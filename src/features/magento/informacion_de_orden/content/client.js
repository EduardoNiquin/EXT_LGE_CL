// Una consulta al grid de ordenes.
//
// El fetch sale del content script a proposito: es el MISMO ORIGEN que el admin,
// asi que la cookie de sesion viaja sola y no hacen falta permisos nuevos ni
// pelear con SameSite desde el service worker.
//
// Tres cosas que no se pueden dar por sentadas (docs/intrucciones.md seccion 7):
//   1. `ORDER_FILTER_ERROR` llega con HTTP 200: se detecta por el CONTENIDO.
//   2. La respuesta es HTML, no JSON; el JSON va embebido.
//   3. `totalRecords === 0` no es un error: es "no hay ordenes en esa ventana".

import { ExtError } from '../../../../shared/errors/index.js';
import { buildGridUrl } from '../grid-request.js';
import { extractGridData, filterErrorMessage, isFilterError } from '../grid-parse.js';

/**
 * @param {object} o
 * @param {string} o.endpoint  update_url resuelto en runtime
 * @param {object} o.query     { from, to, incrementId?, page?, pageSize? }
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<{ items: object[], totalRecords: number }>}
 */
export async function fetchGridPage({ endpoint, query, signal }) {
  const url = buildGridUrl(endpoint, query);
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'text/html, */*',
    },
    signal,
  });

  if (!response.ok) {
    throw new ExtError(`El grid respondio ${response.status}.`, {
      code: 'IO_GRID_HTTP',
      context: { status: response.status },
    });
  }

  const body = await response.text();

  if (isFilterError(body)) {
    throw new ExtError(filterErrorMessage(body), { code: 'IO_FILTER_ERROR' });
  }

  const data = extractGridData(body);
  if (!data) {
    throw new ExtError(
      'La respuesta del grid no trae datos. Puede haber caducado la sesion del admin: abre el listado de ordenes y vuelve a intentar.',
      { code: 'IO_NO_DATA' },
    );
  }

  return data;
}
