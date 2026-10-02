// Un ciclo de "Ventas en vivo": export del grid de ordenes -> portal OBS.
//
// PURO respecto a chrome.*: la red entra por parametro (`fetchImpl`, y la pausa
// por `sleep`), asi el mismo codigo corre en el service worker (fetch de la
// extension) y en el content script de una pestana del admin (fetch de la
// pagina, con su cookie), y se prueba con un fetch falso. Nunca lanza: devuelve
// un resultado.
//
// El export de esta instancia es ASINCRONO (medido el 01-10-2026):
//
//   1. resolver   GET del listado de ordenes -> URL del export (boton Export),
//                 URL de "Export Files Listing" (menu lateral) y form_key.
//   2. foto       GET de la lista de exports -> `maxId` (el mayor id presente).
//   3. encolar    GET gridToCsv?...  -> 302 al listado de ordenes con "Message
//                 is added to queue". Un 500 es error (p. ej. sin store_id).
//   4. sondear    la lista cada `esperaArchivoMs` hasta que haya un item nuevo
//                 (`id > maxId`, type `order`) con status `success`.
//   5. descargar  GET de su `actions.view.href` -> el CSV (sin BOM).
//   6. borrar     POST de su `actions.delete.href` con form_key (opcional,
//                 `borrarArchivo`), DESPUES del POST al portal, salga como salga.
//
// Va en dos mitades porque el content script NO puede hacer el POST al portal
// (desde ahi el fetch sale con el origen de la pagina y el portal no responde
// CORS): la pestana solo saca el CSV (`obtenerCsv`) y el service worker lo envia
// (`terminarEnvio`). El borrado (`borrarArchivo`) es de la mitad Magento: lo
// corre quien tenga la sesion del admin (el SW en `correrCiclo`; la pestana, a
// pedido del SW, cuando el CSV salio de ahi). `correrCiclo` es todo junto.

import {
  API,
  BORRADO_TIMEOUT_MS,
  DEFAULT_ADMIN_BASE,
  DEFAULTS,
  DESCARGA_TIMEOUT_MS,
  ENCOLAR_TIMEOUT_MS,
  EXPORT_LIST_MARCA,
  LISTA_EXPORT_TIMEOUT_MS,
  LISTADO_TIMEOUT_MS,
  ORDERS_LISTING_PATH,
  PORTAL_TIMEOUT_MS,
  RANGO,
  RESULTADO,
  STORE_ID,
} from './constants.js';
import {
  buildExportUrl,
  contarFilasCsv,
  extractExportListUrl,
  extractExportUrl,
  extractFormKey,
  isEncolado,
  isLoginPage,
  looksLikeOrdersCsv,
  mensajeErrorAdmin,
  normalizarAdminBase,
  rangoDeDias,
} from './export-url.js';
import { estadoDe, maxIdDe, parseExportItems, pickNuevo } from './export-list.js';
import { ExtError, isAbortError, toMessage } from '../../../shared/errors/index.js';

const dormir = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// -----------------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------------

/** fetch con timeout que tambien cubre la lectura del cuerpo. */
async function pedirTexto(fetchImpl, url, opciones, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetchImpl(url, { ...opciones, signal: controller.signal });
    const texto = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      texto,
      url: res.url || url,
      redirected: Boolean(res.redirected),
    };
  } catch (err) {
    if (isAbortError(err, controller.signal)) {
      throw new ExtError(`Sin respuesta en ${Math.round(ms / 1000)} s (${recortar(url, 80)}).`, {
        code: 'VEV_TIMEOUT',
        cause: err,
      });
    }
    throw new ExtError(`Fallo de red: ${toMessage(err)}`, { code: 'VEV_RED', cause: err });
  } finally {
    clearTimeout(timer);
  }
}

function recortar(texto, n) {
  const limpio = String(texto || '').replace(/\s+/g, ' ').trim();
  return limpio.length > n ? `${limpio.slice(0, n)}...` : limpio;
}

function error(err, extra = {}) {
  return {
    resultado: RESULTADO.ERROR,
    error: toMessage(err),
    code: err?.code || 'VEV_ERROR',
    status: extra.status ?? null,
    ...extra,
  };
}

function bytesDe(texto) {
  return new TextEncoder().encode(String(texto || '')).length;
}

function entero(valor, fallback) {
  const n = Math.round(Number(valor));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Corto o largo segun el numero de tick (el primero y cada N son largos). */
export function elegirRango(config, tickN, ahora, forzarRango) {
  const cadaN = Math.max(0, Math.round(Number(config?.cadaNTicksLargo)) || 0);
  const n = Math.max(1, Math.round(Number(tickN)) || 1);
  const tipo = forzarRango || (cadaN > 0 && (n - 1) % cadaN === 0 ? RANGO.LARGO : RANGO.CORTO);
  const dias = tipo === RANGO.LARGO ? config?.diasLargos : config?.diasCortos;
  return { tipo, ...rangoDeDias(ahora, dias) };
}

// -----------------------------------------------------------------------------
// Mitad Magento: pasos
// -----------------------------------------------------------------------------

const GET_HTML = { method: 'GET', credentials: 'include', headers: { Accept: 'text/html' } };

/**
 * GET del listado de ordenes -> `{exportUrl, listUrl, formKey}`, o `{login:true}`.
 * Las tres salen del mismo HTML (boton Export, menu lateral, FORM_KEY).
 */
async function resolver(fetchImpl, adminBase) {
  const res = await pedirTexto(fetchImpl, `${adminBase}${ORDERS_LISTING_PATH}`, GET_HTML, LISTADO_TIMEOUT_MS);
  if (isLoginPage(res.texto)) return { login: true };
  if (!res.ok) {
    throw new ExtError(`El admin respondio ${res.status} al pedir el listado de ordenes.`, {
      code: 'VEV_LISTADO_HTTP',
      context: { status: res.status },
    });
  }
  const exportUrl = extractExportUrl(res.texto);
  if (!exportUrl) {
    throw new ExtError('No se encontro la URL del export (boton Export -> CSV) en el listado de ordenes.', {
      code: 'VEV_SIN_URL_EXPORT',
    });
  }
  const listUrl = extractExportListUrl(res.texto, adminBase);
  if (!listUrl) {
    throw new ExtError('No se encontro la URL de "Export Files Listing" (lg_order_export) en el menu del admin.', {
      code: 'VEV_SIN_URL_LISTA',
    });
  }
  return { login: false, exportUrl, listUrl, formKey: extractFormKey(res.texto) };
}

/**
 * GET de "Export Files Listing".
 * @returns {Promise<{login:true}|{vieja:true,status:number}|{items:Array}>}
 *   `vieja` = no termino en la lista (una key vencida redirige al dashboard).
 */
async function leerLista(fetchImpl, listUrl) {
  const res = await pedirTexto(fetchImpl, listUrl, GET_HTML, LISTA_EXPORT_TIMEOUT_MS);
  if (isLoginPage(res.texto)) return { login: true };
  if (!res.ok || !String(res.url || '').includes(EXPORT_LIST_MARCA)) {
    return { vieja: true, status: res.status };
  }
  return { items: parseExportItems(res.texto) };
}

/**
 * GET a gridToCsv: encola el export.
 * @returns {Promise<{tipo:'ok'|'login'|'http'|'otro', status:number, texto?:string}>}
 */
async function encolar(fetchImpl, { exportUrl, rango, storeId }) {
  const url = buildExportUrl(exportUrl, { ...rango, storeId });
  const res = await pedirTexto(fetchImpl, url, { ...GET_HTML, redirect: 'follow' }, ENCOLAR_TIMEOUT_MS);
  if (isLoginPage(res.texto)) return { tipo: 'login', status: res.status };
  if (res.status >= 500) return { tipo: 'http', status: res.status, texto: res.texto };
  if (res.ok && isEncolado(res, res.texto)) return { tipo: 'ok', status: res.status };
  return { tipo: 'otro', status: res.status, ok: res.ok, texto: res.texto };
}

function errorEncolar(r, storeId) {
  if (r.tipo === 'http') {
    return new ExtError(
      `El admin respondio ${r.status} al encolar el export (Store ID ${storeId}; el de Chile es ${STORE_ID}).`,
      { code: 'VEV_ENCOLAR_HTTP', context: { status: r.status } },
    );
  }
  const motivo = mensajeErrorAdmin(r.texto);
  const detalle = motivo
    ? `El admin no encolo el export: ${recortar(motivo, 160)}`
    : (r.ok
      ? `El admin no confirmo el export (falta "added to queue"; empieza con: "${recortar(r.texto, 80)}").`
      : `El admin respondio ${r.status} al encolar el export.`);
  return new ExtError(detalle, { code: 'VEV_NO_ENCOLADO', context: { status: r.status } });
}

/** Archivo de la lista -> lo que viaja en el resultado (sin las URLs de descarga). */
function archivoDe(item) {
  return {
    id: item.id,
    nombre: item.file_path,
    export_time: item.export_time,
    deleteUrl: item.deleteUrl,
  };
}

/**
 * Sondea la lista hasta que aparezca el archivo de este ciclo.
 * @returns {Promise<{login:true}|{item:object}>}
 */
async function esperarArchivo(fetchImpl, { listUrl, maxId, config, sleep }) {
  const paso = entero(config?.esperaArchivoMs, DEFAULTS.esperaArchivoMs);
  const tope = entero(config?.esperaArchivoMaxMs, DEFAULTS.esperaArchivoMaxMs);
  const t0 = Date.now();
  let esperado = 0;
  let ultimo = null;
  for (;;) {
    await sleep(paso);
    esperado += paso;
    const lista = await leerLista(fetchImpl, listUrl);
    if (lista.login) return { login: true };
    if (lista.vieja) {
      throw new ExtError(`La lista de exports no respondio (HTTP ${lista.status}) mientras se esperaba el archivo.`, {
        code: 'VEV_LISTA_HTTP',
        context: { status: lista.status },
      });
    }
    const item = pickNuevo(lista.items, maxId);
    if (item) {
      ultimo = item;
      const estado = estadoDe(item);
      if (estado === 'listo') return { item };
      if (estado === 'fallo') {
        throw new ExtError(`El export del admin termino con estado "${item.status}" (archivo ${item.file_path || item.id}).`, {
          code: 'VEV_EXPORT_FALLO',
          context: { archivo: archivoDe(item) },
        });
      }
    }
    if (esperado >= tope || Date.now() - t0 >= tope) {
      const visto = ultimo ? ` (el ultimo visto seguia "${ultimo.status}")` : '';
      throw new ExtError(`El export no aparecio en ${Math.round(tope / 1000)} s en "Export Files Listing"${visto}.`, {
        code: 'VEV_EXPORT_TIMEOUT',
      });
    }
  }
}

/** GET del archivo -> el CSV. */
async function descargar(fetchImpl, item) {
  if (!item.downloadUrl) {
    throw new ExtError(`El archivo ${item.file_path || item.id} no trae enlace de descarga.`, { code: 'VEV_SIN_DESCARGA' });
  }
  const res = await pedirTexto(fetchImpl, item.downloadUrl, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'text/csv,application/octet-stream,*/*' },
  }, DESCARGA_TIMEOUT_MS);
  if (isLoginPage(res.texto)) return { login: true };
  if (!res.ok) {
    throw new ExtError(`El admin respondio ${res.status} al descargar el export.`, {
      code: 'VEV_DESCARGA_HTTP',
      context: { status: res.status },
    });
  }
  if (!looksLikeOrdersCsv(res.texto)) {
    throw new ExtError(`El archivo descargado no es un CSV de ordenes (empieza con: "${recortar(res.texto, 80)}").`, {
      code: 'VEV_NO_ES_CSV',
      context: { status: res.status },
    });
  }
  return { csv: res.texto };
}

// -----------------------------------------------------------------------------
// Mitad Magento: el CSV del export
// -----------------------------------------------------------------------------

/**
 * Saca el CSV del export con la sesion de `fetchImpl`.
 *
 * @param {object} o
 * @param {object} o.config        config del modulo (DEFAULTS + lo guardado)
 * @param {Function} o.fetchImpl   fetch con la cookie del admin
 * @param {number} [o.ahora]       instante de referencia (para el rango)
 * @param {{exportUrl?:string, listUrl?:string, formKey?:string}} [o.cache]
 *   URLs ya resueltas (se reusan si sirven; si no, se resuelven de nuevo una vez)
 * @param {number} [o.tickN]       numero de tick (decide corto o largo)
 * @param {'corto'|'largo'} [o.forzarRango]
 * @param {(ms:number) => Promise<void>} [o.sleep]  pausa entre sondeos
 * @returns {Promise<object>} `{resultado:'csv', csv, filas, bytes, rango, archivo:{id, nombre,
 *   export_time, deleteUrl}, cache, exportUrl, storeIdUsado, ms}`
 *   | `{resultado:'sesion_caducada', cache:null}` | `{resultado:'error', error, code, status, cache}`
 */
export async function obtenerCsv({
  config,
  fetchImpl,
  ahora = Date.now(),
  cache = null,
  tickN = 1,
  forzarRango,
  sleep = dormir,
} = {}) {
  const inicio = Date.now();
  const adminBase = normalizarAdminBase(config?.adminBase, DEFAULT_ADMIN_BASE);
  const rango = elegirRango(config, tickN, ahora, forzarRango);
  const storeId = String(config?.storeId ?? '').trim() || STORE_ID;
  let actual = cache?.exportUrl && cache?.listUrl ? { ...cache } : null;
  let resueltaAhora = false;
  const sesion = () => ({ resultado: RESULTADO.SESION_CADUCADA, cache: null, exportUrl: '', rango, ms: Date.now() - inicio });

  try {
    const resolverDeNuevo = async () => {
      const r = await resolver(fetchImpl, adminBase);
      if (r.login) return false;
      actual = { exportUrl: r.exportUrl, listUrl: r.listUrl, formKey: r.formKey };
      resueltaAhora = true;
      return true;
    };
    if (!actual && !(await resolverDeNuevo())) return sesion();

    // 2-3. Foto de la lista y encolado. Con URLs de cache que ya no sirven (key
    // de otra sesion: redirigen al dashboard) se resuelve de nuevo una sola vez.
    let maxId = 0;
    for (;;) {
      const lista = await leerLista(fetchImpl, actual.listUrl);
      if (lista.login) return sesion();
      if (lista.vieja) {
        if (!resueltaAhora) {
          if (!(await resolverDeNuevo())) return sesion();
          continue;
        }
        throw new ExtError(`El admin respondio ${lista.status} al pedir la lista de exports (Export Files Listing).`, {
          code: 'VEV_LISTA_HTTP',
          context: { status: lista.status },
        });
      }
      maxId = maxIdDe(lista.items);

      const r = await encolar(fetchImpl, { exportUrl: actual.exportUrl, rango, storeId });
      if (r.tipo === 'ok') break;
      if (r.tipo === 'login') return sesion();
      if (r.tipo === 'otro' && !resueltaAhora) {
        if (!(await resolverDeNuevo())) return sesion();
        continue;
      }
      throw errorEncolar(r, storeId);
    }

    // 4. Esperar el archivo.
    const espera = await esperarArchivo(fetchImpl, { listUrl: actual.listUrl, maxId, config, sleep });
    if (espera.login) return sesion();
    const archivo = archivoDe(espera.item);

    // 5. Descargar.
    let bajada;
    try {
      bajada = await descargar(fetchImpl, espera.item);
    } catch (err) {
      // El archivo queda en el admin para revisarlo a mano.
      err.context = { ...(err.context || {}), archivo };
      throw err;
    }
    if (bajada.login) return sesion();

    return {
      resultado: 'csv',
      csv: bajada.csv,
      filas: contarFilasCsv(bajada.csv),
      bytes: bytesDe(bajada.csv),
      rango,
      archivo,
      cache: actual,
      exportUrl: actual.exportUrl,
      storeIdUsado: storeId,
      ms: Date.now() - inicio,
    };
  } catch (err) {
    return error(err, {
      status: err?.context?.status ?? null,
      archivo: err?.context?.archivo ?? null,
      cache: actual,
      exportUrl: actual?.exportUrl || '',
      rango,
      ms: Date.now() - inicio,
    });
  }
}

/**
 * Borra el archivo del export de "Export Files Listing" (POST con form_key, lo
 * mismo que el boton Delete). Nunca lanza.
 * @returns {Promise<{borrado:boolean, error?:string, status?:number}>}
 */
export async function borrarArchivo({ archivo, formKey, fetchImpl } = {}) {
  try {
    if (!archivo?.deleteUrl) throw new ExtError('El archivo no trae enlace de borrado.', { code: 'VEV_SIN_BORRADO' });
    if (!formKey) throw new ExtError('Falta el form_key del admin para borrar el archivo.', { code: 'VEV_SIN_FORM_KEY' });
    const res = await pedirTexto(fetchImpl, archivo.deleteUrl, {
      method: 'POST',
      credentials: 'include',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ form_key: formKey }).toString(),
    }, BORRADO_TIMEOUT_MS);
    if (isLoginPage(res.texto)) {
      throw new ExtError('Sesion del admin caducada al borrar el archivo.', { code: 'VEV_BORRADO_LOGIN', context: { status: res.status } });
    }
    if (!res.ok) {
      throw new ExtError(`El admin respondio ${res.status} al borrar el archivo.`, {
        code: 'VEV_BORRADO_HTTP',
        context: { status: res.status },
      });
    }
    return { borrado: true, status: res.status };
  } catch (err) {
    return { borrado: false, error: toMessage(err), status: err?.context?.status ?? null };
  }
}

// -----------------------------------------------------------------------------
// Mitad portal: el POST del CSV
// -----------------------------------------------------------------------------

function mensajePortal(status, json, texto) {
  const detalle = json?.message || json?.error || recortar(texto, 120);
  if (status === 401) return 'El portal rechazo el token (401). Revisa el token: es el MAGENTO_PA_TOKEN del portal.';
  if (status === 422) return `El portal rechazo el CSV (422)${detalle ? `: ${detalle}` : '.'}`;
  if (status === 503) return 'El portal no tiene el token configurado (503: falta MAGENTO_PA_TOKEN en su .env).';
  return `El portal respondio ${status}${detalle ? `: ${detalle}` : '.'}`;
}

/**
 * Manda el CSV al portal OBS.
 * @returns {Promise<object>} `{resultado:'ok', carga, hasta, status}` | `{resultado:'error', error, code, status}`
 */
export async function enviarAlPortal({ csv, token, endpoint, fetchImpl } = {}) {
  try {
    if (!token) throw new ExtError('Falta el token del portal.', { code: 'VEV_SIN_TOKEN' });
    let res;
    try {
      res = await pedirTexto(fetchImpl, endpoint || API.BASE_URL, {
        method: 'POST',
        headers: {
          [API.TOKEN_HEADER]: token,
          'Content-Type': 'text/csv',
          Accept: 'application/json',
        },
        body: csv,
      }, PORTAL_TIMEOUT_MS);
    } catch (err) {
      if (err?.code === 'VEV_RED') {
        throw new ExtError(
          `${toMessage(err)}. Si el portal usa un certificado propio, abre ${endpoint || API.BASE_URL} una vez en el navegador y aceptalo.`,
          { code: 'VEV_RED', cause: err },
        );
      }
      throw err;
    }

    let json = null;
    try { json = JSON.parse(res.texto); } catch { /* sin JSON */ }

    if (res.status >= 200 && res.status < 300 && json && json.ok !== false) {
      return {
        resultado: RESULTADO.OK,
        carga: json.carga || null,
        hasta: typeof json.hasta === 'string' ? json.hasta : null,
        status: res.status,
      };
    }
    const code = {
      401: 'VEV_PORTAL_401',
      422: 'VEV_PORTAL_422',
      503: 'VEV_PORTAL_503',
    }[res.status] || (res.ok ? 'VEV_PORTAL_JSON' : 'VEV_PORTAL_HTTP');
    throw new ExtError(mensajePortal(res.status, json, res.texto), { code, context: { status: res.status } });
  } catch (err) {
    return error(err, { status: err?.context?.status ?? null, fase: 'portal' });
  }
}

// -----------------------------------------------------------------------------
// Ciclo completo
// -----------------------------------------------------------------------------

/**
 * Export -> portal -> borrado del archivo.
 *
 * @param {object} o
 * @param {object} o.config
 * @param {string} o.token
 * @param {Function} o.fetchImpl      fetch para el admin (con su cookie)
 * @param {Function} [o.fetchPortal]  fetch para el portal (default: fetchImpl)
 * @param {number} [o.ahora]
 * @param {object} [o.cache]          `{exportUrl, listUrl, formKey}` de un ciclo anterior
 * @param {number} [o.tickN]
 * @param {'corto'|'largo'} [o.forzarRango]
 * @param {(ms:number) => Promise<void>} [o.sleep]
 * @returns {Promise<object>} `{resultado:'ok', carga, hasta, filas, bytes, rango, archivo, borrado, ms, cache}`
 *   | `{resultado:'sesion_caducada', ...}` | `{resultado:'error', error, code, status, ...}`
 */
export async function correrCiclo({
  config,
  token,
  fetchImpl,
  fetchPortal = fetchImpl,
  ahora = Date.now(),
  cache = null,
  tickN = 1,
  forzarRango,
  sleep = dormir,
} = {}) {
  const inicio = Date.now();
  const export_ = await obtenerCsv({ config, fetchImpl, ahora, cache, tickN, forzarRango, sleep });
  if (export_.resultado !== 'csv') return { ...export_, ms: Date.now() - inicio };
  const r = await terminarEnvio(export_, { config, token, fetchPortal, inicio });
  // El borrado va despues del POST, salga como salga: el siguiente tick
  // exporta de nuevo, no hace falta guardar el archivo para reintentar.
  const borrado = await borrarSiCorresponde(export_, { config, fetchImpl });
  return { ...r, ...borrado, ms: Date.now() - inicio };
}

/**
 * Borra el archivo del ciclo si la config lo pide.
 * @returns {Promise<{borrado:boolean|null, errorBorrado?:string}>} `borrado:null` = no se pidio
 */
export async function borrarSiCorresponde(export_, { config, fetchImpl }) {
  if (config?.borrarArchivo === false || !export_?.archivo) return { borrado: null };
  const b = await borrarArchivo({ archivo: export_.archivo, formKey: export_.cache?.formKey, fetchImpl });
  return b.borrado ? { borrado: true } : { borrado: false, errorBorrado: b.error };
}

/**
 * Segunda mitad a partir de un CSV ya obtenido (la usa tambien el service
 * worker cuando el CSV lo saco una pestana del admin). No borra el archivo.
 */
export async function terminarEnvio(export_, { config, token, fetchPortal, inicio = Date.now() }) {
  const { csv, filas, bytes, rango, exportUrl, storeIdUsado, archivo, cache } = export_;
  const base = { filas, bytes, rango, exportUrl, storeIdUsado, archivo: archivo || null, cache: cache || null };
  if (!filas) {
    // Sin ordenes en el rango: el portal contestaria 422 (CSV vacio).
    return { resultado: RESULTADO.OK, sinFilas: true, carga: null, hasta: null, ...base, ms: Date.now() - inicio };
  }
  const envio = await enviarAlPortal({
    csv,
    token,
    endpoint: config?.endpoint || API.BASE_URL,
    fetchImpl: fetchPortal,
  });
  return { ...envio, ...base, ms: Date.now() - inicio };
}
