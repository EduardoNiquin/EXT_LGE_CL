import { features } from './features.js';

const searchInput   = document.getElementById('search');
const searchClear   = document.getElementById('search-clear');
const featuresList  = document.getElementById('features-list');
const emptyState    = document.getElementById('empty-state');
const emptyTerm     = document.getElementById('empty-term');
const featuresLabel = document.getElementById('features-label');

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

function renderFeatures(query = '') {
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

function openFeature(feature) {
  // TODO: navegar a la vista del feature
  console.log('[popup] Abrir feature:', feature.id);
}

searchInput.addEventListener('input', () => {
  const query = searchInput.value;
  searchClear.classList.toggle('hidden', !query);
  renderFeatures(query);
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.classList.add('hidden');
  searchInput.focus();
  renderFeatures('');
});

renderFeatures();
