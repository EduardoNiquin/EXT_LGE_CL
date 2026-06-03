// Extractor de la operación REST `retrieveProductList` (catálogo de la PLP).
//
// La respuesta trae `productLists[]`, cada una con un `productList[]` de modelos.
// Generamos un grupo por modelo (label = nombre amigable) con la info relevante,
// priorizando los TAGS (foco del proyecto): productTag1/2 con su tipo, categoría
// y vigencia, además del delivery tag.

function formatCLP(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `$${n.toLocaleString('es-CL')}`;
}

function field(label, raw, formatted) {
  if (raw == null || raw === '') return null;
  const display = formatted != null ? formatted : String(raw);
  return { label, value: String(display), raw: String(raw) };
}

// "2026-05-31 00:00:00" + "2026-06-03 23:30:00" → "2026-05-31 00:00 → 2026-06-03 23:30"
function vigencia(begin, end) {
  const clip = (s) => String(s || '').trim().replace(/:00$/, '');
  if (!begin && !end) return null;
  return `${clip(begin) || '—'} → ${clip(end) || '—'}`;
}

function tagFields(prefix, item, n) {
  const tag = item[`productTag${n}`];
  if (!tag) return [];
  return [
    field(`${prefix}Tag ${n}`, tag),
    field(`${prefix}Tag ${n} — tipo`, item[`productTag${n}Type`]),
    field(`${prefix}Tag ${n} — categoría`, item[`productTag${n}Category`]),
    field(`${prefix}Tag ${n} — usuarios`, item[`productTag${n}UserType`]),
    field(`${prefix}Tag ${n} — vigencia`, vigencia(item[`productTag${n}BeginDay`], item[`productTag${n}EndDay`])),
  ].filter(Boolean);
}

function productGroup(item, idx) {
  const fields = [
    field('Nombre', item.userFriendlyName || item.modelName),
    field('Modelo', item.modelName),
    field('SKU', item.sku),
    field('Model ID', item.modelId),
    field('Sales Model', item.salesModelCode),
    field('Sufijo', item.salesSuffixCode),
    field('Estado', item.modelStatusCode),
    field('Categoría', item.categoryName),
    field('MSRP', item.msrp, formatCLP(item.msrp)),
    // Tags (lo más relevante para este proyecto)
    ...tagFields('', item, 1),
    ...tagFields('', item, 2),
    field('Delivery tag', item.productDeliveryTag),
    field('Delivery tag — vigencia', vigencia(item.productDeliveryTagBeginDay, item.productDeliveryTagEndDay)),
    field('Texto promo', item.promotionText),
    field('Link promo', item.promotionLinkUrl),
    // Otros datos útiles
    field('Rating', item.srating2 != null && item.srating2 !== 0 ? `${item.srating2} (${item.pcount} reseñas)` : null),
    field('Año', item.modelYear),
    field('Lanzamiento', item.modelReleaseDate),
    field('URL', item.modelUrlPath),
    field('Vende OBS', item.obsSellFlag),
  ].filter(Boolean);

  return {
    id: `modelo-${idx}`,
    label: item.userFriendlyName || item.modelName || item.sku || `Modelo ${idx + 1}`,
    fields,
  };
}

export function extractRetrieveProductList(response) {
  const lists = Array.isArray(response?.productLists) ? response.productLists : null;
  if (!lists) return null;

  const groups = [];
  let idx = 0;
  lists.forEach((list) => {
    const products = Array.isArray(list.productList) ? list.productList : [];
    // Encabezado de la lista (título + tipo + cantidad).
    groups.push({
      id: `lista-${idx}-head`,
      label: `${list.productListTitle || 'Lista'} — ${products.length} producto(s)`,
      fields: [
        field('Título', list.productListTitle),
        field('Tipo', list.productListType),
        field('Cantidad', products.length),
      ].filter(Boolean),
    });
    products.forEach((item) => {
      groups.push(productGroup(item, idx));
      idx += 1;
    });
  });

  return groups;
}
