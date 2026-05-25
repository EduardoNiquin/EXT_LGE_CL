#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$RegFile,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$buildDir = Join-Path $projectRoot 'build'

if (-not $RegFile) {
    $RegFile = if ($Uninstall) {
        Join-Path $buildDir 'uninstall-policy.reg'
    } else {
        Join-Path $buildDir 'install-policy.reg'
    }
}

if (-not (Test-Path $RegFile)) {
    Write-Error "Reg file not found: $RegFile. Run 'npm run release:ext' first."
    exit 1
}

$principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Elevating to administrator..."
    $argList = @('-ExecutionPolicy', 'Bypass', '-File', "`"$($MyInvocation.MyCommand.Path)`"", '-RegFile', "`"$RegFile`"")
    if ($Uninstall) { $argList += '-Uninstall' }
    Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs -Wait
    exit $LASTEXITCODE
}

Write-Host "Applying $RegFile ..."
$proc = Start-Process -FilePath 'reg.exe' -ArgumentList @('import', "`"$RegFile`"") -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) {
    Write-Error "reg import failed with exit code $($proc.ExitCode)"
    exit $proc.ExitCode
}

$keys = @(
    'HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist',
    'HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallSources',
    'HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallAllowlist'
)

if ($Uninstall) {
    Write-Host "`nVerifying removal:"
    foreach ($k in $keys) {
        if (Test-Path $k) {
            Write-Warning "  still present: $k"
        } else {
            Write-Host "  removed: $k"
        }
    }
} else {
    Write-Host "`nVerifying registry keys:"
    foreach ($k in $keys) {
        if (Test-Path $k) {
            Write-Host "  OK  $k"
            Get-ItemProperty -Path $k | Format-List | Out-String | Write-Host
        } else {
            Write-Warning "  MISSING: $k"
        }
    }
}

Write-Host "Restarting Edge to load policy..."
Get-Process -Name 'msedge' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "`nDone. Open edge://policy/ and edge://extensions/ to verify."
