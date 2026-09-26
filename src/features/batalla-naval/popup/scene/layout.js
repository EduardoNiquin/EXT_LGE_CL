// Geometria compartida de la escena: 1 unidad = 1 casilla, tablero centrado en
// el origen sobre el plano XZ. Fila 0 al fondo (-Z), columna 0 a la izquierda.

import { GRID } from '../../constants.js';

export const HALF = GRID / 2;

/** Altura media del agua y de las casillas (flotan por encima de las olas). */
export const WATER_Y = 0;
export const TILE_Y = 0.27;

/** Centro de la casilla (r,c) en coordenadas de mundo. */
export function cellCenter(r, c) {
  return { x: c - HALF + 0.5, z: r - HALF + 0.5 };
}

/** Casilla bajo un punto del plano XZ, o null si cae fuera del tablero. */
export function cellAt(x, z) {
  const c = Math.floor(x + HALF);
  const r = Math.floor(z + HALF);
  if (r < 0 || c < 0 || r >= GRID || c >= GRID) return null;
  return { r, c };
}

/** Fase estable por casilla (para que no floten todas al unisono). */
export function cellPhase(r, c) {
  return ((r * 7.13 + c * 3.71) % 6.283) + (r + c) * 0.21;
}

/**
 * Oleaje: suma de trenes de ondas (direccion, frecuencia, velocidad, amplitud)
 * + una marea lenta que sube y baja todo el mar. La MISMA definicion la usan el
 * shader del agua (WAVES_GLSL) y todo lo que flota (swell), asi barcos, minas y
 * restos siguen exactamente a la superficie que se ve.
 */
export const WAVES = [
  { dx: 1.0, dz: 0.3, freq: 0.42, speed: 0.95, amp: 0.075 },
  { dx: -0.45, dz: 1.0, freq: 0.6, speed: 1.25, amp: 0.055 },
  { dx: 0.7, dz: 0.7, freq: 1.05, speed: 1.8, amp: 0.03 },
  { dx: -0.8, dz: 0.55, freq: 1.7, speed: 2.4, amp: 0.016 },
];
export const TIDE = { amp: 0.035, speed: 0.33 };

function norm(w) {
  const l = Math.hypot(w.dx, w.dz);
  return { x: w.dx / l, z: w.dz / l };
}

export function swell(x, z, t) {
  let y = Math.sin(t * TIDE.speed) * TIDE.amp;
  for (const w of WAVES) {
    const d = norm(w);
    y += Math.sin((x * d.x + z * d.z) * w.freq + t * w.speed) * w.amp;
  }
  return y;
}

/** La misma funcion en GLSL (se inyecta en el vertex shader del agua). */
export const WAVES_GLSL = `
float swell(vec2 p, float t) {
  float y = sin(t * ${TIDE.speed.toFixed(4)}) * ${TIDE.amp.toFixed(4)};
${WAVES.map((w) => {
    const d = norm(w);
    return `  y += sin(dot(p, vec2(${d.x.toFixed(4)}, ${d.z.toFixed(4)})) * ${w.freq.toFixed(4)} + t * ${w.speed.toFixed(4)}) * ${w.amp.toFixed(4)};`;
  }).join('\n')}
  return y;
}
`;
