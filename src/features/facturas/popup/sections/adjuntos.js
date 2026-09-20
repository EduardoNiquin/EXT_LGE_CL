// Adjuntos: los archivos que se suben al voucher (PDF de la factura y detalle).
// Viven en IndexedDB de la extension hasta que se borran desde aqui.

import { ROL_ADJUNTO } from '../../constants.js';
import { asignarRol, borrarAdjunto, guardarAdjunto, listarAdjuntos } from '../../adjuntos/store.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { escapeHtml, formatBytes } from '../../../../shared/ui/format.js';

const ROLES = [
  { value: '', label: '(auto)' },
  { value: ROL_ADJUNTO.FACTURA, label: 'Factura (PDF)' },
  { value: ROL_ADJUNTO.DETALLE, label: 'Detalle' },
];

export async function render(container) {
  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Adjuntos</h3>
        <p class="lt-hint">La <strong>factura</strong> (PDF) y el <strong>detalle</strong> son obligatorios; la distribution no se sube por ahora. Se emparejan solos por el numero de factura en el nombre; si no, elige el rol aqui.</p>
        <label class="ct-btn ct-btn--ghost io-file-btn">
          Subir archivos
          <input type="file" id="fa-adjuntos" multiple hidden>
        </label>
        <p class="lt-hint" id="fa-adjuntos-estado"></p>
        <div id="fa-adjuntos-lista" class="io-table-wrap"></div>
      </section>
    </div>`;

  container.querySelector('#fa-adjuntos').addEventListener('change', (event) => onArchivos(container, event.currentTarget));
  await renderLista(container);
}

async function onArchivos(container, input) {
  const archivos = Array.from(input.files || []);
  const estado = container.querySelector('#fa-adjuntos-estado');
  try {
    for (const file of archivos) {
      estado.textContent = `Guardando ${file.name}...`;
      await guardarAdjunto({ nombre: file.name, tipo: file.type, bytes: await file.arrayBuffer() });
    }
    estado.textContent = archivos.length ? `${archivos.length} archivo(s) guardado(s).` : '';
  } catch (err) {
    estado.textContent = `No se pudo guardar: ${toMessage(err)}`;
  } finally {
    input.value = '';
  }
  await renderLista(container);
}

async function renderLista(container) {
  const wrap = container.querySelector('#fa-adjuntos-lista');
  const adjuntos = await listarAdjuntos();
  if (!adjuntos.length) {
    wrap.innerHTML = '<p class="ct-empty">Sin adjuntos.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="io-table">
      <thead><tr><th>Archivo</th><th>Tamano</th><th>Rol</th><th></th></tr></thead>
      <tbody>
        ${adjuntos.map((a) => `
          <tr data-id="${escapeHtml(a.id)}">
            <td title="${escapeHtml(a.nombre)}">${escapeHtml(a.nombre)}</td>
            <td>${formatBytes(a.tamano)}</td>
            <td><select class="dt-input" data-rol>${ROLES.map((r) => `<option value="${r.value}" ${(a.rol || '') === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}</select></td>
            <td><button type="button" class="ct-btn ct-btn--ghost" data-borrar>Borrar</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('tr[data-id]').forEach((fila) => {
    const id = fila.dataset.id;
    fila.querySelector('[data-rol]').addEventListener('change', (event) => asignarRol(id, event.currentTarget.value || null));
    fila.querySelector('[data-borrar]').addEventListener('click', async () => {
      await borrarAdjunto(id);
      await renderLista(container);
    });
  });
}
