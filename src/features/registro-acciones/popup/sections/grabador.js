// Vista del Registro de acciones: Iniciar / Pausar / Detener + feed en vivo.
//
// El popup no graba nada ni guarda estado propio: solo refleja el run (que vive
// en storage) y manda ordenes al service worker. Si se cierra a mitad de una
// grabacion, la grabacion sigue.
//
// El feed llega por dos vias a proposito: el port (inmediato, mientras el popup
// esta abierto) y el run (cada pocos segundos, para cuando se vuelve a abrir).

import { connectToBackground, sendMessage } from '../../../../shared/messaging/messaging.js';
import { logger } from '../../../../shared/utils/logger.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { EXPORTACION, MESSAGES, PORTS } from '../../constants.js';
import { duracionEfectiva, getOpciones, getRun, setOpciones, subscribeToRun } from '../../state.js';
import { cronometro, escapeHtml, formatBytes, formatTime, tiposOrdenados } from '../utils.js';

const log = logger('registro-acciones');

const AVISO = 'Se va a grabar TODO lo que hagas en el navegador: clics, texto que escribas, '
  + 'paginas que visites y pestanas que abras, en todas las ventanas.\n\n'
  + 'Las claves y los datos de tarjeta se guardan ocultos, pero el resto queda en el archivo.\n\n'
  + 'Comenzar la grabacion?';

let desuscribir = null;
let port = null;
let reloj = null;

function vivo(container) {
  return container && container.isConnected;
}

function limpiarSuscripciones() {
  if (desuscribir) { try { desuscribir(); } catch { /* no-op */ } desuscribir = null; }
  if (port) { try { port.disconnect(); } catch { /* no-op */ } port = null; }
  if (reloj) { clearInterval(reloj); reloj = null; }
}

export async function render(container) {
  limpiarSuscripciones();

  const [run, opciones] = await Promise.all([getRun(), getOpciones()]);

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Grabar un flujo</h3>
        <p class="lt-hint">
          Registra paso a paso lo que haces en el navegador (clics, campos, navegacion) y al
          terminar descarga uno o mas archivos Markdown para analizar el proceso y automatizarlo.
        </p>

        <label class="dt-check">
          <input type="checkbox" id="ra-inventario" ${opciones.inventario ? 'checked' : ''}>
          <span>Mapear cada pagina (formularios, botones y tablas disponibles)</span>
        </label>
        <label class="dt-check">
          <input type="checkbox" id="ra-consecuencias" ${opciones.consecuencias ? 'checked' : ''}>
          <span>Anotar que pasa despues de cada accion (modales, mensajes, cargas)</span>
        </label>
        <label class="dt-check">
          <input type="checkbox" id="ra-portapapeles" ${opciones.portapapeles ? 'checked' : ''}>
          <span>Registrar copiar / cortar / pegar</span>
        </label>
        <label class="dt-check">
          <input type="checkbox" id="ra-contacto" ${opciones.enmascararContacto ? 'checked' : ''}>
          <span>Ocultar tambien correos y RUT</span>
        </label>

        <div class="lt-actions">
          <button type="button" id="ra-start" class="ct-btn ct-btn--primary">Iniciar</button>
          <button type="button" id="ra-pause" class="ct-btn ct-btn--ghost" disabled>Pausar</button>
          <button type="button" id="ra-stop" class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="ra-clear" class="ct-btn ct-btn--ghost hidden">Descartar</button>
        </div>

        <p class="lt-hint" id="ra-aviso"></p>
      </section>

      <section id="ra-estado" class="lt-progress hidden">
        <div class="lt-progress-head">
          <strong id="ra-titulo"><span class="reg-punto"></span>Grabando</strong>
          <span id="ra-reloj" class="dt-progress-counter">00:00</span>
        </div>
        <div id="ra-numeros" class="lt-hint reg-numeros"></div>
        <div id="ra-tipos" class="lt-hint"></div>
      </section>

      <section id="ra-resultado" class="lt-form-card hidden">
        <h3 class="lt-section-title">Archivos generados</h3>
        <div id="ra-archivos"></div>
        <div class="lt-actions">
          <button type="button" id="ra-reexportar" class="ct-btn ct-btn--ghost">Volver a generar</button>
        </div>
      </section>

      <details class="ct-diag lt-log-details" id="ra-feed-caja" open>
        <summary>En vivo</summary>
        <ul id="ra-feed" class="reg-feed"></ul>
      </details>
    </div>
  `;

  cablear(container);
  pintar(container, run);

  desuscribir = subscribeToRun((nuevo) => {
    if (!vivo(container)) { limpiarSuscripciones(); return; }
    pintar(container, nuevo);
  });

  conectarPanel(container);
  arrancarReloj(container);
}

// -----------------------------------------------------------------------------
// Acciones
// -----------------------------------------------------------------------------

function cablear(container) {
  container.querySelector('#ra-start')?.addEventListener('click', () => iniciar(container));
  container.querySelector('#ra-pause')?.addEventListener('click', () => alternarPausa(container));
  container.querySelector('#ra-stop')?.addEventListener('click', () => detener(container));
  container.querySelector('#ra-clear')?.addEventListener('click', () => descartar(container));
  container.querySelector('#ra-reexportar')?.addEventListener('click', () => reexportar(container));

  for (const [id, clave] of [
    ['#ra-inventario', 'inventario'],
    ['#ra-consecuencias', 'consecuencias'],
    ['#ra-portapapeles', 'portapapeles'],
    ['#ra-contacto', 'enmascararContacto'],
  ]) {
    container.querySelector(id)?.addEventListener('change', async (evento) => {
      const opciones = await getOpciones();
      await setOpciones({ ...opciones, [clave]: evento.target.checked });
    });
  }
}

function avisar(container, texto, esError = false) {
  const aviso = container.querySelector('#ra-aviso');
  if (!aviso) return;
  aviso.textContent = texto || '';
  aviso.classList.toggle('lt-err', Boolean(esError));
}

async function iniciar(container) {
  if (!confirm(AVISO)) return;
  avisar(container, 'Iniciando...');

  try {
    const respuesta = await sendMessage({ type: MESSAGES.INICIAR });
    if (!respuesta?.ok) {
      avisar(container, respuesta?.reason || 'No se pudo iniciar.', true);
      return;
    }
    avisar(container, 'Grabando. Puedes cerrar el popup: la grabacion sigue.');
    vaciarFeed(container);
  } catch (err) {
    avisar(container, toMessage(err), true);
  }
}

async function alternarPausa(container) {
  const run = await getRun();
  if (!run?.active) return;

  const tipo = run.paused ? MESSAGES.REANUDAR : MESSAGES.PAUSAR;
  try {
    const respuesta = await sendMessage({ type: tipo });
    if (!respuesta?.ok) avisar(container, respuesta?.reason || 'No se pudo cambiar el estado.', true);
    else avisar(container, run.paused ? 'Grabacion reanudada.' : 'En pausa: no se registra nada.');
  } catch (err) {
    avisar(container, toMessage(err), true);
  }
}

async function detener(container) {
  if (!confirm('Finalizar la grabacion y generar los archivos para descargar?')) return;
  avisar(container, 'Generando los archivos...');

  try {
    const respuesta = await sendMessage({ type: MESSAGES.DETENER, exportar: true });
    if (!respuesta?.ok) {
      avisar(container, respuesta?.reason || 'No se pudo detener.', true);
      return;
    }
    const exportacion = respuesta.exportacion;
    avisar(container, exportacion?.ok
      ? `Listo: ${exportacion.archivos?.length || 0} archivo(s) en Descargas.`
      : (exportacion?.reason || 'La grabacion termino, pero fallo la descarga.'), !exportacion?.ok);
  } catch (err) {
    avisar(container, toMessage(err), true);
  }
}

async function descartar(container) {
  if (!confirm('Descartar lo grabado? No se puede recuperar.')) return;
  try {
    await sendMessage({ type: MESSAGES.DESCARTAR });
    vaciarFeed(container);
    avisar(container, 'Registro descartado.');
  } catch (err) {
    avisar(container, toMessage(err), true);
  }
}

async function reexportar(container) {
  avisar(container, 'Generando de nuevo...');
  try {
    const respuesta = await sendMessage({ type: MESSAGES.EXPORTAR });
    avisar(container, respuesta?.ok ? 'Archivos generados.' : (respuesta?.reason || 'No se pudo generar.'), !respuesta?.ok);
  } catch (err) {
    avisar(container, toMessage(err), true);
  }
}

// -----------------------------------------------------------------------------
// Pintado
// -----------------------------------------------------------------------------

function pintar(container, run) {
  if (!vivo(container)) return;

  const activo = Boolean(run?.active);
  const pausado = Boolean(run?.paused);
  const terminado = Boolean(run && !run.active);

  const start = container.querySelector('#ra-start');
  const pause = container.querySelector('#ra-pause');
  const stop = container.querySelector('#ra-stop');
  const clear = container.querySelector('#ra-clear');

  if (start) start.disabled = activo;
  if (stop) stop.disabled = !activo;
  if (pause) {
    pause.disabled = !activo;
    pause.textContent = pausado ? 'Reanudar' : 'Pausar';
    pause.classList.toggle('ct-btn--primary', pausado);
    pause.classList.toggle('ct-btn--ghost', !pausado);
  }
  if (clear) clear.classList.toggle('hidden', !terminado);

  container.querySelectorAll('.lt-form-card input[type=checkbox]')
    .forEach((el) => { el.disabled = activo; });

  pintarEstado(container, run);
  pintarFeed(container, run?.ultimos || []);
  pintarResultado(container, run);
}

function pintarEstado(container, run) {
  const caja = container.querySelector('#ra-estado');
  if (!caja) return;

  if (!run) {
    caja.classList.add('hidden');
    return;
  }
  caja.classList.remove('hidden');

  const titulo = container.querySelector('#ra-titulo');
  if (titulo) {
    const estado = run.active
      ? (run.paused ? 'En pausa' : 'Grabando')
      : `Grabacion terminada (${run.finishReason || 'usuario'})`;
    const punto = run.active
      ? (run.paused ? 'reg-punto reg-punto--pausa' : 'reg-punto')
      : 'reg-punto reg-punto--fin';
    titulo.innerHTML = `<span class="${punto}"></span>${escapeHtml(estado)}`;
  }

  const contadores = run.contadores || {};
  pintarNumeros(container, contadores);

  const tipos = container.querySelector('#ra-tipos');
  if (tipos) {
    tipos.textContent = tiposOrdenados(contadores.porTipo)
      .map(([tipo, cantidad]) => `${tipo}: ${cantidad}`)
      .join(' - ');
  }

  pintarReloj(container, run);
}

function pintarNumeros(container, contadores = {}) {
  const numeros = container.querySelector('#ra-numeros');
  if (!numeros) return;

  const porTipo = contadores.porTipo || {};
  // Las paginas no se cuentan aparte: son los eventos de visita que ya estan
  // contados por tipo.
  const paginas = (porTipo['pagina.visita'] || 0) + (porTipo['navegacion'] || 0);

  const partes = [`<strong>${contadores.total || 0}</strong> eventos`];
  if (paginas) partes.push(`<strong>${paginas}</strong> paginas`);
  if (contadores.descartados) partes.push(`${contadores.descartados} descartados por frecuencia`);
  numeros.innerHTML = partes.map((p) => `<span>${p}</span>`).join('');
}

function pintarReloj(container, run) {
  const reloj = container.querySelector('#ra-reloj');
  if (!reloj || !run) return;
  reloj.textContent = cronometro(duracionEfectiva(run));
}

function arrancarReloj(container) {
  reloj = setInterval(async () => {
    if (!vivo(container)) { limpiarSuscripciones(); return; }
    const run = await getRun();
    if (run?.active && !run.paused) pintarReloj(container, run);
  }, 1000);
}

/** Color del borde segun de que hable la linea. */
function familiaDe(tipo = '') {
  if (tipo.startsWith('navegacion') || tipo.startsWith('pestana')) return 'navega';
  if (tipo.startsWith('pagina')) return 'pagina';
  if (tipo.startsWith('sesion')) return 'sesion';
  return 'accion';
}

function itemDeFeed(entrada) {
  const titulo = entrada.detalle ? ` title="${escapeHtml(entrada.detalle)}"` : '';
  return `
    <li class="reg-feed-item reg-feed-item--${familiaDe(entrada.tipo)}"${titulo}>
      <span class="reg-feed-hora">${formatTime(entrada.ts)}</span>
      <span class="reg-feed-tipo">${escapeHtml(entrada.etiqueta || '')}</span>
      <span class="reg-feed-texto">${escapeHtml(entrada.resumen || '')}</span>
    </li>
  `;
}

const FEED_VACIO = '<li class="reg-feed-vacio">Todavia no se registro nada.</li>';

function pintarFeed(container, entradas) {
  const lista = container.querySelector('#ra-feed');
  if (!lista) return;

  if (!entradas.length) {
    lista.innerHTML = FEED_VACIO;
    return;
  }

  // Lo mas nuevo arriba: el usuario mira el popup para confirmar que se esta
  // grabando lo que acaba de hacer.
  lista.innerHTML = entradas.slice(-60).reverse().map(itemDeFeed).join('');
}

function vaciarFeed(container) {
  const lista = container.querySelector('#ra-feed');
  if (lista) lista.innerHTML = FEED_VACIO;
}

function pintarResultado(container, run) {
  const caja = container.querySelector('#ra-resultado');
  if (!caja) return;

  const exportacion = run?.exportacion;
  const hayAlgo = exportacion && exportacion.estado !== EXPORTACION.PENDIENTE && !run.active;
  caja.classList.toggle('hidden', !hayAlgo);
  if (!hayAlgo) return;

  const archivos = container.querySelector('#ra-archivos');
  if (!archivos) return;

  if (exportacion.estado === EXPORTACION.GENERANDO) {
    archivos.innerHTML = '<p class="ct-state"><span class="ct-spinner"></span> Generando los archivos...</p>';
    return;
  }

  const filas = (exportacion.partes || []).map((parte) => `
    <li class="lt-region lt-region--${parte.ok ? 'done' : 'error'}">
      <div class="lt-region-head">
        <span class="lt-region-name">${escapeHtml(parte.nombre)}</span>
        <span class="lt-region-status">${parte.ok ? formatBytes(parte.bytes) : escapeHtml(parte.error || 'error')}</span>
      </div>
    </li>
  `).join('');

  archivos.innerHTML = `
    <p class="lt-hint">Carpeta: <code>${escapeHtml(exportacion.carpeta || '')}</code> (dentro de Descargas)</p>
    <ul class="lt-region-list">${filas}</ul>
    ${exportacion.error ? `<p class="lt-err">${escapeHtml(exportacion.error)}</p>` : ''}
  `;
}

// -----------------------------------------------------------------------------
// Feed en vivo por port
// -----------------------------------------------------------------------------

function conectarPanel(container) {
  port = connectToBackground(PORTS.PANEL);
  if (!port) return;

  port.onMessage.addListener((mensaje) => {
    if (!vivo(container)) { limpiarSuscripciones(); return; }
    if (mensaje?.tipo !== 'estado') return;

    if (Array.isArray(mensaje.ultimos) && mensaje.ultimos.length) {
      pintarFeed(container, mensaje.ultimos);
    }

    if (mensaje.contadores) pintarNumeros(container, mensaje.contadores);
  });

  port.onDisconnect.addListener(() => {
    port = null;
    log.debug('panel desconectado del service worker');
  });
}
