// Logica pura de la Batalla Naval (sin IO). Reusable y testeable.
//
// Tablero COMPARTIDO de 16x16: ambos jugadores despliegan barcos y bombas en
// el mismo mapa (ocultos entre si). Un disparo a una casilla:
//   - con barco enemigo  -> 1 punto de dano a esa celda del barco.
//   - con bomba enemiga  -> explota en 3x3 (recortada en bordes) y dana SOLO a
//                           los barcos de quien disparo (trampa).
//   - vacia              -> agua.
// Un barco cae cuando TODAS sus celdas fueron daniadas.

import { GRID, ROLE } from './constants.js';

/** Rol opuesto. */
export function otherRole(role) {
  return role === ROLE.P1 ? ROLE.P2 : ROLE.P1;
}

// --- Celdas y colocacion ------------------------------------------------------

/** Key estable de una celda ("r_c"), segura como key de Firebase. */
export function cellKey(r, c) {
  return `${r}_${c}`;
}

/** True si la celda esta dentro del tablero. */
export function inBounds(r, c) {
  return r >= 0 && c >= 0 && r < GRID && c < GRID;
}

/** Celdas {r,c} que ocupa un barco { r, c, dir:'h'|'v', size }. */
export function shipCells(ship) {
  const cells = [];
  for (let i = 0; i < ship.size; i++) {
    cells.push(ship.dir === 'v' ? { r: ship.r + i, c: ship.c } : { r: ship.r, c: ship.c + i });
  }
  return cells;
}

/**
 * Ajusta la cabeza del barco para que quepa entero en el tablero (lo "empuja"
 * hacia adentro). Util para el preview al colocar.
 */
export function clampShip(ship) {
  const r = Math.max(0, Math.min(ship.dir === 'v' ? GRID - ship.size : GRID - 1, ship.r));
  const c = Math.max(0, Math.min(ship.dir === 'h' ? GRID - ship.size : GRID - 1, ship.c));
  return { ...ship, r, c };
}

/** Set de keys ocupadas por elementos propios (barcos + bombas). */
export function occupiedKeys(ships, bombs, skipShipId = null) {
  const set = new Set();
  for (const s of ships || []) {
    if (skipShipId && s.id === skipShipId) continue;
    for (const cc of shipCells(s)) set.add(cellKey(cc.r, cc.c));
  }
  for (const b of bombs || []) set.add(cellKey(b.r, b.c));
  return set;
}

/** True si el barco cabe en el tablero y no pisa otros elementos propios. */
export function canPlaceShip(ship, ships, bombs) {
  const cells = shipCells(ship);
  if (!cells.every(({ r, c }) => inBounds(r, c))) return false;
  const occ = occupiedKeys(ships, bombs, ship.id);
  return cells.every(({ r, c }) => !occ.has(cellKey(r, c)));
}

/** True si la bomba cabe y no pisa otros elementos propios. */
export function canPlaceBomb(r, c, ships, bombs) {
  if (!inBounds(r, c)) return false;
  return !occupiedKeys(ships, bombs).has(cellKey(r, c));
}

/** Area de explosion 3x3 alrededor de (r,c), recortada en bordes/esquinas. */
export function blastArea(r, c) {
  const cells = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (inBounds(rr, cc)) cells.push({ r: rr, c: cc });
    }
  }
  return cells;
}

// --- Estado de la flota ---------------------------------------------------------

/** True si todas las celdas del barco fueron daniadas (barco caido). */
export function isSunk(ship) {
  return shipCells(ship).every(({ r, c }) => !!ship.hits?.[cellKey(r, c)]);
}

/** True si TODA la flota esta hundida (derrota). */
export function fleetSunk(ships) {
  return (ships || []).length > 0 && ships.every(isSunk);
}

/** Setup inicial de la partida (nadie listo). */
export function emptySetup() {
  return {
    [ROLE.P1]: { ready: false },
    [ROLE.P2]: { ready: false },
  };
}

/** Copia profunda (segura de mutar) del nodo setup de la partida. */
export function cloneSetup(setup) {
  const out = {};
  for (const role of [ROLE.P1, ROLE.P2]) {
    const s = setup?.[role] || {};
    out[role] = {
      ready: !!s.ready,
      ships: (s.ships || []).map((sh) => ({ ...sh, hits: { ...(sh.hits || {}) } })),
      bombs: (s.bombs || []).map((b) => ({ ...b })),
    };
  }
  return out;
}

// --- Resolucion de disparos -----------------------------------------------------

/**
 * Resuelve (en puro) el disparo de `role` a (r,c). NO muta `game`.
 * @returns {{ setup, event, winner }} setup actualizado, evento para feedback
 *          ({ by, r, c, res:'miss'|'hit'|'boom', dmg:[keys], sunk:[shipIds] })
 *          y el rol ganador si la jugada cierra la partida (o null).
 */
export function resolveShot(game, role, r, c) {
  const enemy = otherRole(role);
  const setup = cloneSetup(game.setup);
  const eSet = setup[enemy];
  const mSet = setup[role];
  const key = cellKey(r, c);
  const event = { by: role, r, c, res: 'miss', dmg: [], sunk: [] };

  // 1) ¿Barco enemigo en la celda? -> 1 punto de dano.
  const target = (eSet.ships || []).find(
    (s) => shipCells(s).some((cc) => cellKey(cc.r, cc.c) === key),
  );
  if (target) {
    if (!target.hits[key]) {
      target.hits[key] = true;
      event.dmg.push(key);
    }
    event.res = 'hit';
    if (isSunk(target)) event.sunk.push(target.id);
  } else {
    // 2) ¿Bomba enemiga sin explotar? -> explota y dana MIS barcos en 3x3.
    const bomb = (eSet.bombs || []).find((b) => !b.exploded && cellKey(b.r, b.c) === key);
    if (bomb) {
      bomb.exploded = true;
      event.res = 'boom';
      for (const cell of blastArea(r, c)) {
        const k = cellKey(cell.r, cell.c);
        for (const s of mSet.ships || []) {
          const covers = shipCells(s).some((cc) => cellKey(cc.r, cc.c) === k);
          if (covers && !s.hits[k]) {
            s.hits[k] = true;
            event.dmg.push(k);
            if (isSunk(s) && !event.sunk.includes(s.id)) event.sunk.push(s.id);
          }
        }
      }
    }
  }

  let winner = null;
  if (fleetSunk(eSet.ships)) winner = role;          // hundi toda la flota rival
  else if (fleetSunk(mSet.ships)) winner = enemy;    // la bomba me hundio la mia
  return { setup, event, winner };
}

/**
 * Asigna roles de forma determinista a partir de los uids: P1 = uid menor
 * (orden lexicografico); P2 = uid mayor. Asi ambos clientes calculan los
 * mismos roles sin coordinar.
 */
export function rolesFromUids(uidA, uidB) {
  const [low, high] = [uidA, uidB].sort();
  return { [ROLE.P1]: low, [ROLE.P2]: high };
}

/** Id de partida determinista por par de jugadores (preserva el marcador). */
export function pairId(uidA, uidB) {
  return [uidA, uidB].sort().join('__');
}

/** Rol de un uid dentro de un mapa players { P1:{uid}, P2:{uid} }. */
export function roleForUid(players, uid) {
  if (players?.[ROLE.P1]?.uid === uid) return ROLE.P1;
  if (players?.[ROLE.P2]?.uid === uid) return ROLE.P2;
  return null;
}

// --- Nombres / ranking -------------------------------------------------------

/** Normaliza un nombre para comparar/agrupar: sin acentos, minusculas, trim. */
export function normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita diacriticos (acentos)
    .trim()
    .toLowerCase();
}

/**
 * Key de Firebase para el ranking, derivada del nombre normalizado. Asi
 * "Pedro08" y "pedro08" caen en la misma entrada. Reemplaza los caracteres que
 * Firebase no permite en una key (`.#$[]/` y espacios) por `_`.
 */
export function nameKey(name) {
  const k = normalizeName(name).replace(/[.#$[\]/\s]+/g, '_');
  return k || '_';
}

/** Etiqueta legible de una celda: columna A-P + fila 1-16 (ej: "D7"). */
export function coordLabel(r, c) {
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}
