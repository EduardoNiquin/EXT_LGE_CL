// Comandos de debug de "Ventas en vivo" -> window.__extLgeCl.magentoVentasEnVivo.*
//
// Se registran en el content script (via magento/debug.js) y en el service
// worker (background/index.js, que reemplaza `tick` por la llamada directa).
// `probe`, `exportUrl` y `exportSeco` usan el fetch del contexto donde se
// corren (`exportSeco` deja un archivo en Export Files Listing y lo borra si
// `borrarArchivo`): en el SW dicen si su fetch lleva la cookie del admin; en la pestana
// del admin, si la sesion de la pagina sirve.

import { cmd, register } from '../../../shared/debug/index.js';
import { DEFAULT_ADMIN_BASE, MESSAGES, ORDERS_LISTING_PATH } from './constants.js';
import { getConfig, getEstado, getHistorial, limpiarEstado } from './state.js';
import { borrarSiCorresponde, obtenerCsv } from './ciclo.js';
import {
  cabeceraCsv,
  extractExportListUrl,
  extractExportUrl,
  extractFormKey,
  isLoginPage,
  normalizarAdminBase,
} from './export-url.js';
import { toMessage } from '../../../shared/errors/index.js';

const NAMESPACE = 'magentoVentasEnVivo';

async function baseDelAdmin(adminBase) {
  const config = await getConfig();
  return normalizarAdminBase(adminBase || config.adminBase, DEFAULT_ADMIN_BASE);
}

/** GET del listado de ordenes con el fetch de este contexto. */
async function probarListado(adminBase) {
  const base = await baseDelAdmin(adminBase);
  const url = `${base}${ORDERS_LISTING_PATH}`;
  try {
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html' } });
    const html = await res.text();
    return {
      url,
      status: res.status,
      urlFinal: res.url,
      bytes: html.length,
      login: isLoginPage(html),
      exportUrl: extractExportUrl(html),
      listUrl: extractExportListUrl(html, base),
      formKey: Boolean(extractFormKey(html)),
    };
  } catch (err) {
    return { url, error: toMessage(err) };
  }
}

const BASE = {
  estado: cmd(() => getEstado(), 'Estado de la ultima corrida'),
  config: cmd(() => getConfig(), 'Config guardada (con los valores por defecto)'),
  historial: cmd(() => getHistorial(), 'Ultimas corridas (la mas nueva primero)'),
  tick: cmd(
    () => chrome.runtime.sendMessage({ type: MESSAGES.TICK_NOW }),
    'Pide al service worker un ciclo ahora (export -> portal) y devuelve el resultado',
  ),
  probe: cmd(
    (adminBase) => probarListado(adminBase),
    'GET del listado de ordenes con el fetch de este contexto: status, login?, URL del export y de Export Files Listing',
  ),
  exportUrl: cmd(
    async (adminBase) => (await probarListado(adminBase)).exportUrl || null,
    'Solo la URL del export (null si no aparece o hay login)',
  ),
  exportSeco: cmd(async ({ rango, tickN = 2 } = {}) => {
    const config = await getConfig();
    const fetchImpl = (u, o) => fetch(u, o);
    const r = await obtenerCsv({ config, fetchImpl, tickN, forzarRango: rango });
    const { csv, cache: _cache, ...resto } = r;
    if (r.resultado !== 'csv') return resto;
    // Mismo criterio que el ciclo: si la config lo pide, el archivo se borra del admin.
    const borrado = await borrarSiCorresponde(r, { config, fetchImpl });
    return { ...resto, ...borrado, cabecera: cabeceraCsv(csv) };
  }, 'Encola el export, espera el archivo y lo baja con el fetch de este contexto SIN mandarlo al portal (lo borra si borrarArchivo): exportSeco({rango:"corto"|"largo"})'),
  reset: cmd(async () => { await limpiarEstado(); return true; }, 'Borra el estado y el historial (no la config)'),
};

/** Registra los comandos; `extra` reemplaza o suma (el SW cambia `tick`). */
export function registrarDebug(extra = {}) {
  register(NAMESPACE, { ...BASE, ...extra });
}

registrarDebug();
