// Cliente minimo del Chrome DevTools Protocol para los scripts de `scripts/`.
//
// No se usa puppeteer a proposito: lo unico que hace falta es abrir una pestana,
// evaluar una expresion y leer el resultado. El WebSocket de Node 22 alcanza, y
// asi el repo no suma una dependencia pesada solo para depurar.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TIMEOUT_MS = 30000;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SESSIONS_DIR = resolve(ROOT, '.browsers');

/**
 * Ficha de la sesion de pruebas de un puerto (navegador, perfil e id de la
 * extension). Hace falta porque el service worker MV3 **se duerme a los pocos
 * segundos** y desaparece de `/json/list`: buscar el id por CDP funciona recien
 * levantado el navegador, pero falla en la siguiente llamada. Anotarlo cuando se
 * levanta evita depender de eso.
 */
export function sessionFile(port) {
  return resolve(SESSIONS_DIR, `session-${port}.json`);
}

export function saveSession(port, data) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(sessionFile(port), JSON.stringify({ port, ...data }, null, 2));
}

export function readSession(port) {
  const file = sessionFile(port);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export class CdpError extends Error {}

/** Conecta al navegador que escucha en `port`. */
export async function connect(port, { timeout = 5000 } = {}) {
  const version = await browserVersion(port, timeout);
  if (!version) {
    throw new CdpError([
      `No hay ningun navegador escuchando en http://127.0.0.1:${port}.`,
      '',
      '  Levantalo con:',
      '    npm run browser -- --port=' + port,
    ].join('\n'));
  }
  return openSocket(version.webSocketDebuggerUrl, version);
}

export async function browserVersion(port, timeout = 1500) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeout) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function listTargets(port, timeout = 1500) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(timeout) });
    return response.ok ? await response.json() : [];
  } catch {
    return [];
  }
}

function openSocket(url, version) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    const listeners = new Set();
    let nextId = 0;

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { done, fail } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) fail(new CdpError(`${message.error.message || 'error CDP'} (${message.error.code ?? '?'})`));
        else done(message.result);
        return;
      }
      if (message.method) listeners.forEach((listener) => listener(message));
    });
    ws.addEventListener('error', () => reject(new CdpError('No se pudo abrir el socket de depuracion.')));
    ws.addEventListener('close', () => {
      pending.forEach(({ fail }) => fail(new CdpError('El navegador cerro la conexion.')));
      pending.clear();
    });

    ws.addEventListener('open', () => {
      resolve({
        version,
        send(method, params = {}, sessionId) {
          return new Promise((done, fail) => {
            const id = ++nextId;
            pending.set(id, { done, fail });
            ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
            setTimeout(() => {
              if (!pending.has(id)) return;
              pending.delete(id);
              fail(new CdpError(`Timeout esperando la respuesta de ${method}.`));
            }, DEFAULT_TIMEOUT_MS);
          });
        },
        on(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close() {
          try { ws.close(); } catch { /* ya cerrado */ }
        },
      });
    });
  });
}

export function pause(ms) {
  return new Promise((done) => { setTimeout(done, ms); });
}

/**
 * Id de la extension, leido del target de su service worker.
 *
 * Se filtra por la ruta del service worker del proyecto: sin eso se toma la
 * primera `chrome-extension://` que aparezca, que suelen ser las que el
 * navegador trae de fabrica (se llego a reportar el id de Google Docs Offline).
 */
export async function findExtensionId(port, { timeout = 15000, path = '/src/background/service-worker.js', useSession = true } = {}) {
  // El id anotado al levantar el navegador manda: el service worker pudo
  // dormirse y entonces no hay ningun target por el que preguntar.
  if (useSession) {
    const session = readSession(port);
    if (session?.extensionId) return session.extensionId;
  }
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const targets = await listTargets(port);
    const match = targets
      .map((target) => String(target.url || ''))
      .filter((url) => url.endsWith(path))
      .map((url) => url.match(/^chrome-extension:\/\/([a-p]{32})\//))
      .find(Boolean);
    if (match) return match[1];
    await pause(400);
  }
  return null;
}

/**
 * Evalua una expresion en una pestana.
 *
 * `world`:
 *   - 'main'     el mundo de la pagina (lo que hace `evaluate_script` del MCP).
 *   - 'isolated' el mundo del content script, que es donde vive `__extLgeCl` en
 *                las paginas web. Se ubica su contexto por los eventos de
 *                `Runtime.executionContextCreated`, filtrando los aislados.
 *
 * La expresion se envuelve en una funcion async, asi que admite `await` y un
 * `return` directo.
 */
export async function evaluateInTarget(client, targetId, expression, { world = 'main', extensionName = null } = {}) {
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });

  const contexts = [];
  const off = client.on((message) => {
    if (message.sessionId === sessionId && message.method === 'Runtime.executionContextCreated') {
      contexts.push(message.params.context);
    }
  });

  // `Runtime.enable` reemite los contextos que ya existian, que es como se
  // descubre el mundo aislado de una pagina que ya cargo.
  await client.send('Runtime.enable', {}, sessionId);
  await pause(400);
  off();

  let contextId;
  if (world === 'isolated') {
    const isolated = contexts.filter((context) => context.auxData?.isDefault === false);
    const mine = extensionName
      ? isolated.find((context) => context.name === extensionName)
      : null;
    const chosen = mine || isolated[0];
    if (!chosen) {
      throw new CdpError([
        'No se encontro el mundo aislado del content script en esa pagina.',
        '  Puede que la extension no haya inyectado ahi todavia: recarga la pestana y reintenta.',
        contexts.length ? `  Contextos vistos: ${contexts.map((c) => c.name || '(sin nombre)').join(', ')}` : '',
      ].filter(Boolean).join('\n'));
    }
    contextId = chosen.id;
  }

  const wrapped = `(async () => { ${expression} })()`;
  const result = await client.send('Runtime.evaluate', {
    expression: wrapped,
    returnByValue: true,
    awaitPromise: true,
    ...(contextId ? { contextId } : {}),
  }, sessionId);

  if (result.exceptionDetails) {
    const thrown = result.exceptionDetails.exception;
    throw new CdpError(thrown?.description || thrown?.value || result.exceptionDetails.text || 'La expresion lanzo un error.');
  }
  return result.result?.value;
}
