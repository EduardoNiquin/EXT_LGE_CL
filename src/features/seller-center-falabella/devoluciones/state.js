// Persistencia de "Devoluciones SellerCenter".
//
// Storage-driven, igual que el resto del feature: el panel/popup sube los
// archivos y escribe el `run`; el service worker lo reclama, sondea /orders,
// baja los resultados con chrome.downloads y llama a /saved. El progreso se
// publica en el mismo objeto (storage.local) y el panel lo pinta en vivo. El
// proceso sobrevive al cierre del popup porque el trabajo vive en el SW.
//
// Forma del objeto guardado bajo DEVO_STORAGE_KEYS.RUN:
//   {
//     active: boolean,
//     startedAt, finishedAt,
//     finishReason?: 'done'|'cancelled'|'error'|'unpaired',
//     errorReason?: string,
//     batch: string,                 // uuid del cliente (mismo para toda la carga)
//     base: string,                  // base de la API usada en esta carga
//     ordenes: [{                     // una por comprimido subido
//       id, orden, numero_guia,
//       estado, estado_label, progreso, procesando, listo, final,
//       error_code, error, advertencia, imagenes,
//       guardando: boolean,          // la extensión está bajando/escribiendo
//       guardado: boolean,           // guardado en disco + /saved confirmado
//       saveError: string|null,      // error local de guardado (si lo hubo)
//     }],
//     log: [{ ts, level, message }], // cap LOG_CAP
//   }

import { DEVO_STORAGE_KEYS, LOG_CAP, UPLOAD_METHOD } from './constants.js';
import { createRunStore, createPersistedValue } from '../../../shared/run-store/index.js';

const store = createRunStore({ key: DEVO_STORAGE_KEYS.RUN, logCap: LOG_CAP });
export const { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun } = store;

// Emparejamiento { token, base, ts }. Lo escribe el content script al leer las
// <meta> de la web, o el usuario a mano desde el panel.
const pairing = createPersistedValue(DEVO_STORAGE_KEYS.PAIRING, null);
export const getPairing = pairing.get;
export const setPairing = pairing.set;
export const clearPairing = () => setPairing(null);

// Vía de subida detectada por el ping (§7). Por defecto multipart (la rápida).
const method = createPersistedValue(DEVO_STORAGE_KEYS.METHOD, UPLOAD_METHOD.MULTIPART);
export const getUploadMethod = method.get;
export const setUploadMethod = method.set;

/** Normaliza una orden del servidor a la forma local (con flags de guardado). */
export function normalizeOrder(o, prev = null) {
  return {
    id: o.id,
    orden: o.orden ?? prev?.orden ?? '',
    numero_guia: o.numero_guia ?? prev?.numero_guia ?? '',
    estado: o.estado ?? prev?.estado ?? '',
    estado_label: o.estado_label ?? prev?.estado_label ?? '',
    progreso: typeof o.progreso === 'number' ? o.progreso : (prev?.progreso ?? 0),
    procesando: Boolean(o.procesando),
    listo: Boolean(o.listo),
    final: Boolean(o.final),
    error_code: o.error_code ?? null,
    error: o.error ?? null,
    advertencia: o.advertencia ?? null,
    imagenes: typeof o.imagenes === 'number' ? o.imagenes : (prev?.imagenes ?? 0),
    // Flags locales (no vienen del servidor): se preservan del estado previo.
    guardando: prev?.guardando ?? false,
    guardado: prev?.guardado ?? false,
    saveError: prev?.saveError ?? null,
  };
}

/** Construye un run nuevo a partir de las órdenes creadas al subir. */
export function makeRun({ batch, base, ordenes, message }) {
  return {
    active: true,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    errorReason: null,
    batch,
    base,
    ordenes: (ordenes || []).map((o) => normalizeOrder(o)),
    log: [{ ts: Date.now(), level: 'info', message: message || 'Carga iniciada' }],
  };
}

/**
 * Mezcla la lista del servidor (`/orders`) dentro de las órdenes del run,
 * respetando los flags locales (guardando/guardado/saveError) y limitándose a
 * las órdenes que pertenecen a esta carga (por id).
 */
export function mergeServerOrders(runOrdenes, serverOrdenes) {
  const byId = new Map((serverOrdenes || []).map((o) => [o.id, o]));
  return (runOrdenes || []).map((prev) => {
    const fresh = byId.get(prev.id);
    return fresh ? normalizeOrder(fresh, prev) : prev;
  });
}
