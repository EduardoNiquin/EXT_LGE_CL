// Puente con el mundo MAIN de GP1 > Promotion Management (ver content_scripts
// del manifest).
//
// Por que existe: la pantalla esta hecha con RUI (Rui.data.LDataSet + grids
// L-*). El grid de modelos de la promo y el de busqueda del popup "Model" son
// datasets que solo viven en el JS de la pagina; el mundo aislado ve el DOM pero
// no esos objetos. Elegir 100 modelos a mano son 100 checkboxes y una busqueda
// por categoria; aqui se cargan las filas en el dataset de busqueda y se aprieta
// el SELECT de la pagina, que corre su propio codigo (orden, OBS Price, lista de
// categorias) igual que si la persona los hubiera marcado.
//
// `m2CategoryModelDataSet` es local a un closure de la pagina. Se captura
// enganchando `LDataSet.prototype.clearData`: la pagina lo llama al abrir el
// popup "Model" (cudModelPopup), y en ese momento `this` es el dataset.
//
// Restricciones de este archivo:
//   - Corre en el contexto de la pagina: NO hay `chrome.*` ni imports.
//   - Solo habla por `window.postMessage`.
//   - No guarda nada: ningun op llama al servidor salvo lecturas
//     (retrieveDataList). El SAVE TO STG lo aprieta el mundo aislado.

(() => {
  const SOURCE = 'ext-lge-cl/crear-promo-id-bridge';
  const RETRIEVE_URL = '/common/rui/retrieveDataList.lgajax';
  const MODEL_FIELDS = [
    'bizType', 'superCategory', 'category', 'subCategory',
    'superCategoryId', 'categoryId', 'subCategoryId',
    'salesModel', 'modelName', 'modelId', 'productId', 'msrp', 'stgMsrp',
  ];

  if (window.__extLgeClPromoBridge) return;
  window.__extLgeClPromoBridge = true;

  const captured = {};

  function hookDataSets() {
    const proto = window.Rui?.data?.LDataSet?.prototype;
    if (!proto || proto.__extLgeClHooked) return Boolean(proto);
    const original = proto.clearData;
    proto.clearData = function patchedClearData(...args) {
      try { if (this?.id) captured[this.id] = this; } catch { /* nunca romper la pagina */ }
      return original.apply(this, args);
    };
    proto.__extLgeClHooked = true;
    return true;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isShown = (el) => Boolean(el) && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';

  async function until(fn, { timeout = 15000, every = 100, what = 'condicion' } = {}) {
    const t0 = Date.now();
    for (;;) {
      const value = fn();
      if (value) return value;
      if (Date.now() - t0 > timeout) throw new Error(`timeout esperando ${what}`);
      await sleep(every);
    }
  }

  async function retrieve(params) {
    const res = await fetch(RETRIEVE_URL, {
      method: 'POST',
      credentials: 'include',
      body: new URLSearchParams(params),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GP1 respondio ${res.status}`);
    let json;
    try { json = JSON.parse(text); } catch { throw new Error('GP1 no devolvio JSON (sesion vencida?)'); }
    return json?.[0]?.records || [];
  }

  function locale() { return window.gLocaleCd || 'CL'; }

  async function opCatalog({ bizType = 'B2C' } = {}) {
    const supers = await retrieve({
      localeCode: locale(), categoryLevelNo: '1', typeCode: bizType,
      queryStr: 'Products.retrieveModelCategoryList', dataSetId: 'dataList', schema: 'save',
    });
    const lists = await Promise.all(supers.map((s) => retrieve({
      localeCode: locale(), typeCode: bizType,
      queryCategoryCode: s.code, superCategoryCode: s.code, categoryId: '', subCategoryId: '',
      schPriceFlag: '', schSalesModel: '', schModelName: '',
      queryStr: 'promotionManage.retrieveCategoryModelList', dataSetId: 'm2CategoryModelDataSet', schema: 'publ',
    })));
    const rows = [];
    lists.flat().forEach((r) => {
      const out = {};
      MODEL_FIELDS.forEach((f) => { out[f] = r[f] ?? ''; });
      rows.push(out);
    });
    return { rows, superCategories: supers.map((s) => ({ code: s.code, name: s.value })) };
  }

  async function opList({ from, to, title = '', bizType = 'B2C' } = {}) {
    const records = await retrieve({
      schPromotionId: '', schTitle: title, schType: '', schUse: '', schPublishFlag: '',
      schFromDate: from, schToDate: to, schBizType: bizType,
      schema: 'save', localeCode: locale(),
      queryStr: 'promotionManage.cudPromotionManageList', dataSetId: 'stgDataSet',
    });
    return records.map((r) => ({
      promotionId: r.promotionId, title: r.title, date: r.date,
      publishFlag: r.publishFlag, modelCnt: r.modelCnt,
    }));
  }

  function promoDataSet() {
    const ds = window.mPromotionDataSet || captured.mPromotionDataSet;
    if (!ds) throw new Error('no se encontro el grid de modelos de la promo');
    return ds;
  }

  async function opAddModels({ rows = [] } = {}) {
    if (!hookDataSets()) throw new Error('RUI no esta cargado en esta pagina');
    if (!isShown(document.getElementById('promotionDialog'))) throw new Error('el formulario de la promo no esta abierto');
    const before = promoDataSet().getCount();
    document.getElementById('mPromotionNewBtn-button')?.click();
    await until(() => isShown(document.getElementById('modelDialog')) && captured.m2CategoryModelDataSet,
      { what: 'el popup Model' });
    const ds = captured.m2CategoryModelDataSet;
    ds.clearData();
    for (const row of rows) {
      const rec = ds.getAt(ds.newRecord());
      MODEL_FIELDS.forEach((f) => rec.set(f, row[f] ?? ''));
    }
    for (let i = 0; i < ds.getCount(); i += 1) ds.setMark(i, true);
    document.getElementById('modelSelectBtn-button')?.click();
    await until(() => !isShown(document.getElementById('modelDialog')), { what: 'que se cierre el popup Model' });
    const after = promoDataSet().getCount();
    return { added: after - before, total: after };
  }

  function opSetMain({ modelIds = [] } = {}) {
    const ds = promoDataSet();
    const wanted = new Set(modelIds);
    const done = new Set();
    for (let i = 0; i < ds.getCount(); i += 1) {
      const rec = ds.getAt(i);
      const id = rec.get('modelId');
      const isMain = wanted.has(id) && !done.has(id);
      if (isMain) done.add(id);
      if ((rec.get('mainModelFlag') === 'Y') !== isMain) rec.set('mainModelFlag', isMain ? 'Y' : 'N');
    }
    return { mains: done.size };
  }

  function opSetDates({ startDate, endDate } = {}) {
    const start = window.mPromotionStartDate;
    const end = window.mPromotionEndDate;
    if (!start?.setValue || !end?.setValue) throw new Error('no se encontraron los campos de fecha');
    // Hasta primero si el nuevo desde queda despues del hasta actual (la pantalla
    // valida desde <= hasta en vivo, mismo quirk que el datepicker de MIM).
    end.setValue(endDate);
    start.setValue(startDate);
    end.setValue(endDate);
    return { startDate: start.getValue?.(), endDate: end.getValue?.() };
  }

  function opState() {
    const ds = window.mPromotionDataSet;
    return {
      rui: Boolean(window.Rui?.data?.LDataSet),
      hooked: hookDataSets(),
      dialogOpen: isShown(document.getElementById('promotionDialog')),
      rows: ds ? ds.getCount() : null,
      locale: locale(),
      bizType: window.bizTypeValue || null,
    };
  }

  function opMarkStgRow({ promotionId } = {}) {
    const ds = window.stgDataSet;
    if (!ds) return { marked: false };
    for (let i = 0; i < ds.getCount(); i += 1) {
      if (ds.getNameValue(i, 'promotionId') === promotionId) {
        ds.setMark(i, true);
        return { marked: true };
      }
    }
    return { marked: false };
  }

  const OPS = {
    ping: async () => ({ ok: true }),
    state: async () => opState(),
    catalog: opCatalog,
    list: opList,
    'add-models': opAddModels,
    'set-main': async (p) => opSetMain(p),
    'set-dates': async (p) => opSetDates(p),
    'mark-stg-row': async (p) => opMarkStgRow(p),
  };

  hookDataSets();

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.kind !== 'request') return;
    const reply = (ok, result, error) => window.postMessage({ source: SOURCE, kind: 'response', id: data.id, ok, result, error }, '*');
    const handler = OPS[data.op];
    if (!handler) { reply(false, null, `op desconocida: ${data.op}`); return; }
    try {
      reply(true, await handler(data.payload || {}));
    } catch (err) {
      reply(false, null, String(err?.message || err));
    }
  });
})();
