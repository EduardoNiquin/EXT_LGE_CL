import { isAbortError } from '../../../../shared/errors/index.js';
import { clickEl } from '../../../../shared/dom/events.js';
import { waitFor } from '../../../../shared/dom/wait.js';
import { DETAIL_SECTION_SELECTORS, SELECTORS } from '../../constants.js';
import { parseDetailFields } from '../parser.js';
import { collectAllRegionalRows } from './grid.js';

export async function readShippingRuleDetail({ signal, onWarn } = {}) {
  const startedAt = Date.now();
  await waitFor(() => document.querySelector(SELECTORS.detailReady), {
    signal,
    timeout: 20000,
    interval: 150,
    description: 'formulario de Global Shipping Rule',
  });
  const readyAt = Date.now();

  await expandDetailSections({ signal });
  const expandedAt = Date.now();
  const fields = parseDetailFields();
  const regionalStartedAt = Date.now();
  let regionalVia = '';
  const regionalRows = await collectAllRegionalRows({
    signal,
    onWarn,
    onInfo: (info) => { regionalVia = info?.via || ''; },
  });
  const finishedAt = Date.now();
  return {
    fields,
    regionalRows,
    regionalVia,
    timing: {
      readyMs: readyAt - startedAt,
      sectionsMs: expandedAt - readyAt,
      regionalMs: finishedAt - regionalStartedAt,
      totalMs: finishedAt - startedAt,
    },
  };
}

/**
 * Abre las secciones colapsadas del formulario. Magento no monta el contenido de
 * un fieldset colapsado hasta que se expande, asi que leer sin esto devuelve
 * campos vacios (y la grilla regional directamente no existe). Solo toca los
 * headers de las secciones que interesan: ningun boton de guardado ni de borrado.
 *
 * Se clickean todas de una y despues se espera: son colapsables independientes,
 * y hacerlo en serie pagaba la animacion de cada seccion en CADA rule.
 */
export async function expandDetailSections({ signal } = {}) {
  const titles = [...DETAIL_SECTION_SELECTORS, SELECTORS.regionalRoot]
    .map((selector) => ({
      selector,
      title: document.querySelector(selector)?.querySelector(SELECTORS.collapsibleTitle),
    }))
    .filter(({ title }) => title && title.getAttribute('data-state-collapsible') === 'closed');

  titles.forEach(({ title }) => clickEl(title));

  for (const { selector, title } of titles) {
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
    }
  }
}
