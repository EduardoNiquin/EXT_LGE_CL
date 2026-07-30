#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const buildDir = path.resolve(projectRoot, 'build');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const browser = args.browser ?? 'edge';

const POLICY_ROOT = {
  edge: 'Microsoft\\Edge',
  chrome: 'Google\\Chrome',
};

if (!POLICY_ROOT[browser]) {
  console.error(`[policy] unknown browser: ${browser} (expected "edge" or "chrome")`);
  process.exit(1);
}

const infoPath = path.join(buildDir, `pack-info.${browser}.json`);
if (!fs.existsSync(infoPath)) {
  console.error(`[policy] build/pack-info.${browser}.json missing — run "npm run pack:ext${browser === 'edge' ? '' : ':chrome'}" first.`);
  process.exit(1);
}
const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
const { extensionId, version, crxPath } = info;

const crxAbs = path.resolve(crxPath).replace(/\\/g, '/');
const crxUrl = `file:///${encodeURI(crxAbs)}`;
const updateXmlPath = path.join(buildDir, `update.${browser}.xml`);
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

const policyRoot = POLICY_ROOT[browser];

const installReg = `Windows Registry Editor Version 5.00

; Force-install ${extensionId} via local update manifest
[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\${policyRoot}\\ExtensionInstallForcelist]
"1"="${regEscape(extensionId)};${regEscape(updateXmlUrl)}"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\${policyRoot}\\ExtensionInstallSources]
"1"="file:///*"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\${policyRoot}\\ExtensionInstallAllowlist]
"1"="${regEscape(extensionId)}"
`;

const uninstallReg = `Windows Registry Editor Version 5.00

[-HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\${policyRoot}\\ExtensionInstallForcelist]

[-HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\${policyRoot}\\ExtensionInstallSources]

[-HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\${policyRoot}\\ExtensionInstallAllowlist]
`;

fs.writeFileSync(path.join(buildDir, `install-policy.${browser}.reg`), installReg);
fs.writeFileSync(path.join(buildDir, `uninstall-policy.${browser}.reg`), uninstallReg);

console.log('[policy] generated:');
console.log(`  ${updateXmlPath}`);
console.log(`  ${path.join(buildDir, `install-policy.${browser}.reg`)}`);
console.log(`  ${path.join(buildDir, `uninstall-policy.${browser}.reg`)}`);
console.log(`[policy] browser:      ${browser}`);
console.log(`[policy] extension id: ${extensionId}`);
console.log(`[policy] codebase:     ${crxUrl}`);
