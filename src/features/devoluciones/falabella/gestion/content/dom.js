// Helpers de DOM propios de la gestion automatica: subir archivos a un <input
// type=file> por codigo y manejar los comboboxes de Salesforce (LWC), que no
// son <select> sino botones con una lista de <lightning-base-combobox-item>.

import { PAGE_TIMEOUT_MS, SEL, STEP_TIMEOUT_MS } from '../constants.js';
import { traza, trazaAviso } from '../../../trace.js';
import { sleep, waitFor } from '../../../../../shared/dom/wait.js';

/** Reconstruye un File a partir del base64 que manda el service worker. */
export function base64ToFile({ nombre, tipo, contenido }) {
  const binary = atob(contenido);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], nombre, { type: tipo || 'application/octet-stream' });
}

/**
 * Deja los archivos dentro de un <input type=file>. `input.files` es de solo
 * lectura, pero acepta el FileList de un DataTransfer: es la unica forma de
 * simular una seleccion sin abrir el dialogo (que es justo lo que la politica
 * del equipo bloquea).
 */
export function setFiles(input, files) {
  if (!input) throw new Error('setFiles: no se encontro el campo de archivos');
  const dt = new DataTransfer();
  for (const file of files) dt.items.add(file);
  input.files = dt.files;

  // `composed`, como todos los eventos sinteticos de aqui: el campo de
  // evidencias vive dentro del shadow root del modulo y un evento que no sale de
  // esa raiz no llega al manejador que sube el archivo.
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  return input;
}

/**
 * Escribe en un campo de texto de forma que el framework de la pagina se entere.
 *
 * El modulo de devoluciones de SellerCenter es **React** (Ant Design), y ahi
 * `el.value = x` no basta: React intercepta el setter `value` del prototipo para
 * llevar su propio registro del valor, asi que una asignacion directa cambia lo
 * que se ve en pantalla pero deja a React creyendo que el campo sigue vacio —
 * su `onChange` no se dispara y la busqueda se hace sobre el valor anterior.
 * Llamando al setter NATIVO del prototipo, React lo ve como si lo hubiera
 * tecleado una persona. En una web sin React es exactamente lo mismo que la
 * asignacion de siempre, asi que sirve igual para los campos de Salesforce.
 */
export function escribirEn(el, valor, { blur = false } = {}) {
  if (!el) throw new Error('escribirEn: elemento nulo');

  const prototipo = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(prototipo, 'value')?.set;

  el.focus();

  if (setter) setter.call(el, valor);
  else el.value = valor;

  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  if (blur) el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));

  return el;
}

/**
 * Elige una opcion en un <select>. Mismo motivo que {@link escribirEn}: React
 * rastrea tambien el valor de los <select>, asi que hay que pasar por el setter
 * nativo para que su `onChange` se entere.
 */
export function elegirOpcion(select, valor) {
  if (!select) throw new Error('elegirOpcion: elemento nulo');

  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;

  if (setter) setter.call(select, valor);
  else select.value = valor;

  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));

  return select;
}

/** Texto normalizado (sin acentos, minusculas) para comparar rotulos. */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Todas las raices en las que puede vivir la pantalla: el documento y los
 * **shadow roots abiertos** que cuelgan de el, en anchura.
 *
 * No es un adorno defensivo: el modulo de devoluciones de SellerCenter monta
 * TODA su interfaz (buscador, tabla y formulario de apelacion) dentro del shadow
 * root de `#return-app-container`. En el documento de arriba no hay ni un
 * `<input>` ni una `<table>`, asi que un `document.querySelector` plano no
 * encuentra nada y la espera se agota sin explicacion.
 */
function raices(raiz = document) {
  const encontradas = [raiz];

  // Si la raiz es ELLA MISMA un host, hay que entrar en su shadow root: si no,
  // `raices(combo)` se queda fuera de su propio contenido. Pasa de verdad en la
  // mesa de ayuda (Salesforce LWC con shadow nativo): el
  // `button.slds-combobox__input` de un `lightning-combobox` vive dentro de su
  // shadow root, y buscarlo con `combo.querySelector(...)` devuelve null.
  if (raiz.shadowRoot) encontradas.push(raiz.shadowRoot);

  // Recorrido en anchura sobre el propio array: lo que se anade se visita luego.
  for (let i = 0; i < encontradas.length; i++) {
    // Una raiz que no sabe enumerar descendientes (un nodo suelto) simplemente
    // no aporta shadow roots: se la deja consultar y se sigue.
    const hijos = encontradas[i]?.querySelectorAll?.('*');
    if (!hijos) continue;

    for (const el of hijos) {
      if (el.shadowRoot) encontradas.push(el.shadowRoot);
    }
  }

  return encontradas;
}

/**
 * Primer elemento que encaja con alguno de los selectores dados, en orden. Los
 * portales reordenan su maquetación cada tanto: tener alternativas evita que un
 * `div` nuevo en medio tumbe todo el flujo.
 *
 * Busca primero en el documento y despues en los shadow roots, para que una
 * pantalla encapsulada en un web component no quede invisible desde fuera.
 */
export function primero(selectores, raiz = document) {
  const lista = [].concat(selectores);

  for (const r of raices(raiz)) {
    for (const selector of lista) {
      const el = r.querySelector?.(selector);
      if (el) return el;
    }
  }

  return null;
}

/**
 * Todos los elementos que encajan, cruzando shadow roots. Hace falta para lo que
 * no es "el primero que aparezca": las filas de la tabla o los acordeones del
 * formulario, que son justo donde el modulo guarda lo que hay que leer.
 */
export function todos(selectores, raiz = document) {
  const lista = [].concat(selectores);
  const vistos = new Set();

  for (const r of raices(raiz)) {
    for (const selector of lista) {
      for (const el of r.querySelectorAll?.(selector) || []) vistos.add(el);
    }
  }

  return Array.from(vistos);
}

/**
 * La raiz (documento o shadow root) que contiene la pantalla. Se resuelve UNA
 * vez al empezar una fase y se reutiliza para todas las consultas: asi no se
 * recorre el arbol entero en cada vuelta de una espera, y sobre todo se evita
 * mezclar elementos de dos raices distintas.
 */
export function raizDe(selectores, raiz = document) {
  const lista = [].concat(selectores);

  for (const r of raices(raiz)) {
    if (lista.some((selector) => r.querySelector(selector))) return r;
  }

  return null;
}

/** Cuántos shadow roots abiertos hay (para el diagnóstico). */
export function contarShadowRoots(raiz = document) {
  return raices(raiz).length - 1;
}

/** Primer elemento cuyo texto contiene `texto` (sin distinguir acentos). */
export function buscarPorTexto(root, selector, texto) {
  const objetivo = normalizar(texto);
  return todos(selector, root || document)
    .find((el) => normalizar(el.textContent).includes(objetivo)) || null;
}

/**
 * Texto de un elemento juntando el de TODAS sus raices. Con shadow DOM nativo el
 * `textContent` de un componente viene vacio, porque lo que se ve esta dentro de
 * su shadow root y no cuenta como contenido suyo.
 */
function textoProfundo(el) {
  return raices(el)
    .map((r) => r.textContent || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Texto visible de una opcion de combobox de Salesforce. En la mesa de ayuda
 * (LWC con shadow nativo) el `textContent` de un `lightning-base-combobox-item`
 * llega **vacio** —su rotulo vive en otro shadow root anidado—, pero el valor
 * esta siempre en `data-value`. Se usa ese y solo si falta se baja a leer el
 * texto de las raices.
 */
export function textoDeOpcion(el) {
  return el?.getAttribute?.('data-value') || textoProfundo(el);
}

/** Texto visible de un elemento, cruzando sus shadow roots. */
export function textoVisible(el) {
  return el ? textoProfundo(el) : '';
}

// -----------------------------------------------------------------------------
// Interaccion "como un raton de verdad"
// -----------------------------------------------------------------------------

/** Centro del elemento, para que los eventos lleven coordenadas creibles. */
function puntoDe(el) {
  const caja = el?.getBoundingClientRect?.();
  if (!caja) return { clientX: 0, clientY: 0 };

  return {
    clientX: Math.round(caja.left + caja.width / 2),
    clientY: Math.round(caja.top + caja.height / 2),
  };
}

/**
 * Evento de raton/puntero con `composed: true`.
 *
 * `composed` no es un adorno: sin el, un evento despachado sobre un elemento que
 * vive **dentro de un shadow root** no sale de esa raiz, asi que un manejador de
 * fuera (la delegacion de eventos de React, por ejemplo) no se entera nunca. Los
 * eventos de un raton real son siempre composed; los de `new MouseEvent` no, y
 * ese es justo el escenario de los portales de Falabella, que montan media
 * pantalla dentro de web components.
 */
function eventoDeRaton(tipo, el) {
  const Ctor = tipo.startsWith('pointer') && typeof PointerEvent === 'function'
    ? PointerEvent
    : MouseEvent;

  // enter/leave no burbujean nunca (ni siquiera los de verdad).
  const burbujea = !tipo.endsWith('enter') && !tipo.endsWith('leave');

  return new Ctor(tipo, {
    bubbles: burbujea,
    cancelable: true,
    composed: true,
    view: window,
    button: 0,
    buttons: tipo.endsWith('down') ? 1 : 0,
    detail: tipo === 'click' ? 1 : 0,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    ...puntoDe(el),
  });
}

/**
 * Simula que el raton se posa sobre un elemento.
 *
 * Se lanza tambien en la cadena de ancestros porque `mouseenter`/`pointerenter`
 * no burbujean: un menu que se despliega escuchando el enter de su contenedor no
 * se enteraria si solo tocamos la hoja.
 *
 * Aviso: esto NO activa el `:hover` de CSS — eso solo lo mueve un raton real. Si
 * un menu se despliega por CSS puro, hay que buscar su contenido en el DOM
 * aunque este oculto, que es lo que hace `enlaceCentroDeAyuda`.
 */
export function pasarElRaton(el, { ancestros = 3 } = {}) {
  if (!el) return null;

  const cadena = [el];
  let padre = el.parentElement;
  for (let i = 0; i < ancestros && padre; i++, padre = padre.parentElement) cadena.push(padre);

  el.dispatchEvent(eventoDeRaton('pointerover', el));
  for (const nodo of cadena) nodo.dispatchEvent(eventoDeRaton('pointerenter', nodo));

  el.dispatchEvent(eventoDeRaton('mouseover', el));
  for (const nodo of cadena) nodo.dispatchEvent(eventoDeRaton('mouseenter', nodo));

  el.dispatchEvent(eventoDeRaton('pointermove', el));
  el.dispatchEvent(eventoDeRaton('mousemove', el));

  return el;
}

/**
 * Clic completo: el raton se posa, baja y sube. Frente al `clickEl` compartido
 * añade los eventos de puntero, las coordenadas, el foco y —lo importante— el
 * `composed: true` que deja salir el evento del shadow root.
 */
export function clickReal(el) {
  if (!el) throw new Error('clickReal: elemento nulo');

  pasarElRaton(el);

  for (const tipo of ['pointerdown', 'mousedown']) el.dispatchEvent(eventoDeRaton(tipo, el));
  try { el.focus?.({ preventScroll: true }); } catch { /* elementos sin foco */ }
  for (const tipo of ['pointerup', 'mouseup', 'click']) el.dispatchEvent(eventoDeRaton(tipo, el));

  return el;
}

// -----------------------------------------------------------------------------
// Comboboxes de Salesforce (LWC)
// -----------------------------------------------------------------------------

/** Opciones actualmente montadas en el desplegable. */
function opcionesDeCombobox(combo) {
  return todos(SEL.ticket.comboOpcion, combo);
}

/** Opcion de un combobox por su rotulo: exacta primero, contenida despues. */
function opcionDeCombobox(combo, valor) {
  const objetivo = normalizar(valor);
  const items = opcionesDeCombobox(combo);

  // La exacta manda: "Devoluciones" no puede ganarla "Informacion sobre una
  // orden en devolucion" solo por contener la palabra.
  return items.find((el) => normalizar(textoDeOpcion(el)) === objetivo)
    || items.find((el) => normalizar(textoDeOpcion(el)).includes(objetivo))
    || null;
}

/** Foto del combobox: su boton, lo que muestra y si esta desplegado. */
function estadoDeCombobox(combo) {
  // El boton NO cuelga del combo en el light DOM: vive dentro de su propio
  // shadow root (lightning-combobox -> lightning-base-combobox -> boton), asi
  // que `combo.querySelector` devuelve null. Hay que cruzar sus raices.
  const boton = primero(SEL.ticket.comboBoton, combo);
  const opciones = opcionesDeCombobox(combo);
  const expandido = boton?.getAttribute('aria-expanded');

  return {
    boton,
    texto: normalizar(textoVisible(boton)),
    opciones,
    // Manda `aria-expanded`: las opciones NO se desmontan al cerrar el
    // desplegable (medido en vivo), asi que contarlas diria "abierto" siempre.
    abierto: expandido != null ? expandido === 'true' : opciones.length > 0,
  };
}

/** ¿El combobox quedo con la opcion elegida? */
function seleccionHecha(combo, esperado, rotuloInicial) {
  const ahora = estadoDeCombobox(combo);

  // Lo normal: el boton pasa a mostrar lo elegido.
  if (esperado && ahora.texto.includes(normalizar(esperado))) return ahora.texto;

  // Algunos combos no repintan el rotulo con el texto exacto; vale como señal
  // que se hayan cerrado Y que muestren algo distinto de lo que habia antes.
  if (!ahora.abierto && ahora.texto && ahora.texto !== rotuloInicial) return ahora.texto;

  return null;
}

const INTENTOS_COMBOBOX = 3;

/**
 * Elige una opcion en un combobox de Salesforce y **comprueba que quedo
 * elegida**, reintentando si no.
 *
 * Por que tanto cuidado: el primer desplegable del ticket (el del contacto)
 * fallaba de vez en cuando y habia que elegirlo a mano para que la gestion
 * siguiera. El clic sobre la opcion se daba por bueno sin mirar el resultado, y
 * como el boton "Enviar" solo se activa con el formulario completo, el sintoma
 * aparecia mucho despues y disfrazado ("el formulario no se dio por completo").
 *
 * Si tras los reintentos sigue sin elegirse, no se aborta de inmediato: se avisa
 * por la bitacora y se espera a que el usuario lo elija (`esperaManualMs`), que
 * es exactamente el rescate que se venia haciendo a mano.
 *
 * @param {Element} combo
 * @param {object} opts
 * @param {string|null} [opts.valor] Rotulo a elegir; `null` = la primera opcion.
 * @param {string} [opts.descripcion] Como se llama el campo en los mensajes.
 * @param {number} [opts.esperaManualMs] Cuanto esperar al usuario si falla.
 * @returns {Promise<{ texto: string, via: 'auto'|'manual' }>}
 */
export async function elegirEnCombobox(combo, {
  valor = null,
  descripcion = valor || 'el desplegable',
  esperaManualMs = PAGE_TIMEOUT_MS,
  signal,
  onLog,
} = {}) {
  if (!combo) throw new Error(`No se encontro el desplegable de ${descripcion}`);

  const inicial = estadoDeCombobox(combo);
  if (!inicial.boton) throw new Error(`El desplegable de ${descripcion} no tiene boton`);

  for (let intento = 1; intento <= INTENTOS_COMBOBOX; intento++) {
    // En los reintentos se cierra y se vuelve a abrir: un desplegable que quedo
    // abierto pero vacio no se arregla mirandolo mas rato.
    if (intento > 1 && estadoDeCombobox(combo).abierto) {
      clickReal(inicial.boton);
      await sleep(200, signal);
    }
    if (!estadoDeCombobox(combo).abierto) clickReal(inicial.boton);

    // La primera vuelta espera de verdad (en la cascada del ticket, las opciones
    // de un nivel solo existen despues de elegir el anterior); las siguientes
    // solo confirman que el reintento sirvio de algo.
    const opcion = await waitFor(
      () => (valor ? opcionDeCombobox(combo, valor) : opcionesDeCombobox(combo)[0]),
      {
        timeout: intento === 1 ? STEP_TIMEOUT_MS : 4000,
        signal,
        description: `la opcion "${valor ?? 'unica'}" de ${descripcion}`,
      },
    ).catch(() => null);

    if (!opcion) {
      trazaAviso('combobox', 'El desplegable no mostro la opcion', {
        campo: descripcion,
        valor,
        intento,
        opciones: opcionesDeCombobox(combo).map(textoDeOpcion).slice(0, 8),
      });
      continue;
    }

    const texto = textoDeOpcion(opcion);
    clickReal(opcion);

    const elegido = await waitFor(
      () => seleccionHecha(combo, texto, inicial.texto),
      { timeout: 2500, signal, description: `que el desplegable muestre "${texto}"` },
    ).catch(() => null);

    if (elegido) {
      traza('combobox', 'Opcion elegida', {
        campo: descripcion,
        elegida: texto,
        intento,
        opciones: opcionesDeCombobox(combo).length || inicial.opciones.length,
      });

      return { texto, via: 'auto' };
    }

    trazaAviso('combobox', 'El clic no dejo la opcion elegida', {
      campo: descripcion,
      intentaba: texto,
      intento,
      rotuloAhora: estadoDeCombobox(combo).texto,
    });
  }

  // Ultimo recurso: que lo elija el usuario. Se prefiere a fallar porque el
  // formulario ya esta a medio rellenar y perderlo obliga a repetirlo todo.
  if (esperaManualMs > 0) {
    onLog?.(`No pude elegir "${descripcion}" solo. Eligelo tu en el formulario: la gestion sigue en cuanto lo hagas.`);

    const texto = await waitFor(
      () => seleccionHecha(combo, valor, inicial.texto),
      { timeout: esperaManualMs, signal, description: `que elijas ${descripcion}` },
    ).catch(() => null);

    if (texto) {
      trazaAviso('combobox', 'Lo eligio el usuario a mano', { campo: descripcion, elegido: texto });
      onLog?.(`Gracias: "${descripcion}" quedo con "${texto}". Sigo.`);

      return { texto, via: 'manual' };
    }
  }

  throw new Error(`No se pudo elegir "${valor ?? descripcion}" en el desplegable de ${descripcion}`);
}

/** Compatibilidad: elegir por rotulo. */
export function elegirCombobox(combo, valor, opciones = {}) {
  return elegirEnCombobox(combo, { ...opciones, valor, descripcion: opciones.descripcion || valor });
}

/**
 * Abre un acordeon del formulario de apelacion por el titulo de su caja. Los
 * paneles arrancan colapsados (`class="off"`) y se abren pulsando la cabecera.
 *
 * El titulo admite varias formas: el portal ha cambiado alguna ("Evidencias del
 * producto" / "Evidencia"), y no encontrar la caja tumba la apelacion entera.
 * La cabecera se pulsa con {@link clickReal} — el formulario vive en el shadow
 * root del modulo, y ahi un evento sin `composed` no llega a ningun manejador de
 * fuera.
 *
 * @param {string|string[]} titulo Rotulo(s) posibles de la caja.
 */
export async function abrirAcordeon(titulo, { signal, raiz = document } = {}) {
  const rotulos = [].concat(titulo).map(normalizar);

  const caja = todos(SEL.apelar.caja, raiz).find((box) => {
    const texto = normalizar(box.querySelector(SEL.apelar.cajaTitulo)?.textContent);
    return rotulos.some((rotulo) => texto.includes(rotulo));
  });

  if (!caja) {
    trazaAviso('apelar', 'No se encontro la seccion del formulario', {
      buscaba: rotulos,
      secciones: todos(SEL.apelar.caja, raiz)
        .map((box) => box.querySelector(SEL.apelar.cajaTitulo)?.textContent?.trim())
        .filter(Boolean),
    });

    throw new Error(`No se encontro la seccion "${[].concat(titulo)[0]}"`);
  }

  const cuerpo = caja.querySelector(SEL.apelar.cajaCuerpo);
  if (cuerpo && !cuerpo.classList.contains('on')) {
    clickReal(caja.querySelector('.title-box'));
    await waitFor(
      () => caja.querySelector('.on'),
      { timeout: STEP_TIMEOUT_MS, signal, description: `que se abra "${[].concat(titulo)[0]}"` },
    );
  }

  return caja;
}
