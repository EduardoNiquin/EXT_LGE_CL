/**
 * Empaqueta los builds de Chrome y Edge en ZIPs listos para subir a las stores.
 * Uso: node scripts/package.js [chrome|edge|all]
 */
import { execSync } from 'child_process';

const target = process.argv[2] || 'all';
const browsers = target === 'all' ? ['chrome', 'edge'] : [target];

for (const browser of browsers) {
  console.log(`\n[package] Empaquetando ${browser}...`);
  execSync(
    `web-ext build --source-dir dist/${browser} --artifacts-dir packages --overwrite-dest`,
    { stdio: 'inherit' }
  );
}
