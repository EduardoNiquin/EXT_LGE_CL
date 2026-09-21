// Rotulos del popup de "Facturas".

import { TIPOS_DOCUMENTO } from '../constants.js';

/** "factura" / "nota de credito" para mostrar; el Doc Type tal cual si no se conoce. */
export function nombreDocumento(docType) {
  return TIPOS_DOCUMENTO[docType]?.label || docType || 'documento';
}
