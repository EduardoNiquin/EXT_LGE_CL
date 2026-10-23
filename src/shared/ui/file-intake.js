// Zona de carga de archivos: pegar (Ctrl+V), arrastrar o el selector de siempre.
//
// El pegado es la via que sobrevive a la politica de DLP corporativa: dentro de
// la red de LG el dialogo de "Subir archivo" no devuelve nada (y el arrastre
// tampoco), pero copiar el archivo en el Explorador (Ctrl+C sobre el archivo) y
// pegarlo en la pagina entrega sus bytes sin abrir ningun dialogo. Mismo truco
// que en el modulo DevolucionesSeller del portal.
//
// Ojo con el popup de la extension: al pasar al Explorador el popup se cierra,
// asi que el orden es copiar primero y pegar al reabrirlo (el portapapeles
// sobrevive). Por eso el listener de `paste` cuelga del documento y no de la
// zona: recien abierto el popup el foco no esta en ningun lado concreto.

import { escapeHtml } from './format.js';

/**
 * HTML de la zona. Pegar en un `innerHTML` y luego `wireFileIntake` con el
 * mismo `id`.
 *
 * @param {object} opts
 * @param {string} opts.id         id del contenedor (sin `#`)
 * @param {string} opts.titulo     linea principal ("Pega aqui el Excel")
 * @param {string} opts.nota       una linea de ayuda bajo el titulo
 * @param {string} [opts.boton]    texto del selector de archivos
 * @param {string} [opts.accept]   filtro del selector (`accept` nativo)
 * @param {boolean} [opts.multiple]
 */
export function fileIntakeHtml({ id, titulo, nota, boton = 'Elegir archivo', accept = '', multiple = false }) {
  return `
    <div class="fi-zone" id="${escapeHtml(id)}" tabindex="0" role="button" aria-label="${escapeHtml(titulo)}">
      <p class="fi-zone__titulo"><strong>${escapeHtml(titulo)}</strong> <span class="fi-zone__tecla">Ctrl+V</span></p>
      <p class="fi-zone__nota">${escapeHtml(nota)}</p>
      <label class="ct-btn ct-btn--ghost fi-zone__btn">
        ${escapeHtml(boton)}
        <input type="file" ${multiple ? 'multiple' : ''} ${accept ? `accept="${escapeHtml(accept)}"` : ''} hidden>
      </label>
    </div>`;
}

/**
 * Engancha las tres vias a `onArchivos(archivos, origen)`, con `origen` en
 * `'pegado' | 'arrastre' | 'selector'`. Devuelve un `dispose()`; ademas se
 * desengancha sola cuando la zona sale del DOM (el router del popup reemplaza
 * el contenido de la sub-vista al cambiar de pestana).
 *
 * @returns {() => void}
 */
export function wireFileIntake(container, { id, onArchivos }) {
  const zona = container.querySelector(`#${id}`);
  if (!zona) return () => {};
  const input = zona.querySelector('input[type="file"]');

  const entregar = (archivos, origen) => {
    const lista = Array.from(archivos || []);
    if (lista.length) onArchivos(lista, origen);
  };

  const alPegar = (event) => {
    // La zona vive en la sub-vista: si ya no esta en el DOM, este listener es
    // de una vista vieja y sobra.
    if (!zona.isConnected) { dispose(); return; }
    // Pegar texto no es asunto nuestro: se deja pasar tal cual. Solo se
    // intercepta cuando vienen archivos que la zona acepta.
    //
    // Ojo con Excel: al copiar celdas deja en el portapapeles el texto Y una
    // imagen PNG de esas celdas. Sin el filtro por `accept`, esa "imagen" se
    // tragaba el pegado y el texto nunca llegaba al campo (habia que pasar por
    // el Bloc de notas). Y si el foco esta en un campo de texto y hay texto, gana
    // el texto aunque venga algun archivo.
    const datos = event.clipboardData;
    if (esCampoDeTexto(event.target) && datos?.getData('text/plain')) return;
    const archivos = archivosDelPortapapeles(datos).filter((a) => aceptaArchivo(input?.accept, a));
    if (!archivos.length) return;
    event.preventDefault();
    entregar(archivos, 'pegado');
  };

  const alArrastrar = (event) => { event.preventDefault(); zona.classList.add('fi-zone--over'); };
  const alSalir = () => zona.classList.remove('fi-zone--over');
  const alSoltar = (event) => {
    event.preventDefault();
    zona.classList.remove('fi-zone--over');
    entregar(event.dataTransfer?.files, 'arrastre');
  };
  const alElegir = () => { entregar(input.files, 'selector'); input.value = ''; };
  // Click en la zona = abrir el selector, salvo cuando ya se pulso el boton
  // (su <label> abre el input por su cuenta; reenviarlo lo abriria dos veces).
  const alClick = (event) => { if (!event.target.closest('label')) input.click(); };

  document.addEventListener('paste', alPegar);
  zona.addEventListener('dragover', alArrastrar);
  zona.addEventListener('dragleave', alSalir);
  zona.addEventListener('drop', alSoltar);
  zona.addEventListener('click', alClick);
  input.addEventListener('change', alElegir);

  function dispose() {
    document.removeEventListener('paste', alPegar);
    zona.removeEventListener('dragover', alArrastrar);
    zona.removeEventListener('dragleave', alSalir);
    zona.removeEventListener('drop', alSoltar);
    zona.removeEventListener('click', alClick);
    input.removeEventListener('change', alElegir);
  }
  return dispose;
}

/** Archivos que trae un evento de pegado (los copiados en el Explorador). */
export function archivosDelPortapapeles(clipboardData) {
  if (!clipboardData) return [];
  if (clipboardData.files?.length) return Array.from(clipboardData.files);
  const archivos = [];
  for (const item of clipboardData.items ?? []) {
    if (item.kind !== 'file') continue;
    const archivo = item.getAsFile();
    if (archivo) archivos.push(archivo);
  }
  return archivos;
}

function esCampoDeTexto(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !['file', 'checkbox', 'radio', 'button', 'submit'].includes(el.type);
}

/**
 * `true` si el archivo calza con un `accept` nativo (".csv,.xlsx,text/plain,
 * image/*"). Sin `accept`, todo vale.
 */
export function aceptaArchivo(accept, archivo) {
  const reglas = String(accept || '').split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (!reglas.length) return true;
  const ext = extensionDe(archivo);
  const tipo = String(archivo?.type || '').toLowerCase();
  return reglas.some((regla) => {
    if (regla.startsWith('.')) return ext === regla.slice(1);
    if (regla.endsWith('/*')) return tipo.startsWith(regla.slice(0, -1));
    return tipo === regla;
  });
}

/** Extension del nombre, en minusculas y sin punto ('' si no tiene). */
export function extensionDe(archivo) {
  const nombre = String(archivo?.name ?? '');
  const punto = nombre.lastIndexOf('.');
  return punto > 0 ? nombre.slice(punto + 1).toLowerCase() : '';
}
