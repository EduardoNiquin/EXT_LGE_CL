import { LABELS } from '../constants.js';
import { autocompleteValue, findAutocompleteByLabel, findFilenameInput } from './mui.js';

/**
 * Lee el estado actual del formulario (útil para debug / lectura one-shot).
 * Para los Autocomplete multi (Tiendas/Países) los valores seleccionados se
 * muestran como chips; acá se cuentan los chips presentes en su inputRoot.
 */
export function parseForm() {
  const categoria = findAutocompleteByLabel(LABELS.CATEGORIA);
  const moneda = findAutocompleteByLabel(LABELS.MONEDA);
  const tiendas = findAutocompleteByLabel(LABELS.TIENDAS);
  const paises = findAutocompleteByLabel(LABELS.PAISES);
  const filename = findFilenameInput();

  const chips = (ac) =>
    ac ? ac.root?.querySelectorAll('.MuiChip-root, .MuiAutocomplete-tag').length || 0 : 0;

  return {
    categoria: categoria ? autocompleteValue(categoria.input) : null,
    moneda: moneda ? autocompleteValue(moneda.input) : null,
    tiendasSeleccionadas: chips(tiendas),
    paisesSeleccionados: chips(paises),
    filename: filename ? filename.value : null,
  };
}
