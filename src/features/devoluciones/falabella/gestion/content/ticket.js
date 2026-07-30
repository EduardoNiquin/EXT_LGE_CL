// Fase TICKET: formulario de soporte de ayudaseller (Salesforce Lightning).
//
// Es la via para las devoluciones que NO aparecen en el modulo de devoluciones.
// Los tres desplegables de la consulta son una cascada: las opciones de cada
// nivel solo existen despues de elegir el anterior, asi que van uno a uno y con
// espera entre medias (lo hace elegirCombobox).
//
// Aqui se suben TODOS los PDF: el evidencias.pdf armado por el modulo y los que
// venian en el comprimido (guia de despacho, boletas…).

import {
  CASO_REGEX,
  GUIA_NO_IDENTIFICADA,
  HELP_HOST,
  HELP_SUPPORT_PATH,
  PAGE_TIMEOUT_MS,
  SEL,
  STEP_TIMEOUT_MS,
  TICKET_CASCADA,
  TICKET_SIN_NUMERO,
} from '../constants.js';
import { base64ToFile, elegirCombobox, escribirEn, primero, setFiles, textoDeOpcion, todos } from './dom.js';
import { abrirNuevoCaso } from './navegacion.js';
import { clickEl } from '../../../../../shared/dom/events.js';
import { waitFor } from '../../../../../shared/dom/wait.js';

/**
 * Espera a que aparezca un campo del formulario, cruzando shadow DOM.
 *
 * En la mesa de ayuda (Salesforce LWC con shadow **nativo**) NADA del formulario
 * cuelga del documento: `document.querySelector` devuelve null para todos los
 * campos, asi que las esperas normales se agotan con el formulario a la vista.
 */
function esperarCampo(selector, { timeout = STEP_TIMEOUT_MS, signal } = {}) {
  return waitFor(() => primero(selector), {
    timeout,
    signal,
    description: `el campo "${selector}"`,
  });
}

/** Detalle de la consulta: la observacion mas los datos de la devolucion. */
export function armarDetalle(job) {
  const r = job.reembolso || {};
  const lineas = [
    'Solicito rechazar la devolucion de la siguiente orden:',
    `Numero de orden: ${job.orden}`,
    job.numero_guia ? `Numero de guia: ${job.numero_guia}` : null,
    r.producto ? `Producto: ${r.producto}` : null,
    r.modelo ? `Modelo: ${r.modelo}` : null,
    r.serie ? `Serie: ${r.serie}` : null,
    r.observacion ? `Detalle: ${r.observacion}` : null,
    'Se adjuntan las evidencias fotograficas y los documentos de despacho.',
  ].filter(Boolean);

  return lineas.join('\n');
}

/**
 * Rellena y (salvo en modo prueba) envia el ticket de soporte.
 *
 * @param {object} job
 * @param {object} opts
 * @param {boolean} opts.prueba
 * @param {() => Promise<Array>} opts.pedirArchivos
 * @param {() => Promise<any>} [opts.antesDeEnviar]  Se ejecuta justo antes del envio
 *   (sirve para dejar anotada la fase: el envio puede recargar la pagina).
 * @param {AbortSignal} [opts.signal]
 * @param {Function} [opts.onLog]
 * @returns {Promise<{ enviado: boolean, ticket: string|null, mensaje: string|null }>}
 */
export async function levantarTicket(job, { prueba, pedirArchivos, antesDeEnviar, signal, onLog } = {}) {
  // El formulario no existe hasta abrir la pestana "Nuevo caso".
  await abrirNuevoCaso({ signal, onLog });

  await esperarCampo(SEL.ticket.nivel1, { timeout: PAGE_TIMEOUT_MS, signal });

  // 1. Contacto: hay una sola opcion, se elige esa sin adivinar el nombre.
  const contacto = primero(SEL.ticket.contacto);
  if (contacto) {
    const boton = primero(SEL.ticket.comboBoton, contacto);
    if (boton) {
      clickEl(boton);
      const opcion = await waitFor(
        () => primero(SEL.ticket.comboOpcion, contacto),
        { timeout: STEP_TIMEOUT_MS, signal, description: 'el contacto del formulario' },
      );
      clickEl(opcion);
      onLog?.(`Contacto: ${textoDeOpcion(opcion)}.`);
    }
  }

  // 2. Correo en copia: los CC marcados en la web del modulo.
  const cc = Array.isArray(job.cc) ? job.cc.filter(Boolean) : [];
  if (cc.length) {
    const correo = primero(SEL.ticket.correo);
    if (correo) {
      escribirEn(correo, cc.join(','));
      onLog?.(`Correo en copia: ${cc.join(', ')}.`);
    }
  }

  // 3. Cascada de la consulta (un nivel habilita al siguiente).
  await elegirCombobox(primero(SEL.ticket.nivel1), TICKET_CASCADA.nivel1, { signal });
  await elegirCombobox(
    await esperarCampo(SEL.ticket.nivel2, { signal }),
    TICKET_CASCADA.nivel2,
    { signal },
  );
  await elegirCombobox(
    await esperarCampo(SEL.ticket.nivel3, { signal }),
    TICKET_CASCADA.nivel3,
    { signal },
  );
  onLog?.(`Consulta: ${TICKET_CASCADA.nivel1} / ${TICKET_CASCADA.nivel2} / ${TICKET_CASCADA.nivel3}.`);

  // 4. Detalle.
  const detalle = primero(SEL.ticket.detalle);
  if (!detalle) throw new Error('No se encontro el campo "Detalle" del ticket');
  escribirEn(detalle, armarDetalle(job));

  // 5. Orden y guia. Los campos de orden/guia solo montan despues de la cascada.
  const orden = await esperarCampo(SEL.ticket.numeroOrden, { signal });
  escribirEn(orden, String(job.orden || ''));

  // El campo de guia es obligatorio. Si no se pudo leer de las imagenes va un
  // "0", que es la convencion acordada para "no identificada".
  const guia = primero(SEL.ticket.numeroGuia);
  if (guia) {
    const valor = job.numero_guia ? String(job.numero_guia) : GUIA_NO_IDENTIFICADA;
    escribirEn(guia, valor);
    if (!job.numero_guia) onLog?.(`Sin numero de guia leido: se envia "${GUIA_NO_IDENTIFICADA}".`);
  }

  // 6. Adjuntos: evidencias + los PDF del comprimido.
  const inputArchivos = primero(SEL.ticket.archivos);
  if (!inputArchivos) throw new Error('No se encontro el campo de archivos adjuntos');

  const archivos = await pedirArchivos('ticket');
  setFiles(inputArchivos, archivos.map(base64ToFile));
  onLog?.(`Adjuntos: ${archivos.map((a) => a.nombre).join(', ')}.`);

  // 7. Enviar. El boton solo toma la clase `submit-button` cuando el formulario
  // se da por completo (antes es un `readonly-button`), asi que encontrarlo es
  // ademas la senal de que no falta ningun campo obligatorio.
  const enviar = await esperarCampo(SEL.ticket.enviar, { signal })
    .catch(() => null);
  if (!enviar) throw new Error('El formulario del ticket no se dio por completo: el boton "Enviar" sigue inactivo');

  if (prueba) {
    onLog?.('Modo prueba: ticket completo, NO se envio.');
    return { enviado: false, ticket: null, mensaje: null };
  }

  // Foto de los errores que YA estaban en pantalla: el formulario puede llegar
  // con campos marcados de antes (el combobox de contacto arranca asi), y eso no
  // puede confundirse con un rechazo de nuestro envio.
  const erroresPrevios = erroresDeValidacion();

  // La fase se anota ANTES de pulsar: si el envio recarga la pagina, quien
  // cargue despues tiene que saber que ya toca leer el numero de caso.
  await antesDeEnviar?.();

  clickEl(enviar);
  onLog?.('Ticket enviado, esperando el numero de caso…');

  // Si el envio destruye este documento, esta espera muere con el y el numero lo
  // lee la pagina siguiente (fase CONFIRMACION).
  return leerConfirmacion({ signal, onLog, erroresPrevios });
}

/**
 * Lee el desenlace del envio: la pantalla de confirmacion con el n° de caso, o
 * los errores de validacion que lo impidieron.
 *
 * El numero nunca se inventa. Y si no aparece ni una cosa ni la otra, se reporta
 * como ticket **sin numero**, no como error: lo mas probable es que el caso se
 * creara igual, y un reintento a ciegas duplicaria el ticket en la mesa de
 * ayuda. El mensaje dice que hay que buscarlo en "Casos creados".
 *
 * @param {{ signal?: AbortSignal, onLog?: Function, erroresPrevios?: string[] }} opts
 */
export async function leerConfirmacion({ signal, onLog, erroresPrevios = [] } = {}) {
  const nuevos = (errores) => errores.filter((e) => !erroresPrevios.includes(e));

  const desenlace = await waitFor(() => {
    const numero = numeroDeCaso();
    if (numero) return { numero };

    const errores = nuevos(erroresDeValidacion());
    if (errores.length) return { errores };

    return null;
  }, {
    timeout: PAGE_TIMEOUT_MS,
    signal,
    description: 'la confirmacion del ticket',
  }).catch(() => null);

  if (desenlace?.numero) {
    onLog?.(`Ticket creado: caso N° ${desenlace.numero}.`);

    return { enviado: true, ticket: desenlace.numero, mensaje: 'Ticket levantado en ayudaseller' };
  }

  const errores = desenlace?.errores ?? erroresDeValidacion();

  // Sin confirmacion y con campos en rojo (aunque ya lo estuvieran antes): el
  // formulario no llego a enviarse.
  if (errores.length) {
    return {
      enviado: false,
      ticket: null,
      mensaje: `El formulario rechazo el envio: ${errores.join('; ')}`,
    };
  }

  onLog?.('No se pudo leer el numero de caso: revisa "Casos creados" en la mesa de ayuda.');

  return {
    enviado: true,
    ticket: TICKET_SIN_NUMERO,
    mensaje: 'Ticket enviado, pero no se pudo leer el numero: buscalo en "Casos creados"',
  };
}

/**
 * N° de caso de la pantalla de confirmacion. Viene dentro de una frase ("Tu n°
 * de caso es el 68989843 , con fecha de creacion…"), asi que se extrae por el
 * texto que lo precede y se deja en digitos.
 */
export function numeroDeCaso(raiz = document) {
  const cabecera = primero(SEL.confirmacion.cabecera, raiz);
  if (!cabecera) return null;

  const match = CASO_REGEX.exec(cabecera.parentElement?.textContent || '');
  if (!match) return null;

  const digitos = match[1].replace(/\D+/g, '');

  return digitos.length >= 4 ? digitos : null;
}

/** Mensajes de los campos marcados en error por el formulario. */
export function erroresDeValidacion() {
  return todos(SEL.confirmacion.error)
    .map((el) => el.textContent.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Anclaje de la pantalla de soporte: sus pestañas, el primer desplegable del
 * formulario o la caja de confirmacion (segun en que momento lleguemos).
 */
export function anclaTicket() {
  return primero(SEL.navegacion.pestana)
    || primero(SEL.ticket.nivel1)
    || primero(SEL.confirmacion.cabecera);
}

/** ¿Estamos en la pantalla de soporte (formulario o confirmacion)? */
export function esPaginaTicket() {
  return (location.hostname.includes(HELP_HOST) && location.pathname.includes(HELP_SUPPORT_PATH))
    || Boolean(anclaTicket());
}
