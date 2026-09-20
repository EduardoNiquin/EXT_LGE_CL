// Ejecutar: requisitos (VPN, pestana en Complex Voucher, plan sin errores),
// la corrida en vivo y los botones que la gobiernan. El trabajo lo hace el
// content script de la pestana de GEVS; esta vista solo refleja el run.
//
// La corrida termina en "guardada con adjuntos": el Submit lo hace la persona
// en GEVS y esta vista se lo dice. Con "bitacora" la corrida entera (lo que
// hizo la extension y lo que hizo la persona, Submit incluido) se graba con
// Registro de acciones y se descarga sola al terminar.

import { FASE, FASE_LABEL, FINISH_REASON, MESSAGES, PANTALLA, PASOS } from '../../constants.js';
import { clearRun, getRun, setPlan, subscribeToRun, updateRun } from '../../state.js';
import { cargarContexto } from '../contexto.js';
import { getEstadoOInicial } from '../../../vpn/state.js';
import { EXPORT as EXPORT_REGISTRO } from '../../../registro-acciones/constants.js';
import { sendMessage, sendMessageToActiveTab } from '../../../../shared/messaging/messaging.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { escapeHtml } from '../../../../shared/ui/format.js';
import { logPanelHtml, renderLogPanel } from '../../../../shared/ui/log-panel.js';

const FINISH_TITLE = {
  [FINISH_REASON.DONE]: 'Submit confirmado por GEVS',
  [FINISH_REASON.GUARDADO]: 'Factura guardada en GEVS (Submit por tu cuenta)',
  [FINISH_REASON.CANCELLED]: 'Corrida detenida',
  [FINISH_REASON.ERROR]: 'La corrida se detuvo con error',
  [FINISH_REASON.NOT_DETECTED]: 'No se encontro la pantalla de Complex Voucher',
};

let unsubscribe = null;

export async function render(container) {
  if (unsubscribe) unsubscribe();
  const [ctx, run, requisitos] = await Promise.all([cargarContexto(), getRun(), comprobarRequisitos()]);

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Ejecutar en GEVS</h3>
        <ul class="lt-hint" id="fa-requisitos"></ul>
        <label class="dt-check">
          <input type="checkbox" id="fa-paso-a-paso">
          <span>Paso a paso (se detiene tras cada paso y sigue con "Continuar")</span>
        </label>
        <label class="dt-check">
          <input type="checkbox" id="fa-bitacora" checked>
          <span>Grabar bitacora: lo que hace la extension y lo que haces tu (Submit incluido), en Markdown.
            Se descarga sola al terminar en Descargas/${escapeHtml(EXPORT_REGISTRO.carpeta)}/</span>
        </label>
        <div class="lt-actions">
          <button type="button" id="fa-iniciar" class="ct-btn ct-btn--primary">Iniciar (hasta Save)</button>
          <button type="button" id="fa-continuar" class="ct-btn ct-btn--primary hidden">Continuar</button>
          <button type="button" id="fa-terminar" class="ct-btn ct-btn--primary hidden">Terminar (ya hice el Submit)</button>
          <button type="button" id="fa-cancelar" class="ct-btn ct-btn--ghost" disabled>Detener</button>
          <button type="button" id="fa-limpiar" class="ct-btn ct-btn--ghost hidden">Limpiar</button>
        </div>
      </section>
      <section id="fa-progreso" class="lt-progress hidden">
        <div class="lt-progress-head">
          <strong id="fa-progreso-titulo"></strong>
          <span id="fa-progreso-contador" class="dt-progress-counter"></span>
        </div>
        <div id="fa-progreso-barra" class="lt-progress-bar"><span></span></div>
        <p id="fa-progreso-detalle" class="lt-hint"></p>
        <p id="fa-entrega" class="lt-stat-ok hidden"></p>
        <p id="fa-bitacora-info" class="lt-hint hidden"></p>
        ${logPanelHtml({ title: 'Registro', open: true })}
      </section>
    </div>`;

  renderRequisitos(container, ctx, requisitos);
  container.querySelector('#fa-iniciar').addEventListener('click', () => onIniciar(container, ctx, requisitos));
  container.querySelector('#fa-continuar').addEventListener('click', () => updateRun((r) => ({ ...r, pausado: false })));
  container.querySelector('#fa-terminar').addEventListener('click', onTerminar);
  container.querySelector('#fa-cancelar').addEventListener('click', onCancelar);
  container.querySelector('#fa-limpiar').addEventListener('click', () => onLimpiar(container));

  pintarRun(container, run);
  unsubscribe = subscribeToRun((nuevo) => {
    if (!container.isConnected) { unsubscribe?.(); unsubscribe = null; return; }
    pintarRun(container, nuevo);
  });
}

// --- requisitos ---------------------------------------------------------------

async function comprobarRequisitos() {
  const [vpn, pagina] = await Promise.all([
    getEstadoOInicial(),
    sendMessageToActiveTab({ type: MESSAGES.GET_PAGE_DATA }).catch((err) => ({ ok: false, reason: toMessage(err) })),
  ]);
  return { vpn, pagina };
}

function listaRequisitos(ctx, { vpn, pagina }) {
  const enEntry = pagina?.ok && pagina.pantalla === PANTALLA.ENTRY;
  const items = [
    [vpn.conectado, vpn.conectado ? 'VPN conectada' : 'VPN desconectada: conectala en el apartado VPN'],
    [enEntry, enEntry
      ? `Pestana en Complex Voucher Entry (batchId ${pagina.batchId})`
      : `La pestana activa no esta en Complex Voucher Entry${pagina?.reason ? ` (${pagina.reason})` : ''}`],
    [!!ctx.plan && !ctx.plan.errores.length, ctx.plan
      ? (ctx.plan.errores.length ? `Plan con errores: ${ctx.plan.errores.join(' ')}` : `Plan listo: ${ctx.plan.customer} ${ctx.plan.invoiceNumber}`)
      : 'Elige una factura en Datos'],
  ];
  if (ctx.documento && !ctx.elegibilidad.elegible) {
    items.push([!!ctx.draft.forzar, `Factura no elegible (${ctx.elegibilidad.motivos.join('; ')})${ctx.draft.forzar ? ': se fuerza' : ''}`]);
  }
  if (ctx.yaProcesada) items.push([false, `Ya procesada antes (batch ${ctx.yaProcesada.batchId || '-'}): limpia el resultado o elige otra`]);
  if (enEntry && pagina.batchId !== 0) items.push([false, 'La pantalla ya tiene un batchId: abre un Complex Voucher nuevo (batchId=0)']);
  return items;
}

function renderRequisitos(container, ctx, requisitos) {
  const items = listaRequisitos(ctx, requisitos);
  container.querySelector('#fa-requisitos').innerHTML = items
    .map(([ok, texto]) => `<li class="${ok ? 'lt-stat-ok' : 'lt-err'}">${ok ? 'OK' : 'Falta'}: ${escapeHtml(texto)}</li>`)
    .join('');
  container.querySelector('#fa-iniciar').disabled = !items.every(([ok]) => ok);
}

// --- acciones -----------------------------------------------------------------

async function onIniciar(container, ctx, requisitos) {
  if ((await getRun())?.active) return;
  if (!listaRequisitos(ctx, requisitos).every(([ok]) => ok)) return;
  const config = {
    pasoAPaso: container.querySelector('#fa-paso-a-paso').checked,
    bitacora: container.querySelector('#fa-bitacora').checked,
  };
  const resumen = `${ctx.plan.customer} ${ctx.plan.invoiceNumber}: ${ctx.plan.resumen.filasDebit} filas, credito ${ctx.plan.resumen.credit}.`;
  if (!confirm(`Cargar en GEVS hasta Save? El Submit lo haces tu despues.\n${resumen}\nBitacora: ${config.bitacora ? 'si' : 'no'}.`)) return;
  await setPlan(ctx.plan);
  const respuesta = await sendMessage({ type: MESSAGES.INICIAR, plan: ctx.plan, config });
  if (!respuesta?.ok) alert(`No se pudo iniciar: ${respuesta?.reason || 'sin respuesta del service worker'}`);
}

/** La persona ya hizo el Submit (o no lo hara ahora): se cierra la corrida sin esperar la Reference. */
async function onTerminar() {
  const run = await getRun();
  if (!run?.active || run.fase !== FASE.LISTO_PARA_ENVIAR) return;
  await updateRun((r) => ({ ...r, active: false, finishedAt: Date.now(), finishReason: FINISH_REASON.GUARDADO }));
}

async function onCancelar() {
  if (!confirm('Detener la corrida? Lo ya escrito en GEVS queda como este en la pantalla.')) return;
  await updateRun((r) => ({ ...r, active: false, finishedAt: Date.now(), finishReason: FINISH_REASON.CANCELLED }));
}

async function onLimpiar(container) {
  await clearRun();
  container.querySelector('#fa-progreso').classList.add('hidden');
}

// --- run ----------------------------------------------------------------------

function pintarRun(container, run) {
  const activo = !!run?.active;
  const esperandoSubmit = activo && run.fase === FASE.LISTO_PARA_ENVIAR;
  container.querySelector('#fa-cancelar').disabled = !activo || esperandoSubmit;
  container.querySelector('#fa-limpiar').classList.toggle('hidden', !run || activo);
  container.querySelector('#fa-continuar').classList.toggle('hidden', !(activo && run.pausado));
  container.querySelector('#fa-terminar').classList.toggle('hidden', !esperandoSubmit);
  if (activo) container.querySelector('#fa-iniciar').disabled = true;

  const seccion = container.querySelector('#fa-progreso');
  if (!run) { seccion.classList.add('hidden'); return; }
  seccion.classList.remove('hidden');

  const hechos = run.pasosHechos.length;
  const total = PASOS.length;
  container.querySelector('#fa-progreso-titulo').textContent = !run.active && run.finishReason
    ? FINISH_TITLE[run.finishReason] || 'Corrida terminada'
    : FASE_LABEL[run.fase] || 'Cargando...';
  container.querySelector('#fa-progreso-contador').textContent = `${hechos} / ${total}`;
  container.querySelector('#fa-progreso-barra span').style.width = `${Math.round((hechos / total) * 100)}%`;

  const paso = PASOS.find((p) => p.id === run.paso);
  const detalle = [];
  if (run.error) detalle.push(run.error);
  else if (run.pausado) detalle.push(`En pausa antes de: ${paso?.label || run.paso}. Pulsa Continuar.`);
  else if (run.active && paso && run.fase === FASE.CARGANDO) detalle.push(`Paso: ${paso.label}`);
  if (run.batchId) detalle.push(`batchId ${run.batchId}`);
  if (run.reference) detalle.push(`Reference ${run.reference}`);
  container.querySelector('#fa-progreso-detalle').textContent = detalle.join(' - ');

  const entrega = container.querySelector('#fa-entrega');
  entrega.classList.toggle('hidden', !esperandoSubmit);
  if (esperandoSubmit) {
    entrega.textContent = `Voucher ${run.batchId} guardado con ${run.plan.adjuntos.length} adjunto(s). Revisalo en GEVS y pulsa Submit tu: si pide "reset button of approval info", Reset y Submit otra vez; en el modal de avisos marca las filas y Apply. Cuando GEVS muestre "Submitted Successfully" la extension anota la Reference y cierra sola; si no vas a enviar ahora, pulsa Terminar.`;
  }

  const bitacora = container.querySelector('#fa-bitacora-info');
  bitacora.classList.toggle('hidden', !run.bitacora);
  if (run.bitacora) {
    bitacora.textContent = run.bitacora.propia
      ? `Bitacora: ${run.bitacora.sesionId}${run.active ? ' (grabando; se descarga al terminar)' : ` (descargada en Descargas/${EXPORT_REGISTRO.carpeta}/${run.bitacora.sesionId}/)`}`
      : `Bitacora: se anota en tu grabacion de Registro de acciones ya activa (${run.bitacora.sesionId}); detenla y exportala desde ese apartado.`;
  }
  renderLogPanel(seccion, run.log || []);
}
