import { cmd, register } from '../../../shared/debug/index.js';
import { DEFAULT_CONFIG, FINISH_REASON, SELECTORS, WEBSITE_LABEL } from './constants.js';
import {
  clearExport, clearRun, getDraft, getExport, getRun, makeExport, setExport, updateRun,
} from './state.js';
import { buildExistingMatrix, buildMatrix, matrixToCsv } from './csv.js';
import { parseBundleLines } from './parse-input.js';
import { diagnose } from './content/detector.js';
import {
  clearFilters,
  collectAllBundles,
  currentWebsite,
  deleteExistingRule,
  ensureWebsite,
  findExistingRule,
  parseListingRows,
} from './content/magento/listing.js';
import { fillParentForm, formRoot } from './content/magento/parent-form.js';
import { createOffer, findOfferModal, openOfferModal, readOfferSkus, splitVisible } from './content/magento/offer-modal.js';
import { hasLoadedOptions, readSelectedProduct, selectProduct } from './content/magento/advanced-select.js';
import { field } from './content/magento/fields.js';
import { readMessages } from './content/parser.js';
import { tickIfActive } from './content/flows/run.js';
import { exportTick } from './content/flows/export.js';

register('magentoSoftbundles', {
  diagnose: cmd(() => diagnose(), 'Diagnostico de la pantalla actual'),
  selectors: cmd(() => SELECTORS, 'Selectores del modulo'),
  messages: cmd(() => readMessages(), 'Mensajes que muestra Magento'),

  // --- listado ---
  website: cmd(() => currentWebsite(), 'Website seleccionado en el listado'),
  setWebsite: cmd(
    (label = WEBSITE_LABEL) => ensureWebsite(label, {}),
    'Selecciona el website del listado (navega)',
  ),
  rows: cmd(() => parseListingRows(), 'Filas visibles del listado'),
  exists: cmd((sku) => findExistingRule(sku, {}), 'Busca si un SKU ya tiene package rule'),
  clearFilters: cmd(() => clearFilters({}), 'Quita los filtros del listado'),

  // --- bundles existentes (solo lectura) ---
  bundles: cmd(
    () => collectAllBundles({ onWarn: (m) => console.warn(m), onProgress: (p) => console.info(p) }),
    'Recorre TODO el listado y devuelve las reglas con sus hijos',
  ),
  existingCsv: cmd(
    async () => matrixToCsv(buildExistingMatrix(await collectAllBundles({ onWarn: (m) => console.warn(m) }))),
    'CSV padre,hijo de los package rules existentes',
  ),
  exportBundles: cmd(async () => { await setExport(makeExport()); return exportTick(); }, 'Lanza el export del listado (como el boton del popup)'),
  exportState: cmd(() => getExport(), 'Estado del export'),
  exportReset: cmd(async () => { await clearExport(); return true; }, 'Limpia el export'),

  // --- DESTRUCTIVO: borra un package rule y todas sus ofertas ---
  deleteRule: cmd(
    (sku, expectedId = '') => deleteExistingRule(sku, { expectedId }),
    'BORRA el package rule de un SKU (y sus ofertas). Irreversible: solo para la politica "borrar"',
  ),

  // --- formulario del padre ---
  pickMain: cmd(
    (sku, { force = true } = {}) => selectProduct(field(formRoot(), 'product_sku'), sku, {
      force,
      remote: false,
      onInfo: (message) => console.info(message),
    }),
    'Elige un SKU en "Main Product" (force=true inyecta el que el desplegable no lista)',
  ),
  mainOptionsLoaded: cmd(
    () => hasLoadedOptions(field(formRoot(), 'product_sku')),
    'True si "Main Product" ya trajo su lote de productos (solo tras elegir "Apply To")',
  ),
  mainProduct: cmd(() => readSelectedProduct(field(formRoot(), 'product_sku')), 'SKU elegido en "Main Product"'),
  fillParent: cmd(
    ({ sku, ...overrides } = {}) => fillParentForm({
      parentSku: sku,
      config: { ...DEFAULT_CONFIG, ...overrides },
      onInfo: (message) => console.info(message),
    }),
    'Llena el formulario del padre SIN guardar',
  ),

  // --- ofertas ---
  openOffer: cmd(() => openOfferModal({}), 'Abre el modal "Add New Offer"'),
  offerModal: cmd(() => Boolean(findOfferModal()), 'True si el modal de oferta esta abierto'),
  offers: cmd(() => readOfferSkus(), 'SKU de las ofertas ya creadas'),
  splitVisible: cmd(() => splitVisible(), 'True si el % sobre el principal esta a la vista'),
  addOffer: cmd(
    ({ sku, discountRate = null, mainDiscountRate = null, dryRun = true, ...overrides } = {}) => createOffer({
      child: { sku, discountRate, mainDiscountRate },
      config: { ...DEFAULT_CONFIG, ...overrides },
      dryRun,
      onInfo: (message) => console.info(message),
    }),
    'Crea una oferta (dryRun=true por defecto: llena y cierra sin guardar)',
  ),

  // --- entrada / run ---
  parse: cmd((text) => parseBundleLines(text), 'Lee el texto de bundles como lo hace el popup'),
  state: cmd(() => getRun(), 'Estado persistido del proceso'),
  draft: cmd(() => getDraft(), 'Borrador del formulario del popup'),
  csv: cmd(async () => matrixToCsv(buildMatrix(await getRun())), 'CSV del resultado'),
  stop: cmd(() => updateRun((run) => ({
    ...run,
    active: false,
    finishedAt: Date.now(),
    finishReason: FINISH_REASON.CANCELLED,
  })), 'Detiene el proceso'),
  reset: cmd(async () => { await clearRun(); return true; }, 'Limpia el proceso'),
  tick: cmd(() => tickIfActive(), 'Fuerza un tick del proceso'),
});
