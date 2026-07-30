// Pestana "Registro" del apartado Devoluciones.
//
// El paso a paso de la gestion, junto en un sitio. Hace falta porque el flujo
// corre repartido entre el popup, el service worker y el content script de cada
// frame del portal: sin esto, para saber por que algo se quedo a medias habria
// que abrir tres consolas de DevTools distintas y llegar a tiempo.
//
// Solo se graba con el **Modo Dev** activo, y el interruptor esta aqui mismo
// para no tener que ir a Ajustes.

import { limpiarTrazas, subscribeTrazas, getTrazas } from '../trace.js';
import { escapeHtml } from './utils.js';
import { isDevMode, setDevMode, subscribeDevMode, whenDevModeReady } from '../../../shared/dev-mode/index.js';

const NIVELES = ['debug', 'info', 'warn', 'error'];

/** Filtros y orden de la vista (viven mientras el popup este abierto). */
const ui = {
  texto: '',
  nivel: '',
  ambito: '',
  contexto: '',
  recientesPrimero: true,
};

let unsubTrazas = null;
let unsubDev = null;

export async function render(container) {
  if (unsubTrazas) { try { unsubTrazas(); } catch { /* no-op */ } unsubTrazas = null; }
  if (unsubDev) { try { unsubDev(); } catch { /* no-op */ } unsubDev = null; }

  await whenDevModeReady();

  container.innerHTML = `
    <div class="lt-view devo-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Registro de la gestion</h3>

        <p class="lt-hint">
          Paso a paso de lo que hace la extension en el portal: que pantalla encontro,
          con que selector, que escribio y que respondio la tabla. Se graba
          <strong>solo con el Modo Dev activo</strong>.
        </p>

        <label class="devo-prueba">
          <input type="checkbox" id="devo-reg-dev" ${isDevMode() ? 'checked' : ''}>
          <span>
            <strong>Modo Dev</strong> — graba el registro (y sube el detalle de los logs
            de toda la extension). Deja de grabar al apagarlo.
          </span>
        </label>

        <div id="devo-reg-aviso"></div>

        <div class="devo-reg-filtros">
          <input type="search" id="devo-reg-texto" class="dt-input"
                 placeholder="Filtrar por texto (orden, selector, mensaje…)" value="${escapeHtml(ui.texto)}">

          <select id="devo-reg-nivel" class="dt-input">
            <option value="">Todos los niveles</option>
            ${NIVELES.map((n) => `<option value="${n}" ${ui.nivel === n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>

          <select id="devo-reg-ambito" class="dt-input"></select>
          <select id="devo-reg-contexto" class="dt-input"></select>
        </div>

        <div class="lt-actions">
          <button type="button" id="devo-reg-orden" class="ct-btn ct-btn--ghost"></button>
          <button type="button" id="devo-reg-copiar" class="ct-btn ct-btn--ghost">Copiar</button>
          <button type="button" id="devo-reg-limpiar" class="ct-btn ct-btn--ghost">Limpiar</button>
        </div>

        <p class="lt-hint" id="devo-reg-conteo"></p>
      </section>

      <ul id="devo-reg-lista" class="devo-reg-lista"></ul>
    </div>
  `;

  wireEvents(container);
  pintar(container, getTrazas());

  unsubTrazas = subscribeTrazas((trazas) => pintar(container, trazas));
  unsubDev = subscribeDevMode(() => {
    const check = container.querySelector('#devo-reg-dev');
    if (check) check.checked = isDevMode();
    pintarAviso(container);
  });
}

function wireEvents(container) {
  container.querySelector('#devo-reg-dev')?.addEventListener('change', async (e) => {
    await setDevMode(e.target.checked);
    pintarAviso(container);
  });

  container.querySelector('#devo-reg-texto')?.addEventListener('input', (e) => {
    ui.texto = e.target.value;
    pintar(container, getTrazas());
  });

  for (const [id, campo] of [['#devo-reg-nivel', 'nivel'], ['#devo-reg-ambito', 'ambito'], ['#devo-reg-contexto', 'contexto']]) {
    container.querySelector(id)?.addEventListener('change', (e) => {
      ui[campo] = e.target.value;
      pintar(container, getTrazas());
    });
  }

  container.querySelector('#devo-reg-orden')?.addEventListener('click', () => {
    ui.recientesPrimero = !ui.recientesPrimero;
    pintar(container, getTrazas());
  });

  container.querySelector('#devo-reg-limpiar')?.addEventListener('click', () => {
    if (!confirm('¿Vaciar el registro?')) return;
    limpiarTrazas();
  });

  container.querySelector('#devo-reg-copiar')?.addEventListener('click', () => {
    const texto = filtrar(getTrazas()).map(comoTexto).join('\n');

    navigator.clipboard.writeText(texto).then(() => {
      const btn = container.querySelector('#devo-reg-copiar');
      if (!btn) return;
      btn.textContent = 'Copiado';
      setTimeout(() => { btn.textContent = 'Copiar'; }, 1500);
    }).catch(() => alert('No se pudo copiar al portapapeles.'));
  });
}

function pintarAviso(container) {
  const caja = container.querySelector('#devo-reg-aviso');
  if (!caja) return;

  caja.innerHTML = isDevMode()
    ? ''
    : `<p class="scf-error-line">
         El Modo Dev esta apagado: no se esta grabando nada. Enciendelo y vuelve a
         lanzar la gestion para capturar el detalle.
       </p>`;
}

/** Aplica los filtros de la vista. */
function filtrar(trazas) {
  const texto = ui.texto.trim().toLowerCase();

  return trazas.filter((t) => {
    if (ui.nivel && t.nivel !== ui.nivel) return false;
    if (ui.ambito && t.ambito !== ui.ambito) return false;
    if (ui.contexto && t.contexto !== ui.contexto) return false;

    if (!texto) return true;

    return comoTexto(t).toLowerCase().includes(texto);
  });
}

function hora(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/** Una linea de texto plano (para el filtro por texto y para "Copiar"). */
function comoTexto(t) {
  const datos = t.datos ? ` ${JSON.stringify(t.datos)}` : '';
  const donde = t.frame === 'iframe' ? ' [iframe]' : '';

  return `${hora(t.ts)} [${t.nivel}] ${t.contexto}/${t.ambito}${donde} ${t.evento}${datos}`;
}

/** Rellena un <select> conservando lo elegido. */
function opciones(select, valores, elegido, etiquetaTodos) {
  if (!select) return;

  select.innerHTML = `<option value="">${etiquetaTodos}</option>`
    + valores.map((v) => `<option value="${escapeHtml(v)}" ${v === elegido ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

function pintar(container, trazas) {
  const lista = container.querySelector('#devo-reg-lista');
  if (!lista) return;

  pintarAviso(container);

  // Los desplegables se arman con lo que hay: no tiene sentido ofrecer un
  // ambito del que no se ha grabado nada.
  opciones(container.querySelector('#devo-reg-ambito'), [...new Set(trazas.map((t) => t.ambito))].sort(), ui.ambito, 'Todo el flujo');
  opciones(container.querySelector('#devo-reg-contexto'), [...new Set(trazas.map((t) => t.contexto))].sort(), ui.contexto, 'Todos los contextos');

  const btnOrden = container.querySelector('#devo-reg-orden');
  if (btnOrden) btnOrden.textContent = ui.recientesPrimero ? 'Recientes primero ↓' : 'Antiguas primero ↑';

  const filtradas = filtrar(trazas);
  const ordenadas = ui.recientesPrimero ? filtradas.slice().reverse() : filtradas;

  const conteo = container.querySelector('#devo-reg-conteo');
  if (conteo) {
    conteo.textContent = trazas.length === filtradas.length
      ? `${trazas.length} entradas.`
      : `${filtradas.length} de ${trazas.length} entradas (filtradas).`;
  }

  if (!ordenadas.length) {
    lista.innerHTML = `<li class="devo-reg-vacio">${
      trazas.length ? 'Ninguna entrada coincide con el filtro.' : 'Sin entradas todavia.'
    }</li>`;
    return;
  }

  lista.innerHTML = ordenadas.map((t) => `
    <li class="devo-reg-item devo-reg-item--${escapeHtml(t.nivel)}">
      <div class="devo-reg-cabecera">
        <span class="devo-reg-hora">${hora(t.ts)}</span>
        <span class="devo-reg-origen">${escapeHtml(t.contexto)} · ${escapeHtml(t.ambito)}${t.frame === 'iframe' ? ' · iframe' : ''}</span>
      </div>
      <div class="devo-reg-evento">${escapeHtml(t.evento)}</div>
      ${t.datos ? `<pre class="devo-reg-datos">${escapeHtml(JSON.stringify(t.datos, null, 1))}</pre>` : ''}
    </li>
  `).join('');
}
