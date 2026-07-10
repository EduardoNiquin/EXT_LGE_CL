import { cmd, register } from '../../shared/debug/index.js';
import { CATEGORIES, LABELS, SELECTORS, getCategory } from './constants.js';
import { diagnose, isSolotodoReportPage } from './content/detector.js';
import { parseForm } from './content/parser.js';
import {
  clickGenerar, fillFilename, openExportForm, selectMultiple, selectSingle,
} from './content/flows/fill.js';
import { tickIfActive } from './content/flows/run.js';
import { buildFilename } from './popup/utils.js';
import { clearRun, getDraft, getRun, setRun } from './state.js';

register('solotodo', {
  diagnose:   cmd(() => diagnose(), 'Diagnóstico de detección del formulario y campos'),
  detected:   cmd(() => isSolotodoReportPage(), 'True si este frame tiene el formulario de SoloTodo'),
  selectors:  cmd(() => ({ ...SELECTORS }), 'Mapa de selectores que usa la feature'),
  labels:     cmd(() => ({ ...LABELS }), 'Textos de los labels que se buscan'),
  categories: cmd(() => CATEGORIES.map((c) => ({ id: c.id, label: c.label, stores: c.stores.length })), 'Presets de categorías'),
  form:       cmd(() => parseForm(), 'Estado actual del formulario en la página'),
  state:      cmd(() => getRun(), 'Estado persistido del run actual'),
  draft:      cmd(() => getDraft(), 'Borrador del formulario del popup'),

  openExportForm: cmd(() => openExportForm({}), 'Clickea "Exportar" y espera a que aparezca el formulario'),
  selectSingle: cmd(({ label, value } = {}) => selectSingle(label, value, {}),
    'Selecciona un valor en un Autocomplete single ({label,value}) — p.ej. {label:"Categoría",value:"Televisores"}'),
  selectMultiple: cmd(({ label, values } = {}) => selectMultiple(label, values || [], {}),
    'Selecciona varios valores en un Autocomplete multi ({label,values:[]})'),
  fillFilename: cmd(({ value } = {}) => fillFilename(value, {}), 'Escribe el nombre de archivo ({value})'),
  clickGenerar: cmd(() => clickGenerar({}), 'Clickea el botón "Generar" (¡envía el reporte!)'),

  runCategory: cmd(async ({ categoryId = 'tv', dryRun = true } = {}) => {
    const cat = getCategory(categoryId);
    if (!cat) return `Categoría "${categoryId}" no encontrada`;
    await openExportForm({});
    await selectSingle('Categoría', cat.category, {});
    await selectSingle('Moneda', cat.currency, {});
    await selectMultiple('Tiendas', cat.stores, {});
    await selectMultiple('Países', cat.countries, {});
    await fillFilename(buildFilename(cat.filenamePrefix), {});
    if (!dryRun) await clickGenerar({});
    return parseForm();
  }, 'Ejecuta el llenado completo de una categoría ({categoryId?,dryRun=true}) sin usar el run store'),

  stop:  cmd(async () => {
    const r = await getRun();
    if (!r) return null;
    r.active = false;
    r.finishReason = 'cancelled-manual';
    await setRun(r);
    return r;
  }, 'Marca el run como inactivo'),
  reset: cmd(async () => { await clearRun(); return 'ok'; }, 'Borra el estado del run de storage'),
  tick:  cmd(() => tickIfActive(), 'Fuerza un tick del runner en este frame'),
});
