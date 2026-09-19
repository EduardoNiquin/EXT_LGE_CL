#!/usr/bin/env node
// Arranca el MCP de chrome-devtools y se asegura de que al otro lado haya un
// navegador de pruebas CON LA EXTENSION DEL BUILD YA CARGADA.
//
// Por que existe: el MCP no lanza navegador, se conecta por CDP a uno que ya
// este corriendo (`--browserUrl`). Si no hay ninguno, toda herramienta falla; y
// si el que hay se abrio sin la extension, no hay forma de instalarla desde una
// sesion de depuracion. Este wrapper hace de intermediario entre el cliente y el
// MCP: deja pasar el handshake tal cual y, **antes de cada herramienta que se
// use**, se asegura de que haya navegador (lo mismo que `npm run browser`)
// antes de reenviar la llamada.
//
// Es perezoso a proposito: abrir el cliente MCP no abre Chrome; recien lo abre
// cuando de verdad se va a conducir el navegador.
//
// El flag `--categoryExtensions` no es opcional aca: sin el, el MCP se niega a
// navegar a `chrome-extension://...` y no ve ni el popup ni el service worker
// (ver docs/browser-testing.md).
//
// Uso:
//   node scripts/mcp-chrome.mjs                  lo llama el cliente MCP por stdio
//   node scripts/mcp-chrome.mjs --ensure         solo levanta el navegador y sale
//   node scripts/mcp-chrome.mjs --port=9300      otro puerto
//   node scripts/mcp-chrome.mjs --browser=edge   Edge en vez de Chrome
//   node scripts/mcp-chrome.mjs --build          rebuild antes de levantarlo

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserVersion, readSession } from './lib/cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PORT = { chrome: 9222, edge: 9223 };
const MCP_ENTRY = resolve(ROOT, 'node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js');
const BROWSER_TIMEOUT_MS = 90000;
// Cada cuanto se vuelve a comprobar que el navegador sigue vivo. El chequeo es
// un fetch a 127.0.0.1 (menos de 1 ms), pero no hace falta pagarlo en cada
// herramienta de una rafaga.
const REVALIDAR_MS = 5000;

// Metodos del protocolo que NO necesitan navegador: el handshake y los listados
// de capacidades. Todo lo demas (tools/call) espera a que Chrome este arriba.
const SIN_NAVEGADOR = /^(initialize|notifications\/|ping$|tools\/list|prompts\/|resources\/|completion\/|logging\/)/;

const args = parseArgs(process.argv.slice(2));
const browser = args.browser === 'edge' ? 'edge' : 'chrome';
const port = Number(args.port) || DEFAULT_PORT[browser];
const distDir = resolve(ROOT, 'dist', browser);

if (args.ensure) {
  const ok = await ensureBrowser();
  process.exit(ok ? 0 : 1);
} else {
  proxy();
}

// Para no repetir el mismo "ya hay un navegador" en cada revalidacion: se avisa
// cuando se lo encuentra por primera vez, y recien de nuevo si se cayo.
let anunciado = false;

/** Levanta el navegador si no hay ninguno escuchando en el puerto. */
async function ensureBrowser() {
  const version = await browserVersion(port);
  if (version) {
    if (!anunciado) {
      anunciado = true;
      log(`ya hay ${version.Browser} escuchando en http://127.0.0.1:${port}`);
      avisarSiNoEsElDelProyecto(version);
    }
    return true;
  }

  anunciado = false;
  log(`no hay navegador en el ${port}: levantando ${browser} con la extension...`);
  const devBrowser = resolve(ROOT, 'scripts/dev-browser.mjs');
  const argv = [devBrowser, `--browser=${browser}`, `--port=${port}`];
  // El build tarda ~1 s, pero sin `dist/` no hay extension que cargar.
  if (!args.build && existsSync(resolve(distDir, 'manifest.json'))) argv.push('--no-build');

  const code = await run(process.execPath, argv);
  if (code !== 0) {
    log(`dev-browser.mjs termino con codigo ${code}; el MCP va a fallar hasta que haya navegador.`);
    return false;
  }
  const arriba = await browserVersion(port, 5000);
  if (!arriba) {
    log(`el navegador no aparecio en el ${port}.`);
    return false;
  }
  anunciado = true;
  log(`${arriba.Browser} listo en http://127.0.0.1:${port}`);
  return true;
}

// El puerto podria tenerlo un navegador de otro proyecto (o uno abierto a mano
// sin la extension). No se lo cierra por las suyas: solo se avisa, porque
// cerrarlo seria tirar abajo el trabajo de otra ventana.
function avisarSiNoEsElDelProyecto(version) {
  const sesion = readSession(port);
  if (sesion?.distDir && resolve(sesion.distDir) === distDir) return;
  log(
    `ojo: en el ${port} ya hay un navegador (${version.Browser}) que no levanto este proyecto. ` +
      `Si no tiene la extension cargada, cerralo y corre \`npm run browser -- --restart\`.`,
  );
}

/** Intermediario stdio entre el cliente MCP y chrome-devtools-mcp. */
function proxy() {
  const child = lanzarMcp();
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  // 'close' y no 'exit': asi se alcanza a volcar lo que el MCP dejo en el pipe
  // (con 'exit' la ultima respuesta se puede perder).
  child.on('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));

  // Las llamadas que necesitan navegador se encadenan para no perder el orden
  // entre ellas; el resto (handshake, ping, cancelaciones) pasa de largo.
  let cadena = Promise.resolve();

  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!necesitaNavegador(line)) {
      escribir(child, line);
      return;
    }
    cadena = cadena.then(asegurarNavegador).then(() => escribir(child, line));
  });
  // El stdin del MCP se cierra recien cuando se drenaron las pendientes: si se
  // cerrara antes, escribirlas reventaria con ERR_STREAM_WRITE_AFTER_END.
  rl.on('close', () => { cadena.finally(() => child.stdin.end()); });
}

// Momento de la ultima comprobacion exitosa de que el navegador estaba vivo.
let ultimoOk = 0;

/**
 * Se asegura de que haya navegador antes de dejar pasar una herramienta.
 *
 * No alcanza con hacerlo una sola vez: el navegador se puede cerrar a mitad de
 * sesion (`npm run browser -- --restart`, o cerrandolo a mano) y el MCP se
 * reconecta por `--browserUrl` en la llamada siguiente, asi que conviene que lo
 * encuentre levantado. Si falla no se corta nada —que conteste el MCP con su
 * propio error es mas util que quedarse colgado sin respuesta— y se reintenta en
 * la herramienta siguiente.
 */
async function asegurarNavegador() {
  if (Date.now() - ultimoOk < REVALIDAR_MS) return;
  try {
    const ok = await Promise.race([ensureBrowser(), timeout(BROWSER_TIMEOUT_MS)]);
    if (ok) ultimoOk = Date.now();
  } catch (err) {
    log(`no se pudo levantar el navegador: ${err?.message || err}`);
  }
}

function escribir(child, line) {
  if (child.stdin.destroyed || child.stdin.writableEnded) return;
  child.stdin.write(line + '\n');
}

function lanzarMcp() {
  const mcpArgs = [
    `--browserUrl=http://127.0.0.1:${port}`,
    '--categoryExtensions',
    '--no-usage-statistics',
    '--no-performance-crux',
    ...args.resto,
  ];
  // Se prefiere el paquete instalado (rapido y sin red); npx queda de respaldo
  // por si alguien corre el script en una copia sin `npm install`.
  if (existsSync(MCP_ENTRY)) {
    return spawn(process.execPath, [MCP_ENTRY, ...mcpArgs], { stdio: ['pipe', 'pipe', 'pipe'] });
  }
  log('chrome-devtools-mcp no esta en node_modules: se usa npx (mas lento).');
  return spawn('npx', ['-y', 'chrome-devtools-mcp@latest', ...mcpArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  });
}

function necesitaNavegador(line) {
  try {
    const msg = JSON.parse(line);
    return !!msg.method && !SIN_NAVEGADOR.test(msg.method);
  } catch {
    return false;
  }
}

/** Corre un proceso sin ensuciar stdout (que aca es el canal del protocolo). */
function run(command, argv) {
  return new Promise((resolve_) => {
    const child = spawn(command, argv, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => process.stderr.write(d));
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('error', (err) => {
      log(`no se pudo ejecutar ${command}: ${err.message}`);
      resolve_(1);
    });
    child.on('close', (code) => resolve_(code ?? 1));
  });
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout de ${ms} ms`)), ms).unref());
}

function log(message) {
  process.stderr.write(`[mcp-chrome] ${message}\n`);
}

function parseArgs(argv) {
  const out = { resto: [] };
  for (const arg of argv) {
    const match = /^--([\w-]+)(?:=(.*))?$/.exec(arg);
    if (!match) {
      out.resto.push(arg);
      continue;
    }
    const [, name, value] = match;
    if (['port', 'browser', 'ensure', 'build'].includes(name)) out[name] = value ?? true;
    else out.resto.push(arg);
  }
  return out;
}
