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

import { ITEM_STATUS_INACTIVOS } from '../constants.js';

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

/** Cabecera minima que se guarda de cada orden multi-producto (sin datos del comprador). */
export function resumenOrden(order) {
  return {
    orderId: String(order.OrderId),
    orderNumber: String(order.OrderNumber),
    createdAt: order.CreatedAt || '',
    itemsCount: Number(order.ItemsCount) || 0,
    estados: estadosDeOrden(order),
    promesa: order.PromisedShippingTime || '',
  };
}

/**
 * Analiza los items de una orden.
 * @returns {{ problema: boolean, activos: number, paquetes: number, sinPaquete: number,
 *             grupos: Array<{packageId, trackingCode, items: Array<{sku, nombre, estado}>}> }}
 *   `grupos` son SOLO los paquetes que juntan 2+ items.
 */
export function analizarItems(items) {
  const activos = (items || []).filter((it) => !ITEM_STATUS_INACTIVOS.includes(String(it?.Status || '').toLowerCase()));
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
    grupos,
  };
}

/** Orden con problema, lista para mostrar/exportar. */
export function hallazgo(resumen, analisis) {
  const skus = analisis.grupos.flatMap((g) => g.items.map((it) => it.sku));
  return {
    ...resumen,
    productos: analisis.activos,
    paquetes: analisis.paquetes + analisis.sinPaquete,
    paquetesFaltantes: analisis.activos - analisis.paquetes - analisis.sinPaquete,
    packageIds: analisis.grupos.map((g) => g.packageId),
    guias: analisis.grupos.map((g) => g.trackingCode).filter(Boolean),
    skus: contarSkus(skus),
    nombres: [...new Set(analisis.grupos.flatMap((g) => g.items.map((it) => it.nombre)))],
    estadosItems: [...new Set(analisis.grupos.flatMap((g) => g.items.map((it) => it.estado)))],
  };
}

/** ["A","A","B"] → "A x2, B" */
function contarSkus(skus) {
  const cuenta = new Map();
  for (const s of skus) cuenta.set(s, (cuenta.get(s) || 0) + 1);
  return [...cuenta.entries()].map(([s, n]) => (n > 1 ? `${s} x${n}` : s)).join(', ');
}
