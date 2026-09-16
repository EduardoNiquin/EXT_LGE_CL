// Descripcion de elementos para el Registro de acciones.
//
// El problema que resuelve: guardar "el usuario hizo clic" no sirve de nada.
// Para poder automatizar despues ese paso hay que saber EN QUE hizo clic de
// forma reproducible — un selector que vuelva a encontrarlo, como se llama para
// una persona, y donde estaba parado (que formulario, que fila de que tabla, que
// modal, que iframe).
//
// Nada de esto existia: `shared/dom/events.js` sabe accionar sobre un elemento y
// `shared/dom/wait.js` sabe esperarlo, pero ninguno sabe describirlo.
//
// Todo aqui es puro y defensivo: recibe nodos y devuelve objetos planos
// serializables, sin `chrome.*`, sin estado y sin lanzar nunca — un fallo
// describiendo un elemento jamas puede romper la pagina del usuario.

export const LIMITES = {
  profundidadSelector: 6,   // niveles que sube cssPath antes de rendirse
  clasesPorSegmento: 2,     // clases que entran en un segmento del selector
  texto: 200,               // corte del texto visible de un elemento
  valor: 300,               // corte del valor de un campo
  clases: 8,                // clases que se listan en describeElement
  datos: 10,                // atributos data-* que se listan
};

// -----------------------------------------------------------------------------
// Utilidades base
// -----------------------------------------------------------------------------

/** Recorta y normaliza espacios. Devuelve '' ante cualquier cosa rara. */
export function limpiar(texto, tope = LIMITES.texto) {
  if (texto == null) return '';
  const plano = String(texto).replace(/\s+/g, ' ').trim();
  return plano.length > tope ? `${plano.slice(0, tope)}...` : plano;
}

/** Sin acentos y en minusculas, para comparar rotulos y nombres de campo. */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Escapa un valor para meterlo en un selector CSS. */
function escaparCss(valor) {
  const texto = String(valor);
  try {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(texto);
  } catch { /* entornos sin CSS.escape */ }
  return texto.replace(/([^\w-])/g, '\\$1');
}

/**
 * Un id sirve para el selector solo si va a seguir existiendo en la proxima
 * visita. Los frameworks generan ids por render (`:r3:` de React, `ember1234`,
 * `input-8f3a91`) que serian inutiles — peor: darian un selector que parece
 * bueno y falla siempre.
 */
function idEstable(el) {
  const id = el.id;
  if (!id || typeof id !== 'string') return null;
  if (id.length > 40) return null;
  if (/^\d/.test(id)) return null;                      // ids numericos
  if (/[:\s]/.test(id)) return null;                    // :r3: de React
  if (/^(ember|ext-gen|yui|mat-|cdk-|radix-|headlessui-|mui-)/i.test(id)) return null;
  if (/\d{5,}/.test(id)) return null;                   // contador autogenerado
  if (/^[a-f0-9]{8,}$/i.test(id)) return null;          // hash puro
  return id;
}

/** Misma idea para las clases: fuera las que traen hash del bundler. */
function claseEstable(clase) {
  if (!clase || typeof clase !== 'string') return false;
  if (clase.length > 30) return false;
  if (/^(css|sc|jsx|emotion|styles?)[-_]/i.test(clase)) return false;
  if (/[a-f0-9]{5,}/i.test(clase) && !/[aeiou]{2}/i.test(clase)) return false;
  if (/\d{4,}/.test(clase)) return false;
  // Clases de estado: cambian solas y ensucian el selector.
  if (/^(is-|has-)/i.test(clase)) return false;
  if (/^(active|selected|focus|focused|hover|open|show|shown|hidden|disabled)$/i.test(clase)) return false;
  return true;
}

function clasesDe(el) {
  const crudas = typeof el.className === 'string'
    ? el.className.split(/\s+/)
    : Array.from(el.classList || []);
  return crudas.filter(Boolean);
}

/**
 * Atributos que los equipos ponen a proposito para identificar un elemento.
 * Si hay uno, es mejor selector que cualquier cosa que podamos construir.
 */
const ATRIBUTOS_IDENTIDAD = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-id', 'name'];

function selectorPorAtributo(el) {
  for (const attr of ATRIBUTOS_IDENTIDAD) {
    const valor = el.getAttribute?.(attr);
    if (valor && valor.length <= 60 && !/\d{5,}/.test(valor)) {
      return `${el.tagName.toLowerCase()}[${attr}="${escaparCss(valor)}"]`;
    }
  }
  return null;
}

/** La raiz del elemento: el document o el shadow root que lo contiene. */
function raizDe(el) {
  try {
    return el.getRootNode?.() || el.ownerDocument || null;
  } catch {
    return el.ownerDocument || null;
  }
}

/** Sube un nivel, cruzando el limite del shadow DOM si hace falta. */
function padreDe(el) {
  if (el.parentElement) return el.parentElement;
  const padre = el.parentNode;
  if (padre && padre.host) return padre.host;   // salto del shadow root al host
  return null;
}

function esUnico(selector, raiz) {
  try {
    return raiz.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function indiceEntreHermanos(el) {
  const padre = el.parentElement;
  if (!padre) return 0;
  const mismos = Array.from(padre.children).filter((h) => h.tagName === el.tagName);
  if (mismos.length <= 1) return 0;   // 0 = no hace falta nth-of-type
  return mismos.indexOf(el) + 1;
}

function segmentoDe(el) {
  const tag = el.tagName.toLowerCase();
  const clases = clasesDe(el).filter(claseEstable).slice(0, LIMITES.clasesPorSegmento);
  let segmento = tag + clases.map((c) => `.${escaparCss(c)}`).join('');
  if (!clases.length) {
    const indice = indiceEntreHermanos(el);
    if (indice) segmento += `:nth-of-type(${indice})`;
  }
  return segmento;
}

// -----------------------------------------------------------------------------
// Selectores
// -----------------------------------------------------------------------------

/**
 * Tramo de selector dentro de UNA raiz (document o shadow root), sin cruzar
 * fronteras. Devuelve el string mas corto que identifique al elemento ahi.
 */
function tramoEnRaiz(el, raiz, maxDepth) {
  const partes = [];
  let actual = el;
  let nivel = 0;

  while (actual && actual.nodeType === 1 && raizDe(actual) === raiz && nivel < maxDepth) {
    const id = idEstable(actual);
    if (id) {
      partes.unshift(`#${escaparCss(id)}`);
      return partes.join(' > ');
    }

    const porAtributo = selectorPorAtributo(actual);
    if (porAtributo && esUnico(porAtributo, raiz)) {
      partes.unshift(porAtributo);
      return partes.join(' > ');
    }

    partes.unshift(segmentoDe(actual));
    const candidato = partes.join(' > ');
    if (esUnico(candidato, raiz)) return candidato;

    actual = padreDe(actual);
    nivel++;
  }

  return partes.join(' > ');
}

/**
 * Los tramos del selector, uno por raiz atravesada (de afuera hacia adentro).
 * Con shadow DOM abierto devuelve mas de uno; sin shadow DOM, siempre uno.
 *
 * Se devuelve como array porque ' >>> ' no es CSS valido: el string sirve para
 * que lo lea una persona (o una IA), el array para automatizar de verdad.
 */
export function rutaSelector(el, opciones = {}) {
  if (!el || el.nodeType !== 1) return [];
  const { maxDepth = LIMITES.profundidadSelector } = opciones;
  const tramos = [];

  try {
    let actual = el;
    let vueltas = 0;

    while (actual && actual.nodeType === 1 && vueltas < 5) {
      const raiz = raizDe(actual);
      if (!raiz) break;
      tramos.unshift(tramoEnRaiz(actual, raiz, maxDepth));
      if (!raiz.host) break;         // llegamos al document
      actual = raiz.host;            // seguimos por el host del shadow root
      vueltas++;
    }
  } catch { /* lo que se haya juntado ya sirve */ }

  return tramos.filter(Boolean);
}

/**
 * Selector CSS que vuelve a encontrar el elemento. Prioridad: id estable >
 * atributo de identidad > tag + clases estables > :nth-of-type, subiendo por los
 * ancestros hasta que sea unico (tope `profundidadSelector`).
 *
 * Si el elemento vive dentro de un shadow root abierto, los tramos se separan
 * con ' >>> ' (la frontera que un querySelector normal no cruza).
 */
export function cssPath(el, opciones = {}) {
  const tramos = rutaSelector(el, opciones);
  if (tramos.length) return tramos.join(' >>> ');
  return el && el.tagName ? el.tagName.toLowerCase() : '';
}

/** Version corta y legible del selector, para el feed en vivo del popup. */
export function selectorCorto(el) {
  if (!el || el.nodeType !== 1) return '';
  const tag = el.tagName.toLowerCase();
  const id = idEstable(el);
  if (id) return `#${id}`;
  const identidad = ATRIBUTOS_IDENTIDAD.map((a) => el.getAttribute?.(a)).find(Boolean);
  if (identidad) return `${tag}[${limpiar(identidad, 30)}]`;
  const clase = clasesDe(el).find(claseEstable);
  return clase ? `${tag}.${clase}` : tag;
}

// -----------------------------------------------------------------------------
// Nombre y texto
// -----------------------------------------------------------------------------

/** Texto de un elemento, mirando dentro de su shadow root si tiene uno abierto. */
export function textoProfundo(el, tope = LIMITES.texto) {
  if (!el) return '';
  try {
    const propio = limpiar(el.textContent, tope);
    if (propio) return propio;
    if (el.shadowRoot) return limpiar(el.shadowRoot.textContent, tope);
    return '';
  } catch {
    return '';
  }
}

/**
 * Como llamaria una persona a este elemento. Mismo orden que la accesibilidad:
 * aria-label, aria-labelledby, <label>, placeholder, title, alt, value (botones)
 * y, al final, su propio texto.
 */
export function textoAccesible(el) {
  if (!el || el.nodeType !== 1) return '';
  try {
    const aria = limpiar(el.getAttribute?.('aria-label'));
    if (aria) return aria;

    const refs = el.getAttribute?.('aria-labelledby');
    if (refs) {
      const doc = el.ownerDocument || null;
      const textos = refs.split(/\s+/)
        .map((id) => doc?.getElementById?.(id))
        .filter(Boolean)
        .map((n) => limpiar(n.textContent));
      const junto = limpiar(textos.filter(Boolean).join(' '));
      if (junto) return junto;
    }

    // El <label> identifica CAMPOS. Buscarselo a un enlace o a un boton dentro
    // de una tabla termina devolviendo el texto de la celda de al lado ("Ana
    // Perez" en vez de "Ver"), que es justo lo contrario de lo que se quiere.
    if (/^(input|select|textarea)$/i.test(el.tagName)) {
      const etiqueta = etiquetaDe(el);
      if (etiqueta) return etiqueta;
    }

    for (const attr of ['placeholder', 'title', 'alt']) {
      const valor = limpiar(el.getAttribute?.(attr));
      if (valor) return valor;
    }

    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) {
      const valor = limpiar(el.value);
      if (valor) return valor;
    }

    return textoProfundo(el, 80);
  } catch {
    return '';
  }
}

/** El <label> que le corresponde a un campo, por cualquiera de las vias. */
export function etiquetaDe(el) {
  try {
    if (el.labels && el.labels.length) return limpiar(el.labels[0].textContent, 120);
    const cerrado = el.closest?.('label');
    if (cerrado) return limpiar(cerrado.textContent, 120);
    if (el.id) {
      const doc = el.ownerDocument || null;
      const suelto = doc?.querySelector?.(`label[for="${escaparCss(el.id)}"]`);
      if (suelto) return limpiar(suelto.textContent, 120);
    }
    // Patron comun en los admin: el rotulo es la celda anterior de la fila.
    const celda = el.closest?.('td');
    const previa = celda?.previousElementSibling;
    if (previa && /^(TH|TD)$/.test(previa.tagName)) return limpiar(previa.textContent, 120);
  } catch { /* no-op */ }
  return '';
}

// -----------------------------------------------------------------------------
// Contexto: donde esta parado el elemento
// -----------------------------------------------------------------------------

/** Si el elemento esta en una tabla, en que fila y bajo que columna. */
export function contextoTabla(el) {
  try {
    const celda = el.closest?.('td, th');
    const fila = celda?.closest?.('tr');
    const tabla = fila?.closest?.('table');
    if (!celda || !fila || !tabla) return null;

    const indice = Array.from(fila.children).indexOf(celda);
    const cabecera = tabla.querySelector('thead tr') || tabla.rows?.[0];
    const encabezado = cabecera && cabecera !== fila
      ? limpiar(cabecera.children?.[indice]?.textContent, 60)
      : '';
    const filas = Array.from(tabla.rows || []);

    return {
      selector: selectorCorto(tabla),
      fila: filas.indexOf(fila) + 1,
      columna: indice + 1,
      encabezado: encabezado || null,
      // Celda por celda: el textContent de la fila viene todo pegado
      // ("000123456Ana PerezVer") y se vuelve ilegible.
      textoFila: limpiar(
        Array.from(fila.children).map((c) => limpiar(c.textContent, 40)).filter(Boolean).join(' | '),
        200,
      ),
    };
  } catch {
    return null;
  }
}

/** Si el elemento esta dentro de un modal / dialogo abierto. */
export function contextoDialogo(el) {
  try {
    const dialogo = el.closest?.('dialog, [role="dialog"], [role="alertdialog"], .modal, .modal-content, .ui-dialog');
    if (!dialogo) return null;
    const titulo = dialogo.querySelector('h1, h2, h3, .modal-title, [role="heading"]');
    return {
      selector: selectorCorto(dialogo),
      titulo: limpiar(titulo?.textContent, 120) || null,
    };
  } catch {
    return null;
  }
}

/** El encabezado mas cercano por encima del elemento: en que seccion esta. */
export function seccionDe(el) {
  try {
    let actual = el;
    let nivel = 0;
    while (actual && nivel < 8) {
      let hermano = actual.previousElementSibling;
      while (hermano) {
        if (/^H[1-4]$/.test(hermano.tagName)) return limpiar(hermano.textContent, 120);
        const interno = hermano.querySelector?.('h1, h2, h3');
        if (interno) return limpiar(interno.textContent, 120);
        hermano = hermano.previousElementSibling;
      }
      actual = actual.parentElement;
      nivel++;
    }
  } catch { /* no-op */ }
  return null;
}

/** La cadena de iframes hasta el documento de arriba (lo que se pueda ver). */
export function rutaDeFrame(ventana = typeof window !== 'undefined' ? window : null) {
  const ruta = [];
  try {
    let actual = ventana;
    let nivel = 0;
    while (actual && actual !== actual.top && nivel < 5) {
      const marco = actual.frameElement;   // null si es de otro origen
      ruta.unshift(marco
        ? limpiar(marco.getAttribute('src') || marco.id || marco.name || 'iframe', 120)
        : '(iframe de otro origen)');
      actual = actual.parent;
      nivel++;
    }
  } catch {
    ruta.unshift('(iframe de otro origen)');
  }
  return ruta;
}

/** Los data-* del elemento, que suelen llevar el id real del negocio. */
function atributosDatos(el) {
  const datos = {};
  try {
    for (const attr of Array.from(el.attributes || [])) {
      if (!attr.name.startsWith('data-')) continue;
      if (Object.keys(datos).length >= LIMITES.datos) break;
      datos[attr.name] = limpiar(attr.value, 80);
    }
  } catch { /* no-op */ }
  return datos;
}

// -----------------------------------------------------------------------------
// Valor de un campo
// -----------------------------------------------------------------------------

/** Lee el valor de un campo en el formato en que tiene sentido registrarlo. */
export function valorDeCampo(el) {
  try {
    if (!el) return '';
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'marcado' : 'sin marcar';
    if (el.tagName === 'SELECT') {
      const opcion = el.selectedOptions?.[0] || el.options?.[el.selectedIndex];
      return opcion ? limpiar(opcion.textContent) : (el.value || '');
    }
    if (el.type === 'file') {
      return Array.from(el.files || []).map((f) => f.name).join(', ');
    }
    return el.value == null ? '' : String(el.value);
  } catch {
    return '';
  }
}

/** Rol aproximado cuando el elemento no declara uno. */
function rolImplicito(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return el.hasAttribute?.('href') ? 'enlace' : null;
  if (tag === 'button') return 'boton';
  if (tag === 'select') return 'lista';
  if (tag === 'textarea') return 'texto';
  if (tag === 'input') {
    const tipo = (el.getAttribute('type') || 'text').toLowerCase();
    if (['button', 'submit', 'reset', 'image'].includes(tipo)) return 'boton';
    if (['checkbox', 'radio'].includes(tipo)) return 'casilla';
    return 'campo';
  }
  return null;
}

/**
 * Si el elemento esta a la vista. "Visible" aqui significa que forma parte de la
 * pagina renderizada, no que este dentro del viewport: un boton mas abajo del
 * scroll cuenta, uno con `display:none` no.
 *
 * Se prefiere `checkVisibility()` (Chrome 105+) porque cubre `display:none`,
 * `visibility:hidden` y `content-visibility` de una sola vez. El rect se usa
 * solo como respaldo, y un rect de 0x0 no alcanza para descartar: en un
 * documento sin layout (los tests, o una pestana de fondo) TODO mide 0x0.
 */
export function esVisible(el) {
  try {
    if (!el || el.nodeType !== 1) return false;
    if (el.hidden) return false;
    if (el.type === 'hidden') return false;

    if (typeof el.checkVisibility === 'function') return el.checkVisibility();

    const cajas = el.getClientRects?.();
    if (cajas && cajas.length === 0) return false;
    return true;
  } catch {
    return true;   // ante la duda, se incluye
  }
}

function cajaDe(el) {
  try {
    const caja = el.getBoundingClientRect?.();
    if (!caja) return null;
    return {
      x: Math.round(caja.left),
      y: Math.round(caja.top),
      w: Math.round(caja.width),
      h: Math.round(caja.height),
    };
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Descripcion de un elemento
// -----------------------------------------------------------------------------

/**
 * Retrato completo de un elemento, serializable. Es lo que se guarda en cada
 * evento de interaccion del registro.
 *
 * `opciones.valor`: como tratar el valor de un campo. Se recibe como funcion
 * (`(valor, el) => ({ valor, enmascarado, motivo })`) para que la politica de
 * privacidad viva en la feature y este modulo siga siendo generico.
 *
 * @param {Element} el
 * @param {{ ventana?: Window, valor?: Function, caja?: boolean }} [opciones]
 */
export function describeElement(el, opciones = {}) {
  if (!el || el.nodeType !== 1) return null;

  try {
    const tag = el.tagName.toLowerCase();
    const esCampo = /^(input|textarea|select)$/.test(tag);

    let valor = null;
    let enmascarado = false;
    let motivoEnmascarado = null;

    if (esCampo) {
      const crudo = valorDeCampo(el);
      if (typeof opciones.valor === 'function') {
        const tratado = opciones.valor(crudo, el) || {};
        valor = tratado.valor ?? '';
        enmascarado = Boolean(tratado.enmascarado);
        motivoEnmascarado = tratado.motivo || null;
      } else {
        valor = limpiar(crudo, LIMITES.valor);
      }
    }

    const tramos = rutaSelector(el, opciones);

    const descripcion = {
      tag,
      tipo: el.getAttribute?.('type') || null,
      rol: el.getAttribute?.('role') || rolImplicito(el),
      id: el.id || null,
      nombre: el.getAttribute?.('name') || null,
      clases: clasesDe(el).slice(0, LIMITES.clases),
      texto: textoAccesible(el),
      etiqueta: etiquetaDe(el) || null,
      selector: tramos.join(' >>> '),
      selectorCorto: selectorCorto(el),
      rutaShadow: tramos.length > 1 ? tramos : null,
      sombraCerrada: Boolean(el.shadowRoot === null && el.tagName?.includes('-')),
      datos: atributosDatos(el),
      href: tag === 'a' ? (el.getAttribute('href') || null) : null,
      valor,
      enmascarado,
      motivoEnmascarado,
      deshabilitado: Boolean(el.disabled),
      visible: esVisible(el),
      caja: opciones.caja === false ? null : cajaDe(el),
      contexto: {
        formulario: null,
        dialogo: contextoDialogo(el),
        tabla: contextoTabla(el),
        seccion: seccionDe(el),
        frame: rutaDeFrame(opciones.ventana),
      },
    };

    const formulario = el.closest?.('form');
    if (formulario) {
      descripcion.contexto.formulario = {
        selector: selectorCorto(formulario),
        nombre: formulario.getAttribute('name') || null,
        accion: formulario.getAttribute('action') || null,
        metodo: (formulario.getAttribute('method') || 'GET').toUpperCase(),
      };
    }

    return descripcion;
  } catch {
    return {
      tag: el.tagName?.toLowerCase?.() || '?',
      selector: '',
      selectorCorto: '',
      texto: '',
      error: 'no se pudo describir el elemento',
    };
  }
}

/** Version liviana, para eventos de alta frecuencia (teclas). Sin caja ni tabla. */
export function describeBreve(el) {
  if (!el || el.nodeType !== 1) return null;
  try {
    return {
      tag: el.tagName.toLowerCase(),
      tipo: el.getAttribute?.('type') || null,
      selector: cssPath(el),
      selectorCorto: selectorCorto(el),
      texto: textoAccesible(el),
    };
  } catch {
    return null;
  }
}
