// Fechas y horas en hora de Chile para el modulo "Stock". PURO (sin chrome.*).
//
// El portal manda ISO 8601 en UTC; todo lo que se muestra va en hora de Chile
// con Intl (`America/Santiago`). Nunca `toISOString()` para fechas locales.
//
// `proximoDisparo` calcula el instante del proximo resumen diario: la hora
// elegida se interpreta en Chile, asi que el desfase con UTC se calcula para ESE
// dia (Chile pasa de -04 a -03 el primer domingo de septiembre a las 00:00 y
// vuelve el primer domingo de abril). Una hora que no existe el dia del cambio
// (entre 00:00 y 00:59 en septiembre) cae una hora despues.

import { ZONA_HORARIA } from './constants.js';

const formateadores = new Map();

function formateador(zona) {
  if (!formateadores.has(zona)) {
    formateadores.set(zona, new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return formateadores.get(zona);
}

/** Partes de fecha y hora de un instante en una zona: {year, month, day, hour, minute, second}. */
export function partesEnZona(ts, zona = ZONA_HORARIA) {
  const out = {};
  for (const p of formateador(zona).formatToParts(new Date(ts))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** Desfase de la zona respecto de UTC en ese instante, en ms (Chile: -3 h o -4 h). */
export function desfaseMs(ts, zona = ZONA_HORARIA) {
  const p = partesEnZona(ts, zona);
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return comoUtc - (Math.floor(ts / 1000) * 1000);
}

/** Instante (epoch ms) de una hora de pared en la zona. */
export function instanteDe({ year, month, day, hour = 0, minute = 0 }, zona = ZONA_HORARIA) {
  const pared = Date.UTC(year, month - 1, day, hour, minute, 0);
  const t1 = pared - desfaseMs(pared, zona);
  const t2 = pared - desfaseMs(t1, zona);
  const calza = (t) => {
    const p = partesEnZona(t, zona);
    return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute;
  };
  if (calza(t2)) return t2;
  if (calza(t1)) return t1;
  // La hora no existe ese dia (adelanto del reloj): la siguiente que si existe.
  return Math.max(t1, t2);
}

/** "HH:MM" valido -> {hour, minute}; si no, null. */
export function parseHora(texto) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(texto ?? ''));
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Proximo instante (estrictamente despues de `ahora`) en que en Chile son las
 * `hora` ("HH:MM").
 * @returns {number|null} epoch ms, o null si la hora no es valida
 */
export function proximoDisparo(hora, ahora = Date.now(), zona = ZONA_HORARIA) {
  const hm = parseHora(hora);
  if (!hm) return null;
  const hoy = partesEnZona(ahora, zona);
  for (let extra = 0; extra < 3; extra += 1) {
    // Date.UTC normaliza el dia 32 al mes siguiente.
    const d = new Date(Date.UTC(hoy.year, hoy.month - 1, hoy.day + extra));
    const t = instanteDe({
      year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), ...hm,
    }, zona);
    if (t > ahora) return t;
  }
  return null;
}

function aTs(valor) {
  if (valor == null || valor === '') return null;
  const t = typeof valor === 'number' ? valor : Date.parse(valor);
  return Number.isFinite(t) ? t : null;
}

const pad = (n) => String(n).padStart(2, '0');

/** "dd-mm HH:MM" en hora de Chile (o "—"). Acepta ISO o epoch ms. */
export function fechaHoraChile(valor, zona = ZONA_HORARIA) {
  const t = aTs(valor);
  if (t == null) return '—';
  const p = partesEnZona(t, zona);
  return `${pad(p.day)}-${pad(p.month)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DD HH:MM" en hora de Chile (para el CSV), o "". */
export function fechaHoraChileLarga(valor, zona = ZONA_HORARIA) {
  const t = aTs(valor);
  if (t == null) return '';
  const p = partesEnZona(t, zona);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "HH:MM" en hora de Chile (o "—"). */
export function horaChile(valor, zona = ZONA_HORARIA) {
  const t = aTs(valor);
  if (t == null) return '—';
  const p = partesEnZona(t, zona);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "YYYYMMDD-HHMM" en hora de Chile, para nombres de archivo. */
export function selloArchivo(ahora = Date.now(), zona = ZONA_HORARIA) {
  const p = partesEnZona(ahora, zona);
  return `${p.year}${pad(p.month)}${pad(p.day)}-${pad(p.hour)}${pad(p.minute)}`;
}

export { aTs };
