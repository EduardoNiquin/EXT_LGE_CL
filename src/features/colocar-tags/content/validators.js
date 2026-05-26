// Validadores reutilizables para los flows de tags. Vienen del runner (popup
// hace una validación previa, pero defendemos también acá por si alguien
// manda config malformada vía debug API).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export function isValidDate(s)  { return DATE_RE.test(String(s || '')); }
export function isValidTime(s)  { return TIME_RE.test(String(s || '')); }

/**
 * Valida un rango begin/end (formato + semántica) y lanza Error con mensaje
 * legible si algo está mal. `prefix` se usa para identificar el contexto
 * (ej. "Delivery" o "Tag 1") en los mensajes.
 *
 * @param {object} args
 * @param {string} args.prefix
 * @param {string} args.beginDay   YYYY-MM-DD
 * @param {string} args.beginTime  HH:MM
 * @param {string} args.endDay
 * @param {string} args.endTime
 */
export function validateDateTimeRange({ prefix, beginDay, beginTime, endDay, endTime }) {
  const where = prefix ? `${prefix}: ` : '';
  if (!isValidDate(beginDay)) throw new Error(`${where}beginDay debe ser YYYY-MM-DD (recibido: "${beginDay}")`);
  if (!isValidDate(endDay))   throw new Error(`${where}endDay debe ser YYYY-MM-DD (recibido: "${endDay}")`);
  if (!isValidTime(beginTime)) throw new Error(`${where}beginTime debe ser HH:MM (recibido: "${beginTime}")`);
  if (!isValidTime(endTime))   throw new Error(`${where}endTime debe ser HH:MM (recibido: "${endTime}")`);
  if (beginDay > endDay) {
    throw new Error(`${where}beginDay (${beginDay}) es posterior a endDay (${endDay})`);
  }
  if (beginDay === endDay && beginTime > endTime) {
    throw new Error(`${where}el inicio (${beginDay} ${beginTime}) es posterior al fin (${endDay} ${endTime})`);
  }
}
