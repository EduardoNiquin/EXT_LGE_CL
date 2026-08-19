import { isAbortError } from '../../../../shared/errors/index.js';
import { clickEl } from '../../../../shared/dom/events.js';
import { sleep, waitFor } from '../../../../shared/dom/wait.js';
import { DETAIL_SECTION_SELECTORS, SELECTORS } from '../../constants.js';
import { parseDetailFields } from '../parser.js';
import { collectAllRegionalRows } from './grid.js';

export async function readShippingRuleDetail({ signal, onWarn } = {}) {
  await waitFor(() => document.querySelector(SELECTORS.detailReady), {
    signal,
    timeout: 20000,
    interval: 150,
    description: 'formulario de Global Shipping Rule',
  });

  await expandDetailSections({ signal });
  const fields = parseDetailFields();
  const regionalRows = await collectAllRegionalRows({ signal, onWarn });
  return { fields, regionalRows };
}

/**
 * Abre las secciones colapsadas del formulario. Magento no monta el contenido de
 * un fieldset colapsado hasta que se expande, asi que leer sin esto devuelve
 * campos vacios (y la grilla regional directamente no existe). Solo toca los
 * headers de las secciones que interesan: ningun boton de guardado ni de borrado.
 */
export async function expandDetailSections({ signal } = {}) {
  for (const selector of [...DETAIL_SECTION_SELECTORS, SELECTORS.regionalRoot]) {
    const root = document.querySelector(selector);
    const title = root?.querySelector(SELECTORS.collapsibleTitle);
    if (!title || title.getAttribute('data-state-collapsible') !== 'closed') continue;

    clickEl(title);
    try {
      await waitFor(() => title.getAttribute('data-state-collapsible') === 'open', {
        signal,
        timeout: 5000,
        interval: 100,
        description: `seccion ${selector} abierta`,
      });
    } catch (err) {
      if (isAbortError(err, signal)) throw err;
      // Una seccion que no abre no justifica perder el resto del detalle: los
      // campos que si estan montados se leen igual.
      continue;
    }
    await sleep(120, signal);
  }
}
