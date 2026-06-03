// Extractor de la operación `products` (listado de variantes de un producto:
// distintos tamaños/modelos con su precio y stock). Devuelve un grupo por
// variante, titulado con el nombre, para que sea fácil de buscar y copiar.

function formatCLP(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `$${n.toLocaleString('es-CL')}`;
}

function formatPercent(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `${n}%`;
}

function field(label, raw, formatted) {
  if (raw == null || raw === '') return null;
  const display = formatted != null ? formatted : String(raw);
  return { label, value: String(display), raw: String(raw) };
}

export function extractProducts(response) {
  const items = response?.data?.products?.items;
  if (!Array.isArray(items)) return null;
  if (items.length === 0) return [];

  return items.map((p, i) => {
    const mp = p.price_range?.minimum_price || {};
    const fields = [
      field('SKU', p.sku),
      field('Estado de stock', p.stock_status),
      field('Cantidad vendible', p.saleable_quantity),
      field('Precio final', mp.final_price?.value, formatCLP(mp.final_price?.value)),
      field('Precio regular', mp.regular_price?.value, formatCLP(mp.regular_price?.value)),
      field('Descuento ($)', mp.discount?.amount_off, formatCLP(mp.discount?.amount_off)),
      field('Descuento (%)', mp.discount?.percent_off, formatPercent(mp.discount?.percent_off)),
      field('Cuotas', p.installment?.intro_text),
      field('Flag de descuento', p.discount_flag),
      field('Tipo (GraphQL)', p.__typename),
    ].filter(Boolean);
    return {
      id: `producto-${i}`,
      label: p.name || p.sku || `Producto ${i + 1}`,
      fields,
    };
  });
}
