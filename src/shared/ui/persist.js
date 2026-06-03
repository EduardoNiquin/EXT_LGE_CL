// Persistencia de borradores de formularios ("drafts") en chrome.storage.local.
//
// Objetivo (QoL): que lo que el usuario escribe — SKUs, texto, fechas/horas,
// opciones — NO se pierda si el popup se cierra por accidente (clic afuera,
// cambio de ventana, etc.). Cada sección define una clave y una función que
// recolecta su estado serializable; el helper guarda con debounce en cada
// cambio y permite restaurar al re-renderizar.
//
// Sobrevive al cierre del popup porque se persiste en chrome.storage.local
// (no en memoria del popup). Es independiente del estado de ejecución (`run`):
// el draft es "lo que está cargado en el form", el run es "lo que se está
// procesando".

import { getStorage, setStorage, removeStorage } from '../storage/storage.js';

export function debounce(fn, ms = 400) {
  let handle = null;
  const wrapped = (...args) => {
    if (handle != null) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    if (handle != null) { clearTimeout(handle); handle = null; }
  };
  return wrapped;
}

/**
 * Crea un store de borrador para una clave.
 *
 * @param {string} key  clave en chrome.storage.local
 * @param {object} [opts]
 * @param {number} [opts.delay=400]  debounce de guardado en ms
 * @returns {{ save(value):void, saveNow(value):Promise, load():Promise, clear():Promise }}
 */
export function createDraftStore(key, { delay = 400 } = {}) {
  const flush = debounce((value) => { setStorage(key, value); }, delay);
  return {
    /** Guardado debounced — llamar en cada evento input/change. */
    save(value) { flush(value); },
    /** Guardado inmediato (sin debounce). */
    saveNow(value) {
      flush.cancel();
      return setStorage(key, value);
    },
    /** Devuelve el borrador guardado o null. */
    load() { return getStorage(key); },
    /** Borra el borrador. */
    clear() {
      flush.cancel();
      return removeStorage(key);
    },
  };
}

/**
 * Engancha autosave declarativo sobre los elementos `[data-persist]` de un
 * contenedor estático (input/textarea/select/checkbox/radio). Útil para forms
 * simples sin estado dinámico en JS.
 *
 * @param {HTMLElement} container
 * @param {string} key
 * @param {object} [opts]
 * @param {number} [opts.delay=400]
 * @returns {{ collect():object, restore(values):void, store: ReturnType<createDraftStore> }}
 */
export function bindAutosave(container, key, { delay = 400 } = {}) {
  const store = createDraftStore(key, { delay });
  const els = () => Array.from(container.querySelectorAll('[data-persist]'));

  const readEl = (el) => (el.type === 'checkbox' ? el.checked : el.value);
  const writeEl = (el, value) => {
    if (value == null) return;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value;
  };

  const collect = () => {
    const out = {};
    for (const el of els()) {
      const name = el.dataset.persist;
      if (el.type === 'radio') {
        if (el.checked) out[name] = el.value;
      } else {
        out[name] = readEl(el);
      }
    }
    return out;
  };

  const restore = (values) => {
    if (!values) return;
    for (const el of els()) {
      const name = el.dataset.persist;
      if (!(name in values)) continue;
      if (el.type === 'radio') el.checked = el.value === values[name];
      else writeEl(el, values[name]);
    }
  };

  const onChange = () => store.save(collect());
  container.addEventListener('input', onChange);
  container.addEventListener('change', onChange);

  return { collect, restore, store };
}
