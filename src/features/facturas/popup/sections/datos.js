// Datos: cargar el Invoice Master File y elegir la factura. Lo leido queda en
// el borrador (documentos ya agrupados, no el workbook) para sobrevivir al
// cierre del popup.
//
// El Excel entra por la zona de `shared/ui/file-intake`: dentro de la red de LG
// el dialogo de "Subir archivo" no devuelve nada, y pegar el archivo copiado en
// el Explorador si funciona.

import { leerMasterFile } from '../../reglas/excel.js';
import { agruparDocumentos } from '../../reglas/agrupar.js';
import { getDraft, setDraft } from '../../state.js';
import { evaluarDocumento } from '../contexto.js';
import { nombreDocumento } from '../utils.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { escapeHtml, formatClp } from '../../../../shared/ui/format.js';
import { extensionDe, fileIntakeHtml, wireFileIntake } from '../../../../shared/ui/file-intake.js';

const EXTENSIONES_EXCEL = ['xlsx', 'xlsm'];

export async function render(container) {
  const draft = await getDraft();

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Invoice Master File</h3>
        <p class="lt-hint">Sube el Excel de Finanzas. Se leen las hojas <strong>Master 1_BU v2</strong>, <strong>Master 2_STEPS</strong> y <strong>Map</strong>; el archivo no se guarda, solo lo que se necesita de el.</p>
        ${fileIntakeHtml({
          id: 'fa-excel-zona',
          titulo: 'Pega aqui el Invoice Master File',
          nota: 'Copialo en el Explorador (Ctrl+C sobre el archivo) y pega aqui: asi entra aunque la red de LG bloquee el boton. El popup se cierra al pasar al Explorador, copia primero y vuelve a abrirlo.',
          boton: 'Subir Excel',
          accept: '.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })}
        <p class="lt-hint" id="fa-archivo">${draft?.archivo ? archivoTexto(draft) : 'Sin archivo cargado.'}</p>
      </section>
      <section class="lt-form-card">
        <h3 class="lt-section-title">Facturas del archivo</h3>
        <p class="lt-hint">Entran las <strong>Pending</strong> de clientes Complex voucher con numero, fecha y montos: facturas (todo en positivo) y notas de credito (todo en negativo). El resto se muestra con su motivo.</p>
        <label class="dt-check">
          <input type="checkbox" id="fa-forzar" ${draft?.forzar ? 'checked' : ''}>
          <span>Permitir elegir facturas no elegibles (solo para pruebas)</span>
        </label>
        <div id="fa-tabla" class="io-table-wrap"></div>
      </section>
    </div>`;

  wireFileIntake(container, { id: 'fa-excel-zona', onArchivos: (archivos) => onArchivo(container, archivos) });
  container.querySelector('#fa-forzar').addEventListener('change', async (event) => {
    const forzar = event.currentTarget.checked; // antes del await: luego currentTarget ya es null
    await setDraft({ ...(await getDraft()), forzar });
    renderTabla(container, await getDraft());
  });
  renderTabla(container, draft);
}

function archivoTexto(draft) {
  const { nombre, cargadoEn } = draft.archivo;
  return `Archivo: <strong>${escapeHtml(nombre)}</strong> (${new Date(cargadoEn).toLocaleString()}) - ${draft.documentos.length} documento(s).`;
}

/** Del lote pegado/arrastrado/elegido se usa el primer Excel; el resto se ignora. */
async function onArchivo(container, archivos) {
  const estado = container.querySelector('#fa-archivo');
  const file = archivos.find((a) => EXTENSIONES_EXCEL.includes(extensionDe(a)));
  if (!file) {
    estado.textContent = `Eso no es un Excel (${EXTENSIONES_EXCEL.map((e) => `.${e}`).join(' o ')}): ${archivos.map((a) => a.name).join(', ')}`;
    return;
  }
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
      <thead><tr><th></th><th>Cliente</th><th>Tipo</th><th>Numero</th><th>Fecha</th><th>Estado</th><th>Neto (CLP)</th><th>Motivo</th></tr></thead>
      <tbody>
        ${filas.map(({ doc, elegibilidad }) => `
          <tr>
            <td><input type="radio" name="fa-doc" value="${escapeHtml(doc.clave)}" ${doc.clave === draft.claveElegida ? 'checked' : ''} ${elegibilidad.elegible || draft.forzar ? '' : 'disabled'}></td>
            <td title="${escapeHtml(doc.commissionType)} / ${escapeHtml(doc.cutDate)}">${escapeHtml(doc.customer)}</td>
            <td>${escapeHtml(nombreDocumento(doc.docType))}</td>
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
