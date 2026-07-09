import { cmd, register } from '../../shared/debug/index.js';
import { SELECTORS } from './constants.js';
import { diagnose, getDetalleSections, isSupportSellerPage } from './content/detector.js';
import { parseSections } from './content/parser.js';
import { ensureSection, expandSection, fillSection } from './content/flows/accordion.js';
import { tickIfActive } from './content/flows/run.js';
import { clearRun, getDraft, getRun, setRun } from './state.js';
import {
  diagnose as diagnoseSearch, getCaseCards, getPagination, isCasesPage, readCardMeta,
} from './content/case-search/detector.js';
import {
  closeCaseModal, openCaseModal, parseModalOrders, readModalCaseNumber,
} from './content/case-search/dom.js';
import { tickIfActive as tickSearch } from './content/case-search/run.js';
import { clearSearchRun, getSearchRun } from './state.js';

register('sellerCenterFalabella', {
  diagnose:  cmd(() => diagnose(), 'Diagnóstico de detección del formulario y selectores'),
  detected:  cmd(() => isSupportSellerPage(), 'True si este frame tiene el formulario "Detalle Orden"'),
  selectors: cmd(() => ({ ...SELECTORS }), 'Mapa de selectores que usa la feature'),
  sections:  cmd(() => parseSections(), 'Contenido actual de cada "Detalle Orden" en la página'),
  count:     cmd(() => getDetalleSections().length, 'Cantidad de "Detalle Orden" presentes'),
  state:     cmd(() => getRun(), 'Estado persistido del run actual'),
  draft:     cmd(() => getDraft(), 'Borrador del formulario del popup'),

  fillOne: cmd(async ({ index = 0, ordernumber, guia, cantP } = {}) => {
    const section = await ensureSection(index, {});
    await expandSection(section, {});
    await fillSection(section, { ordernumber, guia, cantP }, {});
    return parseSections()[index];
  }, 'Crea/expande/llena UN "Detalle Orden" ({index?,ordernumber,guia,cantP}) — útil para probar'),

  stop: cmd(async () => {
    const r = await getRun();
    if (!r) return null;
    r.active = false;
    r.finishReason = 'cancelled-manual';
    await setRun(r);
    return r;
  }, 'Marca el run como inactivo'),
  reset: cmd(async () => { await clearRun(); return 'ok'; }, 'Borra el estado del run de storage'),
  tick:  cmd(() => tickIfActive(), 'Fuerza un tick del runner en este frame'),

  // --- "Buscar número de órden en caso" ---
  searchDiagnose: cmd(() => diagnoseSearch(), 'Diagnóstico de detección del listado de casos'),
  searchDetected: cmd(() => isCasesPage(), 'True si este frame tiene el listado de casos'),
  searchState:    cmd(() => getSearchRun(), 'Estado persistido del run de búsqueda'),
  searchCards:    cmd(() => getCaseCards().map(readCardMeta).map(({ button: _b, ...m }) => m), 'Metadatos de los casos visibles'),
  searchPagination: cmd(() => { const p = getPagination(); return p ? { activePage: p.activePage, totalPages: p.totalPages, nextDisabled: p.nextDisabled } : null; }, 'Estado de la paginación'),
  searchTick:     cmd(() => tickSearch(), 'Fuerza un tick del runner de búsqueda en este frame'),
  searchReset:    cmd(async () => { await clearSearchRun(); return 'ok'; }, 'Borra el run de búsqueda de storage'),

  searchReadCase: cmd(async ({ index = 0 } = {}) => {
    const card = getCaseCards()[index];
    if (!card) return null;
    const meta = readCardMeta(card);
    const modal = await openCaseModal(meta.button, {});
    const caseNumber = meta.caseNumber || readModalCaseNumber(modal);
    const orders = parseModalOrders(modal);
    await closeCaseModal({});
    return { caseNumber, caseId: meta.caseId, orders };
  }, 'Abre el caso {index?}, lee su(s) orden(es) y cierra el modal — útil para probar'),
});
