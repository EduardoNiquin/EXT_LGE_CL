// Logica pura del tablero (sin IO). Reusable y testeable.

import { BOARD_SIZE, WIN_LINES, ROLE } from './constants.js';

/** Tablero vacio: 9 casillas en null. */
export function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => null);
}

/** Rol opuesto. */
export function otherRole(role) {
  return role === ROLE.P1 ? ROLE.P2 : ROLE.P1;
}

/**
 * Devuelve el rol ganador ('P1'|'P2') y la linea, o null si no hay 3 en raya.
 * @returns {{ role: string, line: number[] } | null}
 */
export function findWinner(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const v = board[a];
    if (v && v === board[b] && v === board[c]) {
      return { role: v, line };
    }
  }
  return null;
}

/** True si todas las casillas estan marcadas. */
export function isFull(board) {
  return board.every((c) => c != null);
}

/**
 * Asigna roles de forma determinista a partir de los uids: P1 = uid menor
 * (orden lexicografico), marca ROJO; P2 = uid mayor, marca NEGRO. Asi ambos
 * clientes calculan los mismos roles sin coordinar.
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

// --- IA "defensiva" ----------------------------------------------------------

/**
 * Elige la jugada de la IA. Filosofia: NO juega para ganar, sino para EVITAR
 * PERDER. Si el humano amenaza con cerrar un 3 en linea (dos casillas suyas y la
 * tercera libre), tapa esa casilla; si hay varias amenazas, tapa una (no se
 * pueden tapar todas: ahi perdera, y esta bien). Si no hay amenazas, juega al
 * azar. Defensivo ante tableros llenos/invalidos: devuelve -1 si no hay celdas.
 *
 * @returns {number} indice de casilla [0..8], o -1 si no hay movimientos.
 */
export function aiPickMove(board, cpuRole) {
  const human = otherRole(cpuRole);
  const empties = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (board[i] == null) empties.push(i);
  }
  if (empties.length === 0) return -1;

  // Casillas donde el humano cerraria 3 en linea: hay que taparlas.
  const threats = empties.filter((e) => {
    for (const line of WIN_LINES) {
      if (!line.includes(e)) continue;
      const others = line.filter((c) => c !== e);
      if (others.every((c) => board[c] === human)) return true;
    }
    return false;
  });

  const pool = threats.length ? threats : empties;
  return pool[Math.floor(Math.random() * pool.length)];
}
