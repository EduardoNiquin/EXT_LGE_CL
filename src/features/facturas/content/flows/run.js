// El motor de la corrida en la pestana de GEVS. Corre en TODOS los frames de
// TODAS las pestanas del host; cada tick mira que pantalla es este frame y
// actua solo si le toca:
//   ENTRY          la maquina de pasos (con claim por pestana y heartbeat),
//                  solo mientras la fase es CARGANDO: desde que el voucher
//                  queda guardado con adjuntos (LISTO_PARA_ENVIAR) la pantalla
//                  es de la persona, que hace el Submit a mano
//   LOV_TAX        resuelve la ventana "Search and Select" del tax code
//   UPLOAD/RESULT  sube el adjunto en el iframe de otro host
//   INQUIRY        lee "Submitted Successfully" (el Submit de la persona) y
//                  cierra la corrida con la Reference
//
// Reloads: casi cada blur termina en un form_submit. El paso en curso queda en
// storage ANTES de tocar el DOM; el documento nuevo retoma por verificar().

import { FASE, FINISH_REASON, HEARTBEAT_MS, HEARTBEAT_STALE_MS, PANTALLA, SELECTORS } from '../../constants.js';
import { getRun, registrarResultado, updateRun } from '../../state.js';
import { batchIdDe, tipoPantalla } from '../detector.js';
import { mensajeDeError } from '../gevs/campos.js';
import { PASOS_ENTRY } from './pasos.js';
import { resolverLov } from '../lov.js';
import { subirAdjunto } from '../upload.js';
import { anotar, configurarBitacora, registrar } from '../bitacora.js';
import { isAbortError, toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('facturas');

// Identidad de ESTA pestana, estable a traves de los reloads (sessionStorage es
// por pestana y sobrevive a la navegacion). Otra pestana con la misma pantalla
// tiene otro token y se abstiene mientras el heartbeat este fresco.
const TOKEN_KEY = 'ext-lge-cl:facturas:token';
function tokenDeEstaPestana() {
  try {
    let token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) {
      token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

let running = false;
let navigating = false;
let ctrl = null;
let heartbeat = null;

// El documento que pide una navegacion sigue vivo cientos de ms: nada de
// escribir en el desde que se sabe que se va.
window.addEventListener('pagehide', () => {
  navigating = true;
  ctrl?.abort();
});

export function abortActiveRun() {
  ctrl?.abort();
}

const patch = (fields) => updateRun((r) => (r ? { ...r, ...fields } : r));

function pararHeartbeat() {
  clearInterval(heartbeat);
  heartbeat = null;
}

async function finalizar(finishReason, error = '') {
  pararHeartbeat();
  await updateRun((r) => (r ? { ...r, active: false, finishedAt: Date.now(), finishReason, error, esperaLov: null, adjuntoEnCurso: null } : r));
}

function resultadoDe(run, extra) {
  const { plan } = run;
  return { clave: plan.clave, customer: plan.customer, invoiceNumber: plan.invoiceNumber, batchId: run.batchId, reference: run.reference, cutDate: plan.cutDate, commissionType: plan.commissionType, ...extra };
}

export async function tickIfActive() {
  if (running || navigating) return;
  const run = await getRun();
  if (!run?.active) return;
  const pantalla = tipoPantalla();
  if (pantalla === PANTALLA.OTRA) return;
  configurarBitacora(!!run.bitacora);

  running = true;
  ctrl = new AbortController();
  try {
    if (pantalla === PANTALLA.ENTRY && run.fase === FASE.CARGANDO) await correrPasos(run, ctrl.signal);
    else if (pantalla === PANTALLA.LOV_TAX) await resolverLov(run);
    else if (pantalla === PANTALLA.UPLOAD || pantalla === PANTALLA.UPLOAD_RESULT) await subirAdjunto(run, pantalla);
    else if (pantalla === PANTALLA.INQUIRY) await confirmarSubmit(run);
  } catch (err) {
    if (isAbortError(err, ctrl.signal)) log.info('tick abortado', { pantalla });
    else {
      log.error('la corrida fallo', err);
      await registrar('error', toMessage(err), { detalle: { pantalla, url: location.href } });
      await finalizar(FINISH_REASON.ERROR, toMessage(err));
    }
  } finally {
    running = false;
    ctrl = null;
  }
}

// --- ENTRY: la maquina de pasos ---------------------------------------------

/**
 * Reclama la corrida para esta pestana. Solo escribe cuando hace falta (otro
 * token o heartbeat viejo): cada escritura del run dispara un tick en todos los
 * frames, y un tick que siempre escribe se llama a si mismo para siempre.
 */
async function reclamar(run) {
  const token = tokenDeEstaPestana();
  const edad = Date.now() - (run.heartbeatAt || 0);
  if (run.claimed && run.claimed !== token && edad < HEARTBEAT_STALE_MS) return false;
  if (run.claimed !== token || edad >= HEARTBEAT_MS) {
    await patch({ claimed: token, heartbeatAt: Date.now(), claimedFrom: location.href });
  }
  if (!heartbeat) heartbeat = setInterval(() => { patch({ heartbeatAt: Date.now() }).catch(() => {}); }, HEARTBEAT_MS);
  return true;
}

async function correrPasos(inicial, signal) {
  if (!(await reclamar(inicial))) {
    log.info('la corrida la tiene otra pestana', { claimed: inicial.claimed });
    return;
  }

  for (;;) {
    const run = await getRun();
    if (!run?.active || signal.aborted || navigating) return;
    if (run.pausado) return;

    const paso = PASOS_ENTRY.find((p) => !run.pasosHechos.includes(p.id));
    if (!paso) {
      await entregarALaPersona(run);
      return;
    }

    // Guardia de identidad: esta pantalla debe ser el voucher de esta corrida
    // (nuevo hasta el Save; despues, el batchId que GEVS asigno).
    const batch = batchIdDe();
    const esperado = run.batchId ?? 0;
    if (batch !== esperado && !(run.batchId == null && paso.id === 'guardar')) {
      throw new Error(`La pantalla tiene batchId ${batch} y la corrida esperaba ${esperado}. Vuelve al voucher correcto.`);
    }

    const ctx = { run, plan: run.plan, signal, patch };
    if (run.paso !== paso.id) await patch({ paso: paso.id, intentos: 0, progreso: null });

    let hecho = await paso.verificar(ctx);
    if (!hecho) {
      // GEVS rechazo lo anterior (por ejemplo, factura duplicada): no se insiste.
      const rechazo = mensajeDeError();
      if (rechazo) throw new Error(`GEVS rechazo la carga en "${paso.label}": ${rechazo}`);
      // Un paso que espera a otro frame (el iframe de upload) no gasta intentos:
      // el cambio en storage que espera dispara otro tick.
      if (paso.esperando?.(ctx)) return;
      // Un paso que navega en cada escritura (los montos Debit) vuelve aqui una
      // vez por reload: eso no es un reintento mientras haya avanzado algo.
      const progreso = paso.progreso ? paso.progreso(ctx) : null;
      const sinAvance = run.paso === paso.id && (progreso == null || progreso === run.progreso);
      const intentos = (sinAvance ? run.intentos || 0 : 0) + 1;
      if (intentos > 3) throw new Error(`El paso "${paso.label}" no quedo aplicado tras ${intentos - 1} intentos.`);
      await patch({ intentos, progreso });
      await registrar('info', `${paso.label}${intentos > 1 ? ` (intento ${intentos})` : ''}`, { detalle: { paso: paso.id, intento: intentos, progreso } });
      await paso.ejecutar(ctx);
      if (navigating || signal.aborted) return;
      hecho = await paso.verificar({ ...ctx, run: await getRun() });
    }
    if (!hecho) {
      // Puede ser que la accion haya navegado y este documento este muriendo:
      // se deja al documento nuevo verificar de nuevo antes de contarlo como fallo.
      log.debug('paso sin confirmar en este documento', { paso: paso.id });
      return;
    }

    const actual = await getRun();
    if (!actual?.active) return;
    const pasosHechos = actual.pasosHechos.includes(paso.id) ? actual.pasosHechos : [...actual.pasosHechos, paso.id];
    const siguiente = PASOS_ENTRY.find((p) => !pasosHechos.includes(p.id));
    const pausar = actual.config.pasoAPaso && !!siguiente;
    await patch({ pasosHechos, paso: siguiente?.id ?? paso.id, intentos: 0, pausado: pausar });
    anotar(`Paso listo: ${paso.label}`, { detalle: { paso: paso.id, hechos: pasosHechos.length } });

    if (paso.id === 'guardar') {
      const conBatch = await getRun();
      await registrarResultado(resultadoDe(conBatch, { reference: null }));
      await registrar('info', `Guardado: batchId ${conBatch.batchId}`, { detalle: { batchId: conBatch.batchId } });
    }
    if (pausar) {
      await registrar('info', `Pausa antes de "${siguiente.label}"`);
      return;
    }
  }
}

/** Todo escrito, guardado y adjuntado: desde aqui la extension no toca mas la pantalla. */
async function entregarALaPersona(run) {
  pararHeartbeat();
  const adjuntos = run.plan.adjuntos.length;
  await patch({ fase: FASE.LISTO_PARA_ENVIAR, paso: null, pausado: false });
  await registrar('info', `Voucher ${run.batchId} guardado con ${adjuntos} adjunto(s). Revisalo en GEVS y pulsa Submit tu (si pide Reset de aprobadores: Reset y Submit otra vez; marca los avisos del modal y Apply). Cuando GEVS confirme, la extension anota la Reference.`, {
    detalle: { batchId: run.batchId, adjuntos },
  });
}

// --- INQUIRY: GEVS confirmo el Submit de la persona -----------------------------

async function confirmarSubmit(run) {
  if (run.fase !== FASE.LISTO_PARA_ENVIAR) return;
  const texto = (document.querySelector(SELECTORS.mensajes)?.textContent || '').replace(/\s+/g, ' ').trim();
  const m = /Submitted Successfully[^(]*\(Reference=([^)]+)\)/i.exec(texto);
  if (!m) return;
  const reference = m[1].trim();
  await patch({ reference, fase: FASE.DONE });
  await registrarResultado(resultadoDe(run, { reference }));
  await registrar('info', `Submit confirmado por GEVS: ${reference}`, { detalle: { reference, batchId: run.batchId } });
  await finalizar(FINISH_REASON.DONE);
}
