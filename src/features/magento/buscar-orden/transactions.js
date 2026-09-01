// Lectura de las notas de transaccion de una orden. Todo lo de aca es puro
// (recibe texto, devuelve datos) para poder testearlo sin DOM: el content script
// solo se encarga de convertir el HTML de la nota en texto plano.

import { GATEWAY } from './constants.js';

/** Quita acentos, colapsa espacios y baja a minusculas. Base de toda comparacion. */
export function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Convierte el comentario de una nota en pares clave/valor.
 *   - "{...}" (JSON) → sus propias claves.
 *   - "Label: valor" por linea → pares; la primera linea sin ":" queda de titulo.
 * Devuelve tambien `text` para poder detectar la pasarela por palabras sueltas.
 */
export function parseNoteComment(rawText) {
  const text = cleanLines(rawText);
  const trimmed = text.trim();

  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      const values = {};
      const order = [];
      for (const [key, value] of Object.entries(obj)) {
        values[key] = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
        order.push(key);
      }
      return { values, order, title: '', text: trimmed, isJson: true };
    } catch { /* cae al parseo por lineas */ }
  }

  const values = {};
  const order = [];
  let title = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) {
      if (!title) title = line;
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    // MercadoPago abre con "Notificacion automatica de Mercado Pago: El pago fue
    // aprobado." — es la frase de cabecera, no un campo; si no hay titulo aun,
    // se usa como tal en vez de ensuciar los pares.
    if (!title && !(key in values) && /notificacion/i.test(normalizeKey(key))) {
      title = `${key}: ${value}`;
      continue;
    }
    if (!(key in values)) order.push(key);
    values[key] = value;
  }
  return { values, order, title, text, isJson: false };
}

/** Pasarela a la que pertenece una nota ya parseada. */
export function detectGateway(parsed) {
  const keys = (parsed.order || []).map(normalizeKey);
  const blob = normalizeKey(parsed.text);

  if (
    keys.includes('vci')
    || keys.some((key) => key.includes('codigo de respuesta') || key.includes('codigo de autorizacion'))
    || blob.includes('webpay')
    || blob.includes('transbank')
    || blob.includes('tbk')
  ) {
    return GATEWAY.WEBPAY;
  }
  if (
    blob.includes('mercadopago')
    || blob.includes('mercado pago')
    || blob.includes('status_detail')
    || blob.includes('cc_rejected')
    || keys.includes('status_detail')
    || keys.includes('detalle del estado')
    || keys.includes('numero de pago')
  ) {
    return GATEWAY.MERCADOPAGO;
  }
  return GATEWAY.UNKNOWN;
}

/**
 * Nota cruda (ya con el comentario en texto plano) → transaccion normalizada.
 * Devuelve null si la nota no trae comentario: son las del historial.
 */
export function buildTransaction({ when = '', noteStatus = '', comment = '' } = {}) {
  if (!String(comment).trim()) return null;
  const parsed = parseNoteComment(comment);
  const gateway = detectGateway(parsed);
  return {
    gateway,
    when,
    noteStatus,
    title: parsed.title,
    order: parsed.order,
    values: parsed.values,
  };
}

/** Busca en una transaccion el valor de un campo por sus etiquetas conocidas. */
export function readField(transaction, noteKeys = []) {
  const wanted = noteKeys.map(normalizeKey);
  const entries = Object.entries(transaction?.values || {});

  const exact = entries.find(([key]) => wanted.includes(normalizeKey(key)));
  if (exact) return exact[1];

  const partial = entries.find(([key]) => {
    const norm = normalizeKey(key);
    return wanted.some((candidate) => norm.includes(candidate));
  });
  return partial ? partial[1] : '';
}

function cleanLines(value) {
  return String(value ?? '')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0\u202f]+/g, ' ').trim())
    .join('\n');
}
