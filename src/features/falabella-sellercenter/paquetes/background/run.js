// Orquestador de "Identificar paquetes en ordenes" en el service worker.
//
// 1. GetOrders de la ventana (todas las paginas, en paralelo de a
//    API.CONCURRENCIA), quedandose con las ordenes creadas en los dias pedidos.
// 2. Solo las de 2+ productos (ItemsCount > 1) piden sus items, en lotes de 200
//    (GetMultipleOrderItems): en 30 dias son ~2 % de las ordenes.
// 3. analizarItems decide si algun paquete junta 2+ productos.
// El progreso se publica en el run (storage.local) y el popup lo muestra en vivo.

import { API, FINISH_REASON, MESSAGES, PHASE } from '../../constants.js';
import {
  appendLog,
  clearResult,
  getRun,
  makeRun,
  setResult,
  setRun,
  updateRun,
} from '../../state.js';
import { getMultipleOrderItems, getOrdersPage } from '../../api/cliente.js';
import { timestampApi } from '../../api/firma.js';
import { estadoCredenciales, resolverCredenciales } from '../../api/credenciales.js';
import { analizarItems, diaDe, hallazgo, resumenOrden, ventanaApi } from '../analisis.js';
import { isAbortError, toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('falabella-sellercenter');

let running = false;
let controller = null;

/** Corre `tareas` (funciones async) con a lo sumo `n` en vuelo. */
async function enParalelo(tareas, n, signal) {
  let siguiente = 0;
  let fallo = null;
  const trabajador = async () => {
    while (siguiente < tareas.length && !fallo && !signal?.aborted) {
      const i = siguiente++;
      try { await tareas[i](); } catch (err) { fallo ??= err; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tareas.length) }, trabajador));
  if (fallo) throw fallo;
}

const progreso = (patch) => updateRun((run) => (run ? { ...run, progress: { ...run.progress, ...patch } } : run));

/**
 * @param {{desde:string, hasta:string}} payload  dias de Chile, YYYY-MM-DD.
 */
export async function runPaquetes({ desde, hasta } = {}) {
  const motivo = await validar({ desde, hasta });
  if (motivo) return { ok: false, reason: motivo };
  const { cred } = await resolverCredenciales();

  running = true;
  controller = new AbortController();
  const { signal } = controller;

  try {
    await clearResult();
    await setRun(makeRun({ desde, hasta }));

    // 1. Ordenes de la ventana.
    await updateRun((run) => ({ ...run, phase: PHASE.ORDERS }));
    const ventana = ventanaApi(desde, hasta, API.MARGEN_HORAS);
    const porNumero = new Map(); // dedupe por OrderNumber
    const porEstado = {};
    let enRango = 0;

    const tomar = (orders) => {
      for (const o of orders) {
        const dia = diaDe(o.CreatedAt);
        if (dia < desde || dia > hasta) continue;
        const num = String(o.OrderNumber);
        if (porNumero.has(num)) continue;
        const r = resumenOrden(o);
        porNumero.set(num, r.itemsCount > 1 ? r : null); // solo guarda lo que se va a revisar
        enRango++;
        for (const e of r.estados) porEstado[e] = (porEstado[e] || 0) + 1;
      }
    };

    const primera = await getOrdersPage(cred, { ...ventana, offset: 0 }, { signal });
    tomar(primera.orders);
    const paginasTotal = Math.max(1, Math.ceil(primera.total / API.PAGE_SIZE));
    let paginasHechas = 1;
    let ordenesLeidas = primera.orders.length;
    await progreso({ paginasHechas, paginasTotal, ordenesApi: primera.total, ordenesLeidas });
    await appendLog({ level: 'info', message: `La API tiene ${primera.total} orden(es) en la ventana (${paginasTotal} pagina(s) de ${API.PAGE_SIZE}).` });

    const tareas = [];
    for (let p = 1; p < paginasTotal; p++) {
      tareas.push(async () => {
        const { orders } = await getOrdersPage(cred, { ...ventana, offset: p * API.PAGE_SIZE }, { signal });
        tomar(orders);
        paginasHechas++;
        ordenesLeidas += orders.length;
        progreso({ paginasHechas, ordenesLeidas }).catch(() => {});
      });
    }
    await enParalelo(tareas, API.CONCURRENCIA, signal);
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');

    const multi = [...porNumero.values()].filter(Boolean);
    await appendLog({ level: 'info', message: `${enRango} orden(es) creadas en el rango; ${multi.length} con 2 o mas productos.` });

    // 2. Items de las ordenes multi-producto.
    const lotes = [];
    for (let i = 0; i < multi.length; i += API.ITEMS_BATCH) lotes.push(multi.slice(i, i + API.ITEMS_BATCH));
    await updateRun((run) => ({ ...run, phase: PHASE.ITEMS, progress: { ...run.progress, paginasHechas, ordenesLeidas, lotesHechos: 0, lotesTotal: lotes.length } }));

    const hallazgos = [];
    let analizadas = 0;
    let lotesHechos = 0;
    for (const lote of lotes) {
      const items = await getMultipleOrderItems(cred, lote.map((r) => r.orderId), { signal });
      for (const r of lote) {
        const lista = items.get(r.orderId);
        if (!lista) continue;
        analizadas++;
        const a = analizarItems(lista);
        if (a.problema) hallazgos.push(hallazgo(r, a));
      }
      lotesHechos++;
      await progreso({ lotesHechos });
    }

    // 3. Resultado.
    await updateRun((run) => ({ ...run, phase: PHASE.ANALYZING }));
    hallazgos.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (analizadas < multi.length) {
      await appendLog({ level: 'warn', message: `La API no devolvio items de ${multi.length - analizadas} orden(es) multi-producto.` });
    }
    const stats = { enRango, multiProducto: multi.length, analizadas, conProblema: hallazgos.length, porEstado };
    await setResult({ desde, hasta, hallazgos });
    await updateRun((run) => ({
      ...run,
      active: false,
      finishedAt: Date.now(),
      finishReason: FINISH_REASON.DONE,
      phase: PHASE.DONE,
      stats,
    }));
    await appendLog({
      level: hallazgos.length ? 'warn' : 'info',
      message: hallazgos.length
        ? `${hallazgos.length} orden(es) con productos juntos en un paquete.`
        : 'Todas las ordenes multi-producto tienen un paquete por producto.',
    });
    log.info('analisis de paquetes listo', stats);
    return { ok: true, stats };
  } catch (err) {
    if (signal.aborted || isAbortError(err, signal)) {
      await updateRun((run) => ({ ...run, active: false, finishedAt: run.finishedAt || Date.now(), finishReason: FINISH_REASON.CANCELLED, phase: PHASE.IDLE }));
      await appendLog({ level: 'warn', message: 'Cancelado por el usuario.' });
      return { ok: false, cancelled: true };
    }
    const reason = toMessage(err);
    await updateRun((run) => ({ ...run, active: false, finishedAt: Date.now(), finishReason: FINISH_REASON.ERROR, errorReason: reason, phase: PHASE.IDLE }));
    await appendLog({ level: 'error', message: `Error: ${reason}` });
    log.error('analisis de paquetes fallo', err instanceof Error ? err : new Error(reason));
    return { ok: false, reason };
  } finally {
    running = false;
    controller = null;
  }
}

/** Motivo por el que no se puede arrancar, o null. */
async function validar({ desde, hasta } = {}) {
  if (running) return 'Ya hay un analisis en curso.';
  if (!desde || !hasta || desde > hasta) return 'Rango de fechas invalido.';
  if (!(await resolverCredenciales())) return 'Faltan las credenciales de la API. Cargalas en "Credenciales de la API".';
  return null;
}

export function cancelPaquetes() {
  try { controller?.abort(); } catch { /* no-op */ }
}

/** Prueba unas credenciales (o las vigentes) con un GetOrders de 1 orden. */
export async function probarCredenciales(cred) {
  try {
    cred ??= (await resolverCredenciales())?.cred;
    const ayer = timestampApi(new Date(Date.now() - 86400_000));
    const { total } = await getOrdersPage(cred, { createdAfter: ayer, limit: 1 });
    return { ok: true, total };
  } catch (err) {
    return { ok: false, reason: toMessage(err) };
  }
}

// Se llama una vez desde el service worker.
export function wirePaquetesBackground() {
  // Si el SW murio a mitad de una corrida, el run quedo "activo" sin nadie que
  // lo avance: se marca interrumpido para que el popup no espere para siempre.
  getRun().then((run) => {
    if (run?.active && !running) {
      updateRun((r) => ({ ...r, active: false, finishedAt: Date.now(), finishReason: FINISH_REASON.ERROR, errorReason: 'El analisis se interrumpio (el navegador detuvo la extension). Vuelve a iniciarlo.' }))
        .catch(() => {});
    }
  }).catch(() => {});

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === MESSAGES.PAQUETES_START) {
      // El progreso va por storage: se responde apenas arranca para que el
      // popup pueda cerrarse sin cortar el proceso.
      validar(msg.payload).then((motivo) => {
        if (motivo) { sendResponse({ ok: false, reason: motivo }); return; }
        runPaquetes(msg.payload).catch((err) => log.error('runPaquetes', err));
        sendResponse({ ok: true, started: true });
      });
      return true;
    }
    if (msg?.type === MESSAGES.PAQUETES_CANCEL) {
      cancelPaquetes();
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === MESSAGES.ESTADO_CREDENCIALES) {
      estadoCredenciales().then(sendResponse, () => sendResponse({ fuente: null }));
      return true;
    }
    if (msg?.type === MESSAGES.PROBAR_CREDENCIALES) {
      probarCredenciales(msg.payload).then(sendResponse);
      return true;
    }
    return false;
  });
}
