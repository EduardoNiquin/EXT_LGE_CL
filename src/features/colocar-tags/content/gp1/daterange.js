// Helper para setear un rango begin/end de fecha+hora en los widgets
// `datePick` + `timePicker` de GP1, sin que la constraint "From <= To" del
// front rechace ningún input intermedio.
//
// Caso típico: el producto ya tenía un tag con fechas viejas (ej. 1–20 May).
// Si seteamos primero `beginDay` al valor nuevo (25 May), el endDay viejo
// (20 May) sigue ahí y GP1 dispara:
//   "The From Date is earlier than To Date can not be input."
// y aborta el set, dejando el form a medio llenar.
//
// Estrategia:
//   1. Empujar `endDay`/`endTime` a un SENTINEL "infinito" — esto libera
//      cualquier constraint previa porque ahora cualquier `beginDay <
//      endDay (sentinel)`.
//   2. Setear `beginDay`/`beginTime` con los valores reales (no rebota
//      contra el endDay sentinel).
//   3. Setear `endDay`/`endTime` con los valores reales (no rebota porque
//      el popup ya validó que beginDay <= endDay).
//
// Nota: el popup valida semánticamente begin ≤ end ANTES de mandar el run
// (ver `content/validators.js#validateDateTimeRange`), así que el paso 3
// nunca puede crear una violación si los inputs llegaron limpios.

import { setInputValue } from '../../../../shared/dom/events.js';

// "Infinito" suficientemente lejano para destrabar cualquier constraint
// realista. El datePick acepta este rango sin problema.
const SENTINEL_DAY  = '2099-12-31';
const SENTINEL_TIME = '23:30';

/**
 * @param {object} args
 * @param {HTMLElement} args.beginDayEl
 * @param {HTMLElement} args.beginTimeEl
 * @param {HTMLElement} args.endDayEl
 * @param {HTMLElement} args.endTimeEl
 * @param {string} args.beginDay   YYYY-MM-DD
 * @param {string} args.beginTime  HH:MM
 * @param {string} args.endDay
 * @param {string} args.endTime
 */
export function setDateRange({
  beginDayEl,
  beginTimeEl,
  endDayEl,
  endTimeEl,
  beginDay,
  beginTime,
  endDay,
  endTime,
}) {
  if (!beginDayEl || !beginTimeEl || !endDayEl || !endTimeEl) {
    throw new Error('setDateRange: alguno de los inputs es null');
  }

  // 1) Sentinel en end para destrabar la constraint.
  setInputValue(endDayEl,  SENTINEL_DAY);
  setInputValue(endTimeEl, SENTINEL_TIME);

  // 2) Begin real.
  setInputValue(beginDayEl,  beginDay);
  setInputValue(beginTimeEl, beginTime);

  // 3) End real (begin real <= end real ya validado por el popup).
  setInputValue(endDayEl,  endDay);
  setInputValue(endTimeEl, endTime);
}
