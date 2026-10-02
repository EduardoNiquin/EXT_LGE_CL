// Persistencia de "Ventas en vivo" (chrome.storage.local).
//
//   CONFIG     lo que se elige en el popup (DEFAULTS + lo guardado).
//   ESTADO     la ultima corrida, para el popup y el badge. Lo escribe SOLO el
//              service worker; el popup lo refleja via storage.onChanged.
//   HISTORIAL  las ultimas HISTORIAL_MAX corridas, la mas nueva primero.
//
// Los reducers (`aplicarResultado`, `pushHistorial`, `normalizarConfig`) son
// puros para poder probarlos sin chrome.*.

import { DEFAULTS, HISTORIAL_MAX, LIMITES, RESULTADO, STORAGE_KEYS } from './constants.js';
import { createPersistedValue } from '../../../shared/run-store/index.js';
import { removeStorage } from '../../../shared/storage/storage.js';

// -----------------------------------------------------------------------------
// Reducers puros
// -----------------------------------------------------------------------------

function entero(valor, { min, max }, fallback) {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Config guardada -> config completa y dentro de los limites. */
export function normalizarConfig(guardada) {
  const c = { ...DEFAULTS, ...(guardada || {}) };
  return {
    ...c,
    activo: Boolean(c.activo),
    intervaloMin: entero(c.intervaloMin, LIMITES.intervaloMin, DEFAULTS.intervaloMin),
    diasCortos: entero(c.diasCortos, LIMITES.diasCortos, DEFAULTS.diasCortos),
    diasLargos: entero(c.diasLargos, LIMITES.diasLargos, DEFAULTS.diasLargos),
    cadaNTicksLargo: entero(c.cadaNTicksLargo, LIMITES.cadaNTicksLargo, DEFAULTS.cadaNTicksLargo),
    // La tienda es obligatoria para el export: vacia (configs viejas) = la de Chile.
    storeId: String(c.storeId ?? '').trim() || DEFAULTS.storeId,
    borrarArchivo: c.borrarArchivo !== false,
    esperaArchivoMs: entero(c.esperaArchivoMs, LIMITES.esperaArchivoMs, DEFAULTS.esperaArchivoMs),
    esperaArchivoMaxMs: entero(c.esperaArchivoMaxMs, LIMITES.esperaArchivoMaxMs, DEFAULTS.esperaArchivoMaxMs),
    adminBase: String(c.adminBase || DEFAULTS.adminBase).trim(),
    token: String(c.token ?? '').trim(),
    endpoint: String(c.endpoint ?? '').trim(),
  };
}

export const ESTADO_INICIAL = {
  activo: false,
  enCurso: false,
  ultimaCorrida: null, // ts del ultimo tick terminado
  ultimoOk: null, // ts del ultimo envio aceptado por el portal
  resultado: null, // RESULTADO.* del ultimo tick
  filasEnviadas: 0,
  creadas: 0,
  actualizadas: 0,
  omitidas: 0,
  hasta: null, // orden mas nueva que tiene el portal
  rango: null, // { tipo, from, to } del ultimo tick
  error: null,
  sesionCaducada: false,
  fallosSeguidos: 0,
  via: null, // 'sw' | 'tab'
  tickN: 0,
  archivo: null, // { id, nombre, export_time } del ultimo export descargado
  archivoBorrado: null, // true | false | null (no se pidio borrar)
};

/** Lo que se guarda del archivo del export (sin las URLs, que llevan la key de la sesion). */
export function resumenArchivo(archivo) {
  if (!archivo) return null;
  return { id: archivo.id ?? null, nombre: archivo.nombre || '', export_time: archivo.export_time || '' };
}

/**
 * Estado tras un tick.
 * @param {object} estado    estado anterior
 * @param {object} r         resultado del ciclo (+ `via`)
 * @param {number} ahora
 */
export function aplicarResultado(estado, r, ahora = Date.now()) {
  const prev = { ...ESTADO_INICIAL, ...(estado || {}) };
  const base = {
    ...prev,
    enCurso: false,
    ultimaCorrida: ahora,
    resultado: r?.resultado || RESULTADO.ERROR,
    via: r?.via || prev.via,
    rango: r?.rango || prev.rango,
    archivo: r?.archivo ? resumenArchivo(r.archivo) : prev.archivo,
    archivoBorrado: r?.archivo ? (r.borrado ?? null) : prev.archivoBorrado,
  };
  if (r?.resultado === RESULTADO.OK) {
    return {
      ...base,
      ultimoOk: ahora,
      filasEnviadas: r.filas || 0,
      creadas: r.carga?.creadas ?? 0,
      actualizadas: r.carga?.actualizadas ?? 0,
      omitidas: r.carga?.omitidas ?? 0,
      hasta: r.hasta || prev.hasta,
      error: null,
      sesionCaducada: false,
      fallosSeguidos: 0,
    };
  }
  return {
    ...base,
    error: r?.resultado === RESULTADO.SESION_CADUCADA
      ? 'Sesion del admin caducada: abre el admin de Magento e inicia sesion.'
      : (r?.error || 'Error desconocido'),
    sesionCaducada: r?.resultado === RESULTADO.SESION_CADUCADA,
    fallosSeguidos: (prev.fallosSeguidos || 0) + 1,
  };
}

/** Entrada del historial a partir de un resultado (sin el CSV). */
export function entradaHistorial(r, ahora = Date.now()) {
  return {
    ts: ahora,
    resultado: r?.resultado || RESULTADO.ERROR,
    via: r?.via || null,
    rango: r?.rango || null,
    filas: r?.filas ?? null,
    bytes: r?.bytes ?? null,
    creadas: r?.carga?.creadas ?? null,
    actualizadas: r?.carga?.actualizadas ?? null,
    omitidas: r?.carga?.omitidas ?? null,
    cargaId: r?.carga?.id ?? null,
    hasta: r?.hasta ?? null,
    sinFilas: Boolean(r?.sinFilas),
    ms: r?.ms ?? null,
    status: r?.status ?? null,
    error: r?.resultado === RESULTADO.OK ? null : (r?.error || null),
    archivo: r?.archivo?.nombre || null,
    borrado: r?.archivo ? (r.borrado ?? null) : null,
    errorBorrado: r?.errorBorrado || null,
  };
}

/** Agrega al frente y recorta a `max`. */
export function pushHistorial(lista, entrada, max = HISTORIAL_MAX) {
  const previa = Array.isArray(lista) ? lista : [];
  return [entrada, ...previa].slice(0, Math.max(1, max));
}

// -----------------------------------------------------------------------------
// Storage
// -----------------------------------------------------------------------------

const config = createPersistedValue(STORAGE_KEYS.CONFIG, null);
const estado = createPersistedValue(STORAGE_KEYS.ESTADO, null);
const historial = createPersistedValue(STORAGE_KEYS.HISTORIAL, null);

export const getConfig = async () => normalizarConfig(await config.get());
export const setConfig = (valor) => config.set(normalizarConfig(valor));
/** Mezcla un cambio parcial en la config guardada. */
export async function actualizarConfig(cambio) {
  const nueva = normalizarConfig({ ...(await getConfig()), ...(cambio || {}) });
  await config.set(nueva);
  return nueva;
}

export const getEstado = async () => ({ ...ESTADO_INICIAL, ...((await estado.get()) || {}) });
export const setEstado = (valor) => estado.set(valor);
export async function actualizarEstado(fn) {
  const nuevo = fn(await getEstado());
  await estado.set(nuevo);
  return nuevo;
}

export const getHistorial = async () => {
  const lista = await historial.get();
  return Array.isArray(lista) ? lista : [];
};
export async function agregarHistorial(entrada) {
  const lista = pushHistorial(await getHistorial(), entrada);
  await historial.set(lista);
  return lista;
}

export async function limpiarEstado() {
  await removeStorage(STORAGE_KEYS.ESTADO);
  await removeStorage(STORAGE_KEYS.HISTORIAL);
}

/**
 * Escucha cambios de config / estado / historial. `callback({config, estado,
 * historial})` recibe solo las claves que cambiaron (ya normalizadas).
 * @returns {() => void} para desuscribirse
 */
export function subscribe(callback) {
  const listener = (changes, area) => {
    if (area !== 'local') return;
    const out = {};
    if (changes[STORAGE_KEYS.CONFIG]) out.config = normalizarConfig(changes[STORAGE_KEYS.CONFIG].newValue);
    if (changes[STORAGE_KEYS.ESTADO]) out.estado = { ...ESTADO_INICIAL, ...(changes[STORAGE_KEYS.ESTADO].newValue || {}) };
    if (changes[STORAGE_KEYS.HISTORIAL]) {
      const lista = changes[STORAGE_KEYS.HISTORIAL].newValue;
      out.historial = Array.isArray(lista) ? lista : [];
    }
    if (Object.keys(out).length) callback(out);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    try { chrome.storage.onChanged.removeListener(listener); } catch { /* no-op */ }
  };
}
