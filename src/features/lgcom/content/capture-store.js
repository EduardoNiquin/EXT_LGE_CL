// Store en memoria de las capturas GraphQL recibidas desde el bridge MAIN.
//
// Modelo volátil deliberado: las respuestas GraphQL son grandes y específicas de
// la navegación actual. Igual que el modelo SPA de "Colocar TAGs", viven mientras
// la pestaña esté abierta y se piden on-demand desde el popup; no se persisten en
// chrome.storage.
//
// Estructura: Map operationName → array de capturas (las más recientes al final),
// recortado a CAPTURE_CAP. `order` preserva el orden de primera aparición de cada
// operación para la UI.

import { CAPTURE_CAP } from '../constants.js';

const byOperation = new Map();
const order = [];

export function put(operationName, capture) {
  const name = operationName || 'unknown';
  if (!byOperation.has(name)) {
    byOperation.set(name, []);
    order.push(name);
  }
  const list = byOperation.get(name);
  list.push(capture);
  if (list.length > CAPTURE_CAP) list.splice(0, list.length - CAPTURE_CAP);
}

// Resumen liviano (sin response) de la última captura de cada operación.
export function listLatest() {
  return order.map((name) => {
    const list = byOperation.get(name) || [];
    const last = list[list.length - 1];
    return {
      operationName: name,
      ts: last?.ts ?? null,
      url: last?.url ?? null,
      variables: last?.variables ?? null,
      count: list.length,
    };
  });
}

// Última captura completa (con response) de una operación dada.
export function getLatest(operationName) {
  const list = byOperation.get(operationName) || [];
  return list[list.length - 1] || null;
}

export function clear() {
  byOperation.clear();
  order.length = 0;
}
