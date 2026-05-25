#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const buildDir = path.resolve(projectRoot, 'build');

const infoPath = path.join(buildDir, 'pack-info.json');
if (!fs.existsSync(infoPath)) {
  console.error('[policy] build/pack-info.json missing — run "npm run pack:ext" first.');
  process.exit(1);
}
const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
const { extensionId, version, crxPath } = info;

const crxAbs = path.resolve(crxPath).replace(/\\/g, '/');
const crxUrl = `file:///${encodeURI(crxAbs)}`;
const updateXmlPath = path.join(buildDir, 'update.xml');
const updateXmlAbs = path.resolve(updateXmlPath).replace(/\\/g, '/');
const updateXmlUrl = `file:///${encodeURI(updateXmlAbs)}`;

const updateXml = `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${extensionId}">
    <updatecheck codebase="${crxUrl}" version="${version}" />
  </app>
</gupdate>
`;
fs.writeFileSync(updateXmlPath, updateXml);

const regEscape = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const installReg = `Windows Registry Editor Version 5.00

; Force-install ${extensionId} via local update manifest
[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Edge\\ExtensionInstallForcelist]
"1"="${regEscape(extensionId)};${regEscape(updateXmlUrl)}"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Edge\\ExtensionInstallSources]
"1"="file:///*"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Edge\\ExtensionInstallAllowlist]
"1"="${regEscape(extensionId)}"
`;

const uninstallReg = `Windows Registry Editor Version 5.00

[-HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Edge\\ExtensionInstallForcelist]

[-HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Edge\\ExtensionInstallSources]

[-HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Edge\\ExtensionInstallAllowlist]
`;

fs.writeFileSync(path.join(buildDir, 'install-policy.reg'), installReg);
fs.writeFileSync(path.join(buildDir, 'uninstall-policy.reg'), uninstallReg);

console.log('[policy] generated:');
console.log(`  ${updateXmlPath}`);
console.log(`  ${path.join(buildDir, 'install-policy.reg')}`);
console.log(`  ${path.join(buildDir, 'uninstall-policy.reg')}`);
console.log(`[policy] extension id: ${extensionId}`);
console.log(`[policy] codebase:     ${crxUrl}`);
