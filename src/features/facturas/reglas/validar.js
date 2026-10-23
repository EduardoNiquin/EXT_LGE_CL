// Que documento puede entrar al proceso y por que no. Los motivos van tal cual
// al popup, asi que estan escritos para una persona.

import { ESTADO_FACTURA, GEVS, TIPOS_DOCUMENTO } from '../constants.js';
import { FECHA_ISO_RE } from './descripcion.js';
import { normalizar } from './hojas.js';

// Commission Type sin receta propia en Master 2: la de su cliente es la de la
// comision, y su Description es otra ("Logistic Cost 3P PARIS (Fullkom), 3-4%"
// en Check Invoice). Cargarla con esa receta dejaria un titulo equivocado.
const COMMISSION_SIN_RECETA = ['logistic cost'];

const MOTIVO_ESTADO = {
  [ESTADO_FACTURA.APPROVING]: 'ya registrada en GEVS (Approving)',
  [ESTADO_FACTURA.AP_COMPLETED]: 'ya aprobada (AP Completed)',
  [ESTADO_FACTURA.DRAFT]: 'en borrador (Draft): fuera del alcance por ahora',
  [ESTADO_FACTURA.PENDING_REPORT]: 'Pending Report: fuera del alcance por ahora',
  [ESTADO_FACTURA.REVISAR]: 'Finanzas la tiene en revision (Need to review)',
};

// Orden importa: "pending report" antes que "pending".
const PATRONES_ESTADO = [
  [/^ap completed\b/, ESTADO_FACTURA.AP_COMPLETED],
  [/^approving\b/, ESTADO_FACTURA.APPROVING],
  [/^pending report\b/, ESTADO_FACTURA.PENDING_REPORT],
  [/^draft\b/, ESTADO_FACTURA.DRAFT],
  [/^need to review\b/, ESTADO_FACTURA.REVISAR],
  [/^pending$|^(need|pending)( to)? register\b/, ESTADO_FACTURA.PENDING],
];

/** De la col "Invoice Status" (normalizada) a un ESTADO_FACTURA; '' si no se reconoce. */
export function estadoFactura(status) {
  return PATRONES_ESTADO.find(([re]) => re.test(status ?? ''))?.[1] || '';
}

// Lo que no es un numero ("Not received", "Monthly", "In transit") es una fila
// que Finanzas todavia no completa.
const NUMERO_FACTURA_RE = /^\d+$/;

/**
 * @param {object} documento salida de agruparDocumentos
 * @param {object|null} receta salida de armarReceta
 * @returns {{ elegible: boolean, motivos: string[] }}
 */
export function evaluarElegibilidad(documento, receta) {
  const motivos = [];
  const tipo = TIPOS_DOCUMENTO[documento.docType];

  const estado = estadoFactura(documento.status);
  if (estado !== ESTADO_FACTURA.PENDING) {
    motivos.push(MOTIVO_ESTADO[estado] || `estado "${documento.status || 'vacio'}" desconocido`);
  }
  if (!tipo) motivos.push(`tipo de documento "${documento.docType || 'vacio'}" no soportado`);
  if (!receta) motivos.push('sin receta para este cliente');
  else if (receta.systemModule !== GEVS.MODULO_SOPORTADO) motivos.push(`va por "${receta.systemModule}", no por Complex Voucher`);
  if (COMMISSION_SIN_RECETA.includes(normalizar(documento.commissionType))) {
    motivos.push(`"${documento.commissionType}" no tiene receta en Master 2 (su Description es otra)`);
  }
  if (!documento.invoiceNumber) motivos.push('sin numero de factura');
  else if (!NUMERO_FACTURA_RE.test(documento.invoiceNumber)) motivos.push(`numero de factura invalido ("${documento.invoiceNumber}")`);
  if (!FECHA_ISO_RE.test(documento.invoiceDate)) {
    motivos.push(`fecha de factura invalida ("${documento.invoiceDate || 'vacia'}")`);
  }
  if (!documento.lineas.some((l) => l.neto !== 0)) motivos.push('sin montos por BU');
  if (!documento.total || !documento.total.neto) motivos.push('sin fila TOTAL o con total 0');
  // Una nota de credito lleva TODO en negativo y una factura todo en positivo:
  // un monto con el signo cambiado es un error del Excel y no se carga.
  const montos = [...documento.lineas.map((l) => l.neto), documento.total?.neto ?? 0];
  if (tipo && montos.some((m) => m * tipo.signo < 0)) {
    motivos.push(`montos con el signo cambiado: una ${tipo.label} lleva todo en ${tipo.signo < 0 ? 'negativo' : 'positivo'}`);
  }
  if (documento.ambiguo) motivos.push('una BU aparece dos veces con montos distintos');

  return { elegible: motivos.length === 0, motivos };
}
