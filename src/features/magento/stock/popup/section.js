// Vista de "Stock": encender/apagar, config, estado del portal, alertas
// recientes y la lista de productos (buscador, filtros, CSV).
//
// La vista solo REFLEJA: el trabajo corre en el service worker (alarmas) y
// sigue con el panel cerrado. La config se guarda sola al editar (debounce); el
// interruptor manda START/STOP al SW, que crea o borra las alarmas. Estado,
// alertas y foto los escribe solo el SW; aqui se piden cambios por mensaje.

import {
  API,
  DEFAULTS,
  ESTADO_LABEL,
  FILTROS,
  FOTO_VIEJA_MS,
  LIMITES,
  MESSAGES,
  TIPOS,
  TIPO_LABEL,
} from '../constants.js';
import {
  actualizarConfig,
  contarNoVistas,
  getAlertas,
  getConfig,
  getEstado,
  getFoto,
  noVistas,
  subscribe,
} from '../state.js';
import { contarPorFiltro, filtrarProductos, nombreCsv, productosACsv } from '../productos.js';
import { avisoPortal, instanteRevision, nombreDe, textoCambio } from '../notificaciones.js';
import { fechaHoraChile } from '../tiempo.js';
import { escapeHtml, formatClp } from '../../../../shared/ui/format.js';
import { debounce } from '../../../../shared/ui/persist.js';
import { requestDownload } from '../../../../shared/downloads/index.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('magento/stock');

const ALERTAS_VISIBLES = 20;

/** Para la tarjeta del modulo en el menu de Magento. */
export const contador = () => noVistas();

let desuscribir = null;

const FILTRO_LABEL = {
  [FILTROS.TODOS]: 'Todos',
  [FILTROS.EN_STOCK]: 'En stock',
  [FILTROS.PREVENTA]: 'Preventa',
  [FILTROS.AGOTADO]: 'Agotado',
  [FILTROS.POCO_STOCK]: 'Poco stock',
  [FILTROS.FUERA]: 'Fuera',
};

const ORIGEN_LABEL = { cron: 'automatica', manual: 'manual (portal)', api: 'pedida desde la extension' };

function enviar(mensaje) {
  return chrome.runtime.sendMessage(mensaje).then((res) => {
    if (!res?.ok) throw new Error(res?.reason || res?.error || 'El service worker no respondio.');
    return res;
  });
}

/** Solo enlaces http(s) (lo que venga del portal no se pinta como href sin revisar). */
function urlSegura(url) {
  return /^https?:\/\//i.test(String(url ?? '')) ? String(url) : null;
}

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

export async function render(container) {
  const [config, estado, alertas, foto] = await Promise.all([getConfig(), getEstado(), getAlertas(), getFoto()]);
  const vista = { config, estado, alertas, foto, filtro: FILTROS.TODOS, texto: '' };

  container.innerHTML = `
    <div class="lt-view stk-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Stock lg.com/cl</h3>
        <p class="lt-hint">El portal OBS revisa cada hora la tienda lg.com/cl (stock, nombre y precio de cada SKU).
          Esto te avisa con <strong>notificaciones de Windows</strong> cuando registra un producto que se quedo
          <strong>sin stock</strong>, que <strong>salio de la tienda</strong> o que entro en <strong>poco stock</strong>,
          y te da un resumen diario. Corre en segundo plano: no hace falta tener nada abierto.</p>

        <label class="dt-check">
          <input type="checkbox" id="stk-activo" ${config.activo ? 'checked' : ''}>
          <strong>Activo</strong>
        </label>

        <div class="dt-row">
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="stk-intervalo">Consultar cada (minutos)</label>
            <input type="number" id="stk-intervalo" class="dt-input" min="${LIMITES.intervaloMin.min}" max="${LIMITES.intervaloMin.max}" step="1" value="${escapeHtml(config.intervaloMin)}">
          </div>
          <div class="dt-field dt-field--half">
            <label class="dt-label" for="stk-hora">Resumen diario (hora Chile)</label>
            <input type="time" id="stk-hora" class="dt-input" value="${escapeHtml(config.horaResumen)}">
          </div>
        </div>
        <label class="dt-check">
          <input type="checkbox" id="stk-resumen" ${config.resumenActivo ? 'checked' : ''}>
          Notificacion de resumen una vez al dia
        </label>

        <div class="stk-tipos">
          <span class="dt-label">Avisar cuando un producto...</span>
          <div class="fsc-chips">
            ${[
    [TIPOS.SIN_STOCK, 'pasa a sin stock'],
    [TIPOS.FUERA_DE_TIENDA, 'sale de la tienda'],
    [TIPOS.POCO_STOCK, 'entra en poco stock'],
  ].map(([tipo, texto]) => `
              <label class="fsc-chip"><input type="checkbox" data-tipo="${tipo}" ${config.notificar[tipo] ? 'checked' : ''}><span>${escapeHtml(texto)}</span></label>`).join('')}
          </div>
        </div>
        <p class="lt-hint" id="stk-umbral"></p>

        <details class="ct-diag">
          <summary>Conexion</summary>
          <div class="dt-field">
            <label class="dt-label" for="stk-token">Token del portal</label>
            <input type="password" id="stk-token" class="dt-input" autocomplete="off" placeholder="por defecto: el de E-promoters" value="${escapeHtml(config.token)}">
            <p class="lt-hint">El MAGENTO_PA_TOKEN del portal. Vacio = el mismo que usa E-promoters.</p>
          </div>
          <div class="dt-field">
            <label class="dt-label" for="stk-endpoint">URL del portal</label>
            <input type="url" id="stk-endpoint" class="dt-input" placeholder="${escapeHtml(API.BASE_URL)}" value="${escapeHtml(config.endpoint)}">
          </div>
        </details>

        <div class="lt-actions">
          <button type="button" id="stk-revisar" class="ct-btn ct-btn--primary">Revisar ahora</button>
          <button type="button" id="stk-actualizar" class="ct-btn ct-btn--ghost">Actualizar</button>
          <button type="button" id="stk-probar" class="ct-btn ct-btn--ghost">Probar notificacion</button>
        </div>
        <p class="lt-hint" id="stk-guardado"></p>
      </section>

      <section class="lt-progress">
        <div class="lt-progress-head">
          <strong id="stk-titulo"></strong>
          <span id="stk-sub" class="dt-progress-counter"></span>
        </div>
        <div id="stk-aviso"></div>
        <ul id="stk-stats" class="epr-stat-grid"></ul>
      </section>

      <section class="lt-progress">
        <div class="lt-progress-head">
          <strong id="stk-alertas-titulo">Alertas recientes</strong>
          <button type="button" id="stk-vistas" class="fsc-link">Marcar vistas</button>
        </div>
        <ul id="stk-alertas" class="stk-alertas"></ul>
      </section>

      <section class="lt-progress">
        <div class="lt-progress-head">
          <strong id="stk-productos-titulo">Productos</strong>
          <button type="button" id="stk-csv" class="ct-btn ct-btn--ghost stk-btn-chico">Exportar CSV</button>
        </div>
        <input type="search" id="stk-buscar" class="dt-input" placeholder="Buscar por nombre, SKU o modelo" autocomplete="off">
        <div class="fsc-chips stk-filtros" id="stk-filtros"></div>
        <div class="bo-table-wrap stk-tabla-wrap" id="stk-tabla"></div>
      </section>
    </div>
  `;

  enlazar(container, vista);
  pintarTodo(container, vista);

  // Sin foto, o vieja: se pide una al abrir (no bloquea la vista).
  const consultada = vista.foto?.consultadaEn || 0;
  if (!vista.foto || Date.now() - consultada > FOTO_VIEJA_MS) {
    enviar({ type: MESSAGES.CONSULTAR }).catch((err) => log.debug('consulta al abrir', toMessage(err)));
  }

  if (desuscribir) desuscribir();
  desuscribir = subscribe((cambios) => {
    if (!container.isConnected) { desuscribir?.(); desuscribir = null; return; }
    if (cambios.config) {
      vista.config = cambios.config;
      const activo = container.querySelector('#stk-activo');
      if (activo) activo.checked = cambios.config.activo;
    }
    if (cambios.estado) vista.estado = cambios.estado;
    if (cambios.alertas) vista.alertas = cambios.alertas;
    if (cambios.foto !== undefined) vista.foto = cambios.foto;
    if (cambios.config || cambios.estado || cambios.foto !== undefined) pintarEstado(container, vista);
    if (cambios.alertas) pintarAlertas(container, vista);
    if (cambios.foto !== undefined) pintarProductos(container, vista);
  });
}

function pintarTodo(container, vista) {
  pintarEstado(container, vista);
  pintarAlertas(container, vista);
  pintarProductos(container, vista);
}

// -----------------------------------------------------------------------------
// Eventos
// -----------------------------------------------------------------------------

function leerConfig(container) {
  const notificar = {};
  container.querySelectorAll('[data-tipo]').forEach((el) => { notificar[el.dataset.tipo] = el.checked; });
  return {
    intervaloMin: Number(container.querySelector('#stk-intervalo')?.value),
    horaResumen: container.querySelector('#stk-hora')?.value || DEFAULTS.horaResumen,
    resumenActivo: Boolean(container.querySelector('#stk-resumen')?.checked),
    notificar,
    token: container.querySelector('#stk-token')?.value ?? '',
    endpoint: container.querySelector('#stk-endpoint')?.value ?? '',
  };
}

async function conBoton(boton, etiqueta, fn) {
  const texto = boton.textContent;
  boton.disabled = true;
  if (etiqueta) boton.textContent = etiqueta;
  try {
    return await fn();
  } finally {
    boton.disabled = false;
    boton.textContent = texto;
  }
}

function enlazar(container, vista) {
  const guardado = container.querySelector('#stk-guardado');

  const guardar = debounce(async () => {
    try {
      await actualizarConfig(leerConfig(container));
      guardado.textContent = 'Config guardada.';
    } catch (err) {
      guardado.textContent = `No se pudo guardar: ${toMessage(err)}`;
    }
  }, 400);
  container.querySelectorAll('#stk-intervalo, #stk-hora, #stk-resumen, #stk-token, #stk-endpoint, [data-tipo]')
    .forEach((el) => {
      el.addEventListener('input', guardar);
      el.addEventListener('change', guardar);
    });

  container.querySelector('#stk-activo').addEventListener('change', async (e) => {
    const activo = e.target.checked;
    guardar.cancel?.();
    try {
      await enviar(activo ? { type: MESSAGES.START, config: leerConfig(container) } : { type: MESSAGES.STOP });
      guardado.textContent = activo ? 'Activo: se avisara de las alertas nuevas desde ahora.' : 'Apagado.';
      log.info(activo ? 'activado' : 'desactivado');
    } catch (err) {
      e.target.checked = !activo;
      guardado.textContent = `No se pudo ${activo ? 'activar' : 'desactivar'}: ${toMessage(err)}`;
    }
  });

  container.querySelector('#stk-revisar').addEventListener('click', (e) => conBoton(e.currentTarget, 'Revisando...', async () => {
    guardado.textContent = 'El portal esta revisando la tienda (tarda 20-40 s)...';
    try {
      const r = await enviar({ type: MESSAGES.REVISAR });
      guardado.textContent = `Revision lista: ${r.revision?.alertas ?? 0} alertas en la revision, ${r.notificadas ?? 0} notificadas.`;
    } catch (err) {
      guardado.textContent = toMessage(err);
    }
  }));

  container.querySelector('#stk-actualizar').addEventListener('click', (e) => conBoton(e.currentTarget, 'Actualizando...', async () => {
    try {
      await enviar({ type: MESSAGES.CONSULTAR });
      guardado.textContent = 'Datos actualizados desde el portal.';
    } catch (err) {
      guardado.textContent = toMessage(err);
    }
  }));

  container.querySelector('#stk-probar').addEventListener('click', (e) => conBoton(e.currentTarget, null, async () => {
    try {
      const r = await enviar({ type: MESSAGES.PROBAR_NOTIFICACION });
      guardado.textContent = r.permiso === 'denied'
        ? 'La extension tiene las notificaciones bloqueadas en el navegador.'
        : 'Notificacion enviada. Si no aparece, revisa en Windows (Configuracion > Sistema > Notificaciones) que el navegador las tenga permitidas y que No molestar este apagado.';
    } catch (err) {
      guardado.textContent = toMessage(err);
    }
  }));

  container.querySelector('#stk-vistas').addEventListener('click', async () => {
    try {
      await enviar({ type: MESSAGES.MARCAR_VISTAS });
    } catch (err) {
      guardado.textContent = toMessage(err);
    }
  });

  const buscar = debounce(() => {
    vista.texto = container.querySelector('#stk-buscar').value;
    pintarProductos(container, vista);
  }, 150);
  container.querySelector('#stk-buscar').addEventListener('input', buscar);

  container.querySelector('#stk-filtros').addEventListener('change', (e) => {
    if (e.target?.name !== 'stk-filtro') return;
    vista.filtro = e.target.value;
    pintarProductos(container, vista);
  });

  container.querySelector('#stk-csv').addEventListener('click', (e) => conBoton(e.currentTarget, null, async () => {
    const lista = filtrarProductos(vista.foto?.productos, { filtro: vista.filtro, texto: vista.texto });
    if (!lista.length) {
      guardado.textContent = 'No hay productos que exportar con ese filtro.';
      return;
    }
    const r = await requestDownload({
      filename: nombreCsv(Date.now(), vista.filtro),
      text: productosACsv(lista),
      mime: 'text/csv;charset=utf-8',
    });
    guardado.textContent = r.ok ? `CSV con ${lista.length} productos descargado.` : `No se pudo bajar el CSV: ${r.error}`;
  }));
}

// -----------------------------------------------------------------------------
// Pintado
// -----------------------------------------------------------------------------

function textoRevision(revision) {
  if (!revision) return '—';
  const cuando = fechaHoraChile(instanteRevision(revision));
  const estado = revision.estado === 'ok' ? 'ok' : 'con error';
  const origen = ORIGEN_LABEL[revision.origen] || revision.origen || '';
  return `${cuando} · ${estado}${origen ? ` · ${origen}` : ''}`;
}

function pintarEstado(container, vista) {
  const { config, estado, foto } = vista;
  const titulo = container.querySelector('#stk-titulo');
  if (!titulo) return;
  const sub = container.querySelector('#stk-sub');
  const aviso = container.querySelector('#stk-aviso');
  const stats = container.querySelector('#stk-stats');
  const revisar = container.querySelector('#stk-revisar');
  const umbral = container.querySelector('#stk-umbral');

  if (estado.revisando) titulo.innerHTML = '<span class="ct-spinner ct-spinner--inline"></span> El portal esta revisando la tienda...';
  else if (estado.consultando || estado.sondeando) titulo.innerHTML = '<span class="ct-spinner ct-spinner--inline"></span> Consultando el portal...';
  else if (!config.activo) titulo.textContent = 'Apagado (no avisa)';
  else if (estado.error) titulo.textContent = 'Activo — la ultima consulta fallo';
  else titulo.textContent = 'Activo — avisando alertas nuevas';
  sub.textContent = config.activo && estado.notificadas ? `${estado.notificadas} notificadas` : '';
  if (revisar) {
    revisar.disabled = Boolean(estado.revisando);
    if (estado.revisando) revisar.textContent = 'Revisando...';
    else revisar.textContent = 'Revisar ahora';
  }

  const n = foto?.umbral ?? 2;
  umbral.textContent = `"Poco stock" = quedan ${n} o menos. El umbral lo pone Magento (${n}): el sitio publico solo deja ver cantidades de 1 o 2, asi que no hay un umbral propio que elegir.`;

  const avisos = [];
  if (estado.error) avisos.push(`<p class="oi-alert oi-alert--error">${escapeHtml(estado.error)}</p>`);
  const atraso = avisoPortal(foto);
  if (atraso) avisos.push(`<p class="oi-alert oi-alert--warning">${escapeHtml(atraso)}</p>`);
  if (foto?.revision?.estado === 'error' || foto?.revision?.mensaje) {
    if (!atraso && foto.revision.mensaje) avisos.push(`<p class="oi-alert oi-alert--info">Portal: ${escapeHtml(foto.revision.mensaje)}</p>`);
  }
  aviso.innerHTML = avisos.join('');

  const r = foto?.resumen || {};
  const manual = estado.ultimaRevisionManual;
  const filas = [
    ['Ultima consulta', fechaHoraChile(foto?.consultadaEn)],
    ['Ultima revision del portal', textoRevision(foto?.revision || estado.revision)],
    ['Ultima revision ok', fechaHoraChile(instanteRevision(foto?.ultima_ok))],
    ['Productos', r.total ?? 0],
    ['En stock / preventa', `${r.en_stock ?? 0} / ${r.preventa ?? 0}`],
    ['Agotados', r.agotado ?? 0],
    ['Poco stock', r.poco_stock ?? 0],
    ['Fuera de la tienda', r.fuera ?? 0],
    ['Ultimo sondeo de alertas', fechaHoraChile(estado.ultimoSondeo)],
    ['Proximo resumen', config.activo && config.resumenActivo ? fechaHoraChile(estado.proximoResumen) : 'apagado'],
  ];
  if (manual) {
    filas.push(['Ultimo "Revisar ahora"', manual.ok
      ? `${fechaHoraChile(manual.ts)} · ${manual.alertas} alertas`
      : `${fechaHoraChile(manual.ts)} · fallo`]);
  }
  stats.innerHTML = filas
    .map(([etiqueta, valor]) => `<li><span>${escapeHtml(etiqueta)}</span><strong>${escapeHtml(valor)}</strong></li>`)
    .join('');
}

function itemAlerta(a) {
  const url = urlSegura(a.url);
  const quedan = a.tipo === TIPOS.POCO_STOCK && a.quedan != null ? ` · quedan ${a.quedan}` : '';
  const precio = a.precio_final != null ? ` · $${formatClp(a.precio_final)}` : '';
  return `
    <li class="stk-alerta${a.visto ? '' : ' stk-alerta--nueva'}">
      <div class="stk-alerta-cab">
        <span class="stk-chip stk-chip--${escapeHtml(a.tipo)}">${escapeHtml(TIPO_LABEL[a.tipo] || a.tipo)}</span>
        <span class="stk-alerta-hora">${escapeHtml(fechaHoraChile(a.creada_en))}</span>
      </div>
      <div class="stk-alerta-nombre">${escapeHtml(nombreDe(a))}</div>
      <div class="stk-alerta-det">SKU ${escapeHtml(a.sku || '—')} · ${escapeHtml(textoCambio(a))}${escapeHtml(quedan)}${escapeHtml(precio)}
        ${url ? ` · <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Ver ficha</a>` : ''}</div>
    </li>`;
}

function pintarAlertas(container, vista) {
  const lista = container.querySelector('#stk-alertas');
  if (!lista) return;
  const alertas = Array.isArray(vista.alertas) ? vista.alertas : [];
  const nuevas = contarNoVistas(alertas);
  container.querySelector('#stk-alertas-titulo').textContent = nuevas
    ? `Alertas recientes (${nuevas} sin ver)`
    : `Alertas recientes (${alertas.length})`;
  container.querySelector('#stk-vistas').hidden = !nuevas;
  if (!alertas.length) {
    lista.innerHTML = `<li class="lt-hint">${vista.config.activo
      ? 'Sin alertas todavia. Las que registre el portal desde que se activo apareceran aqui.'
      : 'Activalo para recibir las alertas del portal.'}</li>`;
    return;
  }
  const visibles = alertas.slice(0, ALERTAS_VISIBLES).map(itemAlerta).join('');
  const resto = alertas.slice(ALERTAS_VISIBLES);
  lista.innerHTML = visibles + (resto.length
    ? `<li><details><summary class="lt-hint">Ver ${resto.length} mas</summary><ul class="stk-alertas">${resto.map(itemAlerta).join('')}</ul></details></li>`
    : '');
}

function pintarProductos(container, vista) {
  const tabla = container.querySelector('#stk-tabla');
  if (!tabla) return;
  const productos = vista.foto?.productos || [];
  const conteo = contarPorFiltro(productos);
  container.querySelector('#stk-filtros').innerHTML = Object.values(FILTROS).map((f) => `
    <label class="fsc-chip"><input type="radio" name="stk-filtro" value="${f}" ${vista.filtro === f ? 'checked' : ''}><span>${escapeHtml(FILTRO_LABEL[f])} (${conteo[f] ?? 0})</span></label>`).join('');

  const lista = filtrarProductos(productos, { filtro: vista.filtro, texto: vista.texto });
  container.querySelector('#stk-productos-titulo').textContent = productos.length
    ? `Productos (${lista.length} de ${productos.length})`
    : 'Productos';
  container.querySelector('#stk-csv').disabled = !lista.length;

  if (!productos.length) {
    tabla.innerHTML = `<p class="ct-empty">${vista.foto ? 'El portal no devolvio productos.' : 'Sin datos del portal todavia: pulsa Actualizar.'}</p>`;
    return;
  }
  if (!lista.length) {
    tabla.innerHTML = '<p class="ct-empty">Ningun producto calza con la busqueda.</p>';
    return;
  }
  tabla.innerHTML = `
    <table class="bo-table stk-tabla">
      <thead><tr><th>Estado</th><th>Producto</th><th>Quedan</th><th>Precio</th></tr></thead>
      <tbody>${lista.map((p) => {
    const url = urlSegura(p.url);
    const nombre = escapeHtml(p.nombre || p.modelo || p.sku || '—');
    return `<tr>
          <td><span class="stk-chip stk-chip--${escapeHtml(p.estado)}">${escapeHtml(ESTADO_LABEL[p.estado] || p.estado || '—')}</span></td>
          <td class="stk-col-nombre">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${nombre}</a>` : nombre}
            <small>${escapeHtml(p.sku || '')}</small></td>
          <td class="stk-num${p.poco_stock ? ' stk-poco' : ''}">${p.quedan != null ? escapeHtml(p.quedan) : '—'}</td>
          <td class="stk-num">${p.precio_final != null ? `$${escapeHtml(formatClp(p.precio_final))}` : '—'}</td>
        </tr>`;
  }).join('')}</tbody>
    </table>`;
}
