import { waitFor } from '../../../../shared/dom/wait.js';
import { SELECTORS } from '../../constants.js';
import { parseDetailFields } from '../parser.js';
import { collectAllRegionalRows } from './grid.js';

export async function readShippingRuleDetail({ signal } = {}) {
  await waitFor(() => document.querySelector(SELECTORS.detailReady), {
    signal,
    timeout: 20000,
    interval: 150,
    description: 'formulario de Global Shipping Rule',
  });

  const fields = parseDetailFields();
  const regionalRows = await collectAllRegionalRows({ signal });
  return { fields, regionalRows };
}
