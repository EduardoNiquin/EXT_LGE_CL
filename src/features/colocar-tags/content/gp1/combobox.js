// Driver de los comboboxes L-* del modal Marketing Info.
//
// Cada combobox tiene estructura:
//   <div class="combobox combobox-list">
//     <div class="group">
//       <input id="...">
//       <button>
//     </div>
//     <ul role="listbox">
//       <li>opción A</li>
//       <li>opción B</li>
//       ...
//     </ul>
//   </div>
//
// Las opciones (tags / groups / etc.) son **dinámicas**: las populates el
// backend de GP1 y varían entre productos. No se pueden hardcodear. Si el
// usuario tipea un label que no está en el listbox, el driver lanza
// `ComboboxOptionNotFoundError` con una muestra de las opciones disponibles
// para que el flow lo reporte como error claro del SKU (no como timeout
// genérico ni como un valor "fantasma" escrito al input).

import { waitFor, waitForElement } from '../../../../shared/dom/wait.js';
import { clickEl, findByText, setInputValue } from '../../../../shared/dom/events.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('colocar-tags:combobox');

const MAX_SAMPLE = 8;

/**
 * Se lanza cuando el listbox no tiene un `<li>` cuyo texto matchee `wantedLabel`,
 * ni con match exacto ni case-insensitive. Incluye una muestra de los textos
 * disponibles (truncada) para diagnóstico.
 */
export class ComboboxOptionNotFoundError extends Error {
  constructor({ wantedLabel, inputSelector, availableSample, totalOptions }) {
    const sample = availableSample.length === 0
      ? '(listbox vacío)'
      : availableSample.map((s) => `"${s}"`).join(', ');
    const more = totalOptions > availableSample.length ? ` (+${totalOptions - availableSample.length} más)` : '';
    super(`Opción "${wantedLabel}" no encontrada en ${inputSelector}. Disponibles: ${sample}${more}`);
    this.name = 'ComboboxOptionNotFoundError';
    this.wantedLabel = wantedLabel;
    this.inputSelector = inputSelector;
    this.availableSample = availableSample;
    this.totalOptions = totalOptions;
  }
}

function sampleOptions(listbox) {
  const all = Array.from(listbox.querySelectorAll('li'))
    .map((li) => (li.textContent || '').trim())
    .filter(Boolean);
  return { all, sample: all.slice(0, MAX_SAMPLE) };
}

function findOption(listbox, label) {
  // 1) Match exacto (trim a trim).
  const exact = findByText(listbox, 'li', label);
  if (exact) return { option: exact, matchType: 'exact' };

  // 2) Match case-insensitive como rescate. Útil si el usuario tipea con
  //    distinta capitalización que GP1.
  const wanted = label.trim().toLowerCase();
  const ci = Array.from(listbox.querySelectorAll('li'))
    .find((li) => (li.textContent || '').trim().toLowerCase() === wanted);
  if (ci) return { option: ci, matchType: 'ci' };

  return { option: null, matchType: null };
}

/**
 * Selecciona una opción en un combobox L-* identificando button/listbox por
 * id explícito.
 *
 * @param {object} args
 * @param {string} args.inputSelector
 * @param {string} args.buttonSelector
 * @param {string} args.listboxSelector
 * @param {string} args.label
 * @param {AbortSignal} [args.signal]
 * @param {number} [args.timeout=3000]
 * @throws {ComboboxOptionNotFoundError}
 */
export async function selectComboboxOption({
  inputSelector,
  buttonSelector,
  listboxSelector,
  label,
  signal,
  timeout = 3000,
} = {}) {
  const input   = document.querySelector(inputSelector);
  const button  = document.querySelector(buttonSelector);
  const listbox = document.querySelector(listboxSelector);
  if (!input || !button || !listbox) {
    throw new Error(`Combobox incompleto (input=${!!input}, button=${!!button}, listbox=${!!listbox})`);
  }

  clickEl(button);
  await waitForElement(`${listboxSelector} li`, {
    timeout,
    signal,
    description: `opciones de ${listboxSelector}`,
  });

  return commitComboboxSelection({ input, listbox, label, inputSelector });
}

/**
 * Variante que resuelve botón y listbox **relativos al input** vía estructura
 * DOM. Necesaria cuando varios combos comparten id (ej. fila 1 y fila 2 del
 * bloque Product Tag, donde múltiples `<ul id="cb1-listbox">` coexisten).
 *
 * @param {object} args
 * @param {string} args.inputSelector
 * @param {string} args.label
 * @param {AbortSignal} [args.signal]
 * @param {number} [args.timeout=5000]
 * @throws {ComboboxOptionNotFoundError}
 */
export async function selectComboboxByInput({
  inputSelector,
  label,
  signal,
  timeout = 5000,
} = {}) {
  const input = await waitForElement(inputSelector, { signal, description: `combobox ${inputSelector}` });
  log.debug(`[byInput] ${inputSelector} — buscando container`, {
    inputValueInicial: input.value,
    target: label,
  });
  const container = input.closest('.combobox.combobox-list');
  if (!container) throw new Error(`Combobox container no encontrado para ${inputSelector}`);
  const button  = container.querySelector('button');
  const listbox = container.querySelector('ul[role="listbox"]');
  if (!button || !listbox) {
    throw new Error(`Combobox incompleto para ${inputSelector} (button=${!!button}, listbox=${!!listbox})`);
  }
  log.debug(`[byInput] ${inputSelector} — container resuelto`, {
    button: button.id || button.className,
    listbox: listbox.id || listbox.className,
    liCountInicial: listbox.querySelectorAll('li').length,
  });

  clickEl(button);
  // Esperar a que el listbox tenga opciones. Los combos están encadenados
  // (group depende de category, tag depende de group) y el populate llega
  // tras el `change` del select previo.
  await waitFor(
    () => (listbox.querySelectorAll('li').length > 0 ? listbox : null),
    { signal, timeout, interval: 100, description: `opciones del combobox ${inputSelector}` },
  );

  const liCount = listbox.querySelectorAll('li').length;
  log.debug(`[byInput] ${inputSelector} — listbox poblado`, { liCount });

  const result = commitComboboxSelection({ input, listbox, label, inputSelector });
  log.info(`[byInput] ${inputSelector} = "${label}" (match=${result.matchType})`, {
    inputValueFinal: input.value,
  });
  return result;
}

/**
 * Punto común a ambas variantes: buscar la opción en el listbox y comitearla
 * al input. Lanza `ComboboxOptionNotFoundError` si no aparece — el caller
 * decide cómo reportar.
 */
function commitComboboxSelection({ input, listbox, label, inputSelector }) {
  const { option, matchType } = findOption(listbox, label);
  if (!option) {
    const { all, sample } = sampleOptions(listbox);
    throw new ComboboxOptionNotFoundError({
      wantedLabel: label,
      inputSelector,
      availableSample: sample,
      totalOptions: all.length,
    });
  }

  // El click sobre <li> normalmente dispara el handler de GP1 que escribe el
  // value al input. Si por algún motivo no lo hace, lo forzamos.
  clickEl(option);
  const actualLabel = option.textContent.trim();
  if (input.value !== actualLabel) setInputValue(input, actualLabel);

  return { input, listbox, option, matchType };
}
