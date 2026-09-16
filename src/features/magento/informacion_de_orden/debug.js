import { cmd, register } from '../../../shared/debug/index.js';
import { DEFAULT_SECTIONS, FINISH_REASON, ORDER_VIEW_PATH, PAGE_SIZE, expandSections } from './constants.js';
import { buildMatrix, buildRecord } from './csv.js';
import { clearResult, clearRun, getDraft, getResult, getRun, updateRun } from './state.js';
import { adminBaseFrom, diagnose } from './content/detector.js';
import { fetchGridPage } from './content/client.js';
import { fetchOrderDetail } from './content/order-page.js';
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
  csv: cmd(
    async (allColumns = false) => buildMatrix((await getResult())?.records || [], { allColumns }),
    'Matriz del CSV (headers + filas). csv(true) = todas las columnas',
  ),
  result: cmd(() => getResult(), 'Registros capturados'),
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
