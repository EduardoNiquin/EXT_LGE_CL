// Bitacora de la corrida: cada cosa que hace la extension en GEVS se anota en la
// grabacion de Registro de acciones (tipo `extension`), entremezclada con lo que
// hace la persona (clics, campos, Submit), para poder entregarle el archivo a
// una IA si algo salio mal. Solo cuando la corrida la pidio (`run.bitacora`);
// el SW la abre antes del run y la cierra/descarga cuando el run termina.
//
// Nunca frena ni rompe la corrida: se envia y se olvida.

import { FEATURE_ID } from '../constants.js';
import { MESSAGES as REGISTRO } from '../../registro-acciones/constants.js';
import { appendLog } from '../state.js';
import { sendMessage } from '../../../shared/messaging/messaging.js';

let activa = false;

/** Lo llama el motor en cada tick con `!!run.bitacora`. */
export function configurarBitacora(habilitada) {
  activa = !!habilitada;
}

/**
 * Anota una accion de la extension.
 * @param {string} mensaje   que hizo, en una frase ("Escribe #InvoiceNo = ...")
 * @param {object} [datos]   { elemento?: {selector}, valor?, respuesta?, detalle?: {clave: valor} }
 */
export function anotar(mensaje, datos = {}) {
  if (!activa) return;
  try {
    sendMessage({
      type: REGISTRO.ANOTAR,
      url: location.href,
      titulo: document.title,
      datos: { feature: FEATURE_ID, mensaje, ...datos },
    }).catch(() => { /* sin SW o sin grabacion: la bitacora es opcional */ });
  } catch { /* contexto invalidado */ }
}

/** Linea del registro del popup que ademas queda en la bitacora. */
export async function registrar(level, message, datos) {
  anotar(message, datos);
  await appendLog({ level, message });
}
