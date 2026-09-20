// Los adjuntos (PDF de la factura, XLSX del detalle) que el usuario sube en el
// popup, guardados en IndexedDB del ORIGEN DE LA EXTENSION: el popup escribe,
// el service worker lee y se los manda al content script del iframe de upload.
//
// No van a chrome.storage.local (reescribe el valor entero en cada set y no es
// lugar para binarios) ni al IndexedDB del content script (ese es del origen de
// la pagina, y ademas el iframe de upload esta en otro host).

const DB = 'ext-lge-cl-facturas';
const STORE = 'adjuntos';
const VERSION = 1;

let conexion = null;

function pedir(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB: operacion fallida'));
  });
}

function abrir() {
  if (!conexion) {
    conexion = new Promise((resolve, reject) => {
      const solicitud = indexedDB.open(DB, VERSION);
      solicitud.onupgradeneeded = () => {
        const db = solicitud.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      solicitud.onsuccess = () => {
        const db = solicitud.result;
        db.onversionchange = () => { try { db.close(); } catch { /* no-op */ } conexion = null; };
        resolve(db);
      };
      solicitud.onerror = () => reject(solicitud.error || new Error('No se pudo abrir IndexedDB'));
    }).catch((err) => { conexion = null; throw err; });
  }
  return conexion;
}

async function almacen(modo) {
  const db = await abrir();
  return db.transaction(STORE, modo).objectStore(STORE);
}

function nuevoId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const sinBytes = ({ bytes: _bytes, ...meta }) => meta;

/**
 * @param {{ nombre: string, tipo: string, bytes: ArrayBuffer }} archivo
 * @returns {Promise<object>} metadatos del adjunto guardado
 */
export async function guardarAdjunto({ nombre, tipo, bytes }) {
  const registro = { id: nuevoId(), nombre, tipo: tipo || 'application/octet-stream', tamano: bytes.byteLength, rol: null, creadoEn: Date.now(), bytes };
  await pedir((await almacen('readwrite')).add(registro));
  return sinBytes(registro);
}

/** Metadatos de todos los adjuntos (sin los bytes), del mas viejo al mas nuevo. */
export async function listarAdjuntos() {
  const todos = await pedir((await almacen('readonly')).getAll());
  return todos.map(sinBytes).sort((a, b) => a.creadoEn - b.creadoEn);
}

/** El adjunto completo, con bytes; null si no existe. */
export async function leerAdjunto(id) {
  return (await pedir((await almacen('readonly')).get(id))) || null;
}

/** Cambia el rol ('factura' | 'detalle' | null) de un adjunto. */
export async function asignarRol(id, rol) {
  const store = await almacen('readwrite');
  const registro = await pedir(store.get(id));
  if (!registro) throw new Error('El adjunto ya no existe.');
  await pedir(store.put({ ...registro, rol: rol || null }));
}

export async function borrarAdjunto(id) {
  await pedir((await almacen('readwrite')).delete(id));
}
