// "Ventas en vivo" en el content script de una pestana del admin.
//
// Es el respaldo del service worker: cuando el SW ve el login (sesion caducada
// o su fetch sin la cookie), manda TICK a una pestana del admin abierta y aca se
// saca el export con el fetch de la pagina (cookie de primera parte). Solo la
// mitad Magento: el POST al portal lo hace el SW, porque desde aca el fetch
// sale con el origen de la pagina y el portal no responde CORS. Despues del
// POST el SW manda BORRAR y aca se borra el archivo del export (POST
// same-origin con el form_key).

import { ADMIN_BASE_RE, MESSAGES } from '../constants.js';
import { borrarArchivo, obtenerCsv } from '../ciclo.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('magento/ventas-en-vivo');

const paginaFetch = (url, opciones) => fetch(url, opciones);

export function initVentasEnVivo() {
  if (window !== window.top) return;
  const match = ADMIN_BASE_RE.exec(location.href);
  if (!match) return;
  const adminBase = match[1];

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === MESSAGES.BORRAR) {
      borrarArchivo({ archivo: msg.archivo, formKey: msg.formKey, fetchImpl: paginaFetch })
        .then((r) => {
          log.info('borrado del archivo del export', { archivo: msg.archivo?.nombre, borrado: r.borrado, error: r.error });
          sendResponse(r);
        })
        .catch((err) => sendResponse({ borrado: false, error: toMessage(err) }));
      return true; // respuesta async
    }
    if (msg?.type !== MESSAGES.TICK) return false;
    // La base del admin es la de esta pestana: es la que tiene la sesion.
    const config = { ...(msg.config || {}), adminBase };
    obtenerCsv({ config, fetchImpl: paginaFetch, ahora: msg.ahora || Date.now(), tickN: msg.tickN || 1 })
      .then((r) => {
        log.info('export desde la pestana', { resultado: r.resultado, filas: r.filas, archivo: r.archivo?.nombre, error: r.error });
        sendResponse(r);
      })
      .catch((err) => sendResponse({ resultado: 'error', error: toMessage(err) }));
    return true; // respuesta async
  });
}
