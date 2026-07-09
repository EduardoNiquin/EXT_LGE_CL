// Detección y lectura del listado de casos (acordeón paginado) de Soporte Seller.
//
// El listado vive en `.accordion-container` con N `.accordion-card`. Cada card
// tiene un botón "Detalles del caso" (`button.details-link`) con los datos del
// caso en atributos `data-*` (estables). La paginación es `.pagination-controls`.
// Los atributos `lwc-*` cambian por build → nunca se usan como selectores.

import { SEARCH_SELECTORS } from '../../constants.js';

/** Deja sólo dígitos (quita "N° del caso:", puntos, espacios, etc.). */
export function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** True si en este frame está visible el listado de casos con paginación. */
export function isCasesPage(root = document) {
  return Boolean(
    root.querySelector(SEARCH_SELECTORS.accordionContainer) &&
    root.querySelector(SEARCH_SELECTORS.detailsLink),
  );
}

/** Devuelve las `.accordion-card` del contenedor, en orden de DOM (== visual). */
export function getCaseCards(root = document) {
  const container = root.querySelector(SEARCH_SELECTORS.accordionContainer);
  if (!container) return [];
  return Array.from(container.querySelectorAll(SEARCH_SELECTORS.accordionCard));
}

/** Botón "Detalles del caso" de una card. */
export function getDetailsButton(card) {
  return card ? card.querySelector(SEARCH_SELECTORS.detailsLink) : null;
}

/**
 * Metadatos de un caso a partir de su card: número de caso, id interno y el
 * botón para abrir el detalle. Prioriza los `data-*` del botón (estables); cae
 * al texto de `.case-number` si faltan.
 */
export function readCardMeta(card) {
  const button = getDetailsButton(card);
  const fromBtn = button?.dataset?.caseNumber;
  const fromText = card?.querySelector(SEARCH_SELECTORS.caseNumberText)?.textContent;
  const header = card?.querySelector(SEARCH_SELECTORS.accordionHeader);
  return {
    caseNumber: onlyDigits(fromBtn || fromText),
    caseId: button?.dataset?.caseId || header?.dataset?.id || null,
    button,
  };
}

/** Ids (`data-id`) de las cards actualmente en pantalla (para detectar cambios). */
export function currentCardIds(root = document) {
  return getCaseCards(root)
    .map((c) => readCardMeta(c).caseId || '')
    .filter(Boolean);
}

/**
 * Estado de la paginación: página activa, total (máximo `data-page` visible),
 * botón "siguiente" (">") y si está deshabilitado.
 */
export function getPagination(root = document) {
  const wrap = root.querySelector(SEARCH_SELECTORS.paginationControls);
  if (!wrap) return null;

  const active = wrap.querySelector(SEARCH_SELECTORS.pageActive);
  const activePage = active ? Number(active.dataset.page) : null;

  const totalPages = Array.from(wrap.querySelectorAll(SEARCH_SELECTORS.pageNumber))
    .reduce((max, el) => {
      const n = Number(el.dataset.page);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0) || null;

  const buttons = Array.from(wrap.querySelectorAll(SEARCH_SELECTORS.pageButton));
  const nextBtn = buttons.find((b) => b.textContent.trim() === '>') || buttons[buttons.length - 1] || null;

  return {
    wrap,
    activePage: Number.isFinite(activePage) ? activePage : null,
    totalPages,
    nextBtn,
    nextDisabled: nextBtn ? nextBtn.disabled : true,
  };
}

export function diagnose() {
  const pag = getPagination();
  return {
    detected: isCasesPage(),
    cardCount: getCaseCards().length,
    pagination: pag ? { activePage: pag.activePage, totalPages: pag.totalPages, nextDisabled: pag.nextDisabled } : null,
    url: location.href,
    isTopFrame: window === window.top,
  };
}
