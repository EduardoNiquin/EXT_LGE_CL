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
// form_key, que cambian por sesion— y se piden aparte.

import { DETAIL_SECTION, DETAIL_TIMEOUT_MS, SECTION_LABEL, TAB_URL_RE } from '../constants.js';
import { ExtError, toMessage } from '../../../../shared/errors/index.js';
import { parseLogFragment, parseOrderDetail } from '../detail-parse.js';

/**
 * @param {object} o
 * @param {string} o.href     enlace de la orden (el del grid, que ya trae la key)
 * @param {object} o.sections secciones a capturar
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<object>} el detalle parseado
 */
export async function fetchOrderDetail({ href, sections, signal }) {
  const html = await fetchText(href, signal);

  // La ficha sin sesion devuelve el login, no un 401: si no aparece la tabla de
  // la orden, decirlo claro en vez de emitir una fila vacia.
  const doc = parseHtml(html);
  const detail = parseOrderDetail(doc, { sections });
  if (!detail.orderNumber && !detail.fields.length && !detail.items.length) {
    throw new ExtError(
      'La ficha no trae datos de la orden. Puede haber caducado la sesion del admin: abre una orden a mano y vuelve a intentar.',
      { code: 'IO_DETAIL_EMPTY' },
    );
  }

  if (sections?.[DETAIL_SECTION.LOGS]) {
    detail.fields.push(...await fetchLogTabs(html, href, signal));
  }

  return detail;
}

/**
 * ERP y OSMS Export Log. Si ya vinieron embebidos en la ficha, `parseOrderDetail`
 * los leyo y aca no hace falta nada; si no, se piden por su URL. Un log que no
 * se puede traer no invalida la orden: se anota el motivo y se sigue.
 */
async function fetchLogTabs(html, href, signal) {
  const fields = [];
  const targets = [
    { re: TAB_URL_RE.gerp, section: SECTION_LABEL.erp },
    { re: TAB_URL_RE.osms, section: SECTION_LABEL.osms },
  ];

  for (const target of targets) {
    const match = target.re.exec(html);
    if (!match) continue;
    try {
      const fragment = await fetchText(absolute(match[0], href), signal);
      const pairs = parseLogFragment(parseHtml(fragment), target.section);
      pairs.forEach(([label, value]) => {
        if (label && value) fields.push({ section: target.section, label, value });
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      fields.push({ section: target.section, label: 'Error', value: toMessage(err) });
    }
  }
  return fields;
}

function parseHtml(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Las URLs de las pestanas vienen relativas al host del admin. */
function absolute(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

async function fetchText(url, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'text/html, */*', 'X-Requested-With': 'XMLHttpRequest' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ExtError(`La ficha respondio ${response.status}.`, {
        code: 'IO_DETAIL_HTTP',
        context: { status: response.status },
      });
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
