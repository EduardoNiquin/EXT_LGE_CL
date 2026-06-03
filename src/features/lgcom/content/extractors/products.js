// Extractor de la operación `products` / `getProductsBySku`.
//
// La usan varias pantallas:
//   - PLP: listado de variantes (varios SKU).
//   - PBP: un único producto (un SKU) — incluye msrp, suscripción, pre-orden,
//     cheaper_price y, si es BundleProduct, sus componentes.
// Genera un grupo por item (label = nombre).

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

function yesNo(value) {
  if (value == null) return null;
  return value ? 'Sí' : 'No';
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
      field('Límite de venta', p.limit_sale),
      field('Precio final', mp.final_price?.value, formatCLP(mp.final_price?.value)),
      field('Precio regular', mp.regular_price?.value, formatCLP(mp.regular_price?.value)),
      field('MSRP', p.msrp_price, formatCLP(p.msrp_price)),
      field('Descuento ($)', mp.discount?.amount_off, formatCLP(mp.discount?.amount_off)),
      field('Descuento (%)', mp.discount?.percent_off, formatPercent(mp.discount?.percent_off)),
      field('Cuotas', p.installment?.intro_text),
      field('Flag de descuento', p.discount_flag),
      field('Tipo (GraphQL)', p.__typename),
      field('URL partner', p.partner_url),
    ];

    // Precio más barato (cheaper_price)
    const cheaper = p.cheaper_price;
    if (cheaper && (cheaper.amount?.value != null || cheaper.cheaper_percent != null)) {
      fields.push(field('Precio más barato', cheaper.amount?.value, formatCLP(cheaper.amount?.value)));
      fields.push(field('% más barato', cheaper.cheaper_percent, formatPercent(cheaper.cheaper_percent)));
    }

    // Suscripción (fairown)
    const sub = p.fairown_subscription_product;
    if (sub && (sub.subscription_status || sub.max_month || sub.monthly_cost || sub.landing_page_url)) {
      fields.push(field('Suscripción — estado', yesNo(sub.subscription_status)));
      fields.push(field('Suscripción — meses máx.', sub.max_month));
      fields.push(field('Suscripción — costo mensual', sub.monthly_cost, formatCLP(sub.monthly_cost)));
    }

    // Pre-orden
    const pre = p.pre_order;
    if (pre && (pre.enable_flag || pre.start_date || pre.end_date || pre.delivery_start_date || pre.backorder)) {
      fields.push(field('Pre-orden — habilitada', yesNo(pre.enable_flag)));
      fields.push(field('Pre-orden — inicio', pre.start_date));
      fields.push(field('Pre-orden — fin', pre.end_date));
      fields.push(field('Pre-orden — inicio entrega', pre.delivery_start_date));
    }

    // BundleProduct: componentes
    if (Array.isArray(p.items) && p.items.length > 0) {
      fields.push(field('Vista de precio', p.price_view));
      fields.push(field('Envío de items', p.ship_bundle_items));
      p.items.forEach((bi) => {
        const options = Array.isArray(bi.options) ? bi.options : [];
        options.forEach((opt) => {
          const pref = `[${bi.position ?? '?'}] `;
          fields.push(field(`${pref}SKU componente`, opt.product?.sku));
        });
      });
    }

    return {
      id: `producto-${i}`,
      label: p.name || p.sku || `Producto ${i + 1}`,
      fields: fields.filter(Boolean),
    };
  });
}
