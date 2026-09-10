// Lectura del listado de bundles que escribe el usuario (textarea o CSV).
//
// Una linea = un soft bundle. El primer SKU es el producto principal y el resto
// son los productos hijos:
//
//   SKU_PADRE,SKU_HIJO1,SKU_HIJO2
//   SKU_PADRE2,SKU_HIJO1:10,SKU_HIJO2:8:40
//
// Cada hijo puede traer su propio porcentaje pegado con dos puntos:
//   SKU:descuento             -> descuento del hijo
//   SKU:descuento:split       -> descuento del hijo + % repartido al principal
// Lo que no viene en la linea sale de la configuracion del formulario.
//
// Modulo puro: no toca DOM ni storage, asi que se puede probar suelto.

import { SKU_PREFIX } from './constants.js';

const SEPARATOR_RE = /[,;\t]/;
const COMMENT_RE = /^\s*(?:#|\/\/)/;

// Primeras celdas que delatan una fila de encabezados de planilla. Solo van
// las que ningun SKU podria tener: "padre" o "parent" sueltos se descartaron
// porque tumbarian una linea real cuyo producto principal se llamara asi.
const HEADER_CELLS = new Set([
  'sku', 'skupadre', 'skupadres', 'skuprincipal', 'parentsku', 'skuparent',
  'mainproduct', 'productoprincipal', 'productopadre',
]);

/** SKU comparable: sin espacios, en mayusculas y sin el prefijo del catalogo. */
export function normalizeSku(value) {
  const sku = String(value ?? '').trim().toUpperCase();
  return sku.startsWith(SKU_PREFIX) ? sku.slice(SKU_PREFIX.length) : sku;
}

/** True si los dos SKU son el mismo producto, con o sin prefijo `CL.`. */
export function sameSku(a, b) {
  const left = normalizeSku(a);
  return Boolean(left) && left === normalizeSku(b);
}

/** Porcentaje valido para Magento: numero entre 0 y 100 (el campo del padre exige 1-99). */
export function parsePercent(value, { min = 0, max = 100 } = {}) {
  const raw = String(value ?? '').replace('%', '').replace(',', '.').trim();
  if (!raw) return null;
  const number = Number(raw);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return raw;
}

function splitCells(line) {
  return line.split(SEPARATOR_RE).map((cell) => cell.trim().replace(/^"(.*)"$/s, '$1').trim());
}

function looksLikeHeader(cells) {
  // Un encabezado siempre trae columnas; una linea de un solo SKU no lo es.
  if (cells.length < 2) return false;
  const first = cells[0]?.toLowerCase().replace(/[^a-z]/g, '') || '';
  return HEADER_CELLS.has(first);
}

/**
 * Lee un hijo con sus porcentajes opcionales. Devuelve `null` si el SKU esta
 * vacio; los porcentajes invalidos se reportan como aviso y se ignoran (se usa
 * el valor global) en lugar de tumbar la linea entera.
 */
function parseChild(cell, { lineNumber, warnings }) {
  const parts = String(cell).split(':').map((part) => part.trim());
  const sku = parts[0];
  if (!sku) return null;

  const child = { sku, discountRate: null, mainDiscountRate: null };

  if (parts.length > 1 && parts[1] !== '') {
    const discount = parsePercent(parts[1]);
    if (discount === null) {
      warnings.push(`Linea ${lineNumber}: descuento "${parts[1]}" de ${sku} no es un porcentaje valido; se usa el del formulario.`);
    } else {
      child.discountRate = discount;
    }
  }
  if (parts.length > 2 && parts[2] !== '') {
    const split = parsePercent(parts[2], { min: 1, max: 99 });
    if (split === null) {
      warnings.push(`Linea ${lineNumber}: el % sobre el producto principal "${parts[2]}" de ${sku} tiene que ir entre 1 y 99; se usa el del formulario.`);
    } else {
      child.mainDiscountRate = split;
    }
  }
  if (parts.length > 3) {
    warnings.push(`Linea ${lineNumber}: ${sku} trae mas de dos porcentajes; se ignora lo que sobra.`);
  }
  return child;
}

/**
 * Texto pegado o CSV -> lista de bundles.
 * @returns {{ bundles: Array<{parentSku:string, children:Array}>, warnings: string[] }}
 */
export function parseBundleLines(text) {
  const warnings = [];
  const bundles = [];
  const seenParents = new Map();

  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/);
  let headerChecked = false;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || COMMENT_RE.test(line)) return;

    const cells = splitCells(line).filter((cell) => cell !== '');
    if (!cells.length) return;

    if (!headerChecked) {
      headerChecked = true;
      if (looksLikeHeader(cells)) return;
    }

    const parentSku = cells[0];
    const children = cells.slice(1)
      .map((cell) => parseChild(cell, { lineNumber, warnings }))
      .filter(Boolean);

    if (!children.length) {
      warnings.push(`Linea ${lineNumber}: ${parentSku} no trae ningun producto hijo; se omite.`);
      return;
    }

    const key = normalizeSku(parentSku);
    const previous = seenParents.get(key);
    if (previous !== undefined) {
      warnings.push(`Linea ${lineNumber}: ${parentSku} ya aparece en la linea ${previous}; se omite la repetida.`);
      return;
    }
    seenParents.set(key, lineNumber);

    // Un mismo hijo dos veces en el bundle crearia dos ofertas iguales.
    const uniqueChildren = [];
    const seenChildren = new Set();
    children.forEach((child) => {
      const childKey = normalizeSku(child.sku);
      if (childKey === key) {
        warnings.push(`Linea ${lineNumber}: ${child.sku} es el mismo producto principal; se omite.`);
        return;
      }
      if (seenChildren.has(childKey)) {
        warnings.push(`Linea ${lineNumber}: ${child.sku} esta repetido; se deja una sola vez.`);
        return;
      }
      seenChildren.add(childKey);
      uniqueChildren.push(child);
    });

    if (!uniqueChildren.length) {
      warnings.push(`Linea ${lineNumber}: ${parentSku} se queda sin hijos validos; se omite.`);
      return;
    }

    bundles.push({ lineNumber, parentSku, children: uniqueChildren });
  });

  return { bundles, warnings };
}

/** Cuenta las ofertas totales que va a crear el run. */
export function countOffers(bundles) {
  return (bundles || []).reduce((total, bundle) => total + (bundle.children?.length || 0), 0);
}
