// "Configuración" de Revisar Destacados.
//
// - Categorías a revisar: van EN DURO en el código (constants.js →
//   DESTACADOS_URLS), porque un panel persistente se perdería al reinstalar la
//   extensión (ver Pedida.md, punto 1). Se muestran en modo lectura.
// - Revisión automática: el usuario la enciende y define cada cuántos minutos
//   se revisa. Corre en segundo plano mientras haya una pestaña de www.lg.com
//   abierta (lo maneja el content script; ver content/destacados/auto.js).

import {
  DESTACADOS_AUTO_DEFAULT,
  DESTACADOS_AUTO_MAX_MINUTES,
  DESTACADOS_AUTO_MIN_MINUTES,
  DESTACADOS_URLS,
  STORAGE_KEYS,
} from '../../../constants.js';
import { getStorage, setStorage } from '../../../../../shared/storage/storage.js';
import { escapeHtml } from '../../utils.js';

function clampMinutes(min) {
  const n = Number(min);
  if (!Number.isFinite(n)) return DESTACADOS_AUTO_DEFAULT.intervalMinutes;
  return Math.max(DESTACADOS_AUTO_MIN_MINUTES, Math.min(DESTACADOS_AUTO_MAX_MINUTES, Math.round(n)));
}

export async function render(container) {
  const cfg = (await getStorage(STORAGE_KEYS.DESTACADOS_AUTO)) || DESTACADOS_AUTO_DEFAULT;
  const enabled = Boolean(cfg.enabled);
  const interval = clampMinutes(cfg.intervalMinutes ?? DESTACADOS_AUTO_DEFAULT.intervalMinutes);

  const rows = DESTACADOS_URLS.map((u) => `
    <li class="lg-dest-cfg-item">
      <span class="lg-dest-cfg-label">${escapeHtml(u.label)}</span>
      <a class="lg-dest-cfg-url" href="${escapeHtml(u.url)}" target="_blank" rel="noopener">${escapeHtml(u.url)}</a>
    </li>
  `).join('');

  container.innerHTML = `
    <div class="lt-view">
      <section class="lt-form-card">
        <h3 class="lt-section-title">Revisión automática</h3>
        <p class="lt-hint">
          Revisa los destacados en segundo plano cada cierto tiempo, sin abrir el
          popup. Funciona mientras haya una pestaña de <strong>www.lg.com</strong>
          abierta; si no hay ninguna, la revisión queda en pausa hasta que abra una.
        </p>

        <label class="dt-check">
          <input type="checkbox" id="lg-dest-auto-on" ${enabled ? 'checked' : ''}>
          <span>Activar revisión automática</span>
        </label>

        <div class="dt-field">
          <label class="dt-label" for="lg-dest-auto-interval">Revisar cada (minutos)</label>
          <input id="lg-dest-auto-interval" class="dt-input" type="number"
                 min="${DESTACADOS_AUTO_MIN_MINUTES}" max="${DESTACADOS_AUTO_MAX_MINUTES}"
                 value="${interval}" ${enabled ? '' : 'disabled'}>
          <p class="lt-hint">Entre ${DESTACADOS_AUTO_MIN_MINUTES} y ${DESTACADOS_AUTO_MAX_MINUTES} minutos.</p>
        </div>
        <p id="lg-dest-auto-msg" class="lg-dest-stamp"></p>
      </section>

      <section class="lt-form-card">
        <h3 class="lt-section-title">Categorías a revisar (${DESTACADOS_URLS.length})</h3>
        <p class="lt-hint">
          Estas son las páginas cuyos destacados se revisan. Por ahora se definen
          en el código (no se editan aquí) para que no se pierdan al actualizar la
          extensión. Para agregar o quitar categorías, edite
          <code>DESTACADOS_URLS</code> en <code>constants.js</code>.
        </p>
        ${DESTACADOS_URLS.length
          ? `<ul class="lg-dest-cfg-list">${rows}</ul>`
          : `<p class="ct-empty">No hay categorías configuradas.</p>`}
      </section>
    </div>`;

  const onInput = container.querySelector('#lg-dest-auto-interval');
  const onCheck = container.querySelector('#lg-dest-auto-on');
  const msg = container.querySelector('#lg-dest-auto-msg');

  const save = async () => {
    const next = {
      enabled: onCheck.checked,
      intervalMinutes: clampMinutes(onInput.value),
    };
    onInput.disabled = !next.enabled;
    onInput.value = String(next.intervalMinutes);
    await setStorage(STORAGE_KEYS.DESTACADOS_AUTO, next);
    msg.textContent = next.enabled
      ? `Revisión automática activada: cada ${next.intervalMinutes} min.`
      : 'Revisión automática desactivada.';
  };

  onCheck.addEventListener('change', save);
  onInput.addEventListener('change', save);
}
