#!/usr/bin/env node
// Ejecuta codigo dentro del navegador de pruebas y devuelve el resultado como
// JSON por stdout. Es la herramienta para conducir la extension sin tocar el
// navegador a mano: abrir el popup, llenar un formulario, leer el estado de un
// run o llamar a la Debug API de una feature en una pagina real.
//
// Requiere el navegador levantado con `npm run browser`.
//
// Donde se evalua (`--page`):
//   popup     chrome-extension://<id>/src/popup/popup.html   (por defecto)
//   options   chrome-extension://<id>/src/options/options.html
//   active    la pestana que ya este abierta (la primera de tipo page)
//   <url>     una url concreta; se abre una pestana nueva
//
// En que mundo (`--world`), y esto importa:
//   isolated  el del content script, donde vive `window.__extLgeCl` en paginas
//             web. Es el DEFECTO para urls http(s).
//   main      el de la pagina. Es lo que hace `evaluate_script` del MCP, y por
//             eso desde ahi NO se ve la Debug API del content script.
//   Las paginas de la extension (popup/options) tienen un solo mundo: ahi estan
//   la Debug API del popup y `chrome.storage.local`.
//
// Ejemplos:
//   npm run browser:eval -- --expr="return __extLgeCl.help()"
//   npm run browser:eval -- --storage
//   npm run browser:eval -- --storage=magento:softbundles:run
//   npm run browser:eval -- --page=active --expr="return __extLgeCl.magentoSoftbundles.diagnose()"
//   npm run browser:eval -- --file=scripts/snippets/abrir-softbundles.js
//   npm run browser:eval -- --page=https://shop.lg.com/obsadm --world=main --expr="return document.title"
//   npm run browser:eval -- --close             cierra el navegador de pruebas
//
// Para aplicar un rebuild NO existe un `--reload`: `chrome.runtime.reload()`
// DESCARGA una extension cargada con `--load-extension` y no la vuelve a cargar
// (queda ERR_BLOCKED_BY_CLIENT y sin service worker; medido en vivo). La forma
// de recargarla es reiniciar el navegador, que conserva el perfil y la sesion:
//   npm run browser -- --restart

import { readFileSync } from 'node:fs';
import {
  CdpError, connect, evaluateInTarget, findExtensionId, listTargets, pause,
} from './lib/cdp.mjs';

const EXTENSION_NAME = 'EXT LGE CL';
const args = parseArgs(process.argv.slice(2));
const port = Number(args.port) || 9222;

main().catch((err) => {
  console.error(`\n  ${err instanceof CdpError ? err.message : (err.stack || err.message)}\n`);
  process.exit(1);
});

async function main() {
  const client = await connect(port);
  try {
    if (args.close) {
      await client.send('Browser.close');
      console.log(`Navegador del puerto ${port} cerrado.`);
      return;
    }

    const extensionId = await findExtensionId(port, { timeout: args.page === 'active' ? 3000 : 12000 });
    if (!extensionId && needsExtension()) {
      throw new CdpError('No se encontro la extension en ese navegador. Levantalo con `npm run browser`.');
    }

    const { expression, world } = buildExpression(extensionId);
    const { targetId, opened } = await resolveTarget(client, extensionId);

    const value = await evaluateInTarget(client, targetId, expression, { world, extensionName: EXTENSION_NAME });
    console.log(JSON.stringify(value === undefined ? null : value, null, 2));

    if (opened && !args.keep) await client.send('Target.closeTarget', { targetId });
  } finally {
    client.close();
  }
}

function needsExtension() {
  return !args.page || args.page === 'popup' || args.page === 'options' || args.storage !== undefined;
}

// -----------------------------------------------------------------------------
// que se evalua
// -----------------------------------------------------------------------------

function buildExpression(extensionId) {
  const page = args.page || 'popup';
  const isExtensionPage = page === 'popup' || page === 'options';
  // El mundo aislado solo existe en paginas web; en las de la extension hay uno solo.
  const world = args.world || (isExtensionPage ? 'main' : 'isolated');

  if (args.storage !== undefined) {
    const key = args.storage === true ? null : String(args.storage);
    // Sin clave se devuelve el indice (clave + tamano + un extracto): el storage
    // de esta extension guarda runs enteros y volcarlos todos tapa la salida.
    const listing = `
      const all = await chrome.storage.local.get(null);
      return Object.entries(all).map(([clave, valor]) => {
        const texto = JSON.stringify(valor) ?? 'null';
        return { clave, bytes: texto.length, extracto: texto.slice(0, 160) };
      }).sort((a, b) => b.bytes - a.bytes);`;
    return {
      world: 'main',
      expression: key
        ? `const all = await chrome.storage.local.get(${JSON.stringify(key)}); return all[${JSON.stringify(key)}] ?? null;`
        : listing,
    };
  }

  if (args.file) return { world, expression: readFileSync(args.file, 'utf8') };
  if (args.expr) return { world, expression: String(args.expr) };

  throw new CdpError('Falta que evaluar: usa --expr="...", --file=<ruta>, --storage o --close.');
}

// -----------------------------------------------------------------------------
// donde se evalua
// -----------------------------------------------------------------------------

async function resolveTarget(client, extensionId) {
  const page = args.page || 'popup';

  if (page === 'active') {
    const targets = await listTargets(port);
    const active = targets.find((target) => target.type === 'page' && !target.url.startsWith('devtools://'));
    if (!active) throw new CdpError('No hay ninguna pestana abierta en el navegador de pruebas.');
    return { targetId: active.id, opened: false };
  }

  const url = page === 'popup' ? `chrome-extension://${extensionId}/src/popup/popup.html`
    : page === 'options' ? `chrome-extension://${extensionId}/src/options/options.html`
      : page;
  const isExtensionUrl = url.startsWith('chrome-extension://');

  // Si esa url ya esta abierta se reusa (encadenar pasos sobre la misma vista
  // del popup es justo lo util), pero SOLO si su contexto sigue vivo: una
  // recarga de la extension deja las pestanas viejas en pie y muertas, y usarlas
  // devuelve "__extLgeCl is not defined" sin mas explicacion.
  const targets = await listTargets(port);
  const existing = targets.find((target) => target.type === 'page' && target.url === url);
  if (existing && await sigueViva(client, existing.id, isExtensionUrl)) return { targetId: existing.id, opened: false };
  if (existing) await client.send('Target.closeTarget', { targetId: existing.id }).catch(() => {});

  const { targetId } = await client.send('Target.createTarget', { url });
  await pause(Number(args.wait) || 2000);
  return { targetId, opened: true };
}

/**
 * True si esa pestana sigue siendo utilizable.
 *
 * En una pagina de extension no alcanza con que se pueda evaluar codigo: la
 * pantalla de error de Chrome (ERR_BLOCKED_BY_CLIENT, la que queda cuando la
 * extension se descargo) tiene contexto JS y responde igual. Lo que la delata es
 * que ahi NO hay `chrome.runtime.id`.
 */
async function sigueViva(client, targetId, esPaginaDeExtension) {
  const sonda = esPaginaDeExtension
    ? 'return typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;'
    : 'return true;';
  try {
    return await evaluateInTarget(client, targetId, sonda) === true;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// recarga de la extension
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------

function parseArgs(argv) {
  const parsed = {};
  argv.forEach((arg) => {
    const match = arg.match(/^--([^=]+)(?:=([\s\S]*))?$/);
    if (!match) return;
    const [, key, value] = match;
    parsed[key] = value === undefined ? true : value;
  });
  return parsed;
}
