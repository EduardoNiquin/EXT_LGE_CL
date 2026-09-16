// Listeners de la grabacion.
//
// Reglas que valen para todos:
//   · Un unico listener por tipo, en `document`, en fase de CAPTURA — asi se ve
//     el evento aunque la pagina haga stopPropagation.
//   · `event.composedPath()[0]` en vez de `event.target`: el target viene
//     retargeteado al host cuando el elemento vive en un shadow root.
//   · `if (!e.isTrusted) return;` — sin esto, los clics sinteticos de las otras
//     features de esta misma extension (clickEl, setInputValue, clickReal) se
//     grabarian como si los hubiera hecho el usuario.
//   · Salida temprana si no se esta grabando: el guard es lo primero de cada
//     handler y consulta una variable en memoria, nunca storage.
//
// No se escucha `input`, `mousemove`, `scroll` ni `wheel`: son los que disparan
// cientos de eventos por segundo y no aportan al flujo. Los campos se registran
// por su VALOR FINAL (`change` / `focusout`), que es lo que se decidio grabar.

import { describeBreve, describeElement, limpiar } from '../../../shared/dom/describe.js';
import { crearPolitica, tratarTexto } from '../privacidad.js';
import { LIMITES, TECLAS_REGISTRADAS, TIPOS } from '../constants.js';
import { observarTras } from './consecuencias.js';

let activo = false;
let emitir = null;
let politica = crearPolitica();
let opciones = {};

/** Ultimo valor conocido de cada campo, para poder contar el "antes". */
const valoresPrevios = new WeakMap();

function objetivoDe(evento) {
  try {
    const camino = evento.composedPath?.();
    const primero = camino && camino.length ? camino[0] : null;
    if (primero && primero.nodeType === 1) return primero;
    const destino = evento.target;
    return destino && destino.nodeType === 1 ? destino : null;
  } catch {
    return evento.target || null;
  }
}

function modificadoresDe(evento) {
  const mods = [];
  if (evento.ctrlKey) mods.push('ctrl');
  if (evento.altKey) mods.push('alt');
  if (evento.shiftKey) mods.push('shift');
  if (evento.metaKey) mods.push('meta');
  return mods;
}

function describir(el) {
  return describeElement(el, { valor: politica });
}

// -----------------------------------------------------------------------------
// Handlers
// -----------------------------------------------------------------------------

function alHacerClic(evento) {
  if (!activo || !evento.isTrusted) return;
  const el = objetivoDe(evento);
  if (!el) return;

  const descripcion = describir(el);
  const enlace = el.closest?.('a[href]');
  const boton = el.closest?.('button, input[type=submit], [role=button]');
  const puedeNavegar = Boolean(enlace) || (boton && (boton.type === 'submit' || boton.closest?.('form')));

  const ref = emitir({
    tipo: TIPOS.CLIC,
    datos: {
      elemento: descripcion,
      boton: evento.button === 1 ? 'medio' : evento.button === 2 ? 'derecho' : 'izquierdo',
      dobleClic: evento.detail >= 2,
      modificadores: modificadoresDe(evento),
      punto: { x: Math.round(evento.clientX), y: Math.round(evento.clientY) },
      href: enlace ? enlace.getAttribute('href') : null,
      abreEnPestanaNueva: Boolean(
        (enlace && enlace.target === '_blank') || evento.ctrlKey || evento.metaKey || evento.button === 1,
      ),
    },
    // Un clic que puede navegar se manda ya: si esperamos el lote, el documento
    // puede morir antes y perderiamos justo la accion que explica el salto.
  }, { urgente: puedeNavegar });

  if (ref && opciones.consecuencias !== false) observarTras(ref);
}

function alMenuContextual(evento) {
  if (!activo || !evento.isTrusted) return;
  const el = objetivoDe(evento);
  if (!el) return;

  emitir({
    tipo: TIPOS.CLIC,
    datos: {
      elemento: describir(el),
      boton: 'derecho',
      dobleClic: false,
      modificadores: modificadoresDe(evento),
      punto: { x: Math.round(evento.clientX), y: Math.round(evento.clientY) },
    },
  });
}

/** Al enfocar un campo se anota su valor, para poder contar de que a que cambio. */
function alEnfocar(evento) {
  if (!activo || !evento.isTrusted) return;
  const el = objetivoDe(evento);
  if (!el || !/^(input|textarea|select)$/i.test(el.tagName || '')) return;
  try {
    valoresPrevios.set(el, politica(valorCrudo(el), el).valor);
  } catch { /* no-op */ }
}

function valorCrudo(el) {
  try {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'marcado' : 'sin marcar';
    if (el.tagName === 'SELECT') {
      const opcion = el.selectedOptions?.[0] || el.options?.[el.selectedIndex];
      return opcion ? limpiar(opcion.textContent) : (el.value || '');
    }
    return el.value == null ? '' : String(el.value);
  } catch {
    return '';
  }
}

function registrarCambio(el, evento) {
  const descripcion = describir(el);
  const previo = valoresPrevios.get(el);
  const actual = descripcion.valor;

  if (previo !== undefined && previo === actual) return null;   // no cambio nada
  valoresPrevios.set(el, actual);

  const datos = {
    elemento: descripcion,
    tipoCampo: el.getAttribute?.('type') || el.tagName.toLowerCase(),
    etiqueta: descripcion.etiqueta || descripcion.texto || null,
    valor: actual,
    valorAnterior: previo ?? null,
    longitud: String(valorCrudo(el)).length,
    enmascarado: descripcion.enmascarado,
    motivoEnmascarado: descripcion.motivoEnmascarado,
  };

  if (el.tagName === 'SELECT') {
    const opcion = el.selectedOptions?.[0] || el.options?.[el.selectedIndex];
    datos.opcion = opcion ? { texto: limpiar(opcion.textContent, 80), valor: opcion.value } : null;
  }
  if (el.type === 'checkbox' || el.type === 'radio') {
    datos.marcado = Boolean(el.checked);
  }
  if (el.type === 'file') {
    datos.archivos = Array.from(el.files || []).slice(0, 10).map((f) => ({
      nombre: f.name, tamano: f.size, mime: f.type || null,
    }));
  }

  return emitir({ tipo: TIPOS.CAMPO_CAMBIO, datos }, { urgente: Boolean(evento?.urgente) });
}

function alCambiar(evento) {
  if (!activo || !evento.isTrusted) return;
  const el = objetivoDe(evento);
  if (!el || !/^(input|textarea|select)$/i.test(el.tagName || '')) return;
  registrarCambio(el, evento);
}

/**
 * Red de seguridad para las SPA que nunca emiten `change` (React controla el
 * valor y solo dispara `input`): al salir del campo se compara con lo que habia
 * al entrar.
 */
function alDesenfocar(evento) {
  if (!activo || !evento.isTrusted) return;
  const el = objetivoDe(evento);
  if (!el || !/^(input|textarea)$/i.test(el.tagName || '')) return;
  registrarCambio(el, evento);
}

function alPulsarTecla(evento) {
  if (!activo || !evento.isTrusted) return;

  const mods = modificadoresDe(evento);
  const conAtajo = evento.ctrlKey || evento.altKey || evento.metaKey;
  // Filtro barato ANTES de tocar el DOM: la mayoria de las teclas se descartan
  // aqui sin describir nada.
  if (!conAtajo && !TECLAS_REGISTRADAS.has(evento.key)) return;
  if (conAtajo && (evento.key === 'Control' || evento.key === 'Alt' || evento.key === 'Meta' || evento.key === 'Shift')) return;

  const el = objetivoDe(evento);
  const ref = emitir({
    tipo: TIPOS.TECLA,
    datos: {
      tecla: evento.key,
      codigo: evento.code || null,
      modificadores: mods,
      esAtajo: conAtajo,
      elemento: describeBreve(el),
    },
  }, { urgente: evento.key === 'Enter' });

  if (ref && evento.key === 'Enter' && opciones.consecuencias !== false) observarTras(ref);
}

function alEnviarFormulario(evento) {
  if (!activo || !evento.isTrusted) return;
  const form = objetivoDe(evento);
  if (!form || form.tagName !== 'FORM') return;

  const campos = [];
  try {
    for (const campo of Array.from(form.elements || []).slice(0, 60)) {
      if (!campo.name && !campo.id) continue;
      if (campo.type === 'submit' || campo.type === 'button') continue;
      const tratado = politica(valorCrudo(campo), campo);
      campos.push({
        nombre: campo.name || campo.id,
        tipo: campo.type || campo.tagName.toLowerCase(),
        valor: tratado.valor,
        enmascarado: tratado.enmascarado,
      });
    }
  } catch { /* lo que se haya podido leer ya sirve */ }

  const ref = emitir({
    tipo: TIPOS.ENVIO_FORMULARIO,
    datos: {
      formulario: describir(form),
      accion: form.getAttribute('action') || null,
      metodo: (form.getAttribute('method') || 'GET').toUpperCase(),
      campos,
      disparadoPor: describeBreve(evento.submitter || null),
    },
  }, { urgente: true });   // un submit casi siempre mata el documento

  if (ref && opciones.consecuencias !== false) observarTras(ref);
}

function alPortapapeles(tipo) {
  return function manejar(evento) {
    if (!activo || !evento.isTrusted) return;
    if (opciones.portapapeles === false) return;

    const el = objetivoDe(evento);
    let texto = '';
    try {
      if (tipo === TIPOS.PEGAR) {
        texto = evento.clipboardData?.getData('text/plain') || '';
      } else {
        texto = evento.clipboardData?.getData('text/plain')
          || String(document.getSelection?.() || '');
      }
    } catch { /* clipboardData puede estar vacio segun el navegador */ }

    const tratado = tratarTexto(texto, { ...opciones, tope: LIMITES.textoPortapapeles });
    const descripcion = describeBreve(el);

    emitir({
      tipo,
      datos: {
        muestra: tratado.texto,
        longitud: tratado.longitud,
        enmascarado: tratado.enmascarado,
        motivoEnmascarado: tratado.motivo,
        [tipo === TIPOS.PEGAR ? 'destino' : 'origen']: descripcion,
      },
    });
  };
}

function alCambiarVisibilidad() {
  if (!activo) return;
  emitir({
    tipo: document.hidden ? TIPOS.PAGINA_OCULTA : TIPOS.PAGINA_VISIBLE,
    datos: {},
  }, { urgente: document.hidden });   // si se oculta, puede venir una navegacion
}

// -----------------------------------------------------------------------------
// Alta y baja
// -----------------------------------------------------------------------------

const HANDLERS = [
  ['click', alHacerClic],
  ['auxclick', alHacerClic],
  ['contextmenu', alMenuContextual],
  ['focusin', alEnfocar],
  ['change', alCambiar],
  ['focusout', alDesenfocar],
  ['keydown', alPulsarTecla],
  ['submit', alEnviarFormulario],
  ['copy', alPortapapeles(TIPOS.COPIAR)],
  ['cut', alPortapapeles(TIPOS.CORTAR)],
  ['paste', alPortapapeles(TIPOS.PEGAR)],
];

let enganchado = false;

/**
 * @param {object} config
 * @param {(evento:object, opciones?:object)=>string|null} config.emitir
 * @param {object} [config.opciones]
 */
export function iniciarCaptura(config) {
  emitir = config.emitir;
  opciones = config.opciones || {};
  politica = crearPolitica({ enmascararContacto: opciones.enmascararContacto });
  activo = true;

  if (enganchado) return;
  enganchado = true;

  for (const [nombre, handler] of HANDLERS) {
    document.addEventListener(nombre, handler, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', alCambiarVisibilidad, { passive: true });
}

/**
 * Deja de grabar. Los listeners se quedan puestos a proposito: sacarlos y
 * volverlos a poner en cada pausa es mas caro que un `if` al principio de cada
 * handler, y asi una reanudacion es instantanea.
 */
export function pausarCaptura() {
  activo = false;
}

export function reanudarCaptura() {
  activo = true;
}

/** Baja de verdad (al detener la grabacion). */
export function detenerCaptura() {
  activo = false;
  if (!enganchado) return;
  enganchado = false;

  for (const [nombre, handler] of HANDLERS) {
    document.removeEventListener(nombre, handler, { capture: true });
  }
  document.removeEventListener('visibilitychange', alCambiarVisibilidad);
}

export function estadoCaptura() {
  return { activo, enganchado, opciones };
}
