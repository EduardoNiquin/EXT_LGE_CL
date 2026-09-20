// Lado service worker de "Facturas":
//   - abre la corrida (MESSAGES.INICIAR): si se pidio bitacora, primero arranca
//     una grabacion de Registro de acciones y recien despues escribe el run,
//     asi ni la primera accion queda fuera. Cuando el run deja de estar activo
//     (termino, error o cancelacion) cierra esa grabacion y la descarga;
//   - entrega los adjuntos al content script del iframe de upload (base64:
//     chrome.runtime no serializa File/Blob; mismo transporte que Devoluciones);
//   - permite ventanas emergentes en los hosts de GEVS. Medido el 2026-09-19:
//     la ventana LOV ("Search and Select") la abre OAF con window.open y sin un
//     gesto del usuario Chrome la bloquea, asi que al automatizar nunca se
//     abriria. Con el permiso `contentSettings` la extension lo permite solo
//     para esos hosts (es la unica razon de ese permiso en el manifest).

import { ADJUNTO_MAX_BYTES, FEATURE_ID, HOSTS_GEVS, MESSAGES, STORAGE_KEYS } from '../constants.js';
import { getRun, makeRun, setRun } from '../state.js';
import { leerAdjunto } from '../adjuntos/store.js';
import { anotar, detener as detenerGrabacion, iniciar as iniciarGrabacion } from '../../registro-acciones/background/grabador.js';
import { toMessage } from '../../../shared/errors/index.js';
import { logger } from '../../../shared/utils/logger.js';

const log = logger('facturas');

/** Base64 de un ArrayBuffer sin reventar la pila (el SW no tiene FileReader). */
function bytesABase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binario = '';
  const trozo = 0x8000;
  for (let i = 0; i < bytes.length; i += trozo) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + trozo));
  }
  return btoa(binario);
}

async function entregarAdjunto({ id }) {
  const adjunto = await leerAdjunto(id);
  if (!adjunto) throw new Error('El adjunto ya no esta en la extension: vuelve a subirlo en el popup.');
  if (adjunto.tamano > ADJUNTO_MAX_BYTES) throw new Error(`"${adjunto.nombre}" pesa mas de ${ADJUNTO_MAX_BYTES / 1024 / 1024} MB.`);
  return { ok: true, nombre: adjunto.nombre, tipo: adjunto.tipo, contenido: bytesABase64(adjunto.bytes) };
}

// --- bitacora ----------------------------------------------------------------

const anotarFacturas = (mensaje, detalle) => anotar({ datos: { feature: FEATURE_ID, mensaje, detalle } });

/**
 * Grabacion de Registro de acciones para esta corrida. Si la persona ya tenia
 * una grabacion andando, la corrida se anota ahi y no la cierra (propia:false).
 */
async function abrirBitacora(plan) {
  const grabacion = await iniciarGrabacion({ etiqueta: `${FEATURE_ID}-${plan.customer}-${plan.invoiceNumber}` });
  if (!grabacion.ok && !grabacion.run) throw new Error(`No se pudo abrir la bitacora: ${grabacion.reason}`);
  return { sesionId: grabacion.run.sesionId, propia: grabacion.ok };
}

async function iniciarCorrida({ plan, config = {} }) {
  if (!plan) throw new Error('La corrida no tiene plan de carga.');
  if ((await getRun())?.active) return { ok: false, reason: 'Ya hay una corrida en curso.' };

  const bitacora = config.bitacora ? await abrirBitacora(plan) : null;
  await setRun(makeRun({ plan, config, bitacora }));
  if (bitacora) {
    await anotarFacturas(`Corrida iniciada: ${plan.customer} ${plan.invoiceNumber}`, {
      sesion: bitacora.propia ? 'propia' : 'del usuario (ya estaba grabando)',
      filasDebit: plan.resumen.filasDebit,
      credit: plan.resumen.credit,
      pasoAPaso: !!config.pasoAPaso,
    });
  }
  return { ok: true, bitacora };
}

/** El run dejo de estar activo: se anota como termino y, si la bitacora es de esta corrida, se cierra y descarga. */
async function cerrarBitacora(run) {
  if (!run?.bitacora) return;
  await anotarFacturas(`Corrida terminada: ${run.finishReason || 'sin motivo'}${run.error ? ` (${run.error})` : ''}`, {
    fase: run.fase,
    batchId: run.batchId,
    reference: run.reference,
    pasosHechos: run.pasosHechos?.length,
  });
  if (run.bitacora.propia) await detenerGrabacion({ motivo: FEATURE_ID, exportar: true });
}

function vigilarFinDeCorrida() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEYS.RUN]) return;
    const { oldValue, newValue } = changes[STORAGE_KEYS.RUN];
    if (!oldValue?.active || newValue?.active) return;
    cerrarBitacora(newValue ?? oldValue).catch((err) => log.error('no se pudo cerrar la bitacora', err));
  });
}

// --- wiring ------------------------------------------------------------------

/** Deja que GEVS abra sus ventanas LOV aunque nadie haya hecho clic. Idempotente. */
export async function permitirVentanasGevs() {
  for (const host of HOSTS_GEVS) {
    await chrome.contentSettings.popups.set({ primaryPattern: `${host}/*`, setting: 'allow' });
  }
}

const HANDLERS = {
  [MESSAGES.ADJUNTO_GET]: entregarAdjunto,
  [MESSAGES.INICIAR]: iniciarCorrida,
};

export function wireFacturasBackground() {
  permitirVentanasGevs().catch((err) => log.error('no se pudo permitir las ventanas de GEVS', err));
  vigilarFinDeCorrida();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const handler = HANDLERS[msg?.type];
    if (!handler) return false;
    handler(msg)
      .then(sendResponse)
      .catch((err) => {
        log.error(`fallo ${msg.type}`, err);
        sendResponse({ ok: false, reason: toMessage(err) });
      });
    return true;
  });
}
