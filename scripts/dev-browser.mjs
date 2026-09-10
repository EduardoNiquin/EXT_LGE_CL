#!/usr/bin/env node
// Levanta un navegador de pruebas con la extension del build YA cargada y el
// puerto de depuracion abierto, para poder conducirlo con `browser-eval.mjs` o
// desde el MCP de chrome-devtools.
//
// Por que hace falta: el MCP no lanza navegador, se conecta por CDP a uno que ya
// este corriendo (`--browserUrl http://127.0.0.1:9222`). Si ese navegador se
// abrio sin la extension, no hay forma de instalarla desde una sesion de
// depuracion.
//
// CHROME Y EDGE NO SE COMPORTAN IGUAL (medido en vivo el 10-09-2026):
//   - **Edge 152 estable SI acepta `--load-extension`**: se usa el Edge del
//     sistema tal cual.
//   - **Chrome 152 estable lo IGNORA** (el switch se retiro por seguridad). Se
//     probo con `--disable-features=DisableLoadExtensionCommandLineSwitch` y con
//     `--enable-unsafe-extension-debugging`, y la pagina de la extension seguia
//     dando ERR_BLOCKED_BY_CLIENT; `Extensions.loadUnpacked` por CDP devuelve un
//     id pero tampoco la deja utilizable. Por eso para Chrome se usa **Chrome
//     for Testing**, un binario aparte sin esas restricciones ni politicas de
//     empresa, que se descarga solo la primera vez a `.browsers/`.
//   - Este equipo ademas tiene politica corporativa que fuerza la extension
//     EMPAQUETADA desde C:\ProgramData\EXT_LGE_CL: eso instala el .crx que este
//     ahi, no el build de trabajo. `--disable-extensions-except` la desactiva.
//
// Dos detalles que no son opcionales:
//   1. Desde Chrome 136 el puerto de depuracion se IGNORA sobre el perfil por
//      defecto. Por eso cada navegador usa su `--user-data-dir` propio.
//   2. Ese perfil es PERSISTENTE a proposito: se inicia sesion en Magento (con
//      su 2FA) una sola vez y queda para todas las corridas siguientes.
//
// Uso:
//   npm run browser                    Chrome for Testing en el 9222
//   npm run browser:edge               Edge del sistema en el 9223
//   npm run browser -- --restart       rebuild + reiniciar el que ya este abierto
//                                      (asi se aplica un cambio: ver abajo)
//   npm run browser -- --no-build      sin rebuild (mas rapido entre pruebas)
//   npm run browser -- --port=9300
//   npm run browser -- --url=https://shop.lg.com/obsadm
//   npm run browser -- --system        Chrome del sistema (la extension NO se
//                                      carga; solo para ver la de la politica)

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserVersion, connect, findExtensionId, saveSession, pause } from './lib/cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BROWSERS_DIR = resolve(ROOT, '.browsers');
const CDP_TIMEOUT_MS = 25000;

// Puerto por navegador para que Chrome y Edge puedan convivir levantados.
const DEFAULT_PORT = { chrome: 9222, edge: 9223 };

const args = parseArgs(process.argv.slice(2));
const browser = args.browser === 'edge' ? 'edge' : 'chrome';
const port = Number(args.port) || DEFAULT_PORT[browser];
const distDir = resolve(ROOT, 'dist', browser);
const profileDir = resolve(ROOT, args.profile || `.browser-profile-${browser}`);

main().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
});

async function main() {
  let busy = await browserVersion(port);

  // `--restart` es la forma de aplicar un rebuild: `chrome.runtime.reload()`
  // DESCARGA una extension cargada con `--load-extension` y no la vuelve a
  // cargar (medido en vivo: queda ERR_BLOCKED_BY_CLIENT y sin service worker).
  // Reiniciar el navegador si la recarga, y como el perfil es el mismo no se
  // pierde la sesion de Magento.
  if (busy && args.restart) {
    console.log(`> cerrando el navegador del puerto ${port}`);
    const client = await connect(port);
    await client.send('Browser.close').catch(() => {});
    client.close();
    await pause(2500);
    busy = await browserVersion(port);
  }

  if (busy) {
    throw new Error([
      `El puerto ${port} ya lo tiene tomado otro navegador (${busy.Browser}).`,
      '',
      '  Si es una corrida anterior de este mismo script, reinicia con el build nuevo:',
      `    npm run browser${browser === 'edge' ? ':edge' : ''} -- --restart${args.port ? ` --port=${port}` : ''}`,
      '  O levanta este en otro puerto:',
      `    npm run browser${browser === 'edge' ? ':edge' : ''} -- --port=${port + 10}`,
      '  (si cambias el puerto, apunta ahi el MCP de chrome-devtools con --browserUrl).',
    ].join('\n'));
  }

  if (args.build !== false) {
    console.log(`> build ${browser}`);
    const build = spawnSync('npm', ['run', `build:${browser}`], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (build.status !== 0) throw new Error('El build fallo: revisa la salida de arriba.');
  }
  if (!existsSync(resolve(distDir, 'manifest.json'))) {
    throw new Error(`No hay build en ${distDir}. Corre \`npm run build:${browser}\` primero.`);
  }

  const executable = resolveExecutable();
  mkdirSync(profileDir, { recursive: true });

  const launchArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    // El primer arranque del perfil se come la pantalla de bienvenida y el
    // dialogo de navegador por defecto, que tapan la pagina de prueba.
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (!args.system) {
    launchArgs.push(`--load-extension=${distDir}`, `--disable-extensions-except=${distDir}`);
  }
  launchArgs.push(args.url || 'about:blank');

  console.log(`> ${executable}`);
  console.log(`  perfil:    ${profileDir}`);
  if (!args.system) console.log(`  extension: ${distDir}`);

  spawn(executable, launchArgs, { detached: true, stdio: 'ignore' }).unref();

  const version = await waitForCdp(port);
  console.log(`\n  ${version.Browser} escuchando en http://127.0.0.1:${port}`);

  if (args.system) {
    console.log('  Modo --system: el Chrome estable ignora --load-extension, asi que la extension');
    console.log('  del build NO esta cargada. Solo veras la instalada por politica corporativa.');
    console.log('');
    return;
  }

  // Recien levantado el service worker esta despierto: es el momento de leer el
  // id. Se anota para las llamadas siguientes, cuando ya se haya dormido.
  const id = await findExtensionId(port, { timeout: 15000, useSession: false });
  if (id) saveSession(port, { browser, extensionId: id, profileDir, distDir });
  if (!id) {
    console.log('  No aparecio el service worker de la extension. Revisa la pagina de extensiones.');
    console.log('');
    return;
  }

  console.log(`  Extension ID: ${id}`);
  console.log('');
  console.log('  Conducirlo:');
  console.log(`    npm run browser:eval -- --port=${port} --expr="return __extLgeCl.help()"`);
  console.log(`    npm run browser:eval -- --port=${port} --storage`);
  console.log('');
  console.log('  Paginas de la extension (se abren como pestana normal):');
  console.log(`    popup    chrome-extension://${id}/src/popup/popup.html`);
  console.log(`    ajustes  chrome-extension://${id}/src/options/options.html`);
  if (isFirstRun()) {
    console.log('');
    console.log('  Perfil nuevo: inicia sesion en Magento una vez (con su 2FA) y queda guardada.');
  }
  console.log('');
}

// -----------------------------------------------------------------------------
// binario
// -----------------------------------------------------------------------------

function resolveExecutable() {
  if (args.executable) {
    if (!existsSync(args.executable)) throw new Error(`No existe ${args.executable}`);
    return args.executable;
  }
  // Edge estable carga extensiones sin problema; Chrome estable no, y por eso
  // ahi se baja Chrome for Testing.
  if (browser === 'edge' || args.system) return findSystemExecutable(browser);
  return ensureChromeForTesting();
}

/** Devuelve el binario de Chrome for Testing, descargandolo la primera vez. */
function ensureChromeForTesting() {
  const installed = findChromeForTesting();
  if (installed) return installed;

  console.log('> descargando Chrome for Testing (solo la primera vez)');
  const result = spawnSync('npx', ['--yes', '@puppeteer/browsers', 'install', 'chrome@stable', '--path', BROWSERS_DIR], {
    cwd: ROOT, stdio: 'inherit', shell: true,
  });
  if (result.status !== 0) throw new Error('No se pudo descargar Chrome for Testing.');

  const downloaded = findChromeForTesting();
  if (!downloaded) throw new Error(`Se descargo pero no se encontro el binario dentro de ${BROWSERS_DIR}.`);
  return downloaded;
}

function findChromeForTesting() {
  const root = resolve(BROWSERS_DIR, 'chrome');
  if (!existsSync(root)) return null;
  const binary = process.platform === 'win32' ? 'chrome.exe' : 'chrome';
  // Se filtra por directorio: @puppeteer/browsers deja tambien un archivo
  // `.metadata` suelto aca, y recorrerlo revienta con ENOTDIR.
  const dirs = (parent) => readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(parent, entry.name));
  const candidates = dirs(root)
    .flatMap((versionDir) => dirs(versionDir).map((inner) => resolve(inner, binary)))
    .filter((candidate) => existsSync(candidate));
  // La ultima version descargada es la que manda.
  return candidates.sort().pop() || null;
}

const SYSTEM_CANDIDATES = {
  chrome: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ],
  edge: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/microsoft-edge',
  ],
};

function findSystemExecutable(name) {
  const found = SYSTEM_CANDIDATES[name].filter(Boolean).find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`No se encontro ${name}. Pasa la ruta con --executable="C:\\ruta\\navegador.exe".`);
  return found;
}

// -----------------------------------------------------------------------------

async function waitForCdp(targetPort) {
  const deadline = Date.now() + CDP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const version = await browserVersion(targetPort);
    if (version) return version;
    await pause(300);
  }
  throw new Error(`El navegador no abrio el puerto ${targetPort} en ${CDP_TIMEOUT_MS / 1000}s.`);
}

function isFirstRun() {
  return !existsSync(resolve(profileDir, 'Default', 'Preferences'));
}

function parseArgs(argv) {
  const parsed = {};
  argv.forEach((arg) => {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) return;
    const [, key, value] = match;
    if (key === 'no-build') parsed.build = false;
    else parsed[key] = value === undefined ? true : value;
  });
  return parsed;
}
