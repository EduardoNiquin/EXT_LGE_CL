// Extractor de la operación `getProductsBySku` cuando llega con operationName
// EXPLÍCITO (caso landing promocional desde AEM: una "PLP especial" cuya query
// solo pide `sku` por cada producto que la conforma).
//
// Nota: en la PDP/PBP/PLP normales esta misma query llega ANÓNIMA y el bridge la
// clasifica como `products` (vía data-key), así que cae al extractor `products`.
// Acá cubrimos el caso nombrado: si la respuesta trae data rica delegamos en
// `extractProducts`; si solo trae SKUs (la landing), listamos esos SKUs en un
// único grupo para poder copiarlos en bloque.

import { extractProducts } from './products.js';

export function extractProductsBySku(response) {
  const items = response?.data?.products?.items;
  if (!Array.isArray(items)) return null;
  if (items.length === 0) return [];

  // Si la respuesta trae data rica (precio/stock/nombre), reutilizamos el
  // extractor de `products` (mismo shape).
  const hasRich = items.some(
    (p) => p && (p.price_range || p.stock_status != null || p.name || p.msrp_price != null),
  );
  if (hasRich) return extractProducts(response);

  // Landing promocional: solo SKUs. Un grupo con la lista (cada SKU copiable).
  const fields = items
    .map((p, i) => {
      const sku = p?.sku;
      if (sku == null || sku === '') return null;
      return { label: `SKU ${i + 1}`, value: String(sku), raw: String(sku) };
    })
    .filter(Boolean);

  return [
    {
      id: 'landing-skus',
      label: `Productos de la landing (${fields.length})`,
      fields,
    },
  ];
}
