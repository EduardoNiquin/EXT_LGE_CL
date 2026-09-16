// Estado de la grabacion.
//
// Reparto deliberado: los EVENTOS viven en IndexedDB (`shared/event-store`) y el
// RUN vive aqui, en chrome.storage.local. El run es chico y se reescribe seguido
// (contadores, feed); los eventos son muchos y solo se agregan. Meter los
// eventos en storage.local obligaria a reescribir el array entero en cada lote.
//
// Forma del run (`registro-acciones:run`):
// {
//   active, paused,
//   sesionId,                     sello legible: 2026-09-15_14-32-10
//   startedAt, pausedAt, finishedAt,
//   pausaAcumuladaMs,             cuanto tiempo estuvo en pausa (para la duracion real)
//   finishReason, errorReason,
//   contadores: { total, descartados, porTipo: {clic: 12, ...}, paginas, pestanas },
//   ultimos: [{ ts, tipo, resumen, detalle, url }],   ring para el feed (cap LIMITES.ringUltimos)
//   exportacion: { estado, carpeta, partes: [{nombre, eventos, bytes}], error },
//   log: [{ ts, level, message }]
// }

import { createPersistedValue, createRunStore } from '../../shared/run-store/index.js';
import { EXPORTACION, LIMITES, LOG_CAP, STORAGE_KEYS } from './constants.js';

const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });

export const {
  getRun,
  setRun,
  clearRun,
  updateRun,
  appendLog,
  subscribeToRun,
} = store;

/** Sello de sesion legible, que ademas nombra la carpeta de descarga. */
export function nuevoSesionId(ahora = new Date()) {
  const dos = (n) => String(n).padStart(2, '0');
  return [
    ahora.getFullYear(), '-', dos(ahora.getMonth() + 1), '-', dos(ahora.getDate()),
    '_', dos(ahora.getHours()), '-', dos(ahora.getMinutes()), '-', dos(ahora.getSeconds()),
  ].join('');
}

export function makeRun({ sesionId, mensaje } = {}) {
  const ahora = Date.now();
  return {
    active: true,
    paused: false,
    sesionId: sesionId || nuevoSesionId(),
    startedAt: ahora,
    pausedAt: null,
    finishedAt: null,
    pausaAcumuladaMs: 0,
    finishReason: null,
    errorReason: null,
    contadores: { total: 0, descartados: 0, porTipo: {}, paginas: 0, pestanas: 0 },
    ultimos: [],
    exportacion: { estado: EXPORTACION.PENDIENTE, carpeta: null, partes: [], error: null },
    log: [{ ts: ahora, level: 'info', message: mensaje || 'Grabacion iniciada' }],
  };
}

/** Cuanto se grabo de verdad, descontando las pausas. */
export function duracionEfectiva(run, ahora = Date.now()) {
  if (!run?.startedAt) return 0;
  const fin = run.finishedAt || ahora;
  const pausaEnCurso = run.paused && run.pausedAt ? fin - run.pausedAt : 0;
  return Math.max(0, fin - run.startedAt - (run.pausaAcumuladaMs || 0) - pausaEnCurso);
}

/** Agrega un resumen al ring del feed sin pasarse del tope. */
export function conUltimos(run, resumenes) {
  const previos = Array.isArray(run.ultimos) ? run.ultimos : [];
  const ultimos = [...previos, ...resumenes];
  if (ultimos.length > LIMITES.ringUltimos) ultimos.splice(0, ultimos.length - LIMITES.ringUltimos);
  return ultimos;
}

/** Suma al conteo por tipo sin mutar el run anterior. */
export function conContadores(contadores, tipos) {
  const porTipo = { ...(contadores?.porTipo || {}) };
  for (const tipo of tipos) porTipo[tipo] = (porTipo[tipo] || 0) + 1;
  return {
    ...contadores,
    total: (contadores?.total || 0) + tipos.length,
    porTipo,
  };
}

// -----------------------------------------------------------------------------
// Opciones (persisten entre sesiones)
// -----------------------------------------------------------------------------

export const OPCIONES_POR_DEFECTO = {
  inventario: true,        // radiografia de cada pagina visitada
  consecuencias: true,     // que aparecio tras cada accion
  portapapeles: true,      // copiar / cortar / pegar
  enmascararContacto: false, // correos y RUT (off: en Magento son el dato de busqueda)
};

const opciones = createPersistedValue(STORAGE_KEYS.OPCIONES, OPCIONES_POR_DEFECTO);

export const setOpciones = opciones.set;

export async function getOpciones() {
  const guardadas = await opciones.get();
  return { ...OPCIONES_POR_DEFECTO, ...(guardadas || {}) };
}
