// Lectura de las hojas del Invoice Master File a partir de matrices (array de
// filas, cada fila un array de celdas), que es lo que entrega SheetJS con
// `header: 1`. Sin dependencias: se testea con matrices a mano.
//
// Cada hoja se lee ubicando su fila de encabezado por CONTENIDO (la celda
// "Customer", "Payee", ...) y no por posicion: el archivo lo mantiene Finanzas
// y una fila de mas arriba no deberia romper nada.

/** Texto normalizado para comparar encabezados y valores: minusculas, sin acentos, un solo espacio. */
export function normalizar(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function textoOVacio(valor) {
  return valor == null ? '' : String(valor).trim();
}

/**
 * Fechas como 'yyyy-mm-dd' (hora local) y no como Date: el modelo viaja por
 * chrome.storage (JSON) y un Date llegaria como string igual, pero mal formado.
 * Lo que no es fecha (por ejemplo "sep") se deja como texto para poder avisarlo.
 */
export function fechaIso(valor) {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) return textoOVacio(valor);
  const mm = String(valor.getMonth() + 1).padStart(2, '0');
  const dd = String(valor.getDate()).padStart(2, '0');
  return `${valor.getFullYear()}-${mm}-${dd}`;
}

function numeroONulo(valor) {
  if (valor == null || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Fila cuyo contenido incluye TODOS los rotulos pedidos; -1 si no existe. */
function filaEncabezado(matriz, rotulos) {
  const buscados = rotulos.map(normalizar);
  return matriz.findIndex((fila) => {
    const celdas = (fila || []).map(normalizar);
    return buscados.every((r) => celdas.includes(r));
  });
}

/**
 * Convierte la matriz en objetos {rotuloNormalizado: valor} a partir de la fila
 * de encabezado. Devuelve `[]` si no hay encabezado.
 */
function filasComoObjetos(matriz, rotulosClave) {
  const idx = filaEncabezado(matriz, rotulosClave);
  if (idx < 0) return [];
  const encabezado = (matriz[idx] || []).map(normalizar);
  const filas = [];
  for (const fila of matriz.slice(idx + 1)) {
    if (!fila || fila.every((c) => c == null || c === '')) continue;
    const obj = {};
    encabezado.forEach((rotulo, c) => {
      if (rotulo) obj[rotulo] = fila[c];
    });
    filas.push(obj);
  }
  return filas;
}

// --- Master 1 -----------------------------------------------------------------

/**
 * Filas de "Master 1_BU v2": una por factura x division.
 * @returns {Array<object>} ver campos abajo; `netoClp` es null cuando la celda esta vacia.
 */
export function leerMaster1(matriz) {
  return filasComoObjetos(matriz, ['Customer', 'Invoice Number', 'Division']).map((f) => ({
    year: numeroONulo(f.year),
    cutDate: textoOVacio(f['cut date']),
    impactMonth: textoOVacio(f['impact month']),
    invoiceDate: fechaIso(f['invoice date']),
    invoiceNumber: f['invoice number'] == null || f['invoice number'] === '' ? '' : String(f['invoice number']).trim(),
    customer: textoOVacio(f.customer),
    bu: textoOVacio(f.bu).toUpperCase(),
    division: textoOVacio(f.division),
    netoClp: numeroONulo(f['invoice net amt (clp)']),
    vatClp: numeroONulo(f['vat (clp)']),
    totalClp: numeroONulo(f['total amt (clp)']),
    commissionType: textoOVacio(f['commission type']),
    docType: normalizar(f['doc type']),
    status: normalizar(f['invoice status']),
    invoiceUrl: textoOVacio(f['invoice url']),
  })).filter((f) => f.customer);
}

// --- Master 2 -----------------------------------------------------------------

/** Filas de "Master 2_STEPS": la receta por (cliente, tipo de documento). */
export function leerMaster2(matriz) {
  return filasComoObjetos(matriz, ['Payee', 'Doc Type', 'System Module']).map((f) => ({
    customer: textoOVacio(f.payee),
    docType: normalizar(f['doc type']),
    docNo: textoOVacio(f['doc no']),
    systemModule: normalizar(f['system module']),
    invoiceType: textoOVacio(f['invoice type']),
    payeeCode: textoOVacio(f['payee code']),
    titulo: textoOVacio(f['description (f/cn-123 + title + mmyy)'] ?? f.description),
    creditAccount: textoOVacio(f['credit-account']),
    debitDepartment: textoOVacio(f['debit-department']),
    vatCode: textoOVacio(f['vat tax code']),
    debitAccount: textoOVacio(f['debit-account']),
  })).filter((r) => r.customer);
}

// --- Map ----------------------------------------------------------------------

/** Tabla cliente -> codigos de la hoja "Map" (bloque F16:K...). */
export function leerMapa(matriz) {
  return filasComoObjetos(matriz, ['Customer', 'Payee Code', 'Debit Account']).map((f) => ({
    customer: textoOVacio(f.customer),
    department: textoOVacio(f['department code']),
    payeeCode: textoOVacio(f['payee code']),
    debitAccount: textoOVacio(f['debit account']),
  })).filter((c) => c.customer);
}
