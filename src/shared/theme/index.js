// Gestión de tema (claro / oscuro / sistema) para la UI del popup y side panel.
//
// El tema sólo afecta a la UI de la extensión (popup/sidepanel), no a los
// content scripts. Por eso persistimos en `localStorage` (síncrono, mismo
// origin para popup y sidepanel, sobrevive reaperturas) en vez de
// `chrome.storage.local`: leerlo de forma síncrona en el arranque evita el
// "flash" de tema incorrecto al abrir el popup.
//
// El atributo aplicado es `data-theme` en `<html>` (documentElement):
//   - data-theme="light" | "dark"  → fuerza ese tema
//   - sin atributo                  → CSS resuelve vía prefers-color-scheme
//
// La preferencia guardada puede ser 'light' | 'dark' | 'system'. 'system'
// borra el atributo y deja que el CSS (media query) decida.

export const THEME_KEY = 'ext:theme';
export const THEMES = ['light', 'dark', 'system'];
const DEFAULT_THEME = 'system';

const listeners = new Set();
let mediaQuery = null;

function readStored() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEMES.includes(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function writeStored(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* no-op */ }
}

/** Tema efectivo ('light' | 'dark') a partir de la preferencia guardada. */
export function resolveTheme(pref = readStored()) {
  if (pref === 'light' || pref === 'dark') return pref;
  // system
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Preferencia guardada ('light' | 'dark' | 'system'). */
export function getThemePref() {
  return readStored();
}

/** Aplica el tema al documento según la preferencia indicada (o la guardada). */
export function applyTheme(pref = readStored()) {
  const root = document.documentElement;
  if (pref === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', pref);
  }
}

/** Cambia la preferencia, la persiste, la aplica y notifica a los listeners. */
export function setThemePref(pref) {
  const next = THEMES.includes(pref) ? pref : DEFAULT_THEME;
  writeStored(next);
  applyTheme(next);
  notify(next);
  return next;
}

/** Cicla light → dark → system → light. */
export function cycleTheme() {
  const order = ['light', 'dark', 'system'];
  const current = readStored();
  const idx = order.indexOf(current);
  return setThemePref(order[(idx + 1) % order.length]);
}

function notify(pref) {
  const effective = resolveTheme(pref);
  for (const fn of listeners) {
    try { fn({ pref, effective }); } catch { /* swallow */ }
  }
}

/** Subscribe a cambios de tema (incluye cambios del SO cuando pref='system'). */
export function subscribeTheme(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Inicializa el tema: aplica el guardado y engancha el listener del SO para
 * re-aplicar cuando la preferencia es 'system'. Llamar lo antes posible en el
 * arranque del popup/sidepanel.
 */
export function initTheme() {
  applyTheme();
  try {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (readStored() === 'system') {
        applyTheme('system');
        notify('system');
      }
    };
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', onChange);
    else if (mediaQuery.addListener) mediaQuery.addListener(onChange);
  } catch { /* matchMedia no disponible */ }
}
