import { features } from './features.js';
import { install, register, cmd } from '../shared/debug/index.js';
import { installGlobalErrorCapture } from '../shared/diagnostics/index.js';
import { sendMessageToActiveTab } from '../shared/messaging/messaging.js';
import { MESSAGES as COLOCAR_TAGS_MSG } from '../features/colocar-tags/constants.js';
import { initTheme, getThemePref, cycleTheme, subscribeTheme } from '../shared/theme/index.js';

// Aplicar el tema lo antes posible para minimizar el "flash".
initTheme();

const version = chrome?.runtime?.getManifest?.()?.version;
install({ version, context: 'popup' });
installGlobalErrorCapture('popup');

// Atajos para depurar el lado del popup sin abrir el content script.
register('popup', {
  listFeatures: cmd(() => features.map(f => ({ id: f.id, name: f.name })), 'Features registradas en el popup'),
  ping: cmd(
    () => sendMessageToActiveTab({ type: COLOCAR_TAGS_MSG.GET_PAGE_DATA }),
    'Envía get-page-data a la pestaña activa y devuelve la respuesta',
  ),
});

const app         = document.getElementById('app');
const backBtn     = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const panelToggle = document.getElementById('panel-toggle');
const themeToggle = document.getElementById('theme-toggle');

const HOME_TITLE = 'LGE CL Tools';

// Contexto de render: el mismo bundle sirve al popup (pequeño) y al side panel
// (grande, acoplado a la derecha). `sidepanel.html` marca el body.
const isSidePanel = document.body.dataset.context === 'sidepanel';

const ICON_MAXIMIZE = '<path d="M9 2h5v5M14 2L8.5 7.5M7 14H2V9M2 14l5.5-5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
const ICON_MINIMIZE = '<path d="M14 2L9.5 6.5M9.5 6.5H13.5M9.5 6.5V2.5M2 14l4.5-4.5M6.5 9.5H2.5M6.5 9.5V13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';

async function maximizeToSidePanel() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId != null) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch (err) {
    console.warn('[popup] No se pudo abrir el side panel:', err);
    return;
  }
  // Cerramos el popup: el side panel ya quedó abierto con la misma UI.
  window.close();
}

function minimizePanel() {
  // Cierra el side panel; el usuario reabre el popup con el ícono de la barra.
  window.close();
}

// Iconos del toggle de tema según la preferencia activa.
const THEME_ICONS = {
  // Sol (claro)
  light: '<circle cx="8" cy="8" r="3.2" stroke="currentColor" stroke-width="1.4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  // Luna (oscuro)
  dark: '<path d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.3 4.3 0 0 0 7 7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  // Auto (sistema): medio sol / medio luna
  system: '<circle cx="8" cy="8" r="5.2" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.8a5.2 5.2 0 0 0 0 10.4z" fill="currentColor"/>',
};
const THEME_LABELS = { light: 'Tema: claro', dark: 'Tema: oscuro', system: 'Tema: sistema' };

function updateThemeIcon() {
  if (!themeToggle) return;
  const pref = getThemePref();
  const svg = themeToggle.querySelector('svg');
  if (svg) svg.innerHTML = THEME_ICONS[pref] || THEME_ICONS.system;
  themeToggle.title = THEME_LABELS[pref] || THEME_LABELS.system;
  themeToggle.setAttribute('aria-label', THEME_LABELS[pref] || THEME_LABELS.system);
}

function setupThemeToggle() {
  if (!themeToggle) return;
  updateThemeIcon();
  themeToggle.addEventListener('click', () => {
    cycleTheme();
    updateThemeIcon();
  });
  // Mantener el icono en sync si el tema cambia desde otra vista (Ajustes).
  subscribeTheme(updateThemeIcon);
}

function setupPanelToggle() {
  if (!panelToggle) return;
  const svg = panelToggle.querySelector('svg');
  if (isSidePanel) {
    panelToggle.setAttribute('aria-label', 'Minimizar');
    panelToggle.title = 'Minimizar';
    if (svg) svg.innerHTML = ICON_MINIMIZE;
    panelToggle.addEventListener('click', minimizePanel);
  } else {
    panelToggle.setAttribute('aria-label', 'Maximizar');
    panelToggle.title = 'Maximizar (abrir panel lateral)';
    if (svg) svg.innerHTML = ICON_MAXIMIZE;
    panelToggle.addEventListener('click', maximizeToSidePanel);
  }
}

function highlight(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

function filterFeatures(query) {
  if (!query.trim()) return features;
  const q = query.toLowerCase();
  return features.filter(f =>
    f.name.toLowerCase().includes(q) ||
    f.description.toLowerCase().includes(q) ||
    f.keywords.some(k => k.includes(q))
  );
}

function renderHome() {
  headerTitle.textContent = HOME_TITLE;
  backBtn.classList.add('hidden');

  app.innerHTML = `
    <div class="search-wrapper">
      <svg class="search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.6"/>
        <path d="M13 13l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      <input type="text" id="search" class="search-input" placeholder="Buscar funcionalidad..." autocomplete="off" spellcheck="false" />
      <button id="search-clear" class="search-clear hidden" aria-label="Limpiar búsqueda">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <section class="features-section">
      <p class="features-label" id="features-label">Funcionalidades</p>
      <ul id="features-list" class="features-list" role="list"></ul>
      <div id="empty-state" class="empty-state hidden" aria-live="polite">
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <circle cx="18" cy="18" r="11" stroke="currentColor" stroke-width="2"/>
          <path d="M26 26l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M14 18h8M18 14v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <p>Sin resultados para <strong id="empty-term"></strong></p>
      </div>
    </section>
  `;

  const searchInput   = document.getElementById('search');
  const searchClear   = document.getElementById('search-clear');
  const featuresList  = document.getElementById('features-list');
  const emptyState    = document.getElementById('empty-state');
  const emptyTerm     = document.getElementById('empty-term');
  const featuresLabel = document.getElementById('features-label');

  function renderList(query = '') {
    const results = filterFeatures(query);
    featuresList.innerHTML = '';

    if (results.length === 0) {
      featuresList.classList.add('hidden');
      featuresLabel.classList.add('hidden');
      emptyTerm.textContent = query;
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    featuresList.classList.remove('hidden');
    featuresLabel.classList.remove('hidden');
    featuresLabel.textContent = query
      ? `${results.length} resultado${results.length !== 1 ? 's' : ''}`
      : 'Funcionalidades';

    for (const feature of results) {
      const li = document.createElement('li');
      li.className = 'feature-item';
      li.dataset.id = feature.id;
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');
      li.innerHTML = `
        <span class="feature-badge">${feature.abbr}</span>
        <span class="feature-info">
          <span class="feature-name">${highlight(feature.name, query)}</span>
          <span class="feature-desc">${highlight(feature.description, query)}</span>
        </span>
        <svg class="feature-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      li.addEventListener('click', () => openFeature(feature));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') openFeature(feature);
      });
      featuresList.appendChild(li);
    }
  }

  searchInput.addEventListener('input', () => {
    const query = searchInput.value;
    searchClear.classList.toggle('hidden', !query);
    renderList(query);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.add('hidden');
    searchInput.focus();
    renderList('');
  });

  renderList();
}

function openFeature(feature) {
  if (typeof feature.render !== 'function') {
    console.warn('[popup] Feature sin render:', feature.id);
    return;
  }
  headerTitle.textContent = feature.name;
  backBtn.classList.remove('hidden');
  app.innerHTML = '';
  feature.render(app);
}

backBtn.addEventListener('click', renderHome);

setupThemeToggle();
setupPanelToggle();
renderHome();
