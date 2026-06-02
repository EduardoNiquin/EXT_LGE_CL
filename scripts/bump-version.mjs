#!/usr/bin/env node
// Incrementa la versión de la extensión antes de un build/release.
// Fuente de verdad: manifests/manifest.base.json. También sincroniza package.json.
//
// Esquema X.Y: cada bump suma 0.1; cuando Y llega a 9 pasa al siguiente major.
//   0.3 -> 0.4 -> ... -> 0.9 -> 1.0 -> 1.1 -> ... -> 1.9 -> 2.0
// (el componente "patch" de una versión previa tipo X.Y.Z se ignora/descarta).
//
// Uso:
//   node scripts/bump-version.mjs            # +0.1 con rollover (0.3 -> 0.4, 0.9 -> 1.0)
//   node scripts/bump-version.mjs --set=1.2  # fija una versión exacta
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(projectRoot, 'manifests', 'manifest.base.json');
const packagePath = path.join(projectRoot, 'package.json');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

function parseVersion(v) {
  // Acepta X.Y o X.Y.Z (se queda solo con major y minor).
  const parts = String(v).split('.').map((n) => parseInt(n, 10));
  if (parts.length < 2 || parts.slice(0, 2).some((n) => Number.isNaN(n) || n < 0)) {
    throw new Error(`versión inválida: "${v}" (se espera X.Y)`);
  }
  return [parts[0], parts[1]];
}

function nextVersion(current) {
  if (args.set) {
    // Valida el formato y normaliza a X.Y
    return parseVersion(args.set).join('.');
  }
  let [major, minor] = parseVersion(current);
  minor += 1;
  if (minor > 9) {
    major += 1;
    minor = 0;
  }
  return `${major}.${minor}`;
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const current = manifest.version ?? '0.0.0';
const next = nextVersion(current);

manifest.version = next;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// Mantener package.json en sync (sin romper si no existe el campo).
try {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = next;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
} catch {
  // package.json es opcional para el bump del manifest
}

console.log(`[bump] versión: ${current} -> ${next}`);
