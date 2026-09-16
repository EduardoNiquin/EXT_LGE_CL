// Entra a la ficha de una orden y devuelve lo que hay ahi.
//
// "Entrar" es pedir POR FETCH el mismo enlace que abre el operador
// (`/sales/order/view/order_id/<id>/key/<K>/`) y leer su HTML con DOMParser.
// Es el mismo origen y la misma sesion que la pestana, asi que el servidor
// devuelve exactamente la pagina que se veria; la diferencia es que no ocupa la
// pestana y permite pedir varias ordenes a la vez.
//
// Lo unico que NO se obtiene asi es lo que la pagina arma con su propio JS, y
// de eso solo importan las pestanas que Magento carga por AJAX (ERP y OSMS
// Export Log): para esas se busca su URL dentro del HTML —lleva su propia key y
// form_key, que cambian por sesion— y se piden aparte, LAS DOS A LA VEZ.
//
// Cada peticion se mide (espera hasta la cabecera, descarga, bytes) y la ficha
// devuelve ese `timing`: es lo que permite saber si el tiempo se va en el
// servidor, en el tunel o en el parseo, en vez de adivinarlo.

import {
  ADMIN_BASE_RE,
  DETAIL_RETRY_ATTEMPTS,
  DETAIL_RETRY_DELAY_MS,
  DETAIL_SECTION,
  DETAIL_TIMEOUT_MS,
  SECTION_LABEL,
  TAB_URL_RE,
} from '../constants.js';
import { ExtError, isAbortError, toMessage } from '../../../../shared/errors/index.js';
import { mainContentOf, parseLogFragment, parseOrderDetail } from '../detail-parse.js';
import { sleep } from '../../../../shared/dom/wait.js';

/**
 * @param {object} o
 * @param {string} o.href     enlace de la orden (el del grid, que ya trae la key)
 * @param {object} o.sections secciones a capturar
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<object>} el detalle parseado, con `timing`
 */
export async function fetchOrderDetail({ href, sections, signal }) {
  const page = await fetchTextWithRetry(href, signal);

  // La ficha sin sesion devuelve el login, no un 401: si no aparece la tabla de
  // la orden, decirlo claro en vez de emitir una fila vacia.
  const parseStart = now();
  const doc = parseHtml(mainContentOf(page.text));
  const detail = parseOrderDetail(doc, { sections });
  const parseMs = now() - parseStart;
  if (!detail.orderNumber && !detail.fields.length && !detail.items.length) {
    throw new ExtError(
      'La ficha no trae datos de la orden. Puede haber caducado la sesion del admin: abre una orden a mano y vuelve a intentar.',
      { code: 'IO_DETAIL_EMPTY' },
    );
  }

  const timing = {
    ttfbMs: page.ttfbMs,
    downloadMs: page.downloadMs,
    parseMs,
    logsMs: 0,
    bytes: page.bytes,
    requests: 1,
    retries: page.retries,
  };

  if (sections?.[DETAIL_SECTION.LOGS]) {
    const logsStart = now();
    const logs = await fetchLogTabs(page.text, href, signal, detail.logsEmbedded);
    timing.logsMs = now() - logsStart;
    timing.requests += logs.requests;
    timing.retries += logs.retries;
    timing.bytes += logs.bytes;
    detail.fields.push(...logs.fields);
  }

  detail.timing = timing;
  return detail;
}

/**
 * ERP y OSMS Export Log. En la ficha real vienen EMBEBIDOS (medido 16-09-2026),
 * asi que `parseOrderDetail` ya los leyo y aca no se pide nada: `embedded` dice
 * que contenedores estaban. Solo si uno falta se pide su pestana por AJAX (las
 * dos a la vez si hacen falta ambas). Un log que no se puede traer no invalida
 * la orden: se anota el motivo y se sigue.
 *
 * Pedirlos siempre costaba 2 peticiones y ~280 KB mas por orden (un tercio del
 * trafico, con el tunel saturado) a cambio de nada.
 */
async function fetchLogTabs(html, href, signal, embedded = {}) {
  const targets = [
    { re: TAB_URL_RE.gerp, section: SECTION_LABEL.erp, embedded: !!embedded.erp },
    { re: TAB_URL_RE.osms, section: SECTION_LABEL.osms, embedded: !!embedded.osms },
  ];

  const results = await Promise.all(targets.map(async (target) => {
    if (target.embedded) return null;
    const match = target.re.exec(html);
    if (!match) return null;
    try {
      const fragment = await fetchTextWithRetry(absolute(match[0], href), signal);
      const pairs = parseLogFragment(parseHtml(fragment.text), target.section);
      const fields = pairs
        .filter(([label, value]) => label && value)
        .map(([label, value]) => ({ section: target.section, label, value }));
      return { fields, bytes: fragment.bytes, retries: fragment.retries };
    } catch (err) {
      if (isAbortError(err, signal)) throw err;
      return { fields: [{ section: target.section, label: 'Error', value: toMessage(err) }], bytes: 0, retries: 0 };
    }
  }));

  const out = { fields: [], requests: 0, retries: 0, bytes: 0 };
  for (const result of results) {
    if (!result) continue;
    out.fields.push(...result.fields);
    out.requests += 1;
    out.retries += result.retries;
    out.bytes += result.bytes;
  }
  return out;
}

function parseHtml(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

/**
 * La URL de una pestana. En la ficha real viene absoluta y se usa tal cual. Si
 * viniera como ruta (`/sales/order/...`) se cuelga de la BASE DEL ADMIN sacada
 * del enlace de la ficha (`https://host/obsadm`), nunca del origen pelado:
 * resolverla contra la ficha con `new URL` perdia el `/obsadm` y daba 404.
 */
function absolute(url, base) {
  if (/^https?:\/\//i.test(url)) return url;
  const admin = ADMIN_BASE_RE.exec(base)?.[1];
  if (admin && url.startsWith('/sales/')) return `${admin}${url}`;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

// -----------------------------------------------------------------------------
// Peticion medida, con reintento
// -----------------------------------------------------------------------------

/**
 * Un fallo transitorio (red, timeout, 5xx, 429) se reintenta una vez tras una
 * pausa corta. Lo que no cambia con reintentar (401/403/404, sesion caida) sube
 * a la primera. Cancelar corta en el acto, tambien durante la pausa.
 * @returns {Promise<{ text: string, ttfbMs: number, downloadMs: number, bytes: number, retries: number }>}
 */
export async function fetchTextWithRetry(url, signal, attempts = DETAIL_RETRY_ATTEMPTS) {
  let retries = 0;
  for (;;) {
    try {
      const result = await fetchText(url, signal);
      return { ...result, retries };
    } catch (err) {
      if (isAbortError(err, signal) || retries >= attempts - 1 || !isTransient(err)) throw err;
      retries += 1;
      await sleep(DETAIL_RETRY_DELAY_MS, signal);
    }
  }
}

function isTransient(err) {
  if (err?.code === 'IO_DETAIL_TIMEOUT') return true;
  if (err?.code === 'IO_DETAIL_HTTP') {
    const status = Number(err?.context?.status);
    return status >= 500 || status === 429;
  }
  // `fetch` rechaza con TypeError cuando la red falla (tunel caido, DNS, reset).
  return err instanceof TypeError;
}

/**
 * Pide una URL y mide donde se fue el tiempo: `ttfbMs` es hasta que llega la
 * cabecera (cola del navegador + tunel + lo que tarde el servidor en armar la
 * pagina) y `downloadMs` lo que tarda en bajar el cuerpo. Con `bytes` da el
 * ancho de banda efectivo.
 */
async function fetchText(url, signal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DETAIL_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });

  const start = now();
  try {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'text/html, */*', 'X-Requested-With': 'XMLHttpRequest' },
      signal: controller.signal,
    });
    const headersAt = now();
    if (!response.ok) {
      throw new ExtError(`La ficha respondio ${response.status}.`, {
        code: 'IO_DETAIL_HTTP',
        context: { status: response.status },
      });
    }
    const text = await response.text();
    const end = now();
    return {
      text,
      ttfbMs: Math.round(headersAt - start),
      downloadMs: Math.round(end - headersAt),
      bytes: text.length,
    };
  } catch (err) {
    // El abort propio (timeout) no es una cancelacion del usuario: se traduce a
    // un error con nombre para que el reintento lo reconozca.
    if (timedOut && !signal?.aborted) {
      throw new ExtError(`La ficha no respondio en ${Math.round(DETAIL_TIMEOUT_MS / 1000)} s.`, {
        code: 'IO_DETAIL_TIMEOUT',
        cause: err,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
