// State machine que avanza el run a través de páginas Magento.
//
// Diseño:
//   - Idempotente: cada tick lee el estado de storage, decide la próxima
//     acción y la ejecuta. La acción puede ser un cambio de URL (navegación),
//     en cuyo caso el siguiente tick disparado por el page load continúa.
//   - Sólo el top frame ejecuta acciones; iframes (Magento admin no usa pero
//     por si acaso) hacen no-op.
//   - Una sola ejecución por momento, vía flag `running` para evitar
//     reentrancias entre el tick por page load y el tick por storage change.
//
// Flujo conceptual:
//   LISTING:
//     ├─ Si una comuna quedó RUNNING (volvimos del edit con save OK) → marcarla OK.
//     ├─ Si la región actual no tiene comunas recolectadas → abrir filtros,
//     │   setear región, aplicar, recorrer todas las páginas, guardar comunas.
//     ├─ Tomar la próxima comuna PENDING, marcarla RUNNING, navegar al editHref.
//     └─ Si todas las comunas de la región están done → avanzar de región.
//
//   EDIT:
//     ├─ Verificar que el id de la URL matchea la comuna RUNNING.
//     ├─ Abrir colapsable, setear min/max, click Save (Magento navega solo).
//     └─ En error: marcar ERROR y volver al listing.

import { logger } from '../../../../shared/utils/logger.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { COMUNA_STATUS, PAGE_TYPE, REGION_STATUS } from '../../constants.js';
import { appendLog, getRun, setRun } from '../../state.js';
import { detectPage } from '../detector.js';
import {
  openFilters,
  setRegionFilter,
  applyFilters,
  getRegionFilterValue,
  clearAllFilters,
} from '../magento/filters.js';
import {
  waitForGridReady,
  collectAllComunas,
} from '../magento/grid.js';
import {
  openDeliveryCollapsible,
  setLeadTimes,
  clickSave,
  leaveEditPage,
} from '../magento/edit-page.js';

const log = logger('lead-times/run');

let running = false;

/**
 * Punto de entrada. Llamar en el init del content script y en cada
 * storage.onChanged del key del run.
 */
export async function tickIfActive() {
  if (running) return;
  if (window !== window.top) return;

  running = true;
  try {
    const run = await getRun();
    if (!run || !run.active) return;

    const page = detectPage();
    if (page.type === PAGE_TYPE.LISTING) {
      await onListing(run);
    } else if (page.type === PAGE_TYPE.EDIT) {
      await onEdit(run, page);
    } else {
      log.debug('página fuera del flujo, ignorando', { url: page.url });
    }
  } catch (err) {
    log.error('tick falló', err);
    try {
      await appendLog({ level: 'error', message: `tick falló: ${toMessage(err)}` });
    } catch { /* no-op */ }
  } finally {
    running = false;
  }
}

// -----------------------------------------------------------------------------
// LISTING
// -----------------------------------------------------------------------------

async function onListing(run) {
  if (run.currentRegionIndex >= run.queue.length) {
    await finalize(run, { reason: 'done' });
    return;
  }
  const region = run.queue[run.currentRegionIndex];

  // 1) Si alguna comuna quedó RUNNING (estábamos en su edit y Magento navegó
  //    al listing tras el save), marcarla OK.
  if (region.comunas) {
    let touched = false;
    for (const c of region.comunas) {
      if (c.status === COMUNA_STATUS.RUNNING) {
        c.status = COMUNA_STATUS.OK;
        c.savedAt = Date.now();
        touched = true;
        await appendLog({
          level: 'info',
          message: `Guardada: ${c.name} (${region.regionName}) → min=${region.minDays} max=${region.maxDays}`,
        });
      }
    }
    if (touched) await setRun(run);
  }

  // 2) Si la región no tiene comunas recolectadas todavía, filtrar y recolectar.
  if (!region.comunas || region.status === REGION_STATUS.PENDING) {
    region.status = REGION_STATUS.COLLECTING;
    await setRun(run);
    await appendLog({ level: 'info', message: `Filtrando región: ${region.regionName}` });

    try {
      await waitForGridReady();
      const currentFilter = (getRegionFilterValue() || '').trim().toLowerCase();
      const wantedFilter  = region.regionName.trim().toLowerCase();
      if (currentFilter !== wantedFilter) {
        await clearAllFilters();
        await waitForGridReady();
        await openFilters();
        await setRegionFilter(region.regionName);
        await applyFilters();
      }
      await waitForGridReady();
      const comunas = await collectAllComunas();
      if (comunas.length === 0) {
        region.status = REGION_STATUS.ERROR;
        region.error  = 'No se encontraron comunas con ese filtro';
        await setRun(run);
        await appendLog({ level: 'error', message: `${region.regionName}: 0 comunas tras filtrar` });
        await advanceRegion(run);
        return;
      }

      // Red de seguridad: TODAS las comunas leídas deben pertenecer a la
      // región que filtramos. Si una sola no matchea, abortamos esta región
      // antes de tocar nada — pudo haber sido un filtro mal aplicado por
      // Magento o un grid stale, y procesar significaría romper datos en
      // regiones equivocadas.
      const wanted = normalizeText(region.regionName);
      const mismatched = comunas.filter((c) => !normalizeText(c.regionName).includes(wanted));
      if (mismatched.length > 0) {
        const sampleRegions = [...new Set(mismatched.map((c) => c.regionName))].slice(0, 3);
        region.status = REGION_STATUS.ERROR;
        region.error  = `Filtro inconsistente: ${mismatched.length}/${comunas.length} comunas no son de "${region.regionName}". Detectado: ${sampleRegions.join(' | ')}`;
        await setRun(run);
        await appendLog({
          level: 'error',
          message: `${region.regionName}: ABORTADA por filtro inconsistente — ${region.error}`,
        });
        await advanceRegion(run);
        return;
      }

      region.comunas = comunas.map((c) => {
        const curMin = parseInt(c.currentMin, 10);
        const curMax = parseInt(c.currentMax, 10);
        if (curMin === region.minDays && curMax === region.maxDays) {
          return {
            ...c,
            status: COMUNA_STATUS.SKIPPED,
            skipReason: 'already-set',
            previousMin: c.currentMin,
            previousMax: c.currentMax,
          };
        }
        return { ...c, status: COMUNA_STATUS.PENDING };
      });
      region.totalComunas = comunas.length;
      region.status = REGION_STATUS.RUNNING;
      const pendingCount = region.comunas.filter((c) => c.status === COMUNA_STATUS.PENDING).length;
      const skippedCount = region.comunas.length - pendingCount;
      await setRun(run);
      await appendLog({
        level: 'info',
        message: `${region.regionName}: ${comunas.length} comunas — ${pendingCount} a modificar, ${skippedCount} ya correctas`,
      });
    } catch (err) {
      region.status = REGION_STATUS.ERROR;
      region.error  = toMessage(err);
      await setRun(run);
      await appendLog({ level: 'error', message: `Filtrar ${region.regionName} falló: ${region.error}` });
      await advanceRegion(run);
      return;
    }
  }

  // 3) Buscar siguiente comuna pendiente.
  const nextIdx = region.comunas.findIndex((c) => c.status === COMUNA_STATUS.PENDING);
  if (nextIdx === -1) {
    region.status = REGION_STATUS.DONE;
    await setRun(run);
    const okCount      = region.comunas.filter((c) => c.status === COMUNA_STATUS.OK).length;
    const errCount     = region.comunas.filter((c) => c.status === COMUNA_STATUS.ERROR).length;
    const skippedCount = region.comunas.filter((c) => c.status === COMUNA_STATUS.SKIPPED).length;
    await appendLog({
      level: 'info',
      message: `${region.regionName} terminada — ok=${okCount} skipped=${skippedCount} err=${errCount}`,
    });
    await advanceRegion(run);
    return;
  }

  const comuna = region.comunas[nextIdx];
  comuna.status = COMUNA_STATUS.RUNNING;
  region.currentComunaIndex = nextIdx;
  await setRun(run);
  await appendLog({
    level: 'info',
    message: `Editando ${comuna.name} (id=${comuna.id}) — ${nextIdx + 1}/${region.totalComunas}`,
  });

  // Navegar al edit URL — el próximo tick correrá al cargar.
  window.location.href = comuna.editHref;
}

// -----------------------------------------------------------------------------
// EDIT
// -----------------------------------------------------------------------------

async function onEdit(run, page) {
  const region = run.queue[run.currentRegionIndex];
  if (!region || !Array.isArray(region.comunas)) {
    log.warn('edit page sin región/comunas activas', { editId: page.editId });
    return;
  }

  const idx = region.comunas.findIndex((c) => c.id === page.editId);
  if (idx === -1) {
    log.warn('edit page con id que no está en la queue actual', { editId: page.editId });
    return;
  }
  const comuna = region.comunas[idx];

  // Si la comuna no está RUNNING (puede haber sido marcada ERROR antes o el
  // usuario navegó manualmente), no la procesamos.
  if (comuna.status !== COMUNA_STATUS.RUNNING) {
    log.debug('edit page con comuna no-RUNNING, ignorando', { status: comuna.status });
    return;
  }

  try {
    await openDeliveryCollapsible();
    comuna.previousMin = comuna.currentMin;
    comuna.previousMax = comuna.currentMax;
    await setLeadTimes({ minDays: region.minDays, maxDays: region.maxDays });
    await clickSave();
    // Save dispara navegación. No marcamos OK acá — lo hace el próximo tick
    // al llegar al listing (así sabemos que efectivamente navegó).
  } catch (err) {
    comuna.status = COMUNA_STATUS.ERROR;
    comuna.error  = toMessage(err);
    await setRun(run);
    await appendLog({
      level: 'error',
      message: `${comuna.name}: ${comuna.error}`,
    });
    // Volver al listing para no quedar atascados en el edit con error.
    await leaveEditPage();
  }
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

async function advanceRegion(run) {
  run.currentRegionIndex += 1;
  if (run.currentRegionIndex >= run.queue.length) {
    await finalize(run, { reason: 'done' });
    return;
  }
  await setRun(run);

  // Si estamos en edit (caso defensivo), volver al listing.
  if (detectPage().type !== PAGE_TYPE.LISTING) {
    await leaveEditPage();
    return;
  }

  // Workaround Magento: tras haber entrado a un edit y volver al listing, el
  // botón "Filters" del data grid queda en un estado donde no abre el panel.
  // Una recarga limpia ese estado. El run persiste en storage, así que
  // después del reload el próximo tick (al cargar el listing) aplica el
  // filtro de la nueva región.
  await appendLog({ level: 'info', message: 'Recargando listing antes de la próxima región (workaround Filters)' });
  window.location.reload();
}

async function finalize(run, { reason } = {}) {
  run.active = false;
  run.finishedAt = Date.now();
  run.finishReason = reason || 'done';
  await setRun(run);
  await appendLog({ level: 'info', message: `Run finalizado (${run.finishReason})` });
}

/**
 * Normaliza un texto para comparaciones case- y diacritics-insensitive.
 * "Región Aysén" → "region aysen".
 */
const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizeText(s) {
  return (s || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '');
}
