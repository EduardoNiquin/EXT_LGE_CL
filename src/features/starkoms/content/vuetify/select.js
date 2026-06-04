// Driver de los v-select de Vuetify usados en Starkoms:
//   - "Filtro por estado" (grilla de órdenes): el <span> con el label es hermano
//     del .v-select dentro de una columna .d-flex.flex-column.
//   - "Estado del pedido" / "Bodega TO": el <label.v-label> vive DENTRO del slot.
//
// El menú de opciones es teleportado por Vuetify al body como
// `<div class="v-menu__content menuable__content__active">…<div class="v-list">`.
// El slot expone `aria-owns="list-XXXX"` apuntando al id de esa v-list. Se usa
// ese id; si falla, fallback al `.menuable__content__active` activo.

import { SELECTORS } from '../../constants.js';
import { clickEl } from '../../../../shared/dom/events.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('starkoms');

const MAX_SAMPLE = 8;

export class SelectOptionNotFoundError extends Error {
  constructor({ wantedLabel, available, total }) {
    const sample = available.length === 0 ? '(menú vacío)' : available.map((s) => `"${s}"`).join(', ');
    const more = total > available.length ? ` (+${total - available.length} más)` : '';
    super(`Opción "${wantedLabel}" no encontrada en el select. Disponibles: ${sample}${more}`);
    this.name = 'SelectOptionNotFoundError';
    this.wantedLabel = wantedLabel;
  }
}

/** Texto visible de un v-list-item. */
function itemText(it) {
  const title = it.querySelector(SELECTORS.listItemTitle);
  return ((title ? title.textContent : it.textContent) || '').trim();
}

/**
 * Localiza el `.v-select` asociado a un label visible. Cubre tanto el caso del
 * label interno (`<label>` dentro del slot) como el del label hermano (span
 * arriba del select en una columna).
 */
export function findSelectByLabel(labelText, root = document) {
  const lt = labelText.trim().toLowerCase();

  // 1) v-select con <label> interno que matchea.
  for (const sel of root.querySelectorAll(SELECTORS.selectRoot)) {
    const lbl = sel.querySelector('label');
    if (lbl && lbl.textContent.trim().toLowerCase() === lt) return sel;
  }

  // 2) span/label hermano (caso "Filtro por estado").
  const labels = Array.from(root.querySelectorAll('span, label')).filter((el) => {
    const t = el.textContent.trim().toLowerCase();
    return t === lt || t.endsWith(lt);
  });
  for (const lblEl of labels) {
    const sib = lblEl.parentElement?.querySelector(SELECTORS.selectRoot);
    if (sib) return sib;
    const col = lblEl.closest('[class*="col-"], .d-flex, .v-card__text');
    const inCol = col?.querySelector(SELECTORS.selectRoot);
    if (inCol) return inCol;
  }
  return null;
}

/** Valor actualmente seleccionado en un v-select (texto). */
export function selectedValue(selRoot) {
  return (selRoot?.querySelector('.v-select__selection')?.textContent ?? '').trim();
}

/**
 * Abre el select y elige la opción cuyo texto matchea (exacto → ci → contains).
 * Devuelve el texto realmente elegido. Lanza SelectOptionNotFoundError si no está.
 */
export async function selectOption({ selRoot, optionText, signal, timeout = 4000 }) {
  if (!selRoot) throw new Error('selectOption: v-select no encontrado');
  const slot = selRoot.querySelector(SELECTORS.selectSlot) || selRoot.querySelector('.v-input__slot');
  if (!slot) throw new Error('selectOption: v-select sin slot clickeable');

  clickEl(slot);

  const ownsId = slot.getAttribute('aria-owns');
  const listbox = await waitFor(() => {
    let lb = ownsId ? document.getElementById(ownsId) : null;
    if (!lb) lb = document.querySelector(SELECTORS.menuContent);
    return lb && lb.querySelector(SELECTORS.listItem) ? lb : null;
  }, { signal, timeout, interval: 80, description: 'menú del v-select' });

  const items = Array.from(listbox.querySelectorAll(SELECTORS.listItem));
  const want = optionText.trim();
  const wantLc = want.toLowerCase();
  const match =
    items.find((it) => itemText(it) === want) ||
    items.find((it) => itemText(it).toLowerCase() === wantLc) ||
    items.find((it) => itemText(it).toLowerCase().includes(wantLc));

  if (!match) {
    const all = items.map(itemText).filter(Boolean);
    try { clickEl(slot); } catch { /* cerrar menú */ }
    throw new SelectOptionNotFoundError({ wantedLabel: want, available: all.slice(0, MAX_SAMPLE), total: all.length });
  }

  clickEl(match);
  await sleep(120, signal).catch(() => {});
  const chosen = itemText(match);
  log.debug(`select "${optionText}" → "${chosen}"`);
  return chosen;
}

/** Conveniencia: ubicar por label y elegir opción. */
export async function selectByLabel({ labelText, optionText, root = document, signal, timeout = 4000 }) {
  const selRoot = findSelectByLabel(labelText, root);
  if (!selRoot) throw new Error(`No se encontró el select "${labelText}"`);
  return selectOption({ selRoot, optionText, signal, timeout });
}
