// Operaciones de red contra Firebase RTDB: presencia, matchmaking por reto,
// ranking global y partidas. Todo via la API REST (shared/rtdb.js). Pensado
// para baja concurrencia (un puñado de companeros de trabajo).
//
// MATCHMAKING POR RETO (en vez del emparejamiento aleatorio anterior): mientras
// buscas, ves a los demas que tambien buscan y puedes "retar" a uno. El retado
// queda obligado a jugar. Para evitar que dos retos simultaneos pisen al mismo
// rival, el reclamo del slot del rival es ATOMICO via ETags (rsetIfMatch).

import {
  rget,
  rset,
  rupdate,
  rremove,
  rgetWithEtag,
  rsetIfMatch,
} from './shared/rtdb.js';
import {
  PRESENCE_FRESH_MS,
  TICKET_FRESH_MS,
  TURN_MS,
  GAME_STATUS,
  WINNER,
  ROLE,
  LEADERBOARD_PATH,
} from './constants.js';
import {
  emptyBoard,
  findWinner,
  isFull,
  otherRole,
  rolesFromUids,
  pairId,
  roleForUid,
  nameKey,
} from './game.js';

// --- Presencia ---------------------------------------------------------------

/** Marca/renueva nuestra presencia (heartbeat). */
export function beatPresence(uid, name) {
  return rset(`presence/${uid}`, { name, ts: Date.now() });
}

/** Quita nuestra presencia. */
export function clearPresence(uid) {
  return rremove(`presence/${uid}`).catch(() => {});
}

/** Cantidad de OTROS jugadores con heartbeat reciente. */
export async function countActivePlayers(selfUid) {
  const all = (await rget('presence')) || {};
  const now = Date.now();
  let n = 0;
  for (const [uid, p] of Object.entries(all)) {
    if (uid === selfUid) continue;
    if (p && typeof p.ts === 'number' && now - p.ts < PRESENCE_FRESH_MS) n++;
  }
  return n;
}

// --- Cola / lista de jugadores buscando --------------------------------------

/** Entra a la cola (o renueva el ticket). Sin gameId ni reto pendiente. */
export function enqueue(uid, name) {
  return rset(`matchmaking/${uid}`, { uid, name, ts: Date.now(), gameId: null, challenge: null });
}

/** Sale de la cola. */
export function dequeue(uid) {
  return rremove(`matchmaking/${uid}`).catch(() => {});
}

/** Otros jugadores buscando partida (ticket fresco, sin partida asignada). */
export async function listSearchers(selfUid) {
  const all = (await rget('matchmaking')) || {};
  const now = Date.now();
  return Object.values(all)
    .filter((t) => t && t.uid && t.uid !== selfUid && !t.gameId
      && typeof t.ts === 'number' && now - t.ts < TICKET_FRESH_MS)
    .map((t) => ({ uid: t.uid, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Sondea mi propio ticket. Refresca mi ts y, si alguien me asigno partida (me
 * reto), devuelve los datos para unirme + quien me reto.
 * @returns {Promise<null | { gameId, role, opponentName, challengedBy }>}
 */
export async function pollTicket(uid) {
  const my = await rget(`matchmaking/${uid}`);
  if (!my) return null;
  rupdate(`matchmaking/${uid}`, { ts: Date.now() }).catch(() => {});
  if (!my.gameId) return null;

  const game = await getGame(my.gameId);
  const role = roleForUid(game?.players, uid);
  const oppName = role && game ? (game.players[otherRole(role)]?.name || 'Rival') : 'Rival';
  return {
    gameId: my.gameId,
    role,
    opponentName: oppName,
    challengedBy: my.challenge?.byName || null,
  };
}

// --- Reto (claim atomico) ----------------------------------------------------

async function clearClaimIfMine(targetUid, gameId) {
  try {
    const c = await rgetWithEtag(`matchmaking/${targetUid}/gameId`);
    if (c.value === gameId) {
      await rsetIfMatch(`matchmaking/${targetUid}/gameId`, null, c.etag);
    }
  } catch { /* best-effort */ }
}

/**
 * Reta a un jugador. Reclama de forma atomica el slot del rival y el propio
 * (ETags) antes de crear la partida, para que dos retos simultaneos al mismo
 * rival no se pisen.
 * @returns {Promise<{ ok:true, gameId, role, opponentName } | { ok:false, reason:'busy'|'already-matched'|'error' }>}
 */
export async function challengePlayer(uid, name, target) {
  if (!target?.uid) return { ok: false, reason: 'error' };
  const gameId = pairId(uid, target.uid);

  try {
    // 1) Reclamar al rival.
    const t = await rgetWithEtag(`matchmaking/${target.uid}/gameId`);
    if (t.value && t.value !== gameId) return { ok: false, reason: 'busy' };
    if (!t.value) {
      const r = await rsetIfMatch(`matchmaking/${target.uid}/gameId`, gameId, t.etag);
      if (!r.ok) return { ok: false, reason: 'busy' };
    }

    // 2) Reclamarme a mi (por si me retaron al mismo tiempo).
    const s = await rgetWithEtag(`matchmaking/${uid}/gameId`);
    if (s.value && s.value !== gameId) {
      await clearClaimIfMine(target.uid, gameId);
      return { ok: false, reason: 'already-matched' };
    }
    if (!s.value) {
      const r2 = await rsetIfMatch(`matchmaking/${uid}/gameId`, gameId, s.etag);
      if (!r2.ok) {
        await clearClaimIfMine(target.uid, gameId);
        return { ok: false, reason: 'already-matched' };
      }
    }

    // 3) Crear la partida y avisar el reto al rival.
    await ensureGame(uid, name, target.uid, target.name);
    await rupdate(`matchmaking/${target.uid}`, {
      challenge: { byUid: uid, byName: name, ts: Date.now() },
    });

    const game = await getGame(gameId);
    const role = roleForUid(game?.players, uid);
    const oppName = role && game ? (game.players[otherRole(role)]?.name || target.name) : target.name;
    return { ok: true, gameId, role, opponentName: oppName };
  } catch {
    await clearClaimIfMine(target.uid, gameId);
    return { ok: false, reason: 'error' };
  }
}

// --- Partidas ----------------------------------------------------------------

/**
 * Crea la partida si no existe (o la reinicia preservando el marcador). El
 * gameId es determinista por par, asi el marcador de victorias sobrevive entre
 * revanchas y reconexiones de los mismos dos jugadores.
 */
export async function ensureGame(uidA, nameA, uidB, nameB) {
  const gameId = pairId(uidA, uidB);
  const existing = await rget(`games/${gameId}`);
  const roles = rolesFromUids(uidA, uidB);
  const nameByUid = { [uidA]: nameA, [uidB]: nameB };

  const players = {
    [ROLE.P1]: { uid: roles[ROLE.P1], name: nameByUid[roles[ROLE.P1]] },
    [ROLE.P2]: { uid: roles[ROLE.P2], name: nameByUid[roles[ROLE.P2]] },
  };
  // Si hay una partida en curso valida con estos mismos jugadores, no la pisamos.
  if (existing && existing.status === GAME_STATUS.PLAYING && existing.players) {
    return gameId;
  }

  const score = existing?.score && typeof existing.score === 'object'
    ? { [ROLE.P1]: existing.score[ROLE.P1] || 0, [ROLE.P2]: existing.score[ROLE.P2] || 0 }
    : { [ROLE.P1]: 0, [ROLE.P2]: 0 };

  const starter = Math.random() < 0.5 ? ROLE.P1 : ROLE.P2;

  await rset(`games/${gameId}`, {
    players,
    board: emptyBoard(),
    turn: starter,
    status: GAME_STATUS.PLAYING,
    winner: null,
    moveDeadline: Date.now() + TURN_MS,
    rematch: { [ROLE.P1]: false, [ROLE.P2]: false },
    leaver: null,
    score,
    startedAt: Date.now(),
  });
  return gameId;
}

/** Lee el estado actual de la partida. */
export function getGame(gameId) {
  return rget(`games/${gameId}`);
}

/**
 * Aplica una jugada si es legal. Solo el jugador en turno escribe sus jugadas.
 * Resuelve ganador/empate, suma al marcador de la partida y, si hay ganador,
 * incrementa el ranking global (solo lo hace el que cierra la jugada).
 */
export async function makeMove(gameId, role, index) {
  const game = await getGame(gameId);
  if (!game || game.status !== GAME_STATUS.PLAYING) return game;
  if (game.turn !== role) return game;
  const board = Array.isArray(game.board) ? game.board.slice() : emptyBoard();
  if (board[index]) return game; // casilla ocupada

  board[index] = role;
  const patch = { board };

  const win = findWinner(board);
  if (win) {
    patch.status = GAME_STATUS.FINISHED;
    patch.winner = win.role;
    const score = { ...(game.score || {}) };
    score[win.role] = (score[win.role] || 0) + 1;
    patch.score = score;
  } else if (isFull(board)) {
    patch.status = GAME_STATUS.FINISHED;
    patch.winner = WINNER.DRAW;
  } else {
    patch.turn = otherRole(role);
    patch.moveDeadline = Date.now() + TURN_MS;
  }

  await rupdate(`games/${gameId}`, patch);

  // Ranking global (solo el ganador de la jugada lo toca → un unico incremento).
  if (win) {
    const winnerName = game.players?.[win.role]?.name;
    if (winnerName) incrementLeaderboard(winnerName).catch(() => {});
  }

  return { ...game, ...patch };
}

/**
 * Pasa el turno por tiempo agotado. Solo lo ejecuta el jugador en turno (no
 * escribe nadie mas), evitando dobles escrituras.
 */
export async function passTurn(gameId, role) {
  const game = await getGame(gameId);
  if (!game || game.status !== GAME_STATUS.PLAYING || game.turn !== role) return game;
  const patch = { turn: otherRole(role), moveDeadline: Date.now() + TURN_MS };
  await rupdate(`games/${gameId}`, patch);
  return { ...game, ...patch };
}

/** Marca que este rol quiere revancha; si ambos quieren, el host reinicia. */
export async function requestRematch(gameId, role, uid) {
  await rupdate(`games/${gameId}/rematch`, { [role]: true });
  const game = await getGame(gameId);
  const rematch = game?.rematch || {};
  const bothWant = rematch[ROLE.P1] && rematch[ROLE.P2];
  if (bothWant && game.players?.[ROLE.P1]?.uid === uid) {
    const starter = Math.random() < 0.5 ? ROLE.P1 : ROLE.P2;
    await rupdate(`games/${gameId}`, {
      board: emptyBoard(),
      turn: starter,
      status: GAME_STATUS.PLAYING,
      winner: null,
      moveDeadline: Date.now() + TURN_MS,
      rematch: { [ROLE.P1]: false, [ROLE.P2]: false },
      leaver: null,
    });
  }
  return getGame(gameId);
}

/** Avisa que este rol abandono (best-effort) para que el rival lo vea. */
export function markLeft(gameId, role) {
  if (!gameId || !role) return Promise.resolve();
  return rupdate(`games/${gameId}`, { leaver: role }).catch(() => {});
}

// --- Ranking global ----------------------------------------------------------

/**
 * Suma 1 victoria al nombre (case-insensitive). Usa el server value
 * `{".sv":{"increment":1}}` de RTDB → atomico, sin transacciones, sin perder
 * cuentas si dos partidas terminan a la vez.
 */
export function incrementLeaderboard(name) {
  const key = nameKey(name);
  return rupdate(`${LEADERBOARD_PATH}/${key}`, {
    name,
    wins: { '.sv': { increment: 1 } },
  });
}

/** Ranking ordenado por victorias desc. */
export async function getLeaderboard() {
  const all = (await rget(LEADERBOARD_PATH)) || {};
  return Object.values(all)
    .filter((e) => e && e.name)
    .map((e) => ({ name: e.name, wins: e.wins || 0 }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
}
