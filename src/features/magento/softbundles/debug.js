import { cmd, register } from '../../../shared/debug/index.js';
import { DEFAULT_CONFIG, FINISH_REASON, SELECTORS, WEBSITE_LABEL } from './constants.js';
import { clearRun, getDraft, getRun, updateRun } from './state.js';
import { buildMatrix, matrixToCsv } from './csv.js';
import { parseBundleLines } from './parse-input.js';
import { diagnose } from './content/detector.js';
import {
  clearFilters,
  currentWebsite,
  ensureWebsite,
  findExistingRule,
  parseListingRows,
} from './content/magento/listing.js';
import { fillParentForm, formRoot } from './content/magento/parent-form.js';
import { createOffer, findOfferModal, openOfferModal, readOfferSkus, splitVisible } from './content/magento/offer-modal.js';
import { readSelectedProduct, selectProduct } from './content/magento/advanced-select.js';
import { field } from './content/magento/fields.js';
import { readMessages } from './content/parser.js';
import { tickIfActive } from './content/flows/run.js';

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

  // --- formulario del padre ---
  pickMain: cmd(
    (sku) => selectProduct(field(formRoot(), 'product_sku'), sku, {}),
    'Elige un SKU en "Main Product"',
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
