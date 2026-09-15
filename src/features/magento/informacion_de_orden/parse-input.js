// Lectura de la lista de ordenes que pega (o sube) el usuario. Puro y testeable.
//
// Acepta texto suelto y CSV: se parte por cualquier separador razonable y se
// conservan los tokens que parecen un numero de orden. Asi un CSV con
// encabezado y varias columnas funciona sin pedirle al usuario que lo limpie.

const SEPARATORS = /[\s,;|]+/;

// Los increment_id de LG son largos (123001427905). Con menos de 6 digitos es
// casi seguro una cantidad, un precio o un numero de fila.
const MIN_DIGITS = 6;

/**
 * @param {string} text
 * @returns {{ numbers: string[], warnings: string[] }}
 */
export function parseOrderNumbers(text) {
  const tokens = String(text || '').split(SEPARATORS).map((token) => token.trim()).filter(Boolean);
  const numbers = [];
  const seen = new Set();
  const ignored = [];
  const duplicated = [];

  for (const token of tokens) {
    const digits = token.replace(/\D+/g, '');
    if (digits.length < MIN_DIGITS) {
      // Comillas de CSV y encabezados caen aca; no se avisa de los obviamente
      // textuales para no llenar el aviso de ruido.
      if (/\d/.test(token)) ignored.push(token);
      continue;
    }
    if (seen.has(digits)) {
      duplicated.push(digits);
      continue;
    }
    seen.add(digits);
    numbers.push(digits);
  }

  const warnings = [];
  if (ignored.length) {
    warnings.push(`Se ignoraron ${ignored.length} valor(es) que no parecen numero de orden: ${ignored.slice(0, 5).join(', ')}.`);
  }
  if (duplicated.length) {
    warnings.push(`Se quitaron ${duplicated.length} orden(es) repetida(s).`);
  }
  return { numbers, warnings };
}
