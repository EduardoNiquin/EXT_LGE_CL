#!/usr/bin/env node
// Construye un ZIP autocontenido para instalar la extensión en otra PC
// sin Node, sin npm, sin VS Code. El destinatario solo:
//   1. Descomprime el ZIP donde sea.
//   2. Hace doble-click en Install.cmd y acepta el UAC.
// El instalador se copia a sí mismo a C:\ProgramData\EXT_LGE_CL\, crea
// update.xml local y aplica las claves de política.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const buildDir = path.resolve(projectRoot, 'build');
const outDir = path.resolve(buildDir, 'installer');

const infoPath = path.join(buildDir, 'pack-info.json');
if (!fs.existsSync(infoPath)) {
  console.error('[installer] build/pack-info.json missing — run "npm run release:ext" first.');
  process.exit(1);
}
const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
const { extensionId, version, crxPath } = info;

if (!fs.existsSync(crxPath)) {
  console.error(`[installer] crx missing: ${crxPath}`);
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const crxName = `extension-${version}.crx`;
fs.copyFileSync(crxPath, path.join(outDir, crxName));

const installPs1 = `# Instalador EXT LGE CL — no requiere Node ni dev tools.
[CmdletBinding()]
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'

$ExtensionId = '${extensionId}'
$Version     = '${version}'
$CrxName     = '${crxName}'
$InstallDir  = Join-Path $env:ProgramData 'EXT_LGE_CL'

# --- auto-elevación ---
$principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Solicitando permisos de administrador..."
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "\`"$($MyInvocation.MyCommand.Path)\`"")
    if ($Uninstall) { $argList += '-Uninstall' }
    Start-Process powershell.exe -ArgumentList $argList -Verb RunAs -Wait
    exit $LASTEXITCODE
}

$EdgePolicyRoot = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge'
$ForceList      = "$EdgePolicyRoot\\ExtensionInstallForcelist"
$Sources        = "$EdgePolicyRoot\\ExtensionInstallSources"
$AllowList      = "$EdgePolicyRoot\\ExtensionInstallAllowlist"

if ($Uninstall) {
    Write-Host "Desinstalando extensión $ExtensionId ..."
    foreach ($k in @($ForceList, $Sources, $AllowList)) {
        if (Test-Path $k) {
            Remove-Item -Path $k -Recurse -Force
            Write-Host "  borrado: $k"
        }
    }
    if (Test-Path $InstallDir) {
        Remove-Item -Path $InstallDir -Recurse -Force
        Write-Host "  borrado: $InstallDir"
    }
    Write-Host ""
    Write-Host "Reiniciando Edge..."
    Get-Process -Name msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "Listo. Cierra esta ventana."
    Read-Host "Presiona ENTER para salir"
    exit 0
}

# --- install ---
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcCrx = Join-Path $scriptDir $CrxName
if (-not (Test-Path $srcCrx)) {
    Write-Error "No se encuentra $CrxName junto al script. Descomprime el ZIP completo y vuelve a intentar."
    Read-Host "Presiona ENTER para salir"
    exit 1
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$dstCrx = Join-Path $InstallDir $CrxName
Copy-Item -Path $srcCrx -Destination $dstCrx -Force
Write-Host "Copiado $CrxName -> $InstallDir"

# update.xml apuntando al .crx local
$crxUrl = 'file:///' + ($dstCrx -replace '\\\\', '/' -replace ' ', '%20')
$updateXmlPath = Join-Path $InstallDir 'update.xml'
$updateXml = @"
<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="$ExtensionId">
    <updatecheck codebase="$crxUrl" version="$Version" />
  </app>
</gupdate>
"@
[System.IO.File]::WriteAllText($updateXmlPath, $updateXml, [System.Text.UTF8Encoding]::new($false))
$updateXmlUrl = 'file:///' + ($updateXmlPath -replace '\\\\', '/' -replace ' ', '%20')
Write-Host "Generado $updateXmlPath"

# Política de Edge
foreach ($k in @($ForceList, $Sources, $AllowList)) {
    New-Item -Path $k -Force | Out-Null
}
New-ItemProperty -Path $ForceList  -Name '1' -PropertyType String -Value "$ExtensionId;$updateXmlUrl" -Force | Out-Null
New-ItemProperty -Path $Sources    -Name '1' -PropertyType String -Value 'file:///*' -Force | Out-Null
New-ItemProperty -Path $AllowList  -Name '1' -PropertyType String -Value $ExtensionId -Force | Out-Null
Write-Host "Política de Edge aplicada."

Write-Host ""
Write-Host "Reiniciando Edge para cargar la política..."
Get-Process -Name msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "==================================================================="
Write-Host " Extensión instalada."
Write-Host " ID:      $ExtensionId"
Write-Host " Versión: $Version"
Write-Host ""
Write-Host " Abriendo Edge para que verifiques con tus propios ojos..."
Write-Host "   - Pestaña 1: edge://extensions/  (debe figurar la extensión)"
Write-Host "   - Pestaña 2: edge://policy/      (debe figurar ExtensionInstallForcelist)"
Write-Host "==================================================================="
Write-Host ""

# Lanzar Edge como el usuario interactivo (no como SYSTEM/admin)
$edgeExe = @(
    "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe",
    "\${env:ProgramFiles(x86)}\\Microsoft\\Edge\\Application\\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($edgeExe) {
    Start-Process -FilePath $edgeExe -ArgumentList @('edge://extensions/', 'edge://policy/')
} else {
    Write-Warning "No se encontró msedge.exe. Abre Edge manualmente y entra a edge://extensions/"
}

Read-Host "Presiona ENTER para cerrar esta ventana"
`;
fs.writeFileSync(path.join(outDir, 'install.ps1'), installPs1);

// Lanzadores .cmd para que el usuario haga doble click
const installCmd = `@echo off
REM Doble-click aqui para instalar. Se pedira UAC.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
`;
const uninstallCmd = `@echo off
REM Doble-click aqui para desinstalar. Se pedira UAC.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall
`;
fs.writeFileSync(path.join(outDir, 'Install.cmd'), installCmd);
fs.writeFileSync(path.join(outDir, 'Uninstall.cmd'), uninstallCmd);

const readme = `EXT LGE CL — Instalación
==========================

Requisitos:
  - Windows 10 u 11
  - Microsoft Edge instalado
  - Permisos de administrador local (te lo pedira el UAC)

Instalar:
  1. Descomprime este ZIP en cualquier carpeta (Escritorio, Descargas, etc.).
  2. Doble-click en  Install.cmd
  3. Acepta el UAC.
  4. La ventana negra te avisa cuando termine.
  5. Abre Edge y verifica en edge://extensions/  -> debe aparecer la extension
     con la etiqueta "Instalada por su organizacion".

Desinstalar:
  1. Doble-click en  Uninstall.cmd
  2. Acepta el UAC.

Detalles tecnicos:
  - La extension se copia a:  C:\\ProgramData\\EXT_LGE_CL\\
  - Se registran tres claves de politica en:
      HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\ExtensionInstallForcelist
      HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\ExtensionInstallSources
      HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\ExtensionInstallAllowlist
  - ID de la extension:  ${extensionId}
  - Version:             ${version}

Si Windows SmartScreen bloquea Install.cmd:
  Click en "Mas informacion" -> "Ejecutar de todas formas".
`;
fs.writeFileSync(path.join(outDir, 'README.txt'), readme);

// Crear ZIP con PowerShell Compress-Archive (sin dependencias)
const zipPath = path.join(buildDir, `EXT_LGE_CL-installer-${version}.zip`);
fs.rmSync(zipPath, { force: true });
try {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force`,
    ],
    { stdio: 'inherit' },
  );
} catch (err) {
  console.error('[installer] Compress-Archive failed:', err.message);
  process.exit(1);
}

console.log('');
console.log('[installer] paquete listo:');
console.log(`  ${zipPath}`);
console.log('');
console.log('[installer] contenido:');
for (const f of fs.readdirSync(outDir)) {
  console.log(`  - ${f}`);
}
console.log('');
console.log('[installer] enviá ese .zip al usuario final. Solo hace doble-click en Install.cmd.');
