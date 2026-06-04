// Flujo de cambio de estado del pedido: abrir el detalle, click "Cambiar estado",
// elegir el estado objetivo en el diálogo, guardar y persistir (FAB).

import { PAGE_TYPE, ROUTES, TEXTS } from '../../constants.js';
import { gotoRoute, onPageType } from './navigate.js';
import { findButtonByText, findFabSave } from '../vuetify/buttons.js';
import { dialogButton, getDialog, waitDialog, waitDialogClosed } from '../vuetify/dialog.js';
import { selectByLabel } from '../vuetify/select.js';
import { clickEl } from '../../../../shared/dom/events.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('starkoms');

/**
 * Cambia el estado de la orden a `targetState` (default "Ingresado").
 *   1. Navega al detalle y click "Cambiar estado".
 *   2. En el diálogo, elige "Estado del pedido" = targetState.
 *   3. Guarda el diálogo y luego el FAB de persistir (según Pedida.md).
 * En dryRun cierra el diálogo (Cancelar) sin guardar.
 * Devuelve { ok, reason? }.
 */
export async function setOrderState(orderNumber, { signal, dryRun = false, targetState = TEXTS.TARGET_STATE } = {}) {
  await gotoRoute(ROUTES.orderDetail(orderNumber), {
    ready: () => (onPageType(PAGE_TYPE.ORDER_DETAIL)() && findButtonByText(TEXTS.CHANGE_STATE_BTN) ? true : null),
    signal,
  });

  const changeBtn = findButtonByText(TEXTS.CHANGE_STATE_BTN);
  if (!changeBtn) return { ok: false, reason: 'No se encontró el botón "Cambiar estado"' };
  clickEl(changeBtn);

  const dialog = await waitDialog({ signal });
  await sleep(250, signal).catch(() => {});

  await selectByLabel({ labelText: TEXTS.ESTADO_PEDIDO_LABEL, optionText: targetState, root: dialog, signal });
  await sleep(250, signal).catch(() => {});

  if (dryRun) {
    const cancel = dialogButton('Cancelar');
    if (cancel) clickEl(cancel);
    await waitDialogClosed({ signal }).catch(() => {});
    log.info(`[simulación] estado de #${orderNumber} → "${targetState}" (no se guarda)`);
    return { ok: true, dryRun: true };
  }

  const saveDialog = dialogButton(TEXTS.SAVE);
  if (!saveDialog) return { ok: false, reason: 'No se encontró "Guardar" en el diálogo de estado' };
  clickEl(saveDialog);
  await waitDialogClosed({ signal, timeout: 8000 }).catch(() => {});
  await sleep(500, signal).catch(() => {});

  // Persistir con el FAB de guardar (segundo botón según Pedida.md).
  const fab = await waitFor(() => findFabSave(), { signal, timeout: 4000, interval: 150, description: 'FAB de guardar' })
    .catch(() => null);
  if (fab) {
    clickEl(fab);
    await sleep(1200, signal).catch(() => {});
  } else {
    log.warn('no se encontró el FAB de guardar; el diálogo pudo haber persistido directamente');
  }

  // Si quedó un diálogo abierto (p.ej. faltó subestado) lo reportamos.
  if (getDialog()) {
    return { ok: false, reason: 'El diálogo de estado sigue abierto tras guardar (¿falta subestado?)' };
  }

  log.info(`estado de #${orderNumber} → "${targetState}"`);
  return { ok: true };
}
