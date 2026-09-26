// Partida local contra la IA (sin Firebase, NO puntua en el ranking).
//
// El objeto partida tiene la MISMA forma que el de Firebase (players, setup,
// shots, last, seq, turn, status, winner, score, moveDeadline), asi la vista
// (play.js) y la escena 3D lo muestran sin distinguir el origen. Todo es puro:
// cada funcion devuelve una partida nueva y no muta la recibida. El humano es
// siempre P1 y la IA P2.
//
// La IA es sencilla a proposito:
//   - Despliega su flota y sus minas al azar.
//   - "Caza": dispara al azar (en damero, porque el barco mas chico ocupa 2
//     casillas), evitando las casillas de su propia flota.
//   - "Remata": si hay impactos en un barco del jugador que sigue a flote,
//     tantea los alrededores (y si ya tiene 2 impactos en linea, sigue esa
//     linea) hasta hundirlo, como haria una persona.

import {
  GRID, FLEET, BOMBS_PER_PLAYER, GAME_STATUS, ROLE, TURN_MS,
} from './constants.js';
import {
  otherRole, cellKey, inBounds, shipCells, canPlaceShip, canPlaceBomb,
  isSunk, resolveShot, emptySetup,
} from './game.js';

export const AI_ROLE = ROLE.P2;
export const HUMAN_ROLE = ROLE.P1;
export const AI_NAME = 'IA';
/** Pausa (ms) antes de que la IA dispare: que se note que "piensa". */
export const AI_THINK_MS = 1100;

function pick(list, rnd) {
  return list[Math.floor(rnd() * list.length)];
}

// --- Despliegue al azar -------------------------------------------------------------

/** Flota y minas al azar, validas segun las reglas de colocacion. */
export function randomFleet(rnd = Math.random) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const ships = [];
    const bombs = [];
    let ok = true;
    for (const f of FLEET) {
      let placed = false;
      for (let i = 0; i < 200 && !placed; i++) {
        const dir = rnd() < 0.5 ? 'h' : 'v';
        const ship = {
          id: f.id,
          size: f.size,
          dir,
          r: Math.floor(rnd() * (dir === 'v' ? GRID - f.size + 1 : GRID)),
          c: Math.floor(rnd() * (dir === 'h' ? GRID - f.size + 1 : GRID)),
        };
        if (canPlaceShip(ship, ships, bombs)) {
          ships.push(ship);
          placed = true;
        }
      }
      if (!placed) { ok = false; break; }
    }
    for (let b = 0; ok && b < BOMBS_PER_PLAYER; b++) {
      let placed = false;
      for (let i = 0; i < 200 && !placed; i++) {
        const r = Math.floor(rnd() * GRID);
        const c = Math.floor(rnd() * GRID);
        if (canPlaceBomb(r, c, ships, bombs)) {
          bombs.push({ r, c });
          placed = true;
        }
      }
      if (!placed) ok = false;
    }
    if (ok) return { ships, bombs };
  }
  throw new Error('No se pudo desplegar la flota de la IA');
}

function aiSetup(rnd) {
  const { ships, bombs } = randomFleet(rnd);
  return {
    ready: true,
    ships: ships.map((s) => ({ ...s })),
    bombs: bombs.map((b) => ({ ...b, exploded: false })),
  };
}

// --- Ciclo de la partida ---------------------------------------------------------------

/** Partida nueva en despliegue: la IA ya esta lista; el humano coloca. */
export function makeAiGame(humanName, rnd = Math.random, score = null) {
  const setup = emptySetup();
  setup[AI_ROLE] = aiSetup(rnd);
  return {
    local: true,
    players: {
      [HUMAN_ROLE]: { uid: 'local', name: humanName || 'Tu' },
      [AI_ROLE]: { uid: 'ai', name: AI_NAME },
    },
    status: GAME_STATUS.PLACING,
    setup,
    shots: null,
    seq: 0,
    last: null,
    turn: null,
    winner: null,
    moveDeadline: null,
    rematch: { [ROLE.P1]: false, [ROLE.P2]: false },
    leaver: null,
    score: score || { [ROLE.P1]: 0, [ROLE.P2]: 0 },
    startedAt: Date.now(),
  };
}

/** El humano publica su flota: como la IA ya esta lista, arranca la batalla. */
export function submitHumanSetup(game, ships, bombs, rnd = Math.random, now = Date.now()) {
  if (game.status !== GAME_STATUS.PLACING) return game;
  return {
    ...game,
    setup: {
      ...game.setup,
      [HUMAN_ROLE]: {
        ready: true,
        ships: ships.map((s) => ({ id: s.id, size: s.size, r: s.r, c: s.c, dir: s.dir })),
        bombs: bombs.map((b) => ({ r: b.r, c: b.c, exploded: false })),
      },
    },
    status: GAME_STATUS.PLAYING,
    turn: rnd() < 0.5 ? ROLE.P1 : ROLE.P2,
    moveDeadline: now + TURN_MS,
    seq: 0,
    last: null,
    shots: null,
  };
}

/** Disparo de `role` a (r,c). Misma semantica que net.fireShot (sin ranking). */
export function applyShot(game, role, r, c, now = Date.now()) {
  if (game.status !== GAME_STATUS.PLAYING || game.turn !== role) return game;
  const shotKey = `${role}_${r}_${c}`;
  if (game.shots?.[shotKey]) return game;

  const { setup, event, winner } = resolveShot(game, role, r, c);
  const seq = (game.seq || 0) + 1;
  const next = {
    ...game,
    setup,
    shots: { ...(game.shots || {}), [shotKey]: { by: role, r, c, res: event.res, seq } },
    seq,
    last: { ...event, seq, ts: now },
  };
  if (winner) {
    next.status = GAME_STATUS.FINISHED;
    next.winner = winner;
    next.score = { ...(game.score || {}), [winner]: (game.score?.[winner] || 0) + 1 };
  } else {
    next.turn = otherRole(role);
    next.moveDeadline = now + TURN_MS;
  }
  return next;
}

/** Turno perdido por tiempo. */
export function passTurn(game, role, now = Date.now()) {
  if (game.status !== GAME_STATUS.PLAYING || game.turn !== role) return game;
  const seq = (game.seq || 0) + 1;
  return {
    ...game,
    turn: otherRole(role),
    moveDeadline: now + TURN_MS,
    seq,
    last: { by: role, res: 'pass', seq, ts: now },
  };
}

/** Rendicion de `role`: la partida la gana el rival y suma a su marcador. */
export function surrender(game, role, now = Date.now()) {
  if (game.status !== GAME_STATUS.PLAYING) return game;
  const winner = otherRole(role);
  const seq = (game.seq || 0) + 1;
  return {
    ...game,
    status: GAME_STATUS.FINISHED,
    winner,
    score: { ...(game.score || {}), [winner]: (game.score?.[winner] || 0) + 1 },
    seq,
    moveDeadline: null,
    last: { by: role, res: 'surrender', seq, ts: now },
  };
}

/** Revancha inmediata: flota nueva de la IA, se conserva el marcador. */
export function rematch(game, rnd = Math.random) {
  return makeAiGame(game.players?.[HUMAN_ROLE]?.name, rnd, game.score);
}

// --- Punteria de la IA ----------------------------------------------------------------------

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * Casillas impactadas de barcos del jugador que siguen a flote. Es informacion
 * que un jugador real tambien ve (la niebla de guerra muestra los impactos).
 */
export function openHits(game) {
  const out = [];
  for (const s of game.setup?.[HUMAN_ROLE]?.ships || []) {
    if (isSunk(s)) continue;
    for (const cc of shipCells(s)) {
      if (s.hits?.[cellKey(cc.r, cc.c)]) out.push({ r: cc.r, c: cc.c });
    }
  }
  return out;
}

/**
 * Candidatos para rematar: si hay impactos alineados (2+ en la misma fila o
 * columna, contiguos), se prolonga esa linea por sus extremos; si no, las 4
 * casillas vecinas de cada impacto.
 */
export function targetCandidates(hits, canShoot) {
  const hitSet = new Set(hits.map((h) => cellKey(h.r, h.c)));
  const lines = [];
  for (const h of hits) {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      if (!hitSet.has(cellKey(h.r + dr, h.c + dc))) continue;
      // Tramo contiguo en esa direccion: extremos = primera casilla libre a cada lado.
      let r0 = h.r;
      let c0 = h.c;
      while (hitSet.has(cellKey(r0 - dr, c0 - dc))) { r0 -= dr; c0 -= dc; }
      let r1 = h.r;
      let c1 = h.c;
      while (hitSet.has(cellKey(r1 + dr, c1 + dc))) { r1 += dr; c1 += dc; }
      for (const [r, c] of [[r0 - dr, c0 - dc], [r1 + dr, c1 + dc]]) {
        if (canShoot(r, c)) lines.push({ r, c });
      }
    }
  }
  if (lines.length) return lines;

  const around = [];
  for (const h of hits) {
    for (const [dr, dc] of DIRS) {
      const r = h.r + dr;
      const c = h.c + dc;
      if (canShoot(r, c) && !around.some((x) => x.r === r && x.c === c)) around.push({ r, c });
    }
  }
  return around;
}

/** Elige la casilla del proximo disparo de la IA. Devuelve { r, c } o null. */
export function aiPickShot(game, rnd = Math.random) {
  const shots = game.shots || {};
  const shotByAi = (r, c) => !!shots[`${AI_ROLE}_${r}_${c}`];
  const canShoot = (r, c) => inBounds(r, c) && !shotByAi(r, c);

  // 1) Rematar: tantear alrededor de los impactos pendientes.
  const hits = openHits(game);
  if (hits.length) {
    const cands = targetCandidates(hits, canShoot);
    if (cands.length) return pick(cands, rnd);
  }

  // 2) Cazar al azar, evitando su propia flota y minas (una persona tampoco
  // dispara sobre lo suyo) y prefiriendo el damero.
  const own = new Set();
  const mine = game.setup?.[AI_ROLE] || {};
  for (const s of mine.ships || []) for (const cc of shipCells(s)) own.add(cellKey(cc.r, cc.c));
  for (const b of mine.bombs || []) own.add(cellKey(b.r, b.c));

  const free = [];
  const parity = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if (!canShoot(r, c) || own.has(cellKey(r, c))) continue;
      free.push({ r, c });
      if ((r + c) % 2 === 0) parity.push({ r, c });
    }
  }
  if (parity.length) return pick(parity, rnd);
  if (free.length) return pick(free, rnd);

  // 3) Sin opciones "limpias": cualquier casilla aun no disparada.
  const any = [];
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if (canShoot(r, c)) any.push({ r, c });
  return any.length ? pick(any, rnd) : null;
}

/** Jugada completa de la IA (si le toca). */
export function aiMove(game, rnd = Math.random, now = Date.now()) {
  if (game.status !== GAME_STATUS.PLAYING || game.turn !== AI_ROLE) return game;
  const shot = aiPickShot(game, rnd);
  if (!shot) return passTurn(game, AI_ROLE, now);
  return applyShot(game, AI_ROLE, shot.r, shot.c, now);
}
