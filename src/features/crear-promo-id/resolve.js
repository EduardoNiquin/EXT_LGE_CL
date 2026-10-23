// Del catalogo de modelos de GP1 (una fila por ruta de categoria) a lo que hay
// que agregar a la promo. Puro, testeable.
//
// Un mismo modelo aparece una vez por cada categoria/subcategoria en la que esta
// mapeado (ej. RNC5 sale en "Speakers / Party Speakers", "Hi-Fi System", ...).
// Las promos que se arman a mano hoy llevan TODAS esas filas (la de 151 filas
// tiene 69 modelos), por eso es el modo por defecto.

import { CATEGORY_MODE, LIMITS, MAIN_MODEL_COUNTS, SKU_STATUS } from './constants.js';
import { normalizeSku } from './parse-input.js';

// Campos que la pantalla copia del grid de busqueda a la promo (modelSelectBtn).
export const MODEL_FIELDS = [
  'bizType', 'superCategory', 'category', 'subCategory',
  'superCategoryId', 'categoryId', 'subCategoryId',
  'salesModel', 'modelName', 'modelId', 'productId', 'msrp', 'stgMsrp',
];

/** Deja solo los campos que se usan (la API trae ~80 por fila, casi todos null). */
export function slimRow(row) {
  const out = {};
  for (const field of MODEL_FIELDS) out[field] = row?.[field] ?? '';
  return out;
}

export function categoryPath(row) {
  return [row.superCategory, row.category, row.subCategory].filter(Boolean).join(' / ');
}

/** Indices por Sales Model, Product ID y Model Name -> modelIds. */
export function buildIndex(rows) {
  const byModel = new Map();
  const keys = { salesModel: new Map(), productId: new Map(), modelName: new Map() };
  for (const row of rows || []) {
    if (!row?.modelId) continue;
    if (!byModel.has(row.modelId)) byModel.set(row.modelId, []);
    byModel.get(row.modelId).push(row);
    for (const key of Object.keys(keys)) {
      const value = normalizeSku(row[key]);
      if (!value) continue;
      if (!keys[key].has(value)) keys[key].set(value, new Set());
      keys[key].get(value).add(row.modelId);
    }
  }
  return { byModel, keys };
}

function lookup(index, sku) {
  for (const key of ['salesModel', 'productId', 'modelName']) {
    const ids = index.keys[key].get(sku);
    if (ids?.size) return { ids: [...ids], matchedBy: key };
  }
  return null;
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.superCategoryId}|${row.categoryId}|${row.subCategoryId}|${row.modelId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {string[]} skus normalizados
 * @param {object[]} catalogRows filas de retrieveCategoryModelList (slim)
 * @param {{ categoryMode?: string }} [opts]
 */
export function resolveSkus(skus, catalogRows, { categoryMode = CATEGORY_MODE.ALL } = {}) {
  const index = buildIndex(catalogRows);
  const models = [];
  const notFound = [];
  const ambiguous = [];
  const repeated = [];
  const usedModelIds = new Set();

  for (const sku of skus || []) {
    const hit = lookup(index, sku);
    if (!hit) { notFound.push(sku); continue; }
    if (hit.ids.length > 1) {
      ambiguous.push({
        sku,
        options: hit.ids.map((id) => index.byModel.get(id)[0].salesModel),
      });
      continue;
    }
    const modelId = hit.ids[0];
    if (usedModelIds.has(modelId)) { repeated.push(sku); continue; }
    usedModelIds.add(modelId);
    const all = uniqueRows(index.byModel.get(modelId));
    const rows = categoryMode === CATEGORY_MODE.FIRST ? all.slice(0, 1) : all;
    const first = all[0];
    models.push({
      sku,
      matchedBy: hit.matchedBy,
      modelId,
      salesModel: first.salesModel,
      modelName: first.modelName,
      productId: first.productId,
      msrp: first.msrp,
      categories: rows.map(categoryPath),
      rows,
    });
  }

  const rowCount = models.reduce((sum, m) => sum + m.rows.length, 0);
  return { models, notFound, ambiguous, repeated, rowCount };
}

/** Main Model por defecto: los 3 primeros si hay 3 o mas modelos, si no el primero. */
export function defaultMainModels(models) {
  const ids = (models || []).map((m) => m.modelId);
  return ids.length >= 3 ? ids.slice(0, 3) : ids.slice(0, 1);
}

/**
 * Main Model elegidos por la persona (SKUs). Si alguno no esta entre los
 * modelos encontrados, o la cuenta no da 1 o 3, se cae a los por defecto y se
 * avisa: la promo se crea igual.
 *
 * @returns {{ ids: string[], warnings: string[] }}
 */
export function pickMainModels(models, mainSkus = []) {
  const wanted = (mainSkus || []).map(normalizeSku).filter(Boolean);
  if (!wanted.length) return { ids: defaultMainModels(models), warnings: [] };
  const warnings = [];
  const ids = [];
  for (const sku of wanted) {
    const model = (models || []).find((m) => [m.sku, m.salesModel, m.productId, m.modelName].map(normalizeSku).includes(sku));
    if (!model) warnings.push(`Main Model ${sku} no esta entre los modelos agregados.`);
    else if (!ids.includes(model.modelId)) ids.push(model.modelId);
  }
  if (!MAIN_MODEL_COUNTS.includes(ids.length)) {
    const fallback = defaultMainModels(models);
    warnings.push(`Quedaron ${ids.length} Main Model validos y GP1 exige 1 o 3: se usan los ${fallback.length} primero(s) de la lista.`);
    return { ids: fallback, warnings };
  }
  return { ids, warnings };
}

/**
 * Estado por SKU de la lista, en el orden en que se pego.
 * @returns {Array<{ sku: string, status: string, salesModel?: string, modelId?: string, rows?: number, note?: string }>}
 */
export function itemsFromResolution(skus, resolution) {
  const bySku = new Map();
  resolution.models.forEach((m) => bySku.set(m.sku, {
    status: SKU_STATUS.FOUND, salesModel: m.salesModel, modelId: m.modelId, rows: m.rows.length,
    note: m.matchedBy !== 'salesModel' ? `por ${m.matchedBy}` : '',
  }));
  resolution.notFound.forEach((sku) => bySku.set(sku, { status: SKU_STATUS.NOT_FOUND }));
  resolution.ambiguous.forEach((a) => bySku.set(a.sku, { status: SKU_STATUS.AMBIGUOUS, note: a.options.join(', ') }));
  resolution.repeated.forEach((sku) => bySku.set(sku, { status: SKU_STATUS.REPEATED }));
  return skus.map((sku) => ({ sku, ...(bySku.get(sku) || { status: SKU_STATUS.NOT_FOUND }) }));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lo que se puede validar antes de tocar GP1 (los mismos limites de la
 * pantalla). Los SKUs que no existan no bloquean: se reportan y la promo se
 * crea con el resto.
 *
 * @returns {string[]}
 */
export function validateConfig(config, { skus = [], mainSkus = [] } = {}) {
  const errors = [];
  const title = String(config?.title ?? '').trim();
  if (!title) errors.push('Falta el titulo.');
  if (title.length > LIMITS.TITLE) errors.push(`El titulo tiene ${title.length} caracteres (maximo ${LIMITS.TITLE}).`);
  if (String(config?.tag ?? '').length > LIMITS.TAG) errors.push(`El Tag supera ${LIMITS.TAG} caracteres.`);
  if (String(config?.bodyCopy ?? '').length > LIMITS.BODY_COPY) errors.push(`El Body Copy supera ${LIMITS.BODY_COPY} caracteres.`);
  const { startDate, endDate } = config || {};
  if (!DATE_RE.test(startDate || '') || !DATE_RE.test(endDate || '')) errors.push('Faltan las fechas (desde y hasta).');
  else if (startDate > endDate) errors.push('La fecha "desde" es posterior a "hasta".');
  if (!skus.length) errors.push('Pega al menos un SKU.');
  if (mainSkus.length && !MAIN_MODEL_COUNTS.includes(mainSkus.length)) {
    errors.push(`Main Model: GP1 exige 1 o 3 (escribiste ${mainSkus.length}). Dejalo vacio para usar los 3 primeros.`);
  }
  return errors;
}
