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
  ACORDEONES,
  DEFAULT_MOTIVO,
  ENVIO_APELACION_TIMEOUT_MS,
  INFORME_STATUS,
  MOTIVO_KEYWORDS,
  PAGE_TIMEOUT_MS,
  SEL,
  STEP_TIMEOUT_MS,
  SUBSTATUS_DANO_SEVERO,
  SUBSTATUS_INCOMPLETO,
} from '../constants.js';
import { abrirAcordeon, base64ToFile, buscarPorTexto, clickReal, elegirOpcion, escribirEn, normalizar, primero, raizDe, setFiles } from './dom.js';
import { traza, trazaAviso, trazaError } from '../../../trace.js';
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
 * @param {{ prueba: boolean, pedirArchivos: () => Promise<Array>, antesDeEnviar?: () => Promise<any>, signal?: AbortSignal, onLog?: Function }} opts
 */
export async function apelar(job, { prueba, pedirArchivos, antesDeEnviar, signal, onLog } = {}) {
  // El formulario vive dentro del shadow root de la micro-app, igual que el
  // listado: se resuelve la raiz una vez y se consulta siempre contra ella.
  const raiz = raizApelacion();
  await waitForElement(SEL.apelar.caja, { timeout: PAGE_TIMEOUT_MS, signal, root: raiz });

  const observacion = job.reembolso?.observacion || '';
  const comentario = armarComentario(job);

  // 1. Motivo de apelacion.
  const cajaMotivo = await abrirAcordeon(ACORDEONES.motivo, { signal, raiz });
  const motivo = elegirMotivo(observacion);

  await elegirMotivoEnElFormulario(cajaMotivo, motivo, { signal, onLog });

  const textarea = cajaMotivo.querySelector(SEL.apelar.comentario);
  if (textarea) escribirEn(textarea, comentario);

  // 2. Evidencias: el PDF que armo el modulo con las fotos ordenadas.
  await adjuntarEvidencias({ raiz, pedirArchivos, signal, onLog });

  // 3. Informe tecnico: estado, sub-motivo y detalle.
  const cajaInforme = await abrirAcordeon(ACORDEONES.informe, { signal, raiz });

  const radio = Array.from(cajaInforme.querySelectorAll(SEL.apelar.radioEstado))
    .find((r) => normalizar(r.id) === normalizar(INFORME_STATUS));
  if (!radio) throw new Error(`No se encontro el estado "${INFORME_STATUS}" del informe tecnico`);
  clickReal(radio);

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

  // 4. Enviar. El boton solo toma la clase `submit-button-active` cuando el
  //    formulario se da por completo, asi que esperarla es la unica forma de
  //    saber que no falta nada — y, sobre todo, de no reportar "apelada" tras un
  //    clic sobre un boton inerte. Antes se pulsaba el boton encontrara la clase
  //    que encontrara: si la evidencia no habia entrado, la orden se daba por
  //    apelada sin haberse enviado nada.
  const enviar = await waitFor(
    () => primero(SEL.apelar.enviarActivo, raiz),
    { timeout: STEP_TIMEOUT_MS, signal, description: 'que el boton "Enviar" se active' },
  ).catch(() => null);

  if (!enviar) {
    trazaAviso('apelar', 'El boton de enviar no se activo', {
      hayBotonInactivo: Boolean(primero(SEL.apelar.enviar, raiz)),
      evidenciasEnElCampo: primero(SEL.apelar.archivos, raiz)?.files?.length ?? null,
    });

    throw new Error(
      'El formulario de apelacion no se dio por completo: el boton "Enviar" sigue inactivo '
      + '(lo mas probable es que la evidencia no se adjuntara).',
    );
  }

  if (prueba) {
    onLog?.('Modo prueba: formulario completo y boton activo, NO se envio la apelacion.');
    return { enviado: false };
  }

  // La fase se anota ANTES de pulsar, igual que en el ticket: el envio navega
  // al listado (a veces con recarga incluida) y quien cargue despues tiene que
  // saber que ya toca verificar que la orden salio del modulo.
  await antesDeEnviar?.();

  clickReal(enviar);
  onLog?.('Apelacion enviada, esperando la vuelta al listado…');

  await esperarSalidaDelFormulario({ signal });

  return { enviado: true };
}

/**
 * La constancia de que la apelacion de verdad se envio: el portal SALE del
 * formulario (medido en vivo: el POST responde 201 y la SPA regresa a
 * returns_pending_review). Un clic que no prendio —o un POST rechazado— deja
 * la pagina en el formulario, asi que el timeout aqui significa "no se
 * envio", no "quiza se envio": antes se reportaba OK a ciegas y la orden
 * seguia en el modulo sin que nadie se enterara.
 *
 * Si la navegacion recarga la pagina, esta espera muere con el documento y la
 * verificacion la retoma la pagina siguiente (fase VERIFICAR).
 */
async function esperarSalidaDelFormulario({ signal } = {}) {
  const salio = await waitFor(
    () => !location.href.includes('/order/return/rejectAppeals') || null,
    { timeout: ENVIO_APELACION_TIMEOUT_MS, signal, description: 'la salida del formulario tras enviar' },
  ).catch(() => null);

  if (salio) return;

  trazaError('apelar', 'El envio no saco al portal del formulario', {
    url: location.href,
    botonActivoSigue: Boolean(primero(SEL.apelar.enviarActivo, raizApelacion())),
  });

  throw new Error(
    'La apelacion no se envio: tras pulsar "Enviar" el portal no salio del formulario.',
  );
}

/** Veces que se intenta elegir el motivo antes de rendirse. */
const INTENTOS_MOTIVO = 2;

/**
 * Elige el motivo en el desplegable propio del formulario y **comprueba que
 * quedo elegido**.
 *
 * El desplegable no es un `<select>`: es un div con su lista, y un clic que no
 * prende no deja rastro… hasta el final, cuando el boton "Enviar" no se activa y
 * el fallo aparece disfrazado de "formulario incompleto". La cabecera del
 * desplegable pasa a mostrar el motivo elegido (medido en vivo), asi que eso es
 * lo que se verifica.
 */
async function elegirMotivoEnElFormulario(caja, motivo, { signal, onLog } = {}) {
  const header = await waitForElement(SEL.apelar.dropdownHeader, { timeout: STEP_TIMEOUT_MS, signal, root: caja });

  for (let intento = 1; intento <= INTENTOS_MOTIVO; intento++) {
    clickReal(header);

    const opcion = await waitFor(
      () => buscarPorTexto(caja, SEL.apelar.dropdownOpcion, motivo),
      {
        timeout: intento === 1 ? STEP_TIMEOUT_MS : 4000,
        signal,
        description: `el motivo "${motivo}"`,
      },
    ).catch(() => null);

    if (opcion) {
      clickReal(opcion);

      const elegido = await waitFor(
        () => normalizar(header.textContent).includes(normalizar(motivo)),
        { timeout: 3000, signal, description: `que el desplegable muestre "${motivo}"` },
      ).catch(() => false);

      if (elegido) {
        onLog?.(`Motivo de apelacion: ${motivo}.`);
        return;
      }
    }

    trazaAviso('apelar', 'El motivo no quedo elegido', {
      motivo,
      intento,
      cabecera: normalizar(header.textContent).slice(0, 60),
      opciones: [...caja.querySelectorAll(SEL.apelar.dropdownOpcion)].map((o) => o.textContent.trim()),
    });
  }

  throw new Error(`No se pudo elegir el motivo "${motivo}" en el formulario de apelacion`);
}

/**
 * Adjunta `evidencias.pdf` en la caja de evidencias y comprueba que el
 * formulario lo acepto.
 *
 * Dos cosas que aqui fallan en silencio y por eso se miran una a una:
 *
 *   · **Donde esta el campo.** El portal ha movido su maquetacion; buscarlo solo
 *     dentro de la caja daba un timeout con el campo a la vista dos nodos mas
 *     arriba. Se prueba primero la caja y despues la raiz entera.
 *   · **Si de verdad entro.** Muchos uploaders vacian el `input` despues de
 *     leerlo (para poder elegir el mismo archivo dos veces), asi que
 *     `input.files.length` no sirve como prueba: lo que se busca es que el
 *     nombre del archivo aparezca en pantalla. Si no aparece no se aborta —el
 *     portal podria pintarlo de otra forma—, pero queda avisado, y el guardia
 *     del boton "Enviar" corta el envio si de verdad no entro.
 */
async function adjuntarEvidencias({ raiz, pedirArchivos, signal, onLog }) {
  const caja = await abrirAcordeon(ACORDEONES.evidencias, { signal, raiz });

  const input = await waitFor(
    () => primero(SEL.apelar.archivos, caja) || primero(SEL.apelar.archivos, raiz),
    { timeout: STEP_TIMEOUT_MS, signal, description: 'el campo de evidencias' },
  );

  const archivos = await pedirArchivos('apelacion');

  traza('apelar', 'Evidencias recibidas para adjuntar', {
    archivos: archivos.map((a) => a.nombre),
    enLaCaja: caja.contains(input),
  });

  setFiles(input, archivos.map(base64ToFile));

  const nombres = archivos.map((a) => a.nombre);

  // El portal pinta "N archivos adjuntos" + el nombre del archivo dentro de la
  // caja (medido en vivo), y ademas conserva el `input.files` aunque se cierre
  // el acordeon. Vale cualquiera de las dos señales.
  const visible = await waitFor(
    () => nombres.some((nombre) => normalizar(caja.textContent).includes(normalizar(nombre)))
      || (input.files?.length ?? 0) > 0,
    { timeout: 5000, signal, description: 'que el formulario acuse las evidencias' },
  ).catch(() => false);

  if (visible) {
    onLog?.(`Evidencias adjuntas: ${nombres.join(', ')}.`);
    return;
  }

  trazaAviso('apelar', 'El formulario no acuso las evidencias', {
    archivos: nombres,
    enElCampo: input.files?.length ?? null,
    textoDeLaCaja: normalizar(caja.textContent).slice(0, 200),
  });

  onLog?.(`Adjunte ${nombres.join(', ')}, pero el formulario no lo acuso: se comprobara al enviar.`);
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
