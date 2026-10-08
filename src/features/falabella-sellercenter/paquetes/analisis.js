// Regla de "Identificar paquetes en ordenes" (pura, testeable).
//
// Cuando una persona compra 2+ productos, Falabella debe crear un paquete por
// producto: cada item trae su propio PackageId y su propia guia (TrackingCode)
// y el SellerCenter dice "La orden tiene N envios/paquetes".
// Medido contra la API (oct-2026):
//   - bien:  3254531299 → 2 items, PKG...AR y PKG...AQ, guias distintas.
//   - mal:   3254612276 → 2 items (mismo SKU x2) con el MISMO PackageId y la
//            misma guia: Falabella los junto en un solo paquete.
// Regla: entre los items activos (no cancelados/fallidos/devueltos), si 2 o mas
// comparten PackageId la orden esta mal separada. Items sin PackageId todavia
// no tienen paquete asignado y no cuentan.
//
// Montos (medido en 3254612276): GrandTotal = ProductTotal + ShippingFeeTotal, y
// ProductTotal = suma de PaidPrice de los items (el descuento ya va restado).
// Los de la cabecera vienen con coma de miles ("658,970.00").

import { ITEM_STATUS_INACTIVOS } from '../constants.js';

/** "658,970.00" | "658970.00" | 658970 → 658970 (0 si no es numero). */
export function parseMonto(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** Fecha YYYY-MM-DD de un CreatedAt de la API ("2026-10-05 14:47:24", hora de Chile). */
export const diaDe = (createdAt) => String(createdAt || '').slice(0, 10);

/** Rango a pedir a la API para cubrir los dias [desde, hasta] de Chile (ver API.MARGEN_HORAS). */
export function ventanaApi(desde, hasta, margenHoras) {
  const margen = margenHoras * 3600_000;
  const ini = new Date(Date.parse(`${desde}T00:00:00Z`) - margen);
  const fin = new Date(Date.parse(`${hasta}T23:59:59Z`) + margen);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  return { createdAfter: iso(ini), createdBefore: iso(fin) };
}

export const estadosDeOrden = (order) =>
  [...new Set((order?.Statuses || []).map((s) => s?.Status ?? s).filter(Boolean))];

/** ¿La orden pasa el filtro de estados? Sin filtro (vacio) pasa todo. */
export function pasaFiltroEstados(estados, filtro) {
  if (!filtro?.length) return true;
  return estados.some((e) => filtro.includes(e));
}

/** Cabecera minima que se guarda de cada orden multi-producto (sin datos del comprador). */
export function resumenOrden(order) {
  return {
    orderId: String(order.OrderId),
    orderNumber: String(order.OrderNumber),
    createdAt: order.CreatedAt || '',
    itemsCount: Number(order.ItemsCount) || 0,
    estados: estadosDeOrden(order),
    promesa: order.PromisedShippingTime || '',
    montos: {
      productos: parseMonto(order.ProductTotal),
      envio: parseMonto(order.ShippingFeeTotal),
      descuento: parseMonto(order.Voucher),
      total: parseMonto(order.GrandTotal || order.Price),
    },
  };
}

const esActivo = (it) => !ITEM_STATUS_INACTIVOS.includes(String(it?.Status || '').toLowerCase());

/**
 * Analiza los items de una orden.
 * @returns {{ problema: boolean, activos: number, paquetes: number, sinPaquete: number,
 *             compartidos: Set<string>,
 *             grupos: Array<{packageId, trackingCode, items: Array<{sku, nombre, estado}>}> }}
 *   `grupos` son SOLO los paquetes que juntan 2+ items.
 */
export function analizarItems(items) {
  const activos = (items || []).filter(esActivo);
  const porPaquete = new Map();
  let sinPaquete = 0;
  for (const it of activos) {
    const pkg = String(it.PackageId || '').trim();
    if (!pkg) { sinPaquete++; continue; }
    if (!porPaquete.has(pkg)) porPaquete.set(pkg, []);
    porPaquete.get(pkg).push(it);
  }
  const grupos = [...porPaquete.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([packageId, list]) => ({
      packageId,
      trackingCode: [...new Set(list.map((it) => it.TrackingCode).filter(Boolean))].join(' / '),
      items: list.map((it) => ({ sku: it.Sku || '', nombre: it.Name || '', estado: it.Status || '' })),
    }));
  return {
    problema: grupos.length > 0,
    activos: activos.length,
    paquetes: porPaquete.size,
    sinPaquete,
    compartidos: new Set(grupos.map((g) => g.packageId)),
    grupos,
  };
}

/**
 * Todos los items de la orden (tambien los cancelados), en orden de lectura:
 * primero los paquetes compartidos, luego el resto por paquete; dentro, por SKU.
 */
export function itemsDeOrden(items, compartidos = new Set()) {
  const rango = (it) => (compartidos.has(it.PackageId) ? 0 : esActivo(it) ? 1 : 2);
  return [...(items || [])]
    .sort((a, b) => rango(a) - rango(b)
      || String(a.PackageId || '').localeCompare(String(b.PackageId || ''))
      || String(a.Sku || '').localeCompare(String(b.Sku || ''))
      || String(a.OrderItemId || '').localeCompare(String(b.OrderItemId || '')))
    .map((it) => ({
      itemId: String(it.OrderItemId || ''),
      sku: it.Sku || '',
      nombre: it.Name || '',
      estado: it.Status || '',
      paquete: it.PackageId || '',
      guia: it.TrackingCode || '',
      precio: parseMonto(it.PaidPrice),
      precioLista: parseMonto(it.ItemPrice),
      envio: parseMonto(it.ShippingAmount),
      compartido: compartidos.has(it.PackageId),
      activo: esActivo(it),
    }));
}

/** Orden con problema, lista para mostrar/exportar. */
export function hallazgo(resumen, analisis, items = []) {
  const skus = analisis.grupos.flatMap((g) => g.items.map((it) => it.sku));
  return {
    ...resumen,
    productos: analisis.activos,
    paquetes: analisis.paquetes + analisis.sinPaquete,
    paquetesFaltantes: analisis.activos - analisis.paquetes - analisis.sinPaquete,
    packageIds: analisis.grupos.map((g) => g.packageId),
    guias: analisis.grupos.map((g) => g.trackingCode).filter(Boolean),
    skus: contarSkus(skus),
    estadosItems: [...new Set(analisis.grupos.flatMap((g) => g.items.map((it) => it.estado)))],
    items: itemsDeOrden(items, analisis.compartidos),
  };
}

/** Totales del resultado: cuantas ordenes y cuanto suman. */
export function totales(hallazgos) {
  const lista = hallazgos || [];
  return {
    ordenes: lista.length,
    monto: lista.reduce((s, h) => s + (h.montos?.total || 0), 0),
    envio: lista.reduce((s, h) => s + (h.montos?.envio || 0), 0),
  };
}

/** ["A","A","B"] → "A x2, B" */
function contarSkus(skus) {
  const cuenta = new Map();
  for (const s of skus) cuenta.set(s, (cuenta.get(s) || 0) + 1);
  return [...cuenta.entries()].map(([s, n]) => (n > 1 ? `${s} x${n}` : s)).join(', ');
}
