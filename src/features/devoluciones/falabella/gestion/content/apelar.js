// Fase APELAR: formulario "rejectAppeals" del modulo de devoluciones.
//
// Tres acordeones que hay que abrir y rellenar en orden:
//   1. Motivo de apelacion — desplegable propio (no es un <select>) + comentario.
//   2. Evidencias del producto — se sube el evidencias.pdf armado por el modulo.
//   3. Informe tecnico — radio del estado, su sub-motivo y el comentario otra vez.
//
// El motivo y el sub-motivo salen de la observacion que dejo posventa en el
// correo (la que el modulo extrajo de la captura). Si no hay observacion o no
// matchea ninguna palabra clave, se cae al motivo por defecto: es el caso mas
// habitual y el que conviene al seller.

import {
  DEFAULT_MOTIVO,
  INFORME_STATUS,
  MOTIVO_KEYWORDS,
  PAGE_TIMEOUT_MS,
  SEL,
  STEP_TIMEOUT_MS,
  SUBSTATUS_DANO_SEVERO,
  SUBSTATUS_INCOMPLETO,
} from '../constants.js';
import { abrirAcordeon, base64ToFile, buscarPorTexto, elegirOpcion, escribirEn, normalizar, primero, raizDe, setFiles } from './dom.js';
import { clickEl } from '../../../../../shared/dom/events.js';
import { waitFor, waitForElement } from '../../../../../shared/dom/wait.js';

/**
 * Motivo de apelacion segun la observacion de posventa. Gana la primera regla
 * que matchea (van de la mas especifica a la mas general en MOTIVO_KEYWORDS).
 */
export function elegirMotivo(observacion) {
  const texto = normalizar(observacion);
  if (!texto) return DEFAULT_MOTIVO;

  for (const regla of MOTIVO_KEYWORDS) {
    if (regla.keywords.some((k) => texto.includes(normalizar(k)))) return regla.motivo;
  }
  return DEFAULT_MOTIVO;
}

/**
 * Sub-motivo del informe tecnico. "Incompleto" cuando la observacion habla de
 * que falta algo; en cualquier otro caso, daños severos: la apelacion se
 * sostiene sobre que el producto volvio inservible.
 */
export function elegirSubEstado(observacion) {
  const texto = normalizar(observacion);
  const incompleto = ['incompleto', 'falta', 'faltan', 'sin accesorio', 'sin control', 'sin cable'];
  return incompleto.some((k) => texto.includes(k)) ? SUBSTATUS_INCOMPLETO : SUBSTATUS_DANO_SEVERO;
}

/**
 * Texto que se escribe en los comentarios. Se arma con lo que sabemos de la
 * orden para que el revisor de Falabella tenga el detalle sin abrir el PDF.
 */
export function armarComentario(job) {
  const r = job.reembolso || {};
  const partes = [
    r.observacion,
    r.modelo ? `Modelo: ${r.modelo}` : null,
    r.serie ? `Serie: ${r.serie}` : null,
    job.numero_guia ? `Guia de despacho: ${job.numero_guia}` : null,
  ].filter(Boolean);

  const texto = partes.join('. ') || 'Producto devuelto en condiciones distintas a las despachadas. Se adjuntan evidencias fotograficas.';

  // El campo corta en 500 caracteres.
  return texto.slice(0, 500);
}

/**
 * Rellena y (salvo en modo prueba) envia la apelacion.
 *
 * @param {object} job
 * @param {{ prueba: boolean, pedirArchivos: () => Promise<Array>, signal?: AbortSignal, onLog?: Function }} opts
 */
export async function apelar(job, { prueba, pedirArchivos, signal, onLog } = {}) {
  // El formulario vive dentro del shadow root de la micro-app, igual que el
  // listado: se resuelve la raiz una vez y se consulta siempre contra ella.
  const raiz = raizApelacion();
  await waitForElement(SEL.apelar.caja, { timeout: PAGE_TIMEOUT_MS, signal, root: raiz });

  const observacion = job.reembolso?.observacion || '';
  const comentario = armarComentario(job);

  // 1. Motivo de apelacion.
  const cajaMotivo = await abrirAcordeon('Motivo de apelacion', { signal, raiz });
  const motivo = elegirMotivo(observacion);

  const header = await waitForElement(SEL.apelar.dropdownHeader, { timeout: STEP_TIMEOUT_MS, signal, root: cajaMotivo });
  clickEl(header);

  const opcion = await waitFor(
    () => buscarPorTexto(cajaMotivo, SEL.apelar.dropdownOpcion, motivo),
    { timeout: STEP_TIMEOUT_MS, signal, description: `el motivo "${motivo}"` },
  );
  clickEl(opcion);
  onLog?.(`Motivo de apelacion: ${motivo}.`);

  const textarea = cajaMotivo.querySelector(SEL.apelar.comentario);
  if (textarea) escribirEn(textarea, comentario);

  // 2. Evidencias: el PDF que armo el modulo con las fotos ordenadas.
  const cajaEvidencias = await abrirAcordeon('Evidencias del producto', { signal, raiz });
  const inputArchivos = await waitForElement(SEL.apelar.archivos, { timeout: STEP_TIMEOUT_MS, signal, root: cajaEvidencias });

  const archivos = await pedirArchivos('apelacion');
  setFiles(inputArchivos, archivos.map(base64ToFile));
  onLog?.(`Evidencias adjuntas: ${archivos.map((a) => a.nombre).join(', ')}.`);

  // 3. Informe tecnico: estado, sub-motivo y detalle.
  const cajaInforme = await abrirAcordeon('Informe tecnico', { signal, raiz });

  const radio = Array.from(cajaInforme.querySelectorAll(SEL.apelar.radioEstado))
    .find((r) => normalizar(r.id) === normalizar(INFORME_STATUS));
  if (!radio) throw new Error(`No se encontro el estado "${INFORME_STATUS}" del informe tecnico`);
  clickEl(radio);

  // El sub-motivo solo existe despues de marcar el estado.
  const subEstado = await waitForElement(SEL.apelar.subEstado, { timeout: STEP_TIMEOUT_MS, signal, root: cajaInforme })
    .catch(() => null);
  if (subEstado) {
    const valor = elegirSubEstado(observacion);
    elegirOpcion(subEstado, valor);
    onLog?.(`Informe tecnico: ${INFORME_STATUS} / ${valor}.`);
  }

  const subComentario = cajaInforme.querySelector(SEL.apelar.subComentario);
  if (subComentario) escribirEn(subComentario, comentario);

  // 4. Enviar.
  const enviar = primero(SEL.apelar.enviar, raiz);
  if (!enviar) throw new Error('No se encontro el boton "Enviar apelacion"');

  if (prueba) {
    onLog?.('Modo prueba: formulario completo, NO se envio la apelacion.');
    return { enviado: false };
  }

  clickEl(enviar);
  onLog?.('Apelacion enviada.');

  return { enviado: true };
}

/**
 * Anclaje del formulario de apelacion: su campo de archivos, que no existe en
 * ninguna otra pantalla del portal. Vale tanto en el frame superior como dentro
 * de un iframe, donde la URL no sirve para reconocer nada.
 */
export function anclaApelacion() {
  return primero(SEL.apelar.archivos)
    || buscarPorTexto(document, SEL.apelar.cajaTitulo, 'Motivo de apelacion');
}

/**
 * Raiz donde el portal monta el formulario de apelacion: el shadow root de la
 * micro-app de devoluciones, o el documento si deja de encapsularla.
 */
function raizApelacion() {
  return raizDe(SEL.apelar.caja) || raizDe(SEL.apelar.archivos) || document;
}

/** ¿Estamos en el formulario de apelacion? */
export function esPaginaApelacion() {
  return location.href.includes('/order/return/rejectAppeals') || Boolean(anclaApelacion());
}
