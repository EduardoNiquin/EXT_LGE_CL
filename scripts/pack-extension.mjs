#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const browser = args.browser ?? 'edge';
const sourceDir = path.resolve(projectRoot, args.source ?? `dist/${browser}`);
const keysDir = path.resolve(projectRoot, 'keys');
const buildDir = path.resolve(projectRoot, 'build');
const pemPath = path.resolve(keysDir, args.pem ?? 'extension.pem');

const PACKERS = {
  edge: {
    env: 'MSEDGE_PATH',
    candidates: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
  },
  chrome: {
    env: 'CHROME_PATH',
    candidates: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
    ],
  },
};

if (!PACKERS[browser]) {
  console.error(`[pack] unknown browser: ${browser} (expected "edge" or "chrome")`);
  process.exit(1);
}

if (!fs.existsSync(sourceDir)) {
  console.error(`[pack] source dir not found: ${sourceDir}`);
  console.error(`[pack] run "npm run build:${browser}" first.`);
  process.exit(1);
}

const manifestPath = path.join(sourceDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`[pack] manifest.json missing in ${sourceDir}`);
  process.exit(1);
}

fs.mkdirSync(keysDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });

let pemFreshlyGenerated = false;
if (!fs.existsSync(pemPath)) {
  console.log(`[pack] generating new RSA key at ${pemPath}`);
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(pemPath, pem, { mode: 0o600 });
  pemFreshlyGenerated = true;
} else {
  console.log(`[pack] reusing key ${pemPath}`);
}

const privateKey = crypto.createPrivateKey(fs.readFileSync(pemPath));
const publicKey = crypto.createPublicKey(privateKey);
const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
const keyB64 = spkiDer.toString('base64');

const hash = crypto.createHash('sha256').update(spkiDer).digest('hex');
const extensionId = hash
  .slice(0, 32)
  .split('')
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join('');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.key !== keyB64) {
  manifest.key = keyB64;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('[pack] injected "key" into manifest.json');
}
const version = manifest.version;

const packer = PACKERS[browser];
const packerExe = [args[browser], process.env[packer.env], ...packer.candidates]
  .filter(Boolean)
  .find((p) => fs.existsSync(p));

if (!packerExe) {
  console.error(`[pack] ${browser} executable not found. Tried:`);
  for (const c of [args[browser], process.env[packer.env], ...packer.candidates]) {
    if (c) console.error(`  - ${c}`);
  }
  console.error(`[pack] pass --${browser}="C:\\path\\to\\${browser === 'edge' ? 'msedge' : 'chrome'}.exe" or set ${packer.env}.`);
  process.exit(1);
}

console.log(`[pack] packing ${sourceDir} with ${browser}...`);
try {
  execFileSync(
    packerExe,
    [`--pack-extension=${sourceDir}`, `--pack-extension-key=${pemPath}`],
    { stdio: 'inherit' },
  );
} catch (err) {
  console.error(`[pack] ${browser} --pack-extension failed:`, err.message);
  process.exit(1);
}

const parentDir = path.dirname(sourceDir);
const generatedCrx = path.join(parentDir, `${path.basename(sourceDir)}.crx`);
if (!fs.existsSync(generatedCrx)) {
  console.error(`[pack] expected .crx not found at ${generatedCrx}`);
  process.exit(1);
}

const finalCrx = path.join(buildDir, `${browser}-${version}.crx`);
fs.copyFileSync(generatedCrx, finalCrx);
fs.writeFileSync(path.join(buildDir, 'extension-id.txt'), extensionId);
fs.writeFileSync(
  path.join(buildDir, `pack-info.${browser}.json`),
  JSON.stringify(
    { browser, version, extensionId, crxPath: finalCrx, keyB64 },
    null,
    2,
  ),
);

console.log(`[pack] extension id: ${extensionId}`);
console.log(`[pack] crx:          ${finalCrx}`);
console.log(`[pack] version:      ${version}`);
if (pemFreshlyGenerated) {
  console.log('');
  console.log('[pack] WARNING: a new private key was generated.');
  console.log(`[pack]   guard it: ${pemPath}`);
  console.log('[pack]   it is already excluded by .gitignore — do NOT commit it.');
  console.log('[pack]   losing it means the extension ID changes for all users.');
}
