import { SELECTORS } from '../constants.js';

function text(el) {
  return (el?.textContent ?? '').trim();
}

function inputValue(name) {
  return document.querySelector(`input[name="${name}"]`)?.value?.trim() || '';
}

function getActiveTab() {
  const sel = document.querySelector(`${SELECTORS.tabNav} li.L-nav-selected em`);
  return text(sel) || 'STG';
}

export function parseSearchForm() {
  const siteEl = document.querySelector(`${SELECTORS.siteRadios}:checked`);
  return {
    site:          siteEl?.value || null,
    superCategory: inputValue('superCategoryCode'),
    category:      inputValue('categoryCode'),
    subCategory:   inputValue('subCategoryCode'),
    salesModel:    inputValue('salesModel'),
    modelName:     inputValue('modelName'),
    productId:     inputValue('productId'),
    modelStatus:   inputValue('queryModelStatus'),
    modelType:     inputValue('modelTypeCode'),
    promotionId:   inputValue('promotionId'),
    publish:       inputValue('queryMessagePublishFlag'),
  };
}

function parseRow(tr) {
  const cell = (cls) => text(tr.querySelector(`.L-grid-col-${cls}`));

  const rowIdClass = Array.from(tr.classList).find(c => /^L-grid-row-r\d+$/.test(c));
  const rowId = rowIdClass ? rowIdClass.replace('L-grid-row-', '') : null;

  const editBtn = tr.querySelector('.L-grid-col-editView button');
  const onclick = editBtn?.getAttribute('onclick') || '';
  const match = onclick.match(/fncModelPopup\((\d+)\)/);
  const editIndex = match ? Number(match[1]) : null;

  return {
    rowId,
    rowIndex:      Number(cell('num')) || null,
    editIndex,
    isSelected:    tr.classList.contains('L-grid-row-selected'),
    salesModel:    cell('salesModelName'),
    modelName:     cell('modelName'),
    productId:     cell('sku'),
    pimSku:        cell('pimSku'),
    superCategory: cell('superCategory'),
    category:      cell('category'),
    subCategory:   cell('subCategory'),
    modelStatus:   cell('modelStatusCode'),
    modelType:     cell('modelType'),
    publish:       cell('messagePublishFlag'),
  };
}

export function parseGrid() {
  const activeTab = getActiveTab();
  const gridSel = activeTab === 'PROD' ? SELECTORS.gridProd : SELECTORS.gridStg;
  const grid = document.querySelector(gridSel);

  const rows = grid
    ? Array.from(grid.querySelectorAll('tbody tr.L-grid-row')).map(parseRow)
    : [];

  return {
    activeTab,
    rows,
    totals: {
      selected: Number(text(document.querySelector(SELECTORS.countSelect))) || 0,
      stg:      Number(text(document.querySelector(SELECTORS.countStg)))    || 0,
      prod:     Number(text(document.querySelector(SELECTORS.countProd)))   || 0,
    },
  };
}

export function parsePage() {
  return {
    searchForm: parseSearchForm(),
    grid:       parseGrid(),
    capturedAt: Date.now(),
    url:        window.location.href,
  };
}
