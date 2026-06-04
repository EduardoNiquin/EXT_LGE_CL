// Lectura del toast/snackbar de stock que dispara el botón SKU en el detalle de
// orden. Estructura:
//   <div class="v-snack__wrapper">
//     <div class="v-snack__content"><span><table class="table">
//       <thead><tr><th>Bodega</th><th>Stock Disponible</th></tr></thead>
//       <tbody><tr><td>Bodega LG Store OBS</td><td><strong>99999999990</strong></td></tr></tbody>
//     </table></span></div>
//     <div class="v-snack__action"><button>Ok</button></div>
//   </div>

import { SELECTORS } from '../../constants.js';
import { clickEl } from '../../../../shared/dom/events.js';
import { waitFor, waitForElement, waitForGone } from '../../../../shared/dom/wait.js';

/** Espera a que aparezca el toast (tras click en el botón SKU). */
export function waitToast({ signal, timeout = 6000 } = {}) {
  return waitForElement(SELECTORS.toast, { signal, timeout, description: 'toast de stock' });
}

/** Convierte un texto de stock ("99.999" / "-3" / "99999999990") a número. */
function parseStockNumber(text) {
  const cleaned = String(text ?? '').replace(/[^\d-]/g, '');
  if (cleaned === '' || cleaned === '-') return NaN;
  return Number(cleaned);
}

/**
 * Lee las filas del toast actual: [{ bodega, stock }]. Si no hay toast/tabla
 * devuelve []. Tolera múltiples toasts (toma el último).
 */
export function parseToast() {
  const wrappers = Array.from(document.querySelectorAll(SELECTORS.toast));
  const wrapper = wrappers[wrappers.length - 1];
  if (!wrapper) return [];
  const rows = Array.from(wrapper.querySelectorAll('table tbody tr'));
  return rows.map((tr) => {
    const tds = Array.from(tr.querySelectorAll('td'));
    const bodega = (tds[0]?.textContent ?? '').trim();
    const stockText = (tds[tds.length - 1]?.textContent ?? '').trim();
    return { bodega, stock: parseStockNumber(stockText), stockText };
  }).filter((r) => r.bodega);
}

/**
 * Stock numérico de una bodega puntual dentro de las filas leídas. Devuelve
 * `null` si esa bodega no aparece (se interpreta como "sin stock disponible").
 */
export function stockForBodega(rows, bodega) {
  const want = String(bodega).trim().toLowerCase();
  const row = rows.find((r) => r.bodega.trim().toLowerCase() === want)
    || rows.find((r) => r.bodega.trim().toLowerCase().includes(want));
  if (!row) return null;
  return Number.isFinite(row.stock) ? row.stock : null;
}

/** Cierra el toast (botón "Ok") y espera a que desaparezca. */
export async function dismissToast({ signal, timeout = 3000 } = {}) {
  const btns = Array.from(document.querySelectorAll(SELECTORS.toastAction));
  const ok = btns[btns.length - 1];
  if (ok) clickEl(ok);
  await waitForGone(SELECTORS.toast, { signal, timeout }).catch(() => {});
  // Si quedó algún toast residual, esperar un poco más sin romper.
  await waitFor(() => (document.querySelector(SELECTORS.toast) ? null : true), {
    signal, timeout: 800, interval: 80, description: 'cierre de toast',
  }).catch(() => {});
}
