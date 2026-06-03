// Registro de extractores por operationName. Cada extractor es una función pura
// `(response) => grupos | null` reutilizable en content y popup. Las operaciones
// sin extractor caen a la vista de JSON crudo en el popup.

import { extractPbpProduct } from './pbp-product.js';
import { extractAddressLevel1 } from './address-level1.js';
import { extractAddressLevel2 } from './address-level2.js';
import { extractProducts } from './products.js';
import { extractRetrieveProductList } from './retrieve-product-list.js';

export const EXTRACTORS = {
  getPbpProduct: extractPbpProduct,
  getAddressLevel1: extractAddressLevel1,
  getAddressLevel2: extractAddressLevel2,
  products: extractProducts,
  retrieveProductList: extractRetrieveProductList,
};

export function hasExtractor(operationName) {
  return typeof EXTRACTORS[operationName] === 'function';
}

export function extract(operationName, response) {
  const fn = EXTRACTORS[operationName];
  return fn ? fn(response) : null;
}
