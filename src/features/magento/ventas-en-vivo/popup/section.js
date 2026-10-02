// Vista de "Ventas en vivo": encender/apagar, config y estado en vivo.
//
// La vista solo REFLEJA: el trabajo corre en el service worker (alarma) y sigue
// con el panel cerrado. La config se guarda sola al editar (debounce); el
// interruptor manda START/STOP al SW, que es quien crea o borra la alarma.

import { API, DEFAULTS, LIMITES, MESSAGES, RANGO, RESULTADO, STORE_ID, VIA } from '../constants.js';
import { actualizarConfig, getConfig, getEstado, getHistorial, subscribe } from '../state.js';
import { escapeHtml } from '../../popup/utils.js';
import { debounce } from '../../../../shared/ui/persist.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('magento/ventas-en-vivo');

const HISTORIAL_VISIBLE = 10;

let desuscribir = null;

// Campos de la config: id del input -> clave de la config. `escala` = el input
// va en otra unidad (segundos en pantalla, ms en la config); `check` = casilla.
const CAMPOS = [
  { id: 'vev-intervalo', key: 'intervaloMin' },
  { id: 'vev-dias-cortos', key: 'diasCortos' },
  { id: 'vev-dias-largos', key: 'diasLargos' },
  { id: 'vev-cada-n', key: 'cadaNTicksLargo' },
  { id: 'vev-store-id', key: 'storeId' },
  { id: 'vev-espera-max', key: 'esperaArchivoMaxMs', escala: 1000 },
  { id: 'vev-borrar', key: 'borrarArchivo', check: true },
  { id: 'vev-token', key: 'token' },
  { id: 'vev-endpoint', key: 'endpoint' },
  { id: 'vev-admin-base', key: 'adminBase' },
];

// Limites del input de espera, en segundos.
const LIMITE_ESPERA_S = {
  min: LIMITES.esperaArchivoMaxMs.min / 1000,
  max: LIMITES.esperaArchivoMaxMs.max / 1000,
};

/** Lo que hay en los inputs, ya en las unidades de la config. */
function leerCampos(container) {
  const cambio = {};
  for (const { id, key, escala, check } of CAMPOS) {
    const el = container.querySelector(`#${id}`);
    if (!el) continue;
    if (check) cambio[key] = el.checked;
    else if (escala) cambio[key] = Number(el.value) * escala;
    else cambio[key] = el.value ?? '';
  }
  return cambio;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function fechaHora(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function textoRango(rango) {
  if (!rango) return '—';
  return `${rango.from} a ${rango.to}${rango.tipo === RANGO.LARGO ? ' (repaso)' : ''}`;
}

function textoVia(via) {
  if (via === VIA.TAB) return 'pestana del admin';
  if (via === VIA.SW) return 'segundo plano';
  return '—';
}

function textoArchivo(estado) {
  const nombre = estado?.archivo?.nombre;
  if (!nombre) return '—';
  if (estado.archivoBorrado === true) return `${nombre} (borrado)`;
  if (estado.archivoBorrado === false) return `${nombre} (no se pudo borrar)`;
  return nombre;
}

function numero(id, limites, valor) {
  return `<input type="number" id="${id}" class="dt-input" min="${limites.min}" max="${limites.max}" step="1" value="${escapeHtml(valor)}">`;
}

export async function render(container) {
  const [config, estado, historial] = await Promise.all([getConfig(), getEstado(), getHistorial()]);

  container.innerHTML = `
    <div class="lt-view vev-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Ventas en vivo</h3>
        <p class="lt-hint">Cada pocos minutos pide al admin de Magento el <strong>export CSV del grid de ordenes</strong>
          (el mismo boton Export &rarr; CSV) de los ultimos dias y lo manda al portal OBS, para que el panel
          <strong>En vivo</strong> de Ventas muestre las ordenes de lg.com/cl casi al momento. Corre en segundo plano
          con tu sesion del admin: no hace falta tener la pestana abierta mientras la sesion siga viva.</p>

        <label class="dt-check">
          <input type="checkbox" id="vev-activo" ${config.activo ? 'checked' : ''}>
          <strong>Activo</strong>
        </label>

        <div class="dt-row">
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="vev-intervalo">Cada (minutos)</label>
            ${numero('vev-intervalo', LIMITES.intervaloMin, config.intervaloMin)}
          </div>
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="vev-dias-cortos">Dias por envio</label>
            ${numero('vev-dias-cortos', LIMITES.diasCortos, config.diasCortos)}
          </div>
        </div>
        <div class="dt-row">
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="vev-dias-largos">Dias del repaso</label>
            ${numero('vev-dias-largos', LIMITES.diasLargos, config.diasLargos)}
          </div>
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="vev-cada-n">Repaso cada (envios)</label>
            ${numero('vev-cada-n', LIMITES.cadaNTicksLargo, config.cadaNTicksLargo)}
          </div>
        </div>
        <p class="lt-hint">Cada envio cubre hoy y los dias anteriores que indiques (hora de Chile). El primero, y uno de
          cada N, es un repaso mas largo que recoge los cambios de estado de ordenes viejas.</p>

        <div class="dt-row">
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="vev-store-id">Store ID</label>
            <input type="text" id="vev-store-id" class="dt-input" placeholder="${escapeHtml(STORE_ID)}" value="${escapeHtml(config.storeId)}">
          </div>
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="vev-espera-max">Espera del archivo (s)</label>
            ${numero('vev-espera-max', LIMITE_ESPERA_S, Math.round(config.esperaArchivoMaxMs / 1000))}
          </div>
        </div>
        <label class="dt-check">
          <input type="checkbox" id="vev-borrar" ${config.borrarArchivo ? 'checked' : ''}>
          Borrar el archivo del admin tras enviarlo
        </label>
        <p class="lt-hint">El export del admin es asincrono: se encola, el archivo aparece en <em>Export Files Listing</em>
          en unos segundos y de ahi se baja. El Store ID es obligatorio (sin el, el admin responde 500; ${escapeHtml(STORE_ID)} = Chile).
          La espera es el tope para que aparezca el archivo.</p>

        <details class="ct-diag">
          <summary>Conexion</summary>
          <div class="dt-field">
            <label class="dt-label" for="vev-token">Token del portal</label>
            <input type="password" id="vev-token" class="dt-input" autocomplete="off" placeholder="por defecto: el de E-promoters" value="${escapeHtml(config.token)}">
            <p class="lt-hint">El MAGENTO_PA_TOKEN del portal. Vacio = el mismo que usa E-promoters.</p>
          </div>
          <div class="dt-field">
            <label class="dt-label" for="vev-endpoint">URL del portal</label>
            <input type="url" id="vev-endpoint" class="dt-input" placeholder="${escapeHtml(API.BASE_URL)}" value="${escapeHtml(config.endpoint)}">
          </div>
          <div class="dt-field">
            <label class="dt-label" for="vev-admin-base">Admin de Magento</label>
            <input type="url" id="vev-admin-base" class="dt-input" placeholder="${escapeHtml(DEFAULTS.adminBase)}" value="${escapeHtml(config.adminBase)}">
          </div>
        </details>

        <div class="lt-actions">
          <button type="button" id="vev-ahora" class="ct-btn ct-btn--primary">Enviar ahora</button>
        </div>
        <p class="lt-hint" id="vev-guardado"></p>
      </section>

      <section class="lt-progress">
        <div class="lt-progress-head">
          <strong id="vev-titulo"></strong>
          <span id="vev-via" class="dt-progress-counter"></span>
        </div>
        <div id="vev-aviso"></div>
        <ul id="vev-stats" class="epr-stat-grid"></ul>
        <details class="ct-diag lt-log-details" id="vev-historial-box">
          <summary id="vev-historial-titulo">Historial</summary>
          <ul id="vev-historial" class="lt-log"></ul>
        </details>
      </section>
    </div>
  `;

  enlazar(container);
  pintarEstado(container, estado, config);
  pintarHistorial(container, historial);

  if (desuscribir) desuscribir();
  let ultimaConfig = config;
  let ultimoEstado = estado;
  desuscribir = subscribe((cambios) => {
    if (!container.isConnected) { desuscribir?.(); desuscribir = null; return; }
    if (cambios.config) {
      ultimaConfig = cambios.config;
      const activo = container.querySelector('#vev-activo');
      if (activo) activo.checked = cambios.config.activo;
    }
    if (cambios.estado) ultimoEstado = cambios.estado;
    if (cambios.config || cambios.estado) pintarEstado(container, ultimoEstado, ultimaConfig);
    if (cambios.historial) pintarHistorial(container, cambios.historial);
  });
}

function enlazar(container) {
  const guardado = container.querySelector('#vev-guardado');

  const guardar = debounce(async () => {
    const cambio = leerCampos(container);
    try {
      await actualizarConfig(cambio);
      guardado.textContent = 'Config guardada.';
    } catch (err) {
      guardado.textContent = `No se pudo guardar: ${toMessage(err)}`;
    }
  }, 400);
  for (const { id } of CAMPOS) {
    const el = container.querySelector(`#${id}`);
    el?.addEventListener('input', guardar);
    el?.addEventListener('change', guardar);
  }

  container.querySelector('#vev-activo').addEventListener('change', async (e) => {
    const activo = e.target.checked;
    guardar.cancel?.();
    const cambio = leerCampos(container);
    try {
      const res = await chrome.runtime.sendMessage(activo
        ? { type: MESSAGES.START, config: cambio }
        : { type: MESSAGES.STOP });
      if (!res?.ok) throw new Error(res?.reason || 'El service worker no respondio.');
      log.info(activo ? 'activado' : 'desactivado');
    } catch (err) {
      e.target.checked = !activo;
      guardado.textContent = `No se pudo ${activo ? 'activar' : 'desactivar'}: ${toMessage(err)}`;
    }
  });

  container.querySelector('#vev-ahora').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    boton.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: MESSAGES.TICK_NOW });
      if (!res?.ok) throw new Error(res?.reason || 'El service worker no respondio.');
    } catch (err) {
      guardado.textContent = `No se pudo enviar: ${toMessage(err)}`;
    } finally {
      boton.disabled = false;
    }
  });
}

function pintarEstado(container, estado, config) {
  const titulo = container.querySelector('#vev-titulo');
  const via = container.querySelector('#vev-via');
  const aviso = container.querySelector('#vev-aviso');
  const stats = container.querySelector('#vev-stats');
  const ahora = container.querySelector('#vev-ahora');
  if (!titulo) return;

  if (estado.enCurso) {
    titulo.innerHTML = '<span class="ct-spinner ct-spinner--inline"></span> Enviando...';
  } else if (!estado.ultimaCorrida) {
    titulo.textContent = config.activo ? 'Activo, esperando el primer envio' : 'Apagado';
  } else if (estado.resultado === RESULTADO.OK) {
    titulo.textContent = config.activo ? 'Activo — ultimo envio OK' : 'Apagado — ultimo envio OK';
  } else {
    titulo.textContent = config.activo ? 'Activo — el ultimo envio fallo' : 'Apagado — el ultimo envio fallo';
  }
  via.textContent = estado.via ? `via ${textoVia(estado.via)}` : '';
  if (ahora) ahora.disabled = Boolean(estado.enCurso);

  if (estado.sesionCaducada) {
    aviso.innerHTML = '<p class="oi-alert oi-alert--warning">Sesion del admin caducada: abre el admin de Magento e inicia sesion. Con una pestana del admin abierta tambien se puede enviar desde ahi.</p>';
  } else if (estado.error && estado.resultado !== RESULTADO.OK) {
    aviso.innerHTML = `<p class="oi-alert oi-alert--error">${escapeHtml(estado.error)}</p>`;
  } else {
    aviso.innerHTML = '';
  }

  const filas = [
    ['Ultima corrida', fechaHora(estado.ultimaCorrida)],
    ['Ultimo envio OK', fechaHora(estado.ultimoOk)],
    ['Rango', textoRango(estado.rango)],
    ['Filas enviadas', estado.filasEnviadas ?? 0],
    ['Creadas / actualizadas', `${estado.creadas ?? 0} / ${estado.actualizadas ?? 0}`],
    ['Omitidas', estado.omitidas ?? 0],
    ['Datos del portal hasta', estado.hasta ? String(estado.hasta).slice(0, 16) : '—'],
    ['Ultimo archivo', textoArchivo(estado)],
    ['Fallos seguidos', estado.fallosSeguidos ?? 0],
  ];
  stats.innerHTML = filas
    .map(([etiqueta, valor]) => `<li><span>${escapeHtml(etiqueta)}</span><strong>${escapeHtml(valor)}</strong></li>`)
    .join('');
}

function lineaHistorial(e) {
  const hora = fechaHora(e.ts);
  if (e.resultado === RESULTADO.OK) {
    const detalle = e.sinFilas
      ? 'sin ordenes en el rango (no se envio)'
      : `${e.filas ?? 0} filas -> ${e.creadas ?? 0} creadas, ${e.actualizadas ?? 0} actualizadas`;
    const borrado = e.borrado === false ? ` · no se pudo borrar el archivo${e.errorBorrado ? `: ${e.errorBorrado}` : ''}` : '';
    return {
      nivel: e.borrado === false ? 'warn' : 'info',
      hora,
      texto: `OK ${textoRango(e.rango)} · ${detalle} · ${textoVia(e.via)}${e.archivo ? ` · ${e.archivo}` : ''}${borrado}`,
    };
  }
  if (e.resultado === RESULTADO.SESION_CADUCADA) {
    return { nivel: 'warn', hora, texto: 'Sesion del admin caducada' };
  }
  return { nivel: 'error', hora, texto: `${e.error || 'Error'}${e.status ? ` (HTTP ${e.status})` : ''}` };
}

function pintarHistorial(container, historial) {
  const lista = container.querySelector('#vev-historial');
  const tituloEl = container.querySelector('#vev-historial-titulo');
  if (!lista) return;
  const entradas = Array.isArray(historial) ? historial : [];
  tituloEl.textContent = `Historial (${entradas.length})`;
  const item = (e) => {
    const { nivel, hora, texto } = lineaHistorial(e);
    return `<li class="lt-log-item lt-log-item--${nivel}"><span class="lt-log-time">${escapeHtml(hora)}</span><span class="lt-log-msg">${escapeHtml(texto)}</span></li>`;
  };
  const visibles = entradas.slice(0, HISTORIAL_VISIBLE).map(item).join('');
  const resto = entradas.slice(HISTORIAL_VISIBLE);
  lista.innerHTML = visibles + (resto.length
    ? `<li><details><summary class="lt-hint">Ver ${resto.length} mas</summary><ul class="lt-log">${resto.map(item).join('')}</ul></details></li>`
    : '');
}
