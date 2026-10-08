// Credenciales de la API de SellerCenter. Vienen incluidas en la extension
// (cifradas en el build; el popup nunca ve la API Key, solo el UserID). Aqui se
// pueden reemplazar por otras (guardadas solo en este navegador) y volver a las
// incluidas.

import { MESSAGES } from '../../constants.js';
import { setCredenciales } from '../../state.js';
import { sendMessage } from '../../../../shared/messaging/messaging.js';
import { escapeHtml } from '../../../../shared/ui/format.js';
import { toMessage } from '../../../../shared/errors/index.js';

export async function render(container) {
  const estado = await sendMessage({ type: MESSAGES.ESTADO_CREDENCIALES }).catch(() => null);
  const fuente = estado?.fuente;

  const actual = fuente === 'incluidas'
    ? `<p class="oi-alert oi-alert--success">Usando las credenciales <strong>incluidas en la extension</strong> (${escapeHtml(estado.userId)}). No hace falta configurar nada.</p>`
    : fuente === 'propias'
      ? `<p class="oi-alert oi-alert--info">Usando credenciales <strong>propias</strong> de este navegador (${escapeHtml(estado.userId)}).</p>`
      : '<p class="oi-alert oi-alert--warning">Esta version no trae credenciales incluidas: cargalas abajo.</p>';

  container.innerHTML = `
    <div class="lt-view epr-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Credenciales de la API</h3>
        ${actual}
        <div class="lt-actions">
          <button type="button" id="fsc-test" class="ct-btn ct-btn--ghost" ${fuente ? '' : 'disabled'}>Probar conexion</button>
          ${fuente === 'propias' ? '<button type="button" id="fsc-reset" class="ct-btn ct-btn--ghost">Volver a las incluidas</button>' : ''}
        </div>
        <details class="ct-diag fsc-field" ${fuente ? '' : 'open'}>
          <summary>Usar otras credenciales</summary>
          <p class="lt-hint">
            La API no usa la contrasena del portal: se firma con la <strong>API Key</strong> del usuario
            integrador (SellerCenter → Mi cuenta → Usuarios → columna <em>Api Key</em>). Se guardan solo en este navegador.
          </p>
          <label class="epr-field">
            <span class="epr-label">UserID (correo)</span>
            <input type="email" id="fsc-user" class="dt-input" autocomplete="off">
          </label>
          <label class="epr-field fsc-field">
            <span class="epr-label">API Key</span>
            <input type="password" id="fsc-key" class="dt-input" autocomplete="off">
          </label>
          <div class="lt-actions">
            <button type="button" id="fsc-save" class="ct-btn ct-btn--primary">Guardar y probar</button>
          </div>
        </details>
        <div id="fsc-cred-msg" class="epr-result"></div>
      </section>
    </div>`;

  const msg = container.querySelector('#fsc-cred-msg');
  const show = (kind, text) => { msg.innerHTML = `<p class="oi-alert oi-alert--${kind}">${escapeHtml(text)}</p>`; };

  const probar = async (boton, payload) => {
    boton.disabled = true;
    show('info', 'Probando contra la API…');
    try {
      return await sendMessage({ type: MESSAGES.PROBAR_CREDENCIALES, payload });
    } catch (err) {
      return { ok: false, reason: toMessage(err) };
    } finally {
      boton.disabled = false;
    }
  };

  const test = container.querySelector('#fsc-test');
  test.addEventListener('click', async () => {
    const res = await probar(test);
    if (res?.ok) show('success', `La API responde (${res.total} orden(es) en las ultimas 24 h).`);
    else show('error', res?.reason || 'Sin respuesta.');
  });

  container.querySelector('#fsc-reset')?.addEventListener('click', async () => {
    await setCredenciales(null);
    render(container);
  });

  const save = container.querySelector('#fsc-save');
  save.addEventListener('click', async () => {
    const nueva = {
      userId: container.querySelector('#fsc-user').value.trim(),
      apiKey: container.querySelector('#fsc-key').value.trim(),
    };
    if (!nueva.userId || !nueva.apiKey) { show('error', 'Completa UserID y API Key.'); return; }
    const res = await probar(save, nueva);
    if (!res?.ok) { show('error', `No se guardaron: ${res?.reason || 'sin respuesta'}`); return; }
    await setCredenciales(nueva);
    await render(container);
    show('success', `Guardadas. La API responde (${res.total} orden(es) en las ultimas 24 h).`);
  });
}
