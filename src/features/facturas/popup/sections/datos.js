// Datos: cargar el Invoice Master File y elegir la factura. Lo leido queda en
// el borrador (documentos ya agrupados, no el workbook) para sobrevivir al
// cierre del popup.

import { leerMasterFile } from '../../reglas/excel.js';
import { agruparDocumentos } from '../../reglas/agrupar.js';
import { getDraft, setDraft } from '../../state.js';
import { evaluarDocumento } from '../contexto.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { escapeHtml, formatClp } from '../../../../shared/ui/format.js';

export async function render(container) {
  const draft = await getDraft();

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Invoice Master File</h3>
        <p class="lt-hint">Sube el Excel de Finanzas. Se leen las hojas <strong>Master 1_BU v2</strong>, <strong>Master 2_STEPS</strong> y <strong>Map</strong>; el archivo no se guarda, solo lo que se necesita de el.</p>
        <label class="ct-btn ct-btn--ghost io-file-btn">
          Subir Excel
          <input type="file" id="fa-excel" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
        </label>
        <p class="lt-hint" id="fa-archivo">${draft?.archivo ? archivoTexto(draft) : 'Sin archivo cargado.'}</p>
      </section>
      <section class="lt-form-card">
        <h3 class="lt-section-title">Facturas del archivo</h3>
        <p class="lt-hint">Entran las <strong>Pending</strong> de clientes Complex voucher con numero, fecha y montos. El resto se muestra con su motivo.</p>
        <label class="dt-check">
          <input type="checkbox" id="fa-forzar" ${draft?.forzar ? 'checked' : ''}>
          <span>Permitir elegir facturas no elegibles (solo para pruebas)</span>
        </label>
        <div id="fa-tabla" class="io-table-wrap"></div>
      </section>
    </div>`;

  container.querySelector('#fa-excel').addEventListener('change', (event) => onArchivo(container, event.currentTarget));
  container.querySelector('#fa-forzar').addEventListener('change', async (event) => {
    const forzar = event.currentTarget.checked; // antes del await: luego currentTarget ya es null
    await setDraft({ ...(await getDraft()), forzar });
    renderTabla(container, await getDraft());
  });
  renderTabla(container, draft);
}

function archivoTexto(draft) {
  const { nombre, cargadoEn } = draft.archivo;
  return `Archivo: <strong>${escapeHtml(nombre)}</strong> (${new Date(cargadoEn).toLocaleString()}) - ${draft.documentos.length} factura(s).`;
}

async function onArchivo(container, input) {
  const file = input.files?.[0];
  if (!file) return;
  const estado = container.querySelector('#fa-archivo');
  estado.textContent = `Leyendo ${file.name}...`;
  try {
    const libro = leerMasterFile(await file.arrayBuffer());
    const documentos = agruparDocumentos(libro.master1);
    if (!documentos.length) throw new Error('No se encontraron facturas en Master 1.');
    const previo = await getDraft();
    const draft = {
      archivo: { nombre: file.name, tamano: file.size, cargadoEn: Date.now() },
      documentos,
      master2: libro.master2,
      mapa: libro.mapa,
      claveElegida: documentos.some((d) => d.clave === previo?.claveElegida) ? previo.claveElegida : null,
      // Lo que marca la casilla ahora, no lo que habia guardado: la persona
      // puede haberla tocado mientras se leia el archivo.
      forzar: container.querySelector('#fa-forzar').checked,
    };
    await setDraft(draft);
    estado.innerHTML = archivoTexto(draft);
    renderTabla(container, draft);
  } catch (err) {
    estado.textContent = `No se pudo leer el archivo: ${toMessage(err)}`;
  } finally {
    input.value = '';
  }
}

function renderTabla(container, draft) {
  const wrap = container.querySelector('#fa-tabla');
  if (!draft?.documentos?.length) {
    wrap.innerHTML = '<p class="ct-empty">Carga el Excel para ver las facturas.</p>';
    return;
  }
  const filas = draft.documentos.map((doc) => ({ doc, ...evaluarDocumento(draft, doc) }));
  wrap.innerHTML = `
    <table class="io-table">
      <thead><tr><th></th><th>Cliente</th><th>Factura</th><th>Fecha</th><th>Estado</th><th>Neto (CLP)</th><th>Motivo</th></tr></thead>
      <tbody>
        ${filas.map(({ doc, elegibilidad }) => `
          <tr>
            <td><input type="radio" name="fa-doc" value="${escapeHtml(doc.clave)}" ${doc.clave === draft.claveElegida ? 'checked' : ''} ${elegibilidad.elegible || draft.forzar ? '' : 'disabled'}></td>
            <td title="${escapeHtml(doc.commissionType)} / ${escapeHtml(doc.cutDate)}">${escapeHtml(doc.customer)}</td>
            <td>${escapeHtml(doc.invoiceNumber || '-')}</td>
            <td>${escapeHtml(doc.invoiceDate || '-')}</td>
            <td>${escapeHtml(doc.status)}</td>
            <td>${formatClp(doc.total?.neto)}</td>
            <td title="${escapeHtml(elegibilidad.motivos.join('; '))}">${elegibilidad.elegible ? 'elegible' : escapeHtml(elegibilidad.motivos.join('; '))}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('input[name="fa-doc"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      await setDraft({ ...(await getDraft()), claveElegida: radio.value });
    });
  });
}
