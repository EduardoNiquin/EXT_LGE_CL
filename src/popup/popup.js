import { features } from './features.js';

const app         = document.getElementById('app');
const backBtn     = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');

const HOME_TITLE = 'LGE CL Tools';

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

renderHome();
