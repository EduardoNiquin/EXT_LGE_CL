// Logica de "Stock" sobre la API del portal: sondeo de alertas, "Revisar
// ahora" y resumen diario. PURO respecto a chrome.*: la red entra por
// `fetchImpl` y lo guardado por parametro; devuelve que guardar y que
// notificar, y el service worker lo aplica. Nunca lanza.
//
// Alertas: el portal las numera con un id creciente. `ultimoIdVisto` es la
// ultima ya procesada; el sondeo pide `desde_id=<ultimoIdVisto>` y pagina hasta
// `ultimo_id`. La PRIMERA vez (sin `ultimoIdVisto`) solo se guarda `ultimo_id`
// (y unas pocas alertas como ya vistas, para la lista del popup) sin notificar:
// si no, al activar llegaria una avalancha de alertas viejas.
//
// Se guardan (y notifican) solo las de los tipos que la config pide. Antes de
// notificar se descartan las que ya estan guardadas: asi un "Revisar ahora" y
// el sondeo siguiente no avisan dos veces lo mismo.

import { LIMITE_ALERTAS, LIMITE_PRIMERA, VENTANA_RESUMEN_MS } from './constants.js';
import { getAlertas, getStock, leerAlertasDesde, ordenarAlertas, postRevisar } from './api.js';
import { alertasRecientes, filtrarPorTipo, notificacionResumen } from './notificaciones.js';

function maxId(alertas) {
  let max = null;
  for (const a of alertas || []) if (a?.id != null && (max == null || a.id > max)) max = a.id;
  return max;
}

function maxDe(...valores) {
  const n = valores.filter((v) => v != null && Number.isFinite(v));
  return n.length ? Math.max(...n) : null;
}

/** Las que no estan ya en la lista guardada. */
export function sinRepetir(alertas, guardadas) {
  const ids = new Set((Array.isArray(guardadas) ? guardadas : []).map((a) => a.id));
  return (alertas || []).filter((a) => !ids.has(a.id));
}

/**
 * Un sondeo de alertas.
 * @param {object} o
 * @param {number|null} o.ultimoIdVisto
 * @param {object} o.config          normalizada (notificar, endpoint)
 * @param {string} o.token
 * @param {Function} o.fetchImpl
 * @param {Array} [o.guardadas]      alertas ya guardadas (para no repetir)
 * @returns {Promise<object>} `{ok:true, primeraVez, reinicio, alertas, aGuardar, aNotificar, ultimoIdVisto,
 *   revision, paginas, completo}` | `{ok:false, error, code, status}`
 */
export async function sondear({
  ultimoIdVisto = null, config, token, fetchImpl, guardadas = [],
} = {}) {
  const endpoint = config?.endpoint;
  if (ultimoIdVisto == null) {
    const r = await getAlertas({ fetchImpl, endpoint, token, desdeId: null, limite: LIMITE_PRIMERA });
    if (!r.ok) return r;
    return {
      ok: true,
      primeraVez: true,
      reinicio: false,
      alertas: r.alertas,
      aGuardar: filtrarPorTipo(r.alertas, config?.notificar),
      aNotificar: [],
      ultimoIdVisto: maxDe(r.ultimoId, maxId(r.alertas)) ?? 0,
      revision: r.revision,
      paginas: 1,
      completo: true,
    };
  }

  const r = await leerAlertasDesde({ fetchImpl, endpoint, token, desdeId: ultimoIdVisto, limite: LIMITE_ALERTAS });
  if (!r.ok) return r;
  if (r.ultimoPortal != null && r.ultimoPortal < ultimoIdVisto) {
    // El portal numera desde mas abajo que lo ya visto (base rehecha): se
    // empieza de nuevo desde su ultimo id, sin notificar.
    return {
      ok: true,
      primeraVez: false,
      reinicio: true,
      alertas: [],
      aGuardar: [],
      aNotificar: [],
      ultimoIdVisto: r.ultimoPortal,
      revision: r.revision,
      paginas: r.paginas,
      completo: true,
    };
  }
  const aGuardar = filtrarPorTipo(r.alertas, config?.notificar);
  return {
    ok: true,
    primeraVez: false,
    reinicio: false,
    alertas: r.alertas,
    aGuardar,
    aNotificar: sinRepetir(aGuardar, guardadas),
    ultimoIdVisto: maxDe(r.ultimoId, ultimoIdVisto),
    revision: r.revision,
    paginas: r.paginas,
    completo: r.completo,
  };
}

/**
 * "Revisar ahora": POST /revisar y despues un sondeo desde `ultimoIdVisto`,
 * para recoger tambien las alertas de revisiones del cron que aun no se
 * sondearon. Se notifica la union (filtrada y sin repetir). Si el sondeo falla,
 * `ultimoIdVisto` no avanza (avanzar a las ids de la revision saltaria las del
 * cron intermedias; el sondeo siguiente las trae y las ya notificadas no se
 * repiten).
 * @returns {Promise<object>} `{ok:true, revision, alertasRevision, aGuardar, aNotificar, ultimoIdVisto, sondeo}`
 *   | `{ok:false, error, code, status, revision?}`
 */
export async function revisar({
  ultimoIdVisto = null, config, token, fetchImpl, guardadas = [],
} = {}) {
  const post = await postRevisar({ fetchImpl, endpoint: config?.endpoint, token });
  if (!post.ok) return post;

  let sondeo = null;
  if (ultimoIdVisto != null) {
    sondeo = await sondear({ ultimoIdVisto, config, token, fetchImpl, guardadas });
  }
  const sondeoOk = Boolean(sondeo?.ok && !sondeo.reinicio);
  const desde = ultimoIdVisto ?? -Infinity;
  const candidatas = ordenarAlertas([...post.alertas, ...(sondeoOk ? sondeo.alertas : [])])
    .filter((a) => a.id > desde);
  const aGuardar = filtrarPorTipo(candidatas, config?.notificar);

  let nuevoUltimo = ultimoIdVisto;
  if (sondeo?.ok) nuevoUltimo = maxDe(sondeo.ultimoIdVisto, sondeoOk ? maxId(post.alertas) : null);
  else if (ultimoIdVisto == null) nuevoUltimo = maxId(post.alertas);

  return {
    ok: true,
    status: post.status,
    revision: post.revision,
    alertasRevision: post.alertas,
    aGuardar,
    aNotificar: sinRepetir(aGuardar, guardadas),
    ultimoIdVisto: nuevoUltimo,
    sondeo: sondeo ? { ok: sondeo.ok, error: sondeo.error || null, reinicio: Boolean(sondeo.reinicio) } : null,
  };
}

/**
 * Resumen diario: GET /stock + las alertas de las ultimas 24 h (todos los
 * tipos: es una foto del estado, no un aviso).
 * @returns {Promise<{stock:object, notificacion:object, alertas24h:Array}>}
 */
export async function armarResumen({ config, token, fetchImpl, ahora = Date.now() } = {}) {
  const endpoint = config?.endpoint;
  const stock = await getStock({ fetchImpl, endpoint, token });
  let alertas24h = [];
  if (stock.ok) {
    const r = await getAlertas({ fetchImpl, endpoint, token, desdeId: null, limite: LIMITE_ALERTAS });
    if (r.ok) alertas24h = alertasRecientes(r.alertas, ahora, VENTANA_RESUMEN_MS);
  }
  return {
    stock,
    alertas24h,
    notificacion: notificacionResumen({
      foto: stock.ok ? stock.foto : null,
      alertas24h,
      error: stock.ok ? null : stock.error,
      ahora,
    }),
  };
}
