// Router del feature "LG.com": sub-pantallas PDP / PLP / PBP.
//
// Sobre la barra de pestañas hay un switch "Auto" (persistido): cuando está
// activo, la pantalla mostrada SIGUE a la pantalla en la que esté el usuario
// (PDP/PLP), detectada por la captura más reciente y por los cambios de
// pestaña/ventana. Cuando está apagado, se mantiene la pantalla seleccionada
// manualmente.

import { MESSAGES, SCREENS, STORAGE_KEYS, screenForCapture } from '../constants.js';
import { getStorage, setStorage } from '../../../shared/storage/storage.js';
import { logger } from '../../../shared/utils/logger.js';
import * as screenView from './sections/screen.js';

const log = logger('lgcom/popup');

const DEFAULT_SCREEN = 'pdp';
const FOLLOW_INTERVAL = 1500; // ms: re-evalúa la pantalla actual cuando Auto está on

let activeScreenId = DEFAULT_SCREEN;
let autoFollow = false;

let rootContainer = null;
let hostEl = null;
let followTimer = null;
let listenersInstalled = false;

export function render(container) {
  rootContainer = container;
  container.innerHTML = '<div class="ct-state"><span class="ct-spinner"></span><p>Cargando…</p></div>';

  loadPrefs().then(() => {
    buildShell(container);
    installFollowListeners();
    if (autoFollow) { startFollowTimer(); evaluateAndFollow(); }
    mountScreen(activeScreenId);
  });
}

async function loadPrefs() {
  try {
    const screen = await getStorage(STORAGE_KEYS.SCREEN);
    if (SCREENS.some((s) => s.id === screen)) activeScreenId = screen;
    autoFollow = Boolean(await getStorage(STORAGE_KEYS.AUTO_FOLLOW));
  } catch { /* defaults */ }
}

function buildShell(container) {
  container.innerHTML = `
    <div class="lg-screens">
      <nav class="ct-tabs lg-screen-tabs" role="tablist">
        ${SCREENS.map((s) => `
          <button type="button" class="ct-tab lg-screen-tab ${s.id === activeScreenId ? 'is-active' : ''}"
                  data-screen="${s.id}" role="tab">${s.label}</button>
        `).join('')}
      </nav>
      <button type="button" id="lg-auto-follow" class="lg-ctl-btn lg-live ${autoFollow ? 'is-active' : ''}"
              title="Seguir automáticamente la pantalla actual (PDP/PLP)"
              aria-pressed="${autoFollow ? 'true' : 'false'}">
        <span class="lg-live-dot"></span>Auto
      </button>
    </div>
    <div id="lg-screen-host" class="ct-section-host"></div>
  `;

  hostEl = container.querySelector('#lg-screen-host');

  container.querySelectorAll('.lg-screen-tab').forEach((btn) => {
    btn.addEventListener('click', () => selectScreen(btn.dataset.screen));
  });

  container.querySelector('#lg-auto-follow')?.addEventListener('click', (e) => {
    autoFollow = !autoFollow;
    setStorage(STORAGE_KEYS.AUTO_FOLLOW, autoFollow);
    const btn = e.currentTarget;
    btn.classList.toggle('is-active', autoFollow);
    btn.setAttribute('aria-pressed', autoFollow ? 'true' : 'false');
    if (autoFollow) { startFollowTimer(); evaluateAndFollow(); }
    else stopFollowTimer();
  });
}

function selectScreen(screenId, { persist = true } = {}) {
  if (!SCREENS.some((s) => s.id === screenId)) return;
  activeScreenId = screenId;
  if (persist) setStorage(STORAGE_KEYS.SCREEN, screenId);
  if (rootContainer) {
    rootContainer.querySelectorAll('.lg-screen-tab').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.screen === screenId));
  }
  mountScreen(screenId);
}

function mountScreen(screenId) {
  const screen = SCREENS.find((s) => s.id === screenId);
  if (!hostEl || !screen) return;
  Promise.resolve(screenView.render(hostEl, screen)).catch((err) => {
    hostEl.innerHTML = `<p class="ct-empty">Error: ${String(err?.message || err)}</p>`;
  });
}

// -----------------------------------------------------------------------------
// auto-seguir la pantalla actual
// -----------------------------------------------------------------------------

function startFollowTimer() {
  stopFollowTimer();
  followTimer = setInterval(() => { if (autoFollow) evaluateAndFollow(); }, FOLLOW_INTERVAL);
}

function stopFollowTimer() {
  if (followTimer) { clearInterval(followTimer); followTimer = null; }
}

// Mira las capturas de la pestaña activa y cambia a la pantalla "dueña" de la
// captura más reciente (si difiere de la actual). Solo cuando Auto está on.
async function evaluateAndFollow() {
  if (!autoFollow || !rootContainer?.isConnected) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const res = await chrome.tabs.sendMessage(tab.id, { type: MESSAGES.GET_CAPTURES });
    const captures = res?.ok && Array.isArray(res.captures) ? res.captures : [];
    const screenId = freshestScreen(captures);
    if (screenId && screenId !== activeScreenId) {
      log.info('auto-follow → cambia de pantalla', { from: activeScreenId, to: screenId });
      selectScreen(screenId, { persist: false });
    }
  } catch { /* pestaña sin content script / sin capturas */ }
}

function freshestScreen(captures) {
  let best = null;
  let bestTs = -1;
  for (const c of captures) {
    const screenId = screenForCapture(c);
    if (!screenId) continue;
    if ((c.ts ?? 0) > bestTs) { bestTs = c.ts ?? 0; best = screenId; }
  }
  return best;
}

// Cuando cambia la pestaña/ventana activa y Auto está on, re-evaluamos (y al
// remontar la pantalla, ésta vuelve a capturar los datos de la nueva pestaña).
function installFollowListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;

  const onChange = () => {
    if (!autoFollow || !rootContainer?.isConnected) return;
    // Remonta la pantalla actual para refrescar datos de la nueva pestaña, y de
    // paso evalúa si hay que cambiar de pantalla.
    mountScreen(activeScreenId);
    evaluateAndFollow();
  };

  try {
    chrome.tabs.onActivated.addListener(onChange);
    chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === 'complete') onChange(); });
    chrome.windows.onFocusChanged.addListener((winId) => {
      if (winId !== chrome.windows.WINDOW_ID_NONE) onChange();
    });
  } catch { /* APIs no disponibles */ }
}
