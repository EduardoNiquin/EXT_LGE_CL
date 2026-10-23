// Persistencia de "Stock" (chrome.storage.local).
//
//   CONFIG   lo que se elige en el popup (DEFAULTS + lo guardado).
//   ESTADO   ultimo sondeo / consulta / revision, `ultimoIdVisto` y el error.
//   ALERTAS  las ultimas ALERTAS_MAX alertas recibidas (la mas nueva primero),
//            con la marca `visto`.
//   FOTO     la ultima respuesta de GET /stock (+ `consultadaEn`), para pintar
//            el popup sin red.
// ESTADO, ALERTAS y FOTO los escribe SOLO el service worker; el popup los
// refleja via storage.onChanged y pide cambios por mensaje (MARCAR_VISTAS...).
//
// Los reducers son puros para poder probarlos sin chrome.*.

import { ALERTAS_MAX, DEFAULTS, LIMITES, STORAGE_KEYS, TIPOS } from './constants.js';
import { parseHora } from './tiempo.js';
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

/** "9:5" o basura -> "HH:MM" valido (o el por defecto). */
export function normalizarHora(valor, fallback = DEFAULTS.horaResumen) {
  const hm = parseHora(valor);
  if (!hm) return fallback;
  return `${String(hm.hour).padStart(2, '0')}:${String(hm.minute).padStart(2, '0')}`;
}

/** Config guardada -> config completa y dentro de los limites. */
export function normalizarConfig(guardada) {
  const c = { ...DEFAULTS, ...(guardada || {}) };
  const notificar = {};
  for (const tipo of Object.values(TIPOS)) notificar[tipo] = c.notificar?.[tipo] !== false;
  return {
    activo: Boolean(c.activo),
    intervaloMin: entero(c.intervaloMin, LIMITES.intervaloMin, DEFAULTS.intervaloMin),
    notificar,
    resumenActivo: c.resumenActivo !== false,
    horaResumen: normalizarHora(c.horaResumen),
    token: String(c.token ?? '').trim(),
    endpoint: String(c.endpoint ?? '').trim(),
  };
}

export const ESTADO_INICIAL = {
  activo: false,
  sondeando: false,
  consultando: false,
  revisando: false,
  ultimoIdVisto: null, // id de la ultima alerta del portal ya procesada (null = nunca se consulto)
  ultimoSondeo: null, // ts del ultimo GET /alertas terminado (ok o no)
  ultimoSondeoOk: null,
  ultimaConsulta: null, // ts del ultimo GET /stock ok
  revision: null, // la ultima Revision del portal que se vio (alertas, stock o revisar)
  ultimaRevisionManual: null, // { ts, ok, alertas, error } del ultimo "Revisar ahora"
  ultimoResumen: null, // ts de la ultima notificacion de resumen
  proximoResumen: null, // ts programado de la alarma del resumen
  notificadas: 0, // alertas notificadas desde que se activo
  error: null,
  code: null,
  status: null,
  fase: null, // 'sondeo' | 'consulta' | 'revision' | 'resumen'
  fallosSeguidos: 0,
};

/** Estado tras un sondeo exitoso (`r` = resultado de ciclo.sondear). */
export function aplicarSondeo(estado, r, ahora = Date.now()) {
  const prev = { ...ESTADO_INICIAL, ...(estado || {}) };
  return {
    ...prev,
    sondeando: false,
    ultimoSondeo: ahora,
    ultimoSondeoOk: ahora,
    ultimoIdVisto: r?.ultimoIdVisto ?? prev.ultimoIdVisto,
    revision: r?.revision || prev.revision,
    notificadas: (prev.notificadas || 0) + (r?.aNotificar?.length || 0),
    error: null,
    code: null,
    status: null,
    fase: null,
    fallosSeguidos: 0,
  };
}

/** Estado tras un fallo en `fase`. */
export function aplicarError(estado, fase, r, ahora = Date.now()) {
  const prev = { ...ESTADO_INICIAL, ...(estado || {}) };
  return {
    ...prev,
    sondeando: false,
    consultando: false,
    revisando: false,
    ultimoSondeo: fase === 'sondeo' ? ahora : prev.ultimoSondeo,
    revision: r?.revision || prev.revision,
    error: r?.error || 'Error desconocido',
    code: r?.code || null,
    status: r?.status ?? null,
    fase,
    fallosSeguidos: (prev.fallosSeguidos || 0) + 1,
  };
}

/** Estado tras un GET /stock ok. */
export function aplicarConsulta(estado, foto, ahora = Date.now()) {
  const prev = { ...ESTADO_INICIAL, ...(estado || {}) };
  const limpiar = prev.fase === 'consulta';
  return {
    ...prev,
    consultando: false,
    ultimaConsulta: ahora,
    revision: foto?.revision || prev.revision,
    ...(limpiar ? { error: null, code: null, status: null, fase: null, fallosSeguidos: 0 } : {}),
  };
}

/**
 * Suma alertas nuevas a la lista guardada: la mas nueva primero, sin repetir
 * id (la que ya estaba conserva su `visto`), recortada a `max`.
 */
export function agregarAlertas(lista, nuevas, { vistas = false, ahora = Date.now(), max = ALERTAS_MAX } = {}) {
  const previa = Array.isArray(lista) ? lista : [];
  const porId = new Map(previa.map((a) => [a.id, a]));
  for (const a of Array.isArray(nuevas) ? nuevas : []) {
    if (a?.id == null || porId.has(a.id)) continue;
    porId.set(a.id, { ...a, visto: Boolean(vistas), recibida_en: ahora });
  }
  return [...porId.values()].sort((a, b) => b.id - a.id).slice(0, Math.max(1, max));
}

/** Marca como vistas todas (o solo las de `ids`). */
export function marcarVistas(lista, ids = null) {
  const set = ids ? new Set(ids) : null;
  return (Array.isArray(lista) ? lista : []).map((a) => (
    !a.visto && (!set || set.has(a.id)) ? { ...a, visto: true } : a
  ));
}

export function contarNoVistas(lista) {
  return (Array.isArray(lista) ? lista : []).filter((a) => !a.visto).length;
}

// -----------------------------------------------------------------------------
// Storage
// -----------------------------------------------------------------------------

// Las escrituras de estado y alertas (leer -> cambiar -> guardar) van en fila:
// en el SW un sondeo y un "Revisar ahora" pueden terminar a la vez.
let fila = Promise.resolve();
function enFila(tarea) {
  const r = fila.then(tarea, tarea);
  fila = r.catch(() => {});
  return r;
}

const config = createPersistedValue(STORAGE_KEYS.CONFIG, null);
const estado = createPersistedValue(STORAGE_KEYS.ESTADO, null);
const alertas = createPersistedValue(STORAGE_KEYS.ALERTAS, null);
const foto = createPersistedValue(STORAGE_KEYS.FOTO, null);

export const getConfig = async () => normalizarConfig(await config.get());
/** Mezcla un cambio parcial en la config guardada. */
export async function actualizarConfig(cambio) {
  const actual = await getConfig();
  const nueva = normalizarConfig({
    ...actual,
    ...(cambio || {}),
    notificar: { ...actual.notificar, ...(cambio?.notificar || {}) },
  });
  await config.set(nueva);
  return nueva;
}

export const getEstado = async () => ({ ...ESTADO_INICIAL, ...((await estado.get()) || {}) });
export function actualizarEstado(fn) {
  return enFila(async () => {
    const nuevo = fn(await getEstado());
    await estado.set(nuevo);
    return nuevo;
  });
}

export const getAlertas = async () => {
  const lista = await alertas.get();
  return Array.isArray(lista) ? lista : [];
};
export function actualizarAlertas(fn) {
  return enFila(async () => {
    const nueva = fn(await getAlertas());
    await alertas.set(nueva);
    return nueva;
  });
}

export const getFoto = () => foto.get();
export const setFoto = (valor) => foto.set(valor);

/** Cuantas alertas sin ver hay (para la tarjeta del modulo). */
export async function noVistas() {
  try {
    return contarNoVistas(await getAlertas());
  } catch {
    return 0;
  }
}

export async function limpiarEstado() {
  await removeStorage(STORAGE_KEYS.ESTADO);
  await removeStorage(STORAGE_KEYS.ALERTAS);
  await removeStorage(STORAGE_KEYS.FOTO);
}

/**
 * Escucha cambios de config / estado / alertas / foto. `callback({config,
 * estado, alertas, foto})` recibe solo las claves que cambiaron.
 * @returns {() => void} para desuscribirse
 */
export function subscribe(callback) {
  const listener = (changes, area) => {
    if (area !== 'local') return;
    const out = {};
    if (changes[STORAGE_KEYS.CONFIG]) out.config = normalizarConfig(changes[STORAGE_KEYS.CONFIG].newValue);
    if (changes[STORAGE_KEYS.ESTADO]) out.estado = { ...ESTADO_INICIAL, ...(changes[STORAGE_KEYS.ESTADO].newValue || {}) };
    if (changes[STORAGE_KEYS.ALERTAS]) {
      const lista = changes[STORAGE_KEYS.ALERTAS].newValue;
      out.alertas = Array.isArray(lista) ? lista : [];
    }
    if (changes[STORAGE_KEYS.FOTO]) out.foto = changes[STORAGE_KEYS.FOTO].newValue || null;
    if (Object.keys(out).length) callback(out);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    try { chrome.storage.onChanged.removeListener(listener); } catch { /* no-op */ }
  };
}
