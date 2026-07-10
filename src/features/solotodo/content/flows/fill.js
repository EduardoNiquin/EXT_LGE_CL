// Operaciones DOM que llenan cada campo del formulario de export de SoloTodo.
// Reutilizan los helpers MUI (ubicación por label + selección por click nativo).

import { LABELS } from '../../constants.js';
import {
  autocompleteValue,
  closePopper,
  findAutocompleteByLabel,
  findExportButton,
  findFilenameInput,
  findGenerarButton,
  hasExportForm,
  lowerText,
  selectAutocompleteOption,
  setReactInputValue,
} from '../mui.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('solotodo');

/** Resuelve el Autocomplete por label o lanza un error claro. */
function requireAutocomplete(labelText) {
  const ac = findAutocompleteByLabel(labelText);
  if (!ac) throw new Error(`No se encontró el campo "${labelText}".`);
  return ac;
}

/**
 * Asegura que el formulario de export esté visible. Si ya lo está, no hace nada;
 * si no, clickea el botón "Exportar" y espera a que aparezcan sus campos.
 */
export async function openExportForm({ signal } = {}) {
  if (hasExportForm()) {
    log.info('El formulario de export ya estaba abierto');
    return;
  }
  const btn = findExportButton();
  if (!btn) throw new Error('No se encontró el botón "Exportar".');
  btn.scrollIntoView({ block: 'nearest' });
  btn.click();
  await waitFor(() => hasExportForm(), {
    timeout: 10000,
    description: 'el formulario de exportación',
    signal,
  });
  await sleep(250, signal); // dejar que MUI termine de montar el diálogo/form
}

/**
 * Selecciona un valor único en un Autocomplete (Categoría/Moneda). Si ya tiene
 * el valor deseado, no hace nada.
 */
export async function selectSingle(labelText, optionText, { signal } = {}) {
  const { input } = requireAutocomplete(labelText);
  if (lowerText(autocompleteValue(input)) === lowerText(optionText)) {
    log.info(`"${labelText}" ya tenía "${optionText}"`);
    return;
  }
  await selectAutocompleteOption(input, optionText, { signal });
  await sleep(120, signal);
}

/**
 * Selecciona múltiples valores en un Autocomplete multi (Tiendas/Países). Cada
 * selección: escribe el nombre, espera el listbox, clickea la opción exacta.
 * Reporta progreso vía `onProgress(index, total, name)`.
 */
export async function selectMultiple(labelText, values, { signal, onProgress } = {}) {
  const { input } = requireAutocomplete(labelText);
  const total = values.length;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) return;
    const value = values[i];
    try {
      await selectAutocompleteOption(input, value, { signal });
    } catch (err) {
      closePopper(input);
      throw new Error(`En "${labelText}", ${err.message}`, { cause: err });
    }
    onProgress?.(i + 1, total, value);
    await sleep(90, signal);
  }
  closePopper(input);
}

/** Escribe el nombre de archivo (input de texto simple controlado por React). */
export async function fillFilename(value, { signal } = {}) {
  const input = findFilenameInput();
  if (!input) throw new Error(`No se encontró el campo "${LABELS.FILENAME}".`);
  input.focus();
  setReactInputValue(input, value);
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
  await sleep(80, signal);
  if (input.value !== value) {
    log.warn('El nombre de archivo no quedó con el valor esperado', {
      esperado: value,
      actual: input.value,
    });
  }
}

/** Clickea el botón "Generar" (submit). */
export async function clickGenerar({ signal } = {}) {
  const btn = findGenerarButton();
  if (!btn) throw new Error(`No se encontró el botón "${LABELS.GENERAR}".`);
  btn.scrollIntoView({ block: 'nearest' });
  await sleep(60, signal);
  btn.click();
}
