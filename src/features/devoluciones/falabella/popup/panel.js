// UI de "Devoluciones SellerCenter" (panel/popup).
//
// La web sigue siendo la interfaz real (lista de órdenes, avance, errores). Esta
// sección sólo aporta lo que la política de TI no le deja hacer a la web:
// SELECCIONAR archivos del disco y (vía el service worker) ESCRIBIR los
// resultados. El emparejamiento con la sesión web se hace con un token que la
// página publica en una <meta> (lo lee el content script) o que el usuario pega
// a mano acá.
//
// La subida arranca desde acá (los File viven en este contexto); el sondeo y el
// guardado corren en el service worker (sobreviven al cierre del popup). El
// progreso se pinta desde el `run` en storage.
//
// Recomendación de UX: para cargas largas conviene MAXIMIZAR al panel lateral
// (botón de la cabecera): no se cierra al perder el foco.

import {
  CHUNK_BYTES,
  DEFAULT_API_BASE,
  DEFAULT_LIMITS,
  DEVO_FINISH,
  DEVO_MESSAGES,
  PING_SAMPLE_BYTES,
  UPLOAD_METHOD,
  WEB_URL,
} from '../../devoluciones/constants.js';
import {
  clearRun,
  getPairing,
  getRun,
  getUploadMethod,
  makeRun,
  setPairing,
  setRun,
  setUploadMethod,
  subscribeToRun,
} from '../../devoluciones/state.js';
import {
  abortUpload,
  blobToBase64,
  completeUpload,
  getSession,
  openUpload,
  ping,
  pingBase64,
  uploadChunk,
  uploadFile,
} from '../../devoluciones/api.js';
import { escapeHtml, formatTime } from '../utils.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';
import { sendMessage } from '../../../../shared/messaging/messaging.js';

const log = logger('devoluciones-seller');

const ui = {
  paired: false,
  base: DEFAULT_API_BASE,
  limites: { ...DEFAULT_LIMITS },
  files: [],
  fileErrors: [],
  busy: false,        // subida en curso
  statusError: '',
  method: UPLOAD_METHOD.MULTIPART,  // vía de subida (la fija el ping)
};

let unsub = null;

export async function render(container) {
  if (unsub) { try { unsub(); } catch { /* no-op */ } unsub = null; }
  container.innerHTML = `
    <div class="lt-view devo-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Devoluciones SellerCenter</h3>
        <p class="lt-hint">
          La web de devoluciones sigue siendo tu interfaz (lista de órdenes y avance).
          Aquí sólo <strong>seleccionas los comprimidos</strong> y la extensión los sube y
          <strong>guarda los resultados</strong> en tu carpeta de Descargas.
          <a href="#" id="devo-open-web">Ver en la web</a>.
        </p>

        <div id="devo-status" class="devo-status"></div>

        <details class="ct-diag devo-ping">
          <summary>Probar conexión (ping)</summary>
          <p class="lt-hint">
            Comprueba qué deja salir la política del equipo. <strong>Selecciona primero un
            archivo pequeño</strong>: se prueba la subida clásica (multipart) y, si falla, la
            vía base64 (Plan B). No se guarda nada; el archivo se descarta con la petición.
          </p>
          <button type="button" id="devo-ping-btn" class="ct-btn ct-btn--ghost">Probar conexión</button>
          <div id="devo-ping-out" class="devo-ping-out"></div>
        </details>

        <div class="devo-drop" id="devo-drop">
          <input type="file" id="devo-file" class="dt-input" multiple>
          <p class="devo-drop-hint" id="devo-drop-hint">
            Arrastra aquí los comprimidos o haz clic para elegirlos.
          </p>
        </div>

        <div id="devo-files" class="devo-files"></div>

        <div id="devo-upload-status" class="devo-upload-status hidden"></div>

        <div class="lt-actions">
          <button type="button" id="devo-upload" class="ct-btn ct-btn--primary" disabled>Subir</button>
          <button type="button" id="devo-clear"  class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>

      <section id="devo-progress" class="lt-progress hidden">
        <div class="lt-progress-head">
          <strong id="devo-progress-title">Procesando…</strong>
          <span id="devo-progress-counter" class="dt-progress-counter"></span>
        </div>
        <ul id="devo-order-list" class="lt-region-list"></ul>
        <div class="lt-actions">
          <button type="button" id="devo-stop" class="ct-btn ct-btn--ghost" disabled>Detener</button>
        </div>
        <details class="ct-diag lt-log-details">
          <summary>Registro</summary>
          <ul id="devo-log" class="lt-log"></ul>
        </details>
      </section>
    </div>
  `;

  ui.method = await getUploadMethod();
  wireEvents(container);
  await refreshStatus(container);
  applyLimitsToInput(container);

  const run = await getRun();
  renderProgress(container, run);
  updateUploadButton(container);

  unsub = subscribeToRun((newRun) => {
    renderProgress(container, newRun);
    updateUploadButton(container);
  });
}

// -----------------------------------------------------------------------------
// Estado / emparejamiento
// -----------------------------------------------------------------------------

async function refreshStatus(container) {
  const box = container.querySelector('#devo-status');
  if (box) box.innerHTML = '<span class="ct-spinner"></span> Comprobando emparejamiento…';

  const pairing = await getPairing();
  if (!pairing?.token || !pairing?.base) {
    ui.paired = false;
    ui.base = pairing?.base || DEFAULT_API_BASE;
    renderStatus(container);
    return;
  }
  ui.base = pairing.base;

  const res = await getSession(pairing.base, pairing.token);
  if (res.status === 401) {
    ui.paired = false;
    ui.statusError = 'Token caducado. Recarga la web o pega el código de nuevo.';
  } else if (!res.ok) {
    ui.paired = false;
    ui.statusError = res.status === 0
      ? 'No hay conexión con el servidor. ¿Aceptaste el certificado en https://147.93.176.66 ?'
      : (res.error || 'No se pudo consultar la sesión.');
  } else {
    ui.paired = Boolean(res.data?.emparejado);
    ui.statusError = '';
    if (res.data?.limites) ui.limites = { ...DEFAULT_LIMITS, ...res.data.limites };
  }
  renderStatus(container);
  applyLimitsToInput(container);
}

function renderStatus(container) {
  const box = container.querySelector('#devo-status');
  if (!box) return;

  if (ui.paired) {
    box.innerHTML = `
      <div class="devo-badge devo-badge--ok">
        <span class="devo-dot"></span> Emparejado con la web
      </div>
      <p class="lt-hint devo-limits">
        Máx. ${ui.limites.max_archivos_por_carga} archivos por carga ·
        ${ui.limites.max_mb_por_archivo} MB por archivo ·
        ${(ui.limites.extensiones || []).map((e) => `.${escapeHtml(e)}`).join(', ')}
      </p>
      <p class="lt-hint devo-limits">
        Vía de subida: <strong>${ui.method === UPLOAD_METHOD.BASE64 ? 'base64 troceado (Plan B)' : 'multipart'}</strong>
        — usa "Probar conexión" para confirmarla.
      </p>
    `;
    return;
  }

  box.innerHTML = `
    <div class="devo-badge devo-badge--off">
      <span class="devo-dot"></span> Sin emparejar
    </div>
    ${ui.statusError ? `<p class="scf-error-line">${escapeHtml(ui.statusError)}</p>` : ''}
    <p class="lt-hint">
      Abre o recarga la web de devoluciones para emparejar automáticamente, o pega aquí
      el <strong>código</strong> (botón "Copiar código" en la web):
    </p>
    <div class="devo-pair-row">
      <input type="text" id="devo-token" class="dt-input" placeholder="Pega el código de emparejamiento" spellcheck="false">
      <button type="button" id="devo-pair-save" class="ct-btn ct-btn--primary">Guardar</button>
    </div>
    <button type="button" id="devo-refresh" class="ct-btn ct-btn--ghost devo-refresh">Volver a comprobar</button>
  `;

  box.querySelector('#devo-pair-save')?.addEventListener('click', async () => {
    const token = box.querySelector('#devo-token')?.value?.trim();
    if (!token) { alert('Pega el código de emparejamiento.'); return; }
    await setPairing({ token, base: ui.base || DEFAULT_API_BASE, ts: Date.now() });
    log.info('emparejamiento pegado a mano');
    await refreshStatus(container);
    updateUploadButton(container);
  });
  box.querySelector('#devo-refresh')?.addEventListener('click', async () => {
    await refreshStatus(container);
    updateUploadButton(container);
  });
}

function applyLimitsToInput(container) {
  const input = container.querySelector('#devo-file');
  if (input) input.accept = (ui.limites.extensiones || []).map((e) => `.${e}`).join(',');
}

// -----------------------------------------------------------------------------
// Selección de archivos
// -----------------------------------------------------------------------------

function wireEvents(container) {
  container.querySelector('#devo-open-web')?.addEventListener('click', (e) => {
    e.preventDefault();
    try { chrome.tabs.create({ url: WEB_URL }); } catch { window.open(WEB_URL, '_blank'); }
  });

  const input = container.querySelector('#devo-file');
  input?.addEventListener('change', (e) => setFiles(container, [...(e.target.files || [])]));

  const drop = container.querySelector('#devo-drop');
  drop?.addEventListener('click', (e) => { if (e.target !== input) input?.click(); });
  drop?.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('devo-drop--over'); });
  drop?.addEventListener('dragleave', () => drop.classList.remove('devo-drop--over'));
  drop?.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('devo-drop--over');
    setFiles(container, [...(e.dataTransfer?.files || [])]);
  });

  container.querySelector('#devo-ping-btn')?.addEventListener('click', () => onPing(container));
  container.querySelector('#devo-upload')?.addEventListener('click', () => onUpload(container));
  container.querySelector('#devo-clear')?.addEventListener('click', () => onClearRun(container));
  container.querySelector('#devo-stop')?.addEventListener('click', () => onStop());
}

function fileExt(name) {
  const parts = String(name || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function validateFiles(files) {
  const errors = [];
  const { max_archivos_por_carga: maxN, max_mb_por_archivo: maxMb, extensiones } = ui.limites;
  const allowed = (extensiones || []).map((e) => e.toLowerCase());
  if (files.length > maxN) errors.push(`Demasiados archivos: ${files.length} (máx. ${maxN} por carga).`);
  for (const f of files) {
    const ext = fileExt(f.name);
    if (!allowed.includes(ext)) errors.push(`"${f.name}": extensión .${ext || '?'} no admitida.`);
    if (f.size > maxMb * 1024 * 1024) errors.push(`"${f.name}": ${(f.size / 1048576).toFixed(1)} MB supera el tope de ${maxMb} MB.`);
  }
  return errors;
}

function setFiles(container, files) {
  ui.files = files;
  ui.fileErrors = validateFiles(files);
  renderFiles(container);
  updateUploadButton(container);
}

function renderFiles(container) {
  const box = container.querySelector('#devo-files');
  if (!box) return;
  if (!ui.files.length) { box.innerHTML = ''; return; }

  const rows = ui.files.map((f) => `
    <li class="devo-file-row">
      <span class="devo-file-name">${escapeHtml(f.name)}</span>
      <span class="devo-file-size">${(f.size / 1048576).toFixed(1)} MB</span>
    </li>
  `).join('');

  const errs = ui.fileErrors.length
    ? `<ul class="lt-log devo-file-errors">${ui.fileErrors.map((e) => `<li class="lt-log-item lt-log-item--error">${escapeHtml(e)}</li>`).join('')}</ul>`
    : '';

  box.innerHTML = `
    <p class="scf-summary"><strong>${ui.files.length}</strong> archivo(s) seleccionado(s) — un comprimido = una orden.</p>
    <ul class="devo-file-list">${rows}</ul>
    ${errs}
  `;
}

// -----------------------------------------------------------------------------
// Ping (§7)
// -----------------------------------------------------------------------------

// Interpreta la respuesta de /ping: sólo cuenta como "pasó" si el servidor
// confirma que recibió el archivo por la vía esperada (campo `via`).
function pingPassed(res, viaEsperada) {
  return Boolean(res.ok && res.data && res.data.recibido && res.data.via === viaEsperada);
}

async function onPing(container) {
  const out = container.querySelector('#devo-ping-out');
  const btn = container.querySelector('#devo-ping-btn');

  const file = ui.files[0] || null;
  if (!file) {
    if (out) out.innerHTML = '<p class="scf-error-line">Selecciona primero un archivo pequeño: sin archivo la prueba no demuestra nada (via = null).</p>';
    return;
  }

  const base = ui.base || DEFAULT_API_BASE;
  if (out) out.innerHTML = '<span class="ct-spinner"></span> Probando multipart…';
  if (btn) btn.disabled = true;

  // Prueba A — subida clásica multipart.
  const a = await ping(base, file);
  if (a.status === 0) {
    if (btn) btn.disabled = false;
    if (out) out.innerHTML = `<p class="scf-error-line">Sin respuesta (${escapeHtml(a.error || 'red')}). Si la web sí carga, casi seguro es el certificado: abre <strong>https://147.93.176.66</strong>, acepta la advertencia y repite.</p>`;
    return;
  }

  // Prueba B — el mismo archivo (una muestra) como texto base64.
  if (out) out.innerHTML = '<span class="ct-spinner"></span> Probando base64…';
  let b;
  try {
    const sample = file.slice(0, PING_SAMPLE_BYTES);
    const contenido = await blobToBase64(sample);
    b = await pingBase64(base, { nombre: file.name, contenido });
  } catch (err) {
    b = { ok: false, status: 0, data: null, error: toMessage(err) };
  }

  if (btn) btn.disabled = false;

  const aOk = pingPassed(a, 'multipart');
  const bOk = pingPassed(b, 'base64');

  let verdict;
  let cls = 'devo-verdict--ok';
  if (aOk) {
    ui.method = UPLOAD_METHOD.MULTIPART;
    await setUploadMethod(UPLOAD_METHOD.MULTIPART);
    verdict = 'Multipart OK. Se usará la subida clásica (/batches), la más rápida.';
  } else if (bOk) {
    ui.method = UPLOAD_METHOD.BASE64;
    await setUploadMethod(UPLOAD_METHOD.BASE64);
    verdict = 'La subida clásica está bloqueada, pero la vía base64 funciona: se usará el Plan B (troceado). Es más lenta.';
    cls = 'devo-verdict--warn';
  } else {
    verdict = 'Ni multipart ni base64 llegaron: el control mira el contenido que sale. No hay vía que sirva — hay que parar y avisar (correr el módulo en local).';
    cls = 'devo-verdict--err';
  }

  if (!out) return;
  out.innerHTML = `
    <p class="devo-verdict ${cls}">${escapeHtml(verdict)}</p>
    <details class="ct-diag">
      <summary>Respuestas del servidor</summary>
      <p class="lt-hint">Prueba A (multipart) — HTTP ${a.status}, via <code>${escapeHtml(String(a.data?.via ?? 'null'))}</code></p>
      <pre class="devo-json">${escapeHtml(JSON.stringify(a.data, null, 2))}</pre>
      <p class="lt-hint">Prueba B (base64) — HTTP ${b.status}, via <code>${escapeHtml(String(b.data?.via ?? 'null'))}</code></p>
      <pre class="devo-json">${escapeHtml(JSON.stringify(b.data, null, 2))}</pre>
    </details>
  `;
}

// -----------------------------------------------------------------------------
// Subida + arranque del run
// -----------------------------------------------------------------------------

function updateUploadButton(container) {
  const btn = container.querySelector('#devo-upload');
  if (!btn) return;
  getRun().then((run) => {
    const active = Boolean(run?.active);
    const ok = ui.paired && ui.files.length > 0 && ui.fileErrors.length === 0 && !ui.busy && !active;
    btn.disabled = !ok;
    btn.textContent = ui.busy ? 'Subiendo…' : (ui.files.length ? `Subir (${ui.files.length})` : 'Subir');
    const drop = container.querySelector('#devo-drop');
    const input = container.querySelector('#devo-file');
    if (input) input.disabled = active || ui.busy;
    if (drop) drop.classList.toggle('devo-drop--disabled', active || ui.busy);
  }).catch(() => { /* no-op */ });
}

function setUploadStatus(container, html) {
  const el = container.querySelector('#devo-upload-status');
  if (!el) return;
  if (!html) { el.classList.add('hidden'); el.innerHTML = ''; }
  else { el.classList.remove('hidden'); el.innerHTML = `<span class="ct-spinner"></span> ${escapeHtml(html)}`; }
}

// Plan B (§9): sube un archivo en trozos base64. Trocea con file.slice (Blob
// perezoso: nunca carga los 200 MB en memoria) y codifica cada trozo con
// FileReader (sin reventar la pila). Devuelve la misma forma que uploadFile.
async function uploadChunkedFile(base, token, batch, file, onProgress) {
  const opened = await openUpload(base, token, { nombre: file.name, batch });
  if (!opened.ok) return { ok: false, status: opened.status, error: opened.error };

  const id = opened.data?.id;
  const maxChunk = Math.min(CHUNK_BYTES, Number(opened.data?.max_chunk_bytes) || CHUNK_BYTES);
  try {
    let indice = 0;
    for (let desde = 0; desde < file.size; desde += maxChunk) {
      const trozo = file.slice(desde, desde + maxChunk);
      const contenido = await blobToBase64(trozo);
      const chunkRes = await uploadChunk(base, token, id, { indice, contenido });
      if (!chunkRes.ok) throw new Error(chunkRes.error || `HTTP ${chunkRes.status} en el trozo ${indice}`);
      indice += 1;
      onProgress?.((desde + trozo.size) / file.size);
    }
    const done = await completeUpload(base, token, id);
    if (!done.ok) throw new Error(done.error || 'No se pudo cerrar la subida');
    const orden = done.data?.orden;
    return { ok: true, status: done.status, data: { creadas: orden ? [orden] : [], ordenes: [] } };
  } catch (err) {
    // Deja el temporal libre; de todos modos caduca solo.
    try { await abortUpload(base, token, id); } catch { /* no-op */ }
    return { ok: false, status: 0, error: toMessage(err) };
  }
}

async function onUpload(container) {
  const run = await getRun();
  if (run?.active) { alert('Ya hay un proceso en curso.'); return; }
  if (!ui.paired) { alert('No estás emparejado con la web.'); return; }
  if (!ui.files.length || ui.fileErrors.length) { alert('Revisa los archivos seleccionados.'); return; }

  const pairing = await getPairing();
  const base = pairing?.base || ui.base;
  const token = pairing?.token;
  if (!base || !token) { alert('Falta el token de emparejamiento.'); return; }

  ui.busy = true;
  updateUploadButton(container);

  const batch = crypto.randomUUID();
  const method = ui.method || UPLOAD_METHOD.MULTIPART;
  const byId = new Map();
  const uploadErrors = [];
  const total = ui.files.length;

  for (let i = 0; i < total; i++) {
    const file = ui.files[i];
    const label = `Subiendo ${i + 1}/${total}: ${file.name}`;
    setUploadStatus(container, `${label}…`);

    const res = method === UPLOAD_METHOD.BASE64
      ? await uploadChunkedFile(base, token, batch, file, (p) => setUploadStatus(container, `${label} — ${Math.round(p * 100)}%`))
      : await uploadFile(base, token, batch, file);

    if (res.status === 401) {
      uploadErrors.push('Token caducado (401): vuelve a emparejar.');
      break;
    }
    if (res.status === 422) {
      uploadErrors.push(`"${file.name}": ${res.error || 'validación rechazada'}`);
      continue;
    }
    if (!res.ok) {
      uploadErrors.push(`"${file.name}": ${res.error || `HTTP ${res.status}`}`);
      continue;
    }
    const creadas = Array.isArray(res.data?.creadas) ? res.data.creadas : [];
    const ordenes = Array.isArray(res.data?.ordenes) ? res.data.ordenes : [];
    for (const o of [...creadas, ...ordenes]) {
      if (o && o.id != null) byId.set(o.id, o);
    }
  }

  ui.busy = false;
  setUploadStatus(container, '');

  if (uploadErrors.length) {
    const box = container.querySelector('#devo-files');
    if (box) {
      box.insertAdjacentHTML('beforeend',
        `<ul class="lt-log devo-file-errors">${uploadErrors.map((e) => `<li class="lt-log-item lt-log-item--error">${escapeHtml(e)}</li>`).join('')}</ul>`);
    }
  }

  const ordenes = [...byId.values()];
  if (!ordenes.length) {
    updateUploadButton(container);
    if (!uploadErrors.length) alert('El servidor no creó ninguna orden. Revisa los archivos.');
    return;
  }

  const newRun = makeRun({
    batch,
    base,
    ordenes,
    message: `Carga iniciada — ${ordenes.length} orden(es), batch ${batch.slice(0, 8)}…`,
  });
  await setRun(newRun);
  sendMessage({ type: DEVO_MESSAGES.START }).catch(() => { /* el SW también reconcilia */ });
  log.info('carga lanzada', { total: ordenes.length });

  // Reset del selector: los File ya no se necesitan en el panel.
  ui.files = [];
  ui.fileErrors = [];
  const input = container.querySelector('#devo-file');
  if (input) input.value = '';
  renderFiles(container);
  renderProgress(container, newRun);
  updateUploadButton(container);
}

async function onStop() {
  if (!confirm('¿Detener el proceso en curso?')) return;
  sendMessage({ type: DEVO_MESSAGES.CANCEL }).catch(() => { /* no-op */ });
}

async function onClearRun(container) {
  const run = await getRun();
  if (run?.active) {
    if (!confirm('Hay un proceso activo. ¿Detenerlo y limpiar?')) return;
    sendMessage({ type: DEVO_MESSAGES.CANCEL }).catch(() => { /* no-op */ });
  }
  await clearRun();
  renderProgress(container, null);
  updateUploadButton(container);
}

// -----------------------------------------------------------------------------
// Progreso
// -----------------------------------------------------------------------------

function renderProgress(container, run) {
  const wrap = container.querySelector('#devo-progress');
  if (!wrap) return;
  if (!run || !Array.isArray(run.ordenes) || !run.ordenes.length) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');

  const ordenes = run.ordenes;
  const done = ordenes.filter((o) => o.guardado || o.saveError || (o.final && !o.listo)).length;

  const titleEl = container.querySelector('#devo-progress-title');
  if (run.active) titleEl.textContent = 'Procesando…';
  else if (run.finishReason === DEVO_FINISH.CANCELLED) titleEl.textContent = 'Cancelado';
  else if (run.finishReason === DEVO_FINISH.UNPAIRED) titleEl.textContent = 'Sin emparejamiento';
  else if (run.finishReason === DEVO_FINISH.ERROR) titleEl.textContent = 'Terminado con incidencias';
  else titleEl.textContent = 'Terminado';

  const counterEl = container.querySelector('#devo-progress-counter');
  const guardadas = ordenes.filter((o) => o.guardado).length;
  const conErr = ordenes.filter((o) => o.saveError || o.error_code).length;
  counterEl.innerHTML = `
    <span class="lt-stat-total">${done} / ${ordenes.length}</span>
    ${guardadas ? `<span class="lt-stat-sep"></span><span class="lt-stat-ok">${guardadas} guardada(s)</span>` : ''}
    ${conErr ? `<span class="lt-stat-error">${conErr} con error</span>` : ''}
  `;

  const list = container.querySelector('#devo-order-list');
  list.innerHTML = '';
  for (const o of ordenes) {
    const li = document.createElement('li');
    li.className = `lt-region lt-region--${orderClass(o)}`;
    const pct = Math.max(0, Math.min(100, Number(o.progreso) || 0));
    li.innerHTML = `
      <div class="lt-region-head">
        <span class="lt-region-name">orden ${escapeHtml(o.orden)}${o.numero_guia ? ` · guía ${escapeHtml(o.numero_guia)}` : ''}</span>
        <span class="lt-region-status">${escapeHtml(orderLabel(o))}</span>
      </div>
      <div class="lt-progress-bar devo-order-bar"><span style="width:${pct}%"></span></div>
      ${o.error ? `<div class="lt-err">${escapeHtml(o.error)}</div>` : ''}
      ${o.saveError ? `<div class="lt-err">Guardado local: ${escapeHtml(o.saveError)}</div>` : ''}
      ${o.advertencia ? `<div class="lt-warn">${escapeHtml(o.advertencia)}</div>` : ''}
    `;
    list.appendChild(li);
  }

  const stopBtn = container.querySelector('#devo-stop');
  const clearBtn = container.querySelector('#devo-clear');
  if (stopBtn) stopBtn.disabled = !run.active;
  if (clearBtn) clearBtn.classList.toggle('hidden', Boolean(run.active));

  const logEl = container.querySelector('#devo-log');
  if (logEl) {
    logEl.innerHTML = '';
    const entries = Array.isArray(run.log) ? run.log.slice(-50).reverse() : [];
    for (const e of entries) {
      const li = document.createElement('li');
      li.className = `lt-log-item lt-log-item--${e.level}`;
      li.innerHTML = `<span class="lt-log-time">${formatTime(e.ts)}</span><span class="lt-log-msg">${escapeHtml(e.message)}</span>`;
      logEl.appendChild(li);
    }
  }
}

function orderClass(o) {
  if (o.guardado) return 'done';
  if (o.saveError || o.error_code) return 'error';
  if (o.guardando || o.procesando || o.listo) return 'running';
  return 'pending';
}

function orderLabel(o) {
  if (o.guardado) return 'Guardado';
  if (o.saveError) return 'Error al guardar';
  if (o.guardando) return 'Guardando…';
  if (o.error_code) return o.estado_label || 'Falló';
  if (o.listo) return 'Listo para guardar';
  return o.estado_label || 'En cola';
}
