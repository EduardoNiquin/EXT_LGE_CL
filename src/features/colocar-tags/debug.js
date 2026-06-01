import { register, cmd } from '../../shared/debug/index.js';
import { SELECTORS, DELIVERY_DEFAULTS, PRODUCT_TAG_SELECTORS, OFFER_SELECTORS, OFFER_MAX } from './constants.js';
import { diagnose } from './content/detector.js';
import { parsePage } from './content/parser.js';
import { searchProductBySku, findRowBySalesModel } from './content/flows/search-product.js';
import { applyDeliveryTag } from './content/flows/delivery-tag.js';
import { applyOfferTags } from './content/flows/offer-tag.js';
import { isMarketingModalOpen, getMarketingModal } from './content/gp1/modal.js';
import { getTopMessagebox, getMessageboxBodyText } from './content/gp1/messagebox.js';

register('colocarTags', {
  diagnose: cmd(
    () => diagnose(),
    'Diagnóstico de detección de la pantalla MIM en este frame',
  ),
  parse: cmd(
    () => parsePage(),
    'Corre el parser y devuelve { searchForm, grid }',
  ),
  selectors: cmd(
    () => ({ ...SELECTORS }),
    'Mapa de selectores que usa la feature',
  ),
  check: cmd(
    () => Object.fromEntries(
      Object.entries(SELECTORS)
        .filter(([, sel]) => typeof sel === 'string')
        .map(([k, sel]) => [k, Boolean(document.querySelector(sel))]),
    ),
    'true/false por cada selector estático contra el DOM actual',
  ),
  checkProductTagRow: cmd(
    (i = 1) => Object.fromEntries(
      Object.entries(PRODUCT_TAG_SELECTORS)
        .map(([k, fn]) => [k, { selector: fn(i), present: Boolean(document.querySelector(fn(i))) }]),
    ),
    'checkProductTagRow(1|2) — estado de los selectores de la fila i de Product Tag',
  ),
  snapshotProductTags: cmd(
    () => {
      const rows = [];
      for (let i = 1; i <= 2; i++) {
        const get = (sel) => document.querySelector(sel);
        const chk      = get(PRODUCT_TAG_SELECTORS.chk(i));
        const catSel   = get(PRODUCT_TAG_SELECTORS.categorySel(i));
        const groupIn  = get(PRODUCT_TAG_SELECTORS.groupInput(i));
        const valueIn  = get(PRODUCT_TAG_SELECTORS.valueInput(i));
        const typeSel  = get(PRODUCT_TAG_SELECTORS.typeSel(i));
        const useFlag  = get(PRODUCT_TAG_SELECTORS.useFlag(i));
        const userType = get(PRODUCT_TAG_SELECTORS.userType(i));
        rows.push({
          tagIndex: i,
          rowChk:      chk      ? chk.checked     : '<missing>',
          category:    catSel   ? catSel.value    : '<missing>',
          group:       groupIn  ? groupIn.value   : '<missing>',
          tag:         valueIn  ? valueIn.value   : '<missing>',
          type:        typeSel  ? typeSel.value   : '<missing>',
          typeOptions: typeSel  ? Array.from(typeSel.options).map((o) => o.value + (o.hidden ? '(hidden)' : '')) : '<missing>',
          typePtrEv:   typeSel  ? (typeSel.style.pointerEvents || '<default>') : '<missing>',
          useFlag:     useFlag  ? useFlag.checked : '<missing>',
          userType:    userType ? userType.value  : '<missing>',
          beginDay:    get(PRODUCT_TAG_SELECTORS.beginDay(i))?.value  ?? '<missing>',
          beginTime:   get(PRODUCT_TAG_SELECTORS.beginTime(i))?.value ?? '<missing>',
          endDay:      get(PRODUCT_TAG_SELECTORS.endDay(i))?.value    ?? '<missing>',
          endTime:     get(PRODUCT_TAG_SELECTORS.endTime(i))?.value   ?? '<missing>',
        });
      }
      console.table(rows);
      return rows;
    },
    'snapshotProductTags() — snapshot completo de las 2 filas de Product Tag (DOM actual)',
  ),
  find: cmd(
    (key) => {
      const sel = SELECTORS[key];
      if (typeof sel !== 'string') return null;
      return document.querySelector(sel);
    },
    'find("searchForm") → elemento DOM o null',
  ),
  iframes: cmd(
    () => Array.from(document.querySelectorAll('iframe')).map((f) => ({
      id: f.id || null,
      name: f.name || null,
      src: f.getAttribute('src') || '(sin src)',
    })),
    'Lista de iframes del frame actual',
  ),
  frameInfo: cmd(
    () => ({
      url: location.href,
      title: document.title,
      isTopFrame: window === window.top,
    }),
    'Info del frame donde corre este content script',
  ),

  // --- runners interactivos para el flow Delivery ---
  findRow: cmd(
    (sku) => findRowBySalesModel(sku),
    'findRow("OLED65B5PSA.AWH") → fila DOM o null',
  ),
  openModal: cmd(
    (sku) => searchProductBySku({ sku, onStep: (s, d) => console.log('[step]', s, d || '') }),
    'openModal(sku) → busca, click Edit y abre el modal. Loguea pasos.',
  ),
  isModalOpen: cmd(
    () => isMarketingModalOpen(),
    'true si #dialog2 está visible',
  ),
  modal: cmd(
    () => getMarketingModal(),
    'Devuelve el elemento DOM del modal o null',
  ),
  topMessagebox: cmd(
    () => {
      const box = getTopMessagebox();
      return box ? { body: getMessageboxBodyText(box), z: box.style.zIndex } : null;
    },
    'Inspecciona el messagebox visible top',
  ),

  /**
   * runDelivery({sku, tagLabel?, beginDay, beginTime, endDay, endTime, skipProd?})
   * Encadena search + applyDeliveryTag para 1 SKU. No emite progress al popup,
   * loguea por console.
   */
  runDelivery: cmd(
    async (opts = {}) => {
      const {
        sku,
        tagLabel  = DELIVERY_DEFAULTS.tagLabel,
        beginDay,
        beginTime,
        endDay,
        endTime,
        skipProd  = DELIVERY_DEFAULTS.skipProd,
      } = opts;
      const onStep = (s, d) => console.log('[step]', s, d || '');
      await searchProductBySku({ sku, onStep });
      return applyDeliveryTag({ tagLabel, beginDay, beginTime, endDay, endTime, skipProd, onStep });
    },
    'runDelivery({sku, beginDay, beginTime, endDay, endTime, tagLabel?, skipProd?}) — 1 SKU end-to-end',
  ),

  // --- inspección / runner del flow Offer ---
  checkOfferRow: cmd(
    (i = 1) => Object.fromEntries(
      Object.entries(OFFER_SELECTORS)
        .map(([k, fn]) => [k, { selector: fn(i), present: Boolean(document.querySelector(fn(i))) }]),
    ),
    'checkOfferRow(1..4) — estado de los selectores de la fila i de Tag de Oferta',
  ),
  snapshotOfferTags: cmd(
    () => {
      const rows = [];
      for (let i = 1; i <= OFFER_MAX; i++) {
        const get = (sel) => document.querySelector(sel);
        const chk   = get(OFFER_SELECTORS.rowChk(i));
        const flag  = get(OFFER_SELECTORS.useFlag(i));
        const msg   = get(OFFER_SELECTORS.msg(i));
        const start = get(OFFER_SELECTORS.startDate(i));
        const end   = get(OFFER_SELECTORS.endDate(i));
        rows.push({
          offerIndex:  i,
          rowChk:      chk   ? chk.checked  : '<missing>',
          use:         flag  ? flag.checked : '<missing>',
          description: msg   ? msg.value    : '<missing>',
          startDate:   start ? start.value  : '<missing>',
          endDate:     end   ? end.value    : '<missing>',
        });
      }
      console.table(rows);
      return rows;
    },
    'snapshotOfferTags() — snapshot de las 4 filas de Tag de Oferta (DOM actual)',
  ),
  runOffer: cmd(
    async (opts = {}) => {
      const { sku, offers, skipProd = true } = opts;
      const onStep = (s, d) => console.log('[step]', s, d || '');
      await searchProductBySku({ sku, onStep });
      return applyOfferTags({ offers, skipProd, onStep });
    },
    'runOffer({sku, offers:[{index,use,description,startDate,endDate}], skipProd?}) — 1 SKU end-to-end',
  ),
});
