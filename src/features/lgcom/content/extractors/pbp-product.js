// Extractor de la operación `getPbpProduct` (PDP de www.lg.com).
//
// Toma la respuesta cruda y la transforma en grupos legibles por relevancia. La
// salida la consume el popup; cada campo lleva:
//   - label: nombre legible
//   - value: valor ya formateado para mostrar (CLP, %, sí/no, fechas)
//   - raw:   valor crudo para copiar (string)
//
// Orden por importancia: primero la info del PRODUCTO (identificación, precios,
// cuotas, totales, componentes), y al final los datos de ENVÍO (despacho,
// cobertura, reglas de envío).
//
// Defensivo y tolerante a las múltiples formas de `getPbpProduct`:
//   - OmdProduct "simple": product.{name,sku,price_range,...}.
//   - Package rule: product casi vacío; sku/precios viven en total_segments.
//   - PtoV2 (bundle): product.items[] con los componentes; sku/precio en segments.

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

// Construye un field si el valor es significativo; devuelve null si no.
function field(label, raw, formatted) {
  if (raw == null || raw === '') return null;
  const display = formatted != null ? formatted : String(raw);
  return { label, value: String(display), raw: String(raw) };
}

function group(id, label, fields) {
  const clean = fields.filter(Boolean);
  if (clean.length === 0) return null;
  return { id, label, fields: clean };
}

// Lee precio/sku/descuento desde total_segments como fallback cuando el producto
// no los trae a nivel product (packages, PtoV2).
function readSegments(segments) {
  const out = { sku: null, total: null, regular: null, final: null, amountOff: null, percentOff: null };
  if (!Array.isArray(segments)) return out;
  for (const seg of segments) {
    if (seg.code === 'grand_total') out.total = seg.value;
    if (seg.code === 'subtotal' && Array.isArray(seg.items) && seg.items[0]) {
      // El title del primer item del subtotal suele ser el SKU (con "(Qty: N)").
      const title = String(seg.items[0].title || '').replace(/\s*\(qty:.*$/i, '').trim();
      if (title) out.sku = title;
    }
    if (seg.code === 'discount_additional' && Array.isArray(seg.items)) {
      for (const it of seg.items) {
        if (it.code === 'regular_price') out.regular = it.value;
        else if (it.code === 'final_price') out.final = it.value;
        else if (it.code === 'amount_off') out.amountOff = it.value;
        else if (it.code === 'percent_off') out.percentOff = it.value;
      }
    }
  }
  return out;
}

export function extractPbpProduct(response) {
  const root = response?.data?.getPbpProduct;
  if (!root) return null;

  const product = root.product || {};
  const minPrice = product.price_range?.minimum_price || {};
  const discount = minPrice.discount || {};
  const regular = minPrice.regular_price || {};
  const finalPrice = minPrice.final_price || {};
  const seg = readSegments(root.total_segments);

  const groups = [];

  // Valores con fallback a total_segments.
  const sku = product.sku ?? seg.sku;
  const finalVal = finalPrice.value ?? seg.final;
  const regularVal = regular.value ?? product.msrp_price ?? seg.regular;
  const amountOff = discount.amount_off ?? seg.amountOff;
  const percentOff = discount.percent_off ?? seg.percentOff;

  // 1. Identificación
  groups.push(group('identificacion', 'Identificación', [
    field('Nombre', product.name),
    field('SKU', sku),
    field('ID', product.id),
    field('Estado de stock', product.stock_status),
    field('Cantidad vendible', product.saleable_quantity),
    field('Límite de venta', product.limit_sale),
    field('Tipo de producto', product.type_id),
    field('Tipo de despacho', product.delivery_type),
    field('Tipo (GraphQL)', product.__typename),
    field('Vista de precio', product.price_view),
    field('Envío de items', product.ship_bundle_items),
    field('URL partner', product.partner_url),
  ]));

  // 2. Precios
  groups.push(group('precios', 'Precios', [
    field('Precio final', finalVal, formatCLP(finalVal)),
    field('Precio regular', regularVal, formatCLP(regularVal)),
    field('MSRP', product.msrp_price, formatCLP(product.msrp_price)),
    field('Descuento ($)', amountOff, formatCLP(amountOff)),
    field('Descuento (%)', percentOff, formatPercent(percentOff)),
    field('Moneda', regular.currency || 'CLP'),
    field('Flag de descuento', product.discount_flag),
    field('Precio sin impuesto', product.price_excl_tax, formatCLP(product.price_excl_tax)),
    field('Descuento cupón (guest)', root.coupon_discount_for_guest_checkout?.value,
      formatCLP(root.coupon_discount_for_guest_checkout?.value)),
  ]));

  // 3. Cuotas (installment)
  const installment = product.installment;
  if (installment) {
    const fields = [
      field('Texto', installment.intro_text),
      field('Tipo de display', installment.display_type),
      field('Monto display', installment.display_amount),
    ];
    const payments = Array.isArray(installment.payment_information) ? installment.payment_information : [];
    payments.forEach((pay, pi) => {
      const infos = Array.isArray(pay.installment_information) ? pay.installment_information : [];
      const pref = payments.length > 1 ? `[${pi + 1}] ` : '';
      infos.forEach((info) => {
        const m = info.month != null ? `${info.month} cuotas` : 'Cuota';
        fields.push(field(`${pref}${m} — pago mensual`, info.monthly_payment_amount));
        fields.push(field(`${pref}${m} — interés/fee`, info.fee));
        fields.push(field(`${pref}${m} — costo total`, info.total_cost));
        fields.push(field(`${pref}${m} — monto compra`, info.purchase_amount));
        fields.push(field(`${pref}${m} — TAN`, info.tan));
        fields.push(field(`${pref}${m} — TAEG`, info.taeg));
      });
    });
    groups.push(group('cuotas', 'Cuotas', fields));
  }

  // 4. Totales (total_segments)
  const segments = Array.isArray(root.total_segments) ? root.total_segments : [];
  const segFields = [];
  segments.forEach((s) => {
    if (s.value != null && s.value !== '') {
      segFields.push(field(s.title || s.code, s.value, formatCLP(s.value)));
    }
    const items = Array.isArray(s.items) ? s.items : [];
    items.forEach((it) => {
      if (it.value == null || it.value === '') return;
      const label = `${s.title ? s.title + ' · ' : ''}${it.title || it.code}`;
      const isPct = it.code === 'percent_off';
      segFields.push(field(label, it.value, isPct ? formatPercent(it.value) : formatCLP(it.value)));
    });
  });
  groups.push(group('totales', 'Totales', segFields));

  // 5. Componentes del bundle (PtoV2: product.items[].options[].product)
  const bundleItems = Array.isArray(product.items) ? product.items : [];
  if (bundleItems.length > 0) {
    const fields = [];
    bundleItems.forEach((bi) => {
      const options = Array.isArray(bi.options) ? bi.options : [];
      options.forEach((opt) => {
        const p = opt.product || {};
        const mp = p.price_range?.minimum_price || {};
        const pref = `[${bi.position ?? '?'}] `;
        fields.push(field(`${pref}Nombre`, p.name));
        fields.push(field(`${pref}SKU`, p.sku));
        fields.push(field(`${pref}Precio final`, mp.final_price?.value, formatCLP(mp.final_price?.value)));
        fields.push(field(`${pref}Precio regular`, mp.regular_price?.value, formatCLP(mp.regular_price?.value)));
        fields.push(field(`${pref}Descuento (%)`, mp.discount?.percent_off, formatPercent(mp.discount?.percent_off)));
      });
    });
    groups.push(group('componentes', 'Componentes del bundle', fields));
  }

  // 6. Garantía extendida
  const ewItems = root.extended_warranty?.ew_items;
  if (Array.isArray(ewItems) && ewItems.length > 0) {
    const fields = [];
    ewItems.forEach((wrap, i) => {
      const ew = wrap.ew_item || {};
      const pref = ewItems.length > 1 ? `[${i + 1}] ` : '';
      fields.push(field(`${pref}Nombre`, ew.name));
      fields.push(field(`${pref}SKU`, ew.sku));
      fields.push(field(`${pref}Precio`, ew.price, formatCLP(ew.price)));
      fields.push(field(`${pref}Precio con descuento`, ew.price_discount, formatCLP(ew.price_discount)));
    });
    groups.push(group('garantia', 'Garantía extendida', fields));
  }

  // 7. Paquetes relacionados
  const packages = root.list_related_package_product;
  if (Array.isArray(packages) && packages.length > 0) {
    const fields = [];
    packages.forEach((pkg, i) => {
      const pref = `[${i + 1}] `;
      fields.push(field(`${pref}SKU`, pkg.product_sku));
      fields.push(field(`${pref}Precio paquete`, pkg.package_price, formatCLP(pkg.package_price)));
      fields.push(field(`${pref}Descuento (%)`, pkg.discount_rate, formatPercent(pkg.discount_rate)));
      fields.push(field(`${pref}Texto promo`, pkg.promotion_text));
    });
    groups.push(group('paquetes', 'Paquetes relacionados', fields));
  }

  // 8. Suscripción (fairown)
  const sub = product.fairown_subscription_product;
  if (sub && (sub.subscription_status || sub.max_month || sub.monthly_cost || sub.landing_page_url)) {
    groups.push(group('suscripcion', 'Suscripción', [
      field('Estado', yesNo(sub.subscription_status)),
      field('Meses máx.', sub.max_month),
      field('Costo mensual', sub.monthly_cost, formatCLP(sub.monthly_cost)),
      field('Landing', sub.landing_page_url),
    ]));
  }

  // 9. Pre-orden
  const pre = product.pre_order;
  if (pre && (pre.enable_flag || pre.start_date || pre.end_date || pre.delivery_start_date || pre.backorder)) {
    groups.push(group('preorden', 'Pre-orden', [
      field('Habilitada', yesNo(pre.enable_flag)),
      field('Inicio', pre.start_date),
      field('Fin', pre.end_date),
      field('Inicio de entrega', pre.delivery_start_date),
      field('Cantidad pre-orden', pre.total_pre_quantity),
      field('Backorder', yesNo(pre.backorder)),
    ]));
  }

  // 10. Marketing (textos del paquete principal)
  const marketing = root.main_package_product?.marketing_text_detail;
  if (Array.isArray(marketing) && marketing.length > 0) {
    const fields = marketing.map((m) =>
      field(`Texto (${m.product_type || '—'})`, m.marketing_text));
    groups.push(group('marketing', 'Marketing', fields));
  }

  // 11. Instalación (suele venir vacío)
  const install = root.install;
  if (install && (install.notice || install.label || install.sub_label || (Array.isArray(install.items) && install.items.length))) {
    const fields = [
      field('Aviso', install.notice),
      field('Etiqueta', install.label),
      field('Sub-etiqueta', install.sub_label),
    ];
    const items = Array.isArray(install.items) ? install.items : [];
    items.forEach((wrap, i) => {
      const it = wrap.item || {};
      const pref = items.length > 1 ? `[${i + 1}] ` : '';
      fields.push(field(`${pref}Nombre`, it.name));
      fields.push(field(`${pref}SKU`, it.sku));
      fields.push(field(`${pref}Precio`, it.price, formatCLP(it.price)));
    });
    groups.push(group('instalacion', 'Instalación', fields));
  }

  // ── Datos de ENVÍO (menor prioridad: van al final) ──

  // 12. Despacho (+ cobertura por comuna)
  const coverage = root.delivery_coverage || {};
  groups.push(group('despacho', 'Despacho', [
    field('Lead time mín. (días)', product.delivery_lead_time_min),
    field('Lead time máx. (días)', product.delivery_lead_time_max),
    field('Cobertura (estado)', coverage.status),
    field('Cobertura (mensaje)', coverage.message),
  ]));

  // 13. Reglas de envío (global_shipping_rules — PtoV2)
  const gsr = root.global_shipping_rules;
  if (gsr && Array.isArray(gsr.items) && gsr.items.length > 0) {
    const fields = [];
    gsr.items.forEach((cartItem) => {
      const rules = Array.isArray(cartItem.rules) ? cartItem.rules : [];
      rules.forEach((rule) => {
        const pref = cartItem.sku ? `${cartItem.sku} — ` : '';
        fields.push(field(`${pref}${rule.rule_name || 'Regla'}`, rule.delivery_fee, formatCLP(rule.delivery_fee)));
        fields.push(field(`${pref}Lead time`, rule.delivery_lead_time_min != null
          ? `${rule.delivery_lead_time_min}–${rule.delivery_lead_time_max} días` : null));
        fields.push(field(`${pref}Transportista`, rule.carrier_name));
      });
    });
    groups.push(group('reglas-envio', 'Reglas de envío', fields));
  }

  return groups.filter(Boolean);
}
