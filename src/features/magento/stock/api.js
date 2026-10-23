// Cliente de la API de stock del portal OBS. PURO respecto a chrome.*: la red
// entra por `fetchImpl`, asi se prueba con un fetch falso. Ninguna funcion
// exportada lanza: devuelven `{ok:true, ...}` o `{ok:false, error, code, status}`.
//
//   GET  <base>          foto del stock: {revision, ultima_ok, umbral, resumen, productos}
//   GET  <base>/alertas  {alertas, ultimo_id, revision}; ?desde_id=&limite= (1..500), orden de id ascendente
//   POST <base>/revisar  201 {revision, alertas} | 409 revision_en_curso | 502 tienda_no_responde
//                        | 401 token | 503 sin token en el servidor | 429 throttle (6 por minuto)
//
// Codigos de error `MST_*` (como `VEV_*` en Ventas en vivo).

import {
  API,
  GET_TIMEOUT_MS,
  LIMITE_ALERTAS,
  MAX_PAGINAS,
  POST_TIMEOUT_MS,
} from './constants.js';
import { ExtError, isAbortError, toMessage } from '../../../shared/errors/index.js';

// -----------------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------------

/** Base de la API (sin barra final). Vacio = la por defecto. */
export function baseDe(endpoint) {
  const base = String(endpoint ?? '').trim() || API.BASE_URL;
  return base.replace(/\/+$/, '');
}

/** Las tres URLs a partir de la base configurada. */
export function urlsDe(endpoint) {
  const base = baseDe(endpoint);
  return { stock: base, alertas: `${base}/alertas`, revisar: `${base}/revisar` };
}

function recortar(texto, n) {
  const s = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

/** fetch con timeout (cubre tambien la lectura del cuerpo) -> {status, ok, texto, json}. */
async function pedir(fetchImpl, url, opciones, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetchImpl(url, { ...opciones, signal: controller.signal });
    const texto = await res.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* sin JSON */ }
    return { status: res.status, ok: res.ok, texto, json };
  } catch (err) {
    if (isAbortError(err, controller.signal)) {
      throw new ExtError(`El portal no respondio en ${Math.round(ms / 1000)} s.`, {
        code: 'MST_TIMEOUT',
        context: { url },
      });
    }
    throw new ExtError(
      `Fallo de red: ${toMessage(err)}. Si el portal usa un certificado propio, abre ${url} una vez en el navegador y aceptalo.`,
      { code: 'MST_RED', cause: err, context: { url } },
    );
  } finally {
    clearTimeout(timer);
  }
}

const CODIGOS = {
  401: 'MST_401',
  409: 'MST_409',
  429: 'MST_429',
  502: 'MST_502',
  503: 'MST_503',
};

/** Mensaje legible de una respuesta que no es 2xx. */
export function mensajeError(status, json, texto) {
  const detalle = json?.message || json?.error || recortar(texto, 120);
  if (status === 401) return 'El portal rechazo el token (401). Revisa el token: es el MAGENTO_PA_TOKEN del portal.';
  if (status === 409) return `El portal ya esta revisando la tienda (409)${json?.message ? `: ${json.message}` : '; espera a que termine.'}`;
  if (status === 429) return 'Demasiadas revisiones seguidas (429): el portal acepta 6 por minuto. Espera un momento.';
  if (status === 502) return `La tienda lg.com/cl no respondio a la revision (502)${json?.message ? `: ${json.message}` : '.'}`;
  if (status === 503) return 'El portal no tiene el token configurado (503: falta MAGENTO_PA_TOKEN en su .env).';
  return `El portal respondio ${status}${detalle ? `: ${detalle}` : '.'}`;
}

/** ExtError de una respuesta HTTP no exitosa (o 2xx sin JSON). */
export function errorDeRespuesta(res) {
  if (res.status >= 200 && res.status < 300) {
    return new ExtError(`El portal respondio ${res.status} sin JSON valido (empieza con: "${recortar(res.texto, 60)}").`, {
      code: 'MST_JSON',
      context: { status: res.status },
    });
  }
  return new ExtError(mensajeError(res.status, res.json, res.texto), {
    code: CODIGOS[res.status] || 'MST_HTTP',
    context: { status: res.status },
  });
}

function fallo(err, extra = {}) {
  return {
    ok: false,
    error: toMessage(err),
    code: err?.code || 'MST_ERROR',
    status: err?.context?.status ?? null,
    ...extra,
  };
}

function cabeceras(token, extra = {}) {
  return { [API.TOKEN_HEADER]: token, Accept: 'application/json', ...extra };
}

function sinToken() {
  return new ExtError('Falta el token del portal.', { code: 'MST_SIN_TOKEN' });
}

function entero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Alertas en orden de id ascendente, sin duplicados ni filas sin id. */
export function ordenarAlertas(alertas) {
  const vistos = new Set();
  const out = [];
  for (const a of Array.isArray(alertas) ? alertas : []) {
    const id = entero(a?.id);
    if (id == null || vistos.has(id)) continue;
    vistos.add(id);
    out.push({ ...a, id });
  }
  return out.sort((a, b) => a.id - b.id);
}

// -----------------------------------------------------------------------------
// Pedidos
// -----------------------------------------------------------------------------

/** Respuesta de GET /stock normalizada (arrays y objetos siempre presentes). */
export function normalizarFoto(json) {
  const r = json?.resumen || {};
  return {
    revision: json?.revision || null,
    ultima_ok: json?.ultima_ok || null,
    umbral: entero(json?.umbral),
    resumen: {
      total: entero(r.total) ?? 0,
      en_stock: entero(r.en_stock) ?? 0,
      preventa: entero(r.preventa) ?? 0,
      agotado: entero(r.agotado) ?? 0,
      fuera: entero(r.fuera) ?? 0,
      poco_stock: entero(r.poco_stock) ?? 0,
    },
    productos: Array.isArray(json?.productos) ? json.productos : [],
  };
}

/** GET /stock. */
export async function getStock({ fetchImpl, endpoint, token } = {}) {
  try {
    if (!token) throw sinToken();
    const res = await pedir(fetchImpl, urlsDe(endpoint).stock, { method: 'GET', headers: cabeceras(token) }, GET_TIMEOUT_MS);
    if (!res.ok || !res.json || typeof res.json !== 'object') throw errorDeRespuesta(res);
    return { ok: true, status: res.status, foto: normalizarFoto(res.json) };
  } catch (err) {
    return fallo(err);
  }
}

/** Una pagina de GET /alertas. `desdeId` null = las ultimas `limite`. */
export async function getAlertas({ fetchImpl, endpoint, token, desdeId = null, limite = LIMITE_ALERTAS } = {}) {
  try {
    if (!token) throw sinToken();
    const params = new URLSearchParams();
    if (desdeId != null) params.set('desde_id', String(desdeId));
    params.set('limite', String(Math.min(LIMITE_ALERTAS, Math.max(1, entero(limite) || LIMITE_ALERTAS))));
    const url = `${urlsDe(endpoint).alertas}?${params.toString()}`;
    const res = await pedir(fetchImpl, url, { method: 'GET', headers: cabeceras(token) }, GET_TIMEOUT_MS);
    if (!res.ok || !res.json || typeof res.json !== 'object') throw errorDeRespuesta(res);
    return {
      ok: true,
      status: res.status,
      alertas: ordenarAlertas(res.json.alertas),
      ultimoId: entero(res.json.ultimo_id),
      revision: res.json.revision || null,
    };
  } catch (err) {
    return fallo(err);
  }
}

/**
 * Todas las alertas con id > `desdeId`, paginando de a `limite` hasta alcanzar
 * `ultimo_id` (tope `maxPaginas`).
 * @returns {Promise<object>} `{ok:true, alertas, ultimoId, ultimoPortal, revision, paginas, completo}`
 *   `completo:false` = se corto por el tope; `ultimoId` es entonces el de la ultima alerta leida.
 */
export async function leerAlertasDesde({
  fetchImpl, endpoint, token, desdeId, limite = LIMITE_ALERTAS, maxPaginas = MAX_PAGINAS,
} = {}) {
  const todas = [];
  let cursor = desdeId;
  let revision = null;
  let ultimoPortal = null;
  for (let pagina = 1; pagina <= maxPaginas; pagina += 1) {
    const r = await getAlertas({ fetchImpl, endpoint, token, desdeId: cursor, limite });
    if (!r.ok) return { ...r, alertas: todas, paginas: pagina };
    revision = r.revision || revision;
    ultimoPortal = r.ultimoId ?? ultimoPortal;
    const nuevas = r.alertas.filter((a) => cursor == null || a.id > cursor);
    todas.push(...nuevas);
    const ultimaLeida = nuevas.length ? nuevas[nuevas.length - 1].id : cursor;
    const faltan = r.alertas.length >= limite && ultimoPortal != null && ultimaLeida != null && ultimaLeida < ultimoPortal;
    if (!faltan || !nuevas.length) {
      const candidatos = [ultimoPortal, ultimaLeida].filter((n) => n != null);
      return {
        ok: true,
        alertas: todas,
        ultimoId: candidatos.length ? Math.max(...candidatos) : null,
        ultimoPortal,
        revision,
        paginas: pagina,
        completo: true,
      };
    }
    cursor = ultimaLeida;
  }
  return {
    ok: true, alertas: todas, ultimoId: cursor, ultimoPortal, revision, paginas: maxPaginas, completo: false,
  };
}

/** POST /revisar: el portal revisa la tienda ahora (tarda ~20-40 s). */
export async function postRevisar({ fetchImpl, endpoint, token } = {}) {
  try {
    if (!token) throw sinToken();
    const res = await pedir(fetchImpl, urlsDe(endpoint).revisar, { method: 'POST', headers: cabeceras(token) }, POST_TIMEOUT_MS);
    if (!res.ok || !res.json || typeof res.json !== 'object') {
      // El 502 trae la revision fallida: sirve para mostrar su mensaje.
      return fallo(errorDeRespuesta(res), { revision: res.json?.revision || null });
    }
    return {
      ok: true,
      status: res.status,
      revision: res.json.revision || null,
      alertas: ordenarAlertas(res.json.alertas),
    };
  } catch (err) {
    return fallo(err);
  }
}
