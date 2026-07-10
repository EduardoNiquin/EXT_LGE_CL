import { HOST, LABELS, REPORT_PATH, SELECTORS } from '../constants.js';
import {
  findAutocompleteByLabel, findExportButton, findFilenameInput, findGenerarButton, hasExportForm,
} from './mui.js';

/** True si la URL de este frame es la página de "Precios actuales" del backoffice. */
export function isCurrentPricesUrl() {
  return location.hostname === HOST && location.pathname.startsWith(REPORT_PATH);
}

/**
 * True si en este frame se puede operar el export de reportes de SoloTodo:
 * estamos en la página de precios actuales, o ya está abierto el formulario de
 * export, o hay un botón "Exportar" para abrirlo.
 */
export function isSolotodoReportPage() {
  return isCurrentPricesUrl() || hasExportForm() || Boolean(findExportButton());
}

export function diagnose() {
  const fields = {};
  for (const key of ['CATEGORIA', 'MONEDA', 'TIENDAS', 'PAISES']) {
    const ac = findAutocompleteByLabel(LABELS[key]);
    fields[key] = { label: LABELS[key], present: Boolean(ac), value: ac ? ac.input.value : null };
  }
  return {
    detected: isSolotodoReportPage(),
    currentPricesUrl: isCurrentPricesUrl(),
    exportFormOpen: hasExportForm(),
    exportButton: Boolean(findExportButton()),
    fields,
    filenameInput: Boolean(findFilenameInput()),
    generarButton: Boolean(findGenerarButton()),
    url: location.href,
    title: document.title,
    isTopFrame: window === window.top,
    selectors: { ...SELECTORS },
  };
}
