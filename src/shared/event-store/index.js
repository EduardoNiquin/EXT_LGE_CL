// Cola persistente de eventos sobre IndexedDB.
//
// Por que no `chrome.storage.local` (que es lo que usa el resto de la
// extension): storage.local **reescribe el valor entero** en cada `set`. Un
// registro de acciones genera decenas de miles de eventos, asi que guardar el
// array completo cada 400 ms seria O(n) por escritura y ademas dispararia un
// `storage.onChanged` con todo el array a TODOS los contextos — incluidos los
// content scripts de cada frame de cada pestana, que tendrian que
// deserializarlo. Inviable.
//
// IndexedDB es append-only, se lee por cursor (sin cargar todo en memoria) y
// esta disponible en el service worker MV3.
//
// El modulo es generico a proposito: no sabe nada de "registro de acciones".
// La `id` autoIncrement de IndexedDB hace de numero de secuencia global, asi que
// no hay que persistir ni releer un contador propio cuando el service worker se
// duerme y despierta.

const CONEXIONES = new Map();   // nombre -> Promise<IDBDatabase>

function hayIndexedDb() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/** Envuelve un IDBRequest en una promesa. */
function pedir(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB: operacion fallida'));
  });
}

/** Espera a que una transaccion termine de verdad (no basta con el request). */
function esperarTransaccion(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('IndexedDB: transaccion abortada'));
    tx.onerror = () => reject(tx.error || new Error('IndexedDB: transaccion con error'));
  });
}

/**
 * Crea (o recupera) el almacen de eventos.
 *
 * @param {object} [opciones]
 * @param {string} [opciones.nombre='ext-lge-cl-eventos']  base de datos
 * @param {string} [opciones.store='eventos']              almacen de eventos
 * @param {string} [opciones.meta='meta']                  almacen clave/valor
 */
export function crearEventStore(opciones = {}) {
  const {
    nombre = 'ext-lge-cl-eventos',
    store = 'eventos',
    meta = 'meta',
    version = 1,
  } = opciones;

  function abrir() {
    if (!hayIndexedDb()) return Promise.reject(new Error('IndexedDB no esta disponible en este contexto'));

    // Una sola conexion por base: un despertar en frio del service worker no
    // puede terminar abriendo dos.
    if (!CONEXIONES.has(nombre)) {
      const promesa = new Promise((resolve, reject) => {
        const solicitud = indexedDB.open(nombre, version);

        solicitud.onupgradeneeded = () => {
          const db = solicitud.result;
          if (!db.objectStoreNames.contains(store)) {
            const almacen = db.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
            almacen.createIndex('porTs', 'ts', { unique: false });
            almacen.createIndex('porSesion', 'sesionId', { unique: false });
          }
          if (!db.objectStoreNames.contains(meta)) {
            db.createObjectStore(meta, { keyPath: 'clave' });
          }
        };

        solicitud.onsuccess = () => {
          const db = solicitud.result;
          // Si otra pestana pide una version nueva, soltamos la conexion en vez
          // de bloquearla para siempre.
          db.onversionchange = () => { try { db.close(); } catch { /* no-op */ } CONEXIONES.delete(nombre); };
          resolve(db);
        };

        solicitud.onerror = () => reject(solicitud.error || new Error('No se pudo abrir IndexedDB'));
        solicitud.onblocked = () => reject(new Error('IndexedDB bloqueada por otra conexion'));
      }).catch((err) => {
        CONEXIONES.delete(nombre);
        throw err;
      });

      CONEXIONES.set(nombre, promesa);
    }

    return CONEXIONES.get(nombre);
  }

  /**
   * Guarda un lote en UNA transaccion. Devuelve las ids asignadas (la ultima es
   * el numero de secuencia mas alto hasta ahora).
   */
  async function agregarLote(eventos) {
    if (!Array.isArray(eventos) || !eventos.length) return [];
    const db = await abrir();
    const tx = db.transaction(store, 'readwrite');
    const almacen = tx.objectStore(store);
    const ids = [];

    for (const evento of eventos) {
      // No se espera cada request: se encolan todos en la misma transaccion y se
      // espera al `oncomplete`. Es la diferencia entre un round-trip y N.
      const request = almacen.add(evento);
      request.onsuccess = () => ids.push(request.result);
    }

    await esperarTransaccion(tx);
    return ids;
  }

  /** Cuantos eventos hay guardados. */
  async function contar() {
    const db = await abrir();
    const tx = db.transaction(store, 'readonly');
    const total = await pedir(tx.objectStore(store).count());
    return total;
  }

  /**
   * Recorre los eventos en orden de llegada, por bloques, sin cargarlos todos en
   * memoria. `onChunk` puede ser async: el cursor espera antes de seguir.
   *
   * @param {{ tamano?: number, desde?: number, onChunk: (bloque:object[]) => any }} opciones
   * @returns {Promise<number>} cuantos eventos se recorrieron
   */
  async function recorrer({ tamano = 500, desde = null, onChunk } = {}) {
    if (typeof onChunk !== 'function') throw new Error('recorrer: falta onChunk');
    const db = await abrir();
    let procesados = 0;
    let bloque = [];
    let pendiente = Promise.resolve();

    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const rango = desde != null ? IDBKeyRange.lowerBound(desde) : null;
      const solicitud = tx.objectStore(store).openCursor(rango);

      solicitud.onerror = () => reject(solicitud.error || new Error('IndexedDB: cursor con error'));
      solicitud.onsuccess = () => {
        const cursor = solicitud.result;

        if (!cursor) {
          // Ultimo bloque incompleto.
          if (bloque.length) {
            const resto = bloque;
            bloque = [];
            pendiente = pendiente.then(() => onChunk(resto));
          }
          pendiente.then(resolve, reject);
          return;
        }

        bloque.push(cursor.value);
        procesados++;

        if (bloque.length >= tamano) {
          const lleno = bloque;
          bloque = [];
          pendiente = pendiente.then(() => onChunk(lleno));
        }

        cursor.continue();
      };
    });

    return procesados;
  }

  /** Los ultimos N eventos (para el feed y para depurar). */
  async function ultimos(cantidad = 20) {
    const db = await abrir();
    const encontrados = [];

    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const solicitud = tx.objectStore(store).openCursor(null, 'prev');
      solicitud.onerror = () => reject(solicitud.error || new Error('IndexedDB: cursor con error'));
      solicitud.onsuccess = () => {
        const cursor = solicitud.result;
        if (!cursor || encontrados.length >= cantidad) return resolve();
        encontrados.push(cursor.value);
        cursor.continue();
      };
    });

    return encontrados.reverse();
  }

  /** Borra todos los eventos. No toca `meta`. */
  async function limpiar() {
    const db = await abrir();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    await esperarTransaccion(tx);
  }

  async function getMeta(clave) {
    const db = await abrir();
    const tx = db.transaction(meta, 'readonly');
    const fila = await pedir(tx.objectStore(meta).get(clave));
    return fila ? fila.valor : null;
  }

  async function setMeta(clave, valor) {
    const db = await abrir();
    const tx = db.transaction(meta, 'readwrite');
    tx.objectStore(meta).put({ clave, valor });
    await esperarTransaccion(tx);
  }

  /** Cierra la conexion (util en tests y al desinstalar). */
  async function cerrar() {
    const promesa = CONEXIONES.get(nombre);
    if (!promesa) return;
    CONEXIONES.delete(nombre);
    try {
      const db = await promesa;
      db.close();
    } catch { /* ya estaba cerrada */ }
  }

  return { abrir, agregarLote, contar, recorrer, ultimos, limpiar, getMeta, setMeta, cerrar, disponible: hayIndexedDb };
}
