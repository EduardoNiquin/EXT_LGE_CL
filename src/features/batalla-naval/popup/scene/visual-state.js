// Logica pura: traduce el estado del juego a "lo que se dibuja" en la escena 3D.
// Sin Three ni DOM (testeable). La niebla de guerra se aplica aqui: del rival
// solo se ven las celdas impactadas, los barcos hundidos (enteros) y las bombas
// ya explotadas; las bombas propias sin explotar solo las ve su dueno.

import { cellKey, shipCells, isSunk } from '../../game.js';

/**
 * @typedef {{ id:string, size:number, r:number, c:number, dir:'h'|'v', hits:string[], sunk:boolean }} ShipView
 * @typedef {{
 *   myShips: ShipView[],
 *   enemySunk: ShipView[],
 *   enemyHits: string[],
 *   mines: { r:number, c:number, mine:boolean, exploded:boolean }[],
 *   misses: string[],
 *   shotByMe: string[],
 * }} VisualState
 */

function shipView(s) {
  const hits = shipCells(s)
    .map((cc) => cellKey(cc.r, cc.c))
    .filter((k) => !!s.hits?.[k]);
  return { id: s.id, size: s.size, r: s.r, c: s.c, dir: s.dir, hits, sunk: isSunk(s) };
}

/** Estado visual del despliegue: solo lo propio, sin danos. */
export function placementVisualState(place) {
  return {
    myShips: (place?.ships || []).map((s) => ({ ...shipView(s), hits: [], sunk: false })),
    enemySunk: [],
    enemyHits: [],
    mines: (place?.bombs || []).map((b) => ({ r: b.r, c: b.c, mine: true, exploded: false })),
    misses: [],
    shotByMe: [],
  };
}

/**
 * Estado visual de la batalla desde el punto de vista de `myRole`.
 * @param {{ mySetup:object, oppSetup:object, shots:object, myRole:string }} snap
 * @returns {VisualState}
 */
export function battleVisualState(snap) {
  const myShips = (snap.mySetup?.ships || []).map(shipView);

  const enemySunk = [];
  const enemyHits = [];
  for (const s of snap.oppSetup?.ships || []) {
    const v = shipView(s);
    if (v.sunk) enemySunk.push({ ...v, hits: [] });
    else enemyHits.push(...v.hits);
  }

  const mines = [];
  for (const b of snap.mySetup?.bombs || []) {
    mines.push({ r: b.r, c: b.c, mine: true, exploded: !!b.exploded });
  }
  for (const b of snap.oppSetup?.bombs || []) {
    if (b.exploded) mines.push({ r: b.r, c: b.c, mine: false, exploded: true });
  }

  // Celdas con algo visible encima: ahi no se dibuja la bala de "agua".
  const occupied = new Set(enemyHits);
  for (const s of myShips) for (const cc of shipCells(s)) occupied.add(cellKey(cc.r, cc.c));
  for (const s of enemySunk) for (const cc of shipCells(s)) occupied.add(cellKey(cc.r, cc.c));
  for (const m of mines) occupied.add(cellKey(m.r, m.c));

  const misses = [];
  const shotByMe = [];
  for (const sh of Object.values(snap.shots || {})) {
    if (!sh) continue;
    const k = cellKey(sh.r, sh.c);
    if (sh.by === snap.myRole) shotByMe.push(k);
    if (sh.res === 'miss' && !occupied.has(k) && !misses.includes(k)) misses.push(k);
  }

  return { myShips, enemySunk, enemyHits, mines, misses, shotByMe };
}
