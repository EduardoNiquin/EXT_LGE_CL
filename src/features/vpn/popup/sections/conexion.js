// VPN — la unica seccion: estado, modo y los dos botones.
//
// El popup no hace el trabajo: manda el mensaje al service worker y se
// suscribe al estado. Todo lo que se ve aqui sale de vpn:estado, de modo que
// abrir el popup despues de que el tunel se cayo con el popup cerrado muestra
// lo que paso, con hora, en el registro.

import {
  MESSAGES, MODO, MODO_LABEL, MOTIVO, ORIGEN, ORIGEN_LABEL, SOCKS_POR_DEFECTO,
} from '../../constants.js';
import { getConfig, getEstadoOInicial, setConfig, subscribeToEstado } from '../../state.js';
import { desdeHace, escapeHtml, formatTime, lineas } from '../utils.js';

let stylesInjected = false;

export async function render(container) {
  injectStyles();

  const estado = await getEstadoOInicial();
  // `config` se reasigna al guardar: lo que se pinta (el SOCKS del semaforo)
  // tiene que reflejar lo que se acaba de escribir, no lo que habia al abrir.
  let config = await getConfig();

  container.innerHTML = `
    <div class="vpn-view">
      <div id="vpn-estado"></div>

      <div class="lt-form-card">
        <p class="lt-section-title">Conectar por</p>
        <div class="scf-mode-row" id="vpn-origenes">
          <button type="button" class="scf-mode-btn" data-origen="${ORIGEN.SERVIDOR}">${ORIGEN_LABEL[ORIGEN.SERVIDOR]}</button>
          <button type="button" class="scf-mode-btn" data-origen="${ORIGEN.LOCAL}">${ORIGEN_LABEL[ORIGEN.LOCAL]}</button>
        </div>
        <p class="lt-hint" id="vpn-origen-hint"></p>

        <details class="ct-diag vpn-listas" id="vpn-servidor-det">
          <summary>Servidor y credenciales</summary>
          <div class="vpn-listas-body">
            <label class="dt-label" for="vpn-servidor">Servidor (dominio:puerto)</label>
            <input class="dt-input" id="vpn-servidor" type="text" placeholder="vpn.midominio.com:443" />
            <label class="dt-label" for="vpn-usuario">Usuario</label>
            <input class="dt-input" id="vpn-usuario" type="text" autocomplete="off" />
            <label class="dt-label" for="vpn-clave">Contrasena</label>
            <input class="dt-input" id="vpn-clave" type="password" autocomplete="off" />
            <p class="lt-hint">Tiene que ser un nombre con certificado valido, no
              una IP: Chrome no deja aceptar una excepcion de certificado para un proxy.</p>
            <div class="lt-actions">
              <button type="button" class="ct-btn ct-btn--ghost" id="vpn-guardar-srv">Guardar</button>
            </div>
          </div>
        </details>
      </div>

      <div class="lt-form-card">
        <p class="lt-section-title">Enrutar</p>
        <div class="scf-mode-row" id="vpn-modos">
          <button type="button" class="scf-mode-btn" data-modo="${MODO.LG}">${MODO_LABEL[MODO.LG]}</button>
          <button type="button" class="scf-mode-btn" data-modo="${MODO.TODO}">${MODO_LABEL[MODO.TODO]}</button>
        </div>
        <p class="lt-hint" id="vpn-modo-hint"></p>

        <details class="ct-diag vpn-listas">
          <summary>Que se considera "de LG"</summary>
          <div class="vpn-listas-body">
            <label class="dt-label" for="vpn-dominios">Dominios (uno por linea)</label>
            <textarea class="dt-textarea" id="vpn-dominios" rows="2"></textarea>
            <label class="dt-label" for="vpn-redes">Redes CIDR (una por linea)</label>
            <textarea class="dt-textarea" id="vpn-redes" rows="4"></textarea>
            <label class="dt-label" for="vpn-socks">SOCKS5 de Enlace LG (origen local)</label>
            <input class="dt-input" id="vpn-socks" type="text" placeholder="${SOCKS_POR_DEFECTO}" />
            <p class="lt-hint">Las listas solo aplican al modo "${MODO_LABEL[MODO.LG]}". Al
              guardar se reaplica si ya estabas conectado.</p>
            <div class="lt-actions">
              <button type="button" class="ct-btn ct-btn--ghost" id="vpn-guardar">Guardar listas</button>
            </div>
          </div>
        </details>
      </div>

      <div class="lt-actions">
        <button type="button" class="ct-btn ct-btn--primary" id="vpn-toggle"></button>
        <button type="button" class="ct-btn ct-btn--ghost" id="vpn-ip">Comprobar IP de salida</button>
      </div>

      <div id="vpn-registro"></div>
    </div>
  `;

  const origenesEl = container.querySelector('#vpn-origenes');
  const origenHint = container.querySelector('#vpn-origen-hint');
  const servidorEl = container.querySelector('#vpn-servidor');
  const usuarioEl  = container.querySelector('#vpn-usuario');
  const claveEl    = container.querySelector('#vpn-clave');
  const guardarSrv = container.querySelector('#vpn-guardar-srv');
  const servidorDet = container.querySelector('#vpn-servidor-det');
  const modosEl    = container.querySelector('#vpn-modos');
  const hintEl     = container.querySelector('#vpn-modo-hint');
  const dominiosEl = container.querySelector('#vpn-dominios');
  const redesEl    = container.querySelector('#vpn-redes');
  const socksEl    = container.querySelector('#vpn-socks');
  const guardarEl  = container.querySelector('#vpn-guardar');
  const toggleEl   = container.querySelector('#vpn-toggle');
  const ipEl       = container.querySelector('#vpn-ip');

  let modoElegido = config.modo;
  let origenElegido = config.origen;
  let conectado = Boolean(estado.conectado);

  dominiosEl.value = (config.dominios || []).join('\n');
  redesEl.value    = (config.redes || []).join('\n');
  socksEl.value    = config.socks || SOCKS_POR_DEFECTO;
  servidorEl.value = config.servidor || '';
  usuarioEl.value  = config.usuario || '';
  claveEl.value    = config.clave || '';

  function pintarOrigen() {
    origenesEl.querySelectorAll('.scf-mode-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.origen === origenElegido);
      b.disabled = conectado;
    });
    const porServidor = origenElegido === ORIGEN.SERVIDOR;
    origenHint.textContent = porServidor
      ? 'No hace falta instalar nada en este PC.'
      : 'Necesita enlace-lg.exe abierto y en verde en este PC.';
    servidorDet.classList.toggle('hidden', !porServidor);
    // Si falta el servidor o la contrasena no hay nada que intentar, asi que se
    // abre el bloque solo. Es el caso normal la primera vez: el servidor viene
    // puesto de fabrica y lo unico que la persona tiene que hacer es escribir
    // la contrasena, asi que hay que ponersela delante sin que la busque.
    if (porServidor && (!servidorEl.value.trim() || !claveEl.value)) servidorDet.open = true;
  }

  origenesEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.scf-mode-btn');
    if (!btn || btn.disabled) return;
    origenElegido = btn.dataset.origen;
    setConfig({ origen: origenElegido }).catch(() => {});
    pintarOrigen();
  });

  // Enter en cualquiera de los tres campos guarda: escribir la contrasena y
  // pulsar Enter es lo que hace todo el mundo sin pensarlo.
  [servidorEl, usuarioEl, claveEl].forEach((el) => {
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); guardarSrv.click(); }
    });
  });

  guardarSrv.addEventListener('click', async () => {
    guardarSrv.disabled = true;
    try {
      config = await setConfig({
        servidor: servidorEl.value.trim(),
        usuario: usuarioEl.value.trim(),
        clave: claveEl.value,
      });
      if (conectado) await chrome.runtime.sendMessage({ type: MESSAGES.CONECTAR, payload: {} });
      pintar(await getEstadoOInicial());
    } finally {
      guardarSrv.disabled = false;
    }
  });

  function pintarModo() {
    modosEl.querySelectorAll('.scf-mode-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.modo === modoElegido);
      // Cambiar de modo estando conectado exige reconectar: el proxy se aplica
      // entero, no por partes. Se bloquea para que no parezca que ya cambio.
      b.disabled = conectado;
    });
    hintEl.textContent = modoElegido === MODO.TODO
      ? 'Todo el navegador sale por LG, incluidas las demas funciones de esta extension.'
      : 'Solo los dominios y redes de abajo van por el tunel. El resto sigue saliendo por tu conexion.';
  }

  modosEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.scf-mode-btn');
    if (!btn || btn.disabled) return;
    modoElegido = btn.dataset.modo;
    setConfig({ modo: modoElegido }).catch(() => {});
    pintarModo();
  });

  guardarEl.addEventListener('click', async () => {
    guardarEl.disabled = true;
    try {
      config = await setConfig({
        dominios: lineas(dominiosEl.value),
        redes: lineas(redesEl.value),
        socks: socksEl.value.trim() || SOCKS_POR_DEFECTO,
      });
      // Reaplicar solo si ya estabas conectado: el proxy se aplica entero, asi
      // que guardar sin reconectar dejaria puesto el PAC viejo.
      if (conectado) await chrome.runtime.sendMessage({ type: MESSAGES.CONECTAR, payload: {} });
      pintar(await getEstadoOInicial());
    } finally {
      guardarEl.disabled = false;
    }
  });

  toggleEl.addEventListener('click', async () => {
    toggleEl.disabled = true;
    ipEl.disabled = true;
    const previo = toggleEl.textContent;
    toggleEl.textContent = conectado ? 'Desconectando…' : 'Conectando…';
    try {
      const res = conectado
        ? await chrome.runtime.sendMessage({ type: MESSAGES.DESCONECTAR })
        : await chrome.runtime.sendMessage({
          type: MESSAGES.CONECTAR,
          payload: { modo: modoElegido, origen: origenElegido },
        });
      if (!res?.ok && res?.reason) {
        // El motivo tambien queda en el registro; esto es para que no pase
        // desapercibido justo despues de pulsar.
        window.alert(res.reason);
      }
    } catch (err) {
      window.alert(String(err?.message || err));
      toggleEl.textContent = previo;
    } finally {
      toggleEl.disabled = false;
      ipEl.disabled = false;
    }
  });

  ipEl.addEventListener('click', async () => {
    ipEl.disabled = true;
    const previo = ipEl.textContent;
    ipEl.textContent = 'Comprobando…';
    try {
      const res = await chrome.runtime.sendMessage({ type: MESSAGES.IP_SALIDA });
      if (!res?.ok) window.alert(res?.reason || 'No se pudo comprobar la IP de salida.');
    } finally {
      ipEl.textContent = previo;
      ipEl.disabled = false;
    }
  });

  function pintar(nuevo) {
    const e = nuevo || { conectado: false, log: [] };
    conectado = Boolean(e.conectado);
    toggleEl.textContent = conectado ? 'Desconectar' : 'Conectar';
    toggleEl.classList.toggle('ct-btn--primary', !conectado);
    toggleEl.classList.toggle('ct-btn--ghost', conectado);
    if (conectado) {
      modoElegido = e.modo || modoElegido;
      origenElegido = e.origen || origenElegido;
    }
    pintarOrigen();
    pintarModo();
    renderEstado(container.querySelector('#vpn-estado'), e, config);
    renderRegistro(container.querySelector('#vpn-registro'), e);
  }

  pintar(estado);

  // Al abrir el popup, comprobar: puede haber pasado cualquier cosa mientras
  // estaba cerrado y el estado guardado ser de hace rato.
  chrome.runtime.sendMessage({ type: MESSAGES.COMPROBAR }).catch(() => {});

  const unsubscribe = subscribeToEstado((nuevo) => pintar(nuevo));

  // El popup no avisa del desmontaje; se detecta cuando el nodo sale del DOM.
  const mo = new MutationObserver(() => {
    if (container.isConnected) return;
    unsubscribe();
    mo.disconnect();
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

function renderEstado(host, estado, config) {
  if (!host) return;

  const porLocal = (estado.origen || config?.origen) === ORIGEN.LOCAL;
  const via = escapeHtml(porLocal
    ? (config?.socks || SOCKS_POR_DEFECTO)
    : (config?.servidor || 'sin servidor configurado'));

  let clase = 'vpn-dot--off';
  let titulo = 'Desconectado';
  let detalle = porLocal
    ? `Enlace LG publica el SOCKS5 en ${via}. Tiene que estar abierto para conectar.`
    : `Se conectara a ${via}. No hace falta instalar nada en este PC.`;

  if (estado.conectado) {
    clase = 'vpn-dot--ok';
    titulo = `Conectado — ${escapeHtml(MODO_LABEL[estado.modo] || '')}`;
    detalle = `Por ${via}${estado.desde ? ` · ${desdeHace(estado.desde)}` : ''}`;
  } else if (estado.motivo === MOTIVO.CAIDO) {
    clase = 'vpn-dot--bad';
    titulo = 'El tunel se cayo';
    detalle = 'Se volvio a conexion directa sola.';
  } else if (estado.motivo === MOTIVO.CREDENCIALES) {
    clase = 'vpn-dot--bad';
    titulo = 'Usuario o contrasena incorrectos';
    detalle = escapeHtml(estado.ultimoError || '');
  } else if (estado.motivo === MOTIVO.SIN_SERVIDOR) {
    clase = 'vpn-dot--off';
    titulo = 'Falta configurar el servidor';
    detalle = escapeHtml(estado.ultimoError || '');
  } else if (estado.motivo === MOTIVO.SIN_TUNEL) {
    clase = 'vpn-dot--bad';
    titulo = porLocal ? 'Enlace LG no responde' : 'No se llega al servidor';
    detalle = escapeHtml(estado.ultimoError || '');
  } else if (estado.motivo === MOTIVO.SIN_CONTROL) {
    clase = 'vpn-dot--bad';
    titulo = 'No se puede cambiar el proxy';
    detalle = escapeHtml(estado.ultimoError || '');
  }

  const ip = estado.ipSalida;
  let ipHtml = '';
  if (ip) {
    // En "Solo sitios de LG" el echo no es un dominio de LG, asi que sale
    // directo por definicion: ver una IP de casa ahi es lo correcto, no un
    // fallo. Marcarlo en rojo mandaria a buscar un problema que no existe.
    const acotado = ip.modo === MODO.LG;
    const clase = acotado ? '' : (ip.porLg ? 'vpn-ip--lg' : 'vpn-ip--no');
    const nota = acotado
      ? '· es tu conexion, y es lo esperado: en este modo solo lo interno va por el tunel'
      : (ip.porLg ? '· saliendo por LG' : '· NO es una IP de LG');
    ipHtml = `<p class="lt-hint vpn-ip ${clase}">
        IP de salida: <strong>${escapeHtml(ip.ip)}</strong> ${nota}
      </p>`;
  }

  host.innerHTML = `
    <div class="vpn-estado">
      <span class="vpn-dot ${clase}"></span>
      <div class="vpn-estado-txt">
        <p class="vpn-estado-titulo">${titulo}</p>
        <p class="lt-hint">${detalle}</p>
        ${ipHtml}
      </div>
    </div>
  `;
}

function renderRegistro(host, estado) {
  if (!host) return;
  const log = Array.isArray(estado.log) ? estado.log.slice(-12).reverse() : [];
  if (!log.length) { host.innerHTML = ''; return; }

  host.innerHTML = `
    <details class="ct-diag lt-log-details">
      <summary>Registro</summary>
      <ul class="lt-log">
        ${log.map((l) => `
          <li class="lt-log-item lt-log-item--${escapeHtml(l.level || 'info')}">
            <span class="lt-log-time">${formatTime(l.ts)}</span>
            <span class="lt-log-msg">${escapeHtml(l.message)}</span>
          </li>
        `).join('')}
      </ul>
    </details>
  `;
}

// El CSS propio se inyecta desde aqui (mismo camino que Ajustes) para no sumar
// otro bloque al popup.css de 2600 lineas por una feature autocontenida.
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .vpn-view { display: flex; flex-direction: column; gap: 14px; }
    .vpn-estado { display: flex; gap: 10px; align-items: flex-start;
      padding: 10px 12px; border: 1px solid var(--border, #e5e7eb);
      border-radius: var(--radius-sm, 6px); background: var(--surface-2, #f9fafb); }
    .vpn-estado-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .vpn-estado-titulo { margin: 0; font-size: 13px; font-weight: 700; color: var(--text, #111827); }
    .vpn-dot { flex: 0 0 auto; width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; }
    .vpn-dot--ok  { background: var(--success, #10b981); }
    .vpn-dot--bad { background: var(--danger, #ef4444); }
    .vpn-dot--off { background: var(--text-subtle, #9ca3af); }
    .vpn-ip--lg strong { color: var(--success, #10b981); }
    .vpn-ip--no strong { color: var(--danger, #ef4444); }
    .vpn-listas-body { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; }
  `;
  document.head.appendChild(style);
}
