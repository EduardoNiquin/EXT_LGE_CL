import { cmd, register } from '../../../shared/debug/index.js';
import {
  DEFAULT_ADMIN_BASE,
  DEFAULT_RANGE_DAYS,
  DEFAULT_SECTIONS,
  FINISH_REASON,
  ORDER_VIEW_PATH,
  PAGE_SIZE,
  REST_ORDER_PATH,
  expandSections,
} from './constants.js';
import { buildMatrix, buildRecord } from './csv.js';
import {
  clearResult,
  clearRun,
  getDraft,
  getResultIndex,
  getRun,
  readResultPart,
  updateRun,
} from './state.js';
import { adminBaseFrom, diagnose } from './content/detector.js';
import { fetchGridPage } from './content/client.js';
import { fetchOrderDetail, fetchTextWithRetry } from './content/order-page.js';
import { formatMs } from './stats.js';
import { findOrderInRanges, tickIfActive } from './content/flows/run.js';
import { normalizePayment } from './payment.js';
import { parseOrderDetail } from './detail-parse.js';
import { resetEndpointCache, resolveGridEndpoint } from './content/endpoint.js';
import { splitDateRange } from './grid-request.js';
import { stripHtml } from './grid-parse.js';

register('magentoInformacionDeOrden', {
  diagnose: cmd(() => diagnose(), 'Diagnostico de la pagina actual (admin de Magento)'),
  endpoint: cmd(() => resolveGridEndpoint(), 'Resuelve la key del grid de ordenes'),
  resetEndpoint: cmd(() => { resetEndpointCache(); return true; }, 'Olvida la key guardada'),
  // Una consulta cruda al grid: sirve para ver si los filtros pasan y cuantas
  // ordenes hay antes de lanzar el batch. Un rango largo se pide por bloques,
  // igual que la corrida de verdad, y se informa lo que aporto cada uno.
  probe: cmd(async ({ from, to, page = 1 } = {}) => {
    const { endpoint } = await resolveGridEndpoint();
    const blocks = [];
    for (const range of splitDateRange(from, to)) {
      const data = await fetchGridPage({ endpoint, query: { ...range, page, pageSize: PAGE_SIZE } });
      blocks.push({
        ...range,
        totalRecords: data.totalRecords,
        items: data.items.length,
        sample: data.items.slice(0, 3).map((item) => stripHtml(item.increment_id)),
      });
    }
    return { totalRecords: blocks.reduce((sum, block) => sum + block.totalRecords, 0), blocks };
  }, 'Consulta el grid para un rango: probe({from:"2026-09-01",to:"2026-09-15"})'),
  // Resuelve el enlace de una orden a partir de su numero.
  link: cmd(async (incrementId, { from, to } = {}) => {
    const { endpoint } = await resolveGridEndpoint();
    const match = await findOrderInRanges({ endpoint, dateRanges: splitDateRange(from, to), incrementId });
    if (!match) return { found: false };
    return { found: true, entityId: stripHtml(match.entity_id), href: match?.actions?.view?.href || '' };
  }, 'Enlace de una orden: link("123001427905",{from,to})'),
  // Lee la ficha de una orden: el paso que importa, el que trae el cliente
  // completo, los items, los totales y el historial.
  detail: cmd(async (href, sections = DEFAULT_SECTIONS) => {
    const url = String(href).startsWith('http') ? href : `${adminBaseFrom()}${ORDER_VIEW_PATH}${href}/`;
    return fetchOrderDetail({ href: url, sections: expandSections(sections) });
  }, 'Lee una ficha: detail("<url o entity_id>")'),
  // La ficha abierta ahora mismo en esta pestana, sin pedir nada por red.
  parseCurrent: cmd(
    () => parseOrderDetail(document, { sections: expandSections(DEFAULT_SECTIONS) }),
    'Parsea la ficha que esta abierta en esta pestana',
  ),
  // Una orden de punta a punta: enlace + ficha + la fila que saldria en el CSV.
  order: cmd(async (incrementId, { from, to, sections = DEFAULT_SECTIONS } = {}) => {
    const { endpoint } = await resolveGridEndpoint();
    const match = await findOrderInRanges({ endpoint, dateRanges: splitDateRange(from, to), incrementId });
    if (!match) return { found: false };
    const viewHref = match?.actions?.view?.href || `${adminBaseFrom()}${ORDER_VIEW_PATH}${stripHtml(match.entity_id)}/`;
    const detail = await fetchOrderDetail({ href: viewHref, sections: expandSections(sections) });
    return {
      found: true,
      viewHref,
      payment: normalizePayment(match),
      detail,
      record: buildRecord({ item: match, detail, viewHref }),
    };
  }, 'Captura una orden entera: order("123001427905",{from,to})'),
  // De donde sale la lentitud. Pide UNA ficha sola (linea base) y despues
  // `lanes` a la vez, y compara las esperas: si con N carriles la espera crece
  // escalonada (1x, 2x, 3x... la base), Magento atiende las peticiones de esta
  // sesion de a una y subir carriles no acelera nada. Solo lecturas.
  benchmark: cmd(async ({ href = '', lanes = 4, from, to } = {}) => {
    const url = href ? toDetailUrl(href) : (await firstOrder({ from, to })).href;
    const count = Math.max(1, Math.round(Number(lanes)) || 1);

    const single = await timedFetch(url);
    const batchStart = performance.now();
    const batch = await Promise.all(Array.from({ length: count }, () => timedFetch(url)));
    const batchMs = Math.round(performance.now() - batchStart);

    const waits = batch.map((entry) => entry.ttfbMs).sort((a, b) => a - b);
    const downloads = batch.map((entry) => entry.downloadMs).sort((a, b) => a - b);
    const base = Math.max(1, single.ttfbMs);
    const baseDownload = Math.max(1, single.downloadMs);
    const bytes = batch.reduce((sum, entry) => sum + entry.bytes, 0);
    const throughput = {
      single: kbps(single.bytes, single.ttfbMs + single.downloadMs),
      batch: kbps(bytes, batchMs),
      // Solo la fase de descarga del lote: lo que da el tunel cuando va lleno.
      pipeKBps: kbps(bytes, Math.max(...batch.map((entry) => entry.ttfbMs + entry.downloadMs)) - Math.min(...waits)),
    };

    // Tres firmas distintas (medido 16-09-2026: la real era la segunda):
    //  - serializa: la ESPERA crece escalonada con cada carril (1x, 2x, 3x...).
    //  - satura el tunel: la espera se mantiene pero la DESCARGA se estira con
    //    los carriles, y los KB/s del lote no superan a los de pocos carriles.
    //  - paralelo: ni la espera ni la descarga se estiran.
    let verdict;
    if (waits[waits.length - 1] >= base * Math.max(2.5, count * 0.6) && waits[0] <= base * 1.8) {
      verdict = 'El servidor atiende las peticiones de esta sesion DE A UNA: la espera crece con cada carril. Subir "Consultas simultaneas" no acelera; lo que acelera es pedir menos o menos pesado.';
    } else if (downloads[downloads.length - 1] >= baseDownload * 2.5) {
      verdict = `El TUNEL satura (~${throughput.pipeKBps} KB/s): la descarga se estira con los carriles (${formatMs(baseDownload)} sola, hasta ${formatMs(downloads[downloads.length - 1])} con ${count}). Mas carriles no suman fichas/min; el techo es ~${Math.round((throughput.pipeKBps * 60) / Math.max(1, single.bytes / 1024))} fichas/min con fichas de ${Math.round(single.bytes / 1024)} KB.`;
    } else if (waits[waits.length - 1] <= base * 1.8) {
      verdict = 'El servidor atiende en paralelo y el tunel da abasto: mas carriles si aceleran.';
    } else {
      verdict = 'Resultado mixto: parte de la espera crece con los carriles. Probar con lanes mas altos o repetir para descartar ruido.';
    }

    return {
      url,
      single: describeTimed(single),
      batch: { lanes: count, totalMs: batchMs, requests: batch.map(describeTimed) },
      throughputKBps: throughput,
      resources: resourceTimings(url, count + 1),
      verdict,
    };
  }, 'Mide una ficha sola y N a la vez: benchmark({lanes:6}) o benchmark({href, lanes:12})'),
  // La API REST del admin devolveria la orden entera en JSON por una fraccion
  // del costo de la ficha. En principio la cookie del admin no viaja a /rest/
  // (path /obsadm); esto lo comprueba contra el servidor real. Solo lectura.
  restProbe: cmd(async (entityId = '') => {
    const id = entityId ? String(entityId) : (await firstOrder({})).entityId;
    const origin = new URL(adminBaseFrom() || DEFAULT_ADMIN_BASE).origin;
    const url = `${origin}${REST_ORDER_PATH}${id}`;
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* no era JSON */
    }
    const usable = !!(response.ok && json && (json.increment_id || json.entity_id));
    return {
      url,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      usable,
      bytes: text.length,
      keys: json && typeof json === 'object' ? Object.keys(json).slice(0, 40) : null,
      sample: usable ? null : text.slice(0, 300),
      verdict: usable
        ? 'La REST responde con la sesion del admin: se puede capturar por JSON (hasta 200 ordenes por consulta) en vez de ficha por ficha.'
        : 'La REST no acepta la sesion del admin (lo esperable por el path de la cookie). La captura sigue por la ficha.',
    };
  }, 'Prueba si /rest/V1/orders/<entity_id> acepta la sesion del admin: restProbe("35732098")'),
  // El resultado vive en PARTES (un CSV por parte): estos comandos trabajan
  // sobre una, nunca sobre todo junto, por la misma razon que el popup.
  csv: cmd(async (part = 0, allColumns = false) => {
    const index = await getResultIndex();
    const entry = index?.parts?.[part];
    if (!entry) return { headers: [], rows: [] };
    return buildMatrix(await readResultPart(entry), { allColumns, columns: index.columns });
  }, 'Matriz del CSV de una parte: csv(0) o csv(0, true) para todas las columnas'),
  result: cmd(() => getResultIndex(), 'Indice del resultado: partes, total y columnas'),
  part: cmd(async (part = 0) => {
    const index = await getResultIndex();
    return readResultPart(index?.parts?.[part] ?? part);
  }, 'Registros capturados de una parte: part(0)'),
  state: cmd(() => getRun(), 'Estado persistido de la captura'),
  draft: cmd(() => getDraft(), 'Ultimo formulario guardado'),
  stop: cmd(() => updateRun((run) => ({
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: FINISH_REASON.CANCELLED,
  })), 'Detiene la captura'),
  reset: cmd(async () => { await Promise.all([clearRun(), clearResult()]); return true; }, 'Limpia la captura y su resultado'),
  tick: cmd(() => tickIfActive(), 'Fuerza un tick de la captura'),
});

// ---------------------------------------------------------------------------
// Helpers de los comandos de medicion
// ---------------------------------------------------------------------------

function toDetailUrl(href) {
  return String(href).startsWith('http') ? String(href) : `${adminBaseFrom()}${ORDER_VIEW_PATH}${href}/`;
}

/** La orden mas reciente del rango (por defecto, la ultima semana). */
async function firstOrder({ from, to }) {
  const end = to || new Date().toISOString().slice(0, 10);
  const start = from || new Date(Date.parse(end) - DEFAULT_RANGE_DAYS * 86400000).toISOString().slice(0, 10);
  const { endpoint } = await resolveGridEndpoint();
  const [range] = splitDateRange(start, end);
  const data = await fetchGridPage({ endpoint, query: { ...range, page: 1, pageSize: 1 } });
  const item = data.items[0];
  if (!item) throw new Error(`No hay ordenes entre ${start} y ${end}; pasa {from,to} o un href.`);
  const entityId = stripHtml(item.entity_id);
  return { entityId, href: item?.actions?.view?.href || `${adminBaseFrom()}${ORDER_VIEW_PATH}${entityId}/` };
}

/** Una peticion sin reintento, con sus tiempos. */
async function timedFetch(url) {
  const startedAt = performance.now();
  const result = await fetchTextWithRetry(url, undefined, 1);
  return { ...result, startedAt: Math.round(startedAt) };
}

function describeTimed(entry) {
  return {
    ttfbMs: entry.ttfbMs,
    downloadMs: entry.downloadMs,
    bytes: entry.bytes,
    espera: formatMs(entry.ttfbMs),
    descarga: formatMs(entry.downloadMs),
  };
}

function kbps(bytes, ms) {
  return ms > 0 ? Math.round((bytes / 1024) / (ms / 1000)) : 0;
}

/**
 * Lo que el navegador midio de esas mismas peticiones (Resource Timing): cuanto
 * espero en cola antes de salir, cuanto tardo el servidor, cuanto la descarga,
 * y si el cuerpo vino comprimido. Mismo origen, asi que los tiempos vienen
 * completos. Si no hay entradas (buffer lleno, contexto raro) se devuelve [].
 */
function resourceTimings(url, count) {
  if (typeof performance?.getEntriesByName !== 'function') return [];
  // El buffer por defecto (250) ya viene lleno con lo que cargo la pagina del
  // admin, y entonces las entradas nuevas se descartan en silencio.
  performance.setResourceTimingBufferSize?.(2000);
  return performance.getEntriesByName(url).slice(-count).map((entry) => ({
    colaMs: Math.round(entry.requestStart - entry.startTime),
    servidorMs: Math.round(entry.responseStart - entry.requestStart),
    descargaMs: Math.round(entry.responseEnd - entry.responseStart),
    transferKB: Math.round((entry.transferSize || 0) / 1024),
    encodedKB: Math.round((entry.encodedBodySize || 0) / 1024),
    decodedKB: Math.round((entry.decodedBodySize || 0) / 1024),
    comprimido: entry.encodedBodySize > 0 && entry.decodedBodySize > entry.encodedBodySize,
  }));
}
