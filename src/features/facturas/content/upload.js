// El iframe de adjuntos (upload.jsp, en OTRO host que la pantalla). Este frame
// pide los bytes al service worker, los deja en el <input type=file> y pulsa
// Upload; en uploadResult.jsp marca el adjunto como subido para que el frame
// de la pantalla pulse Apply.

import { MESSAGES, PANTALLA, SELECTORS } from '../constants.js';
import { updateRun } from '../state.js';
import { anotar, registrar } from './bitacora.js';
import { sendMessage } from '../../../shared/messaging/messaging.js';

let actuado = false;

function base64ToFile({ nombre, tipo, contenido }) {
  const binario = atob(contenido);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new File([bytes], nombre, { type: tipo || 'application/octet-stream' });
}

export async function subirAdjunto(run, pantalla) {
  const enCurso = run.adjuntoEnCurso;
  if (!enCurso || actuado) return;

  if (pantalla === PANTALLA.UPLOAD_RESULT) {
    actuado = true;
    anotar(`GEVS confirmo la subida de ${enCurso.nombre} (uploadResult.jsp); falta Apply en la pantalla`, { detalle: { archivo: enCurso.nombre } });
    await updateRun((r) => (r?.adjuntoEnCurso?.id === enCurso.id ? { ...r, adjuntoSubido: true } : r));
    return;
  }
  if (run.adjuntoSubido) return;

  const input = document.querySelector(SELECTORS.upload.file);
  const boton = document.querySelector(SELECTORS.upload.submit);
  if (!input || !boton) return;

  actuado = true;
  const respuesta = await sendMessage({ type: MESSAGES.ADJUNTO_GET, id: enCurso.id });
  if (!respuesta?.ok) throw new Error(respuesta?.reason || 'No se pudo obtener el adjunto.');

  const dt = new DataTransfer();
  dt.items.add(base64ToFile(respuesta));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  if (!input.files.length) throw new Error(`El campo de archivo no acepto "${enCurso.nombre}".`);

  await registrar('info', `Subiendo ${enCurso.nombre}...`, { elemento: { selector: SELECTORS.upload.submit }, valor: enCurso.nombre, respuesta: 'navega' });
  boton.click();
}
