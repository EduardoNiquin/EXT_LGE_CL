import { cmd, register } from '../../shared/debug/index.js';
import { LGCOM_HOST_RE, MESSAGES } from './constants.js';
import * as store from './content/capture-store.js';
import { extract } from './content/extractors/index.js';
import { parseSpotlight, waitAndParse } from './content/destacados/check.js';

register('lgcom', {
  diagnose: cmd(
    () => ({
      host: location.hostname,
      isLgcom: LGCOM_HOST_RE.test(location.hostname),
      isTopFrame: window === window.top,
      bridgeInstalled: Boolean(window.__extLgeClGraphqlBridge),
      operations: store.listLatest().map((c) => c.operationName),
    }),
    'Estado de la feature: host, bridge y operaciones captadas',
  ),
  captures: cmd(
    () => store.listLatest(),
    'Resumen de la última captura por operación GraphQL',
  ),
  operation: cmd(
    (name) => store.getLatest(name),
    'Captura completa (con response) de una operación: operation("getPbpProduct")',
  ),
  raw: cmd(
    (name) => store.getLatest(name)?.response ?? null,
    'JSON de respuesta crudo de una operación',
  ),
  pbp: cmd(
    () => {
      const cap = store.getLatest('getPbpProduct');
      if (!cap) return null;
      return extract('getPbpProduct', cap.response);
    },
    'Grupos formateados de la última captura getPbpProduct (PDP)',
  ),
  extract: cmd(
    (name) => {
      const cap = store.getLatest(name);
      if (!cap) return null;
      return extract(name, cap.response);
    },
    'Grupos formateados de una operación con extractor: extract("getAddressLevel1")',
  ),
  clear: cmd(
    () => { store.clear(); return 'ok'; },
    'Vacía el store de capturas en memoria',
  ),
  destacados: cmd(
    () => parseSpotlight(document),
    'Parsea el recuadro de destacados de la página ACTUAL al instante (tags/stock por producto)',
  ),
  destacadosLive: cmd(
    () => waitAndParse(),
    'Espera a que el spotlight renderice en la página ACTUAL y lo parsea',
  ),
  runDestacados: cmd(
    () => chrome.runtime.sendMessage({ type: MESSAGES.RUN_DESTACADOS }),
    'Dispara la revisión completa en el service worker (abre pestañas de fondo)',
  ),
});
