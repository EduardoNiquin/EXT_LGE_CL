// Partida local contra la IA (sin Firebase, NO puntua en el ranking). Logica
// pura sobre un objeto de partida con la misma forma que el multijugador, asi
// la UI del tablero se reutiliza. Humano = P1 (ROJO), IA = P2 (NEGRO).

import { GAME_STATUS, WINNER, AI_ROLE, TURN_MS } from './constants.js';
import { emptyBoard, findWinner, isFull, otherRole, aiPickMove } from './game.js';

const HUMAN = AI_ROLE.HUMAN;
const CPU = AI_ROLE.CPU;

/** Nueva partida contra la IA. Conserva el marcador previo si se pasa. */
export function makeAiGame(prevScore) {
  const score = prevScore && typeof prevScore === 'object'
    ? { [HUMAN]: prevScore[HUMAN] || 0, [CPU]: prevScore[CPU] || 0 }
    : { [HUMAN]: 0, [CPU]: 0 };
  return {
    board: emptyBoard(),
    turn: Math.random() < 0.5 ? HUMAN : CPU, // quien parte, al azar
    status: GAME_STATUS.PLAYING,
    winner: null,
    moveDeadline: Date.now() + TURN_MS,
    score,
    ai: true,
  };
}

// Resuelve el estado tras colocar `role` en `index` (asume jugada legal).
function settle(game, board, role) {
  const next = { ...game, board };
  const win = findWinner(board);
  if (win) {
    next.status = GAME_STATUS.FINISHED;
    next.winner = win.role;
    next.score = { ...game.score, [win.role]: (game.score?.[win.role] || 0) + 1 };
  } else if (isFull(board)) {
    next.status = GAME_STATUS.FINISHED;
    next.winner = WINNER.DRAW;
  } else {
    next.turn = otherRole(role);
    next.moveDeadline = Date.now() + TURN_MS;
  }
  return next;
}

/** Jugada del humano. Devuelve el nuevo estado (sin cambios si es ilegal). */
export function humanMove(game, index) {
  if (!game || game.status !== GAME_STATUS.PLAYING) return game;
  if (game.turn !== HUMAN) return game;
  if (game.board[index]) return game;
  const board = game.board.slice();
  board[index] = HUMAN;
  return settle(game, board, HUMAN);
}

/** Jugada de la IA (defensiva). Devuelve el nuevo estado. */
export function cpuMove(game) {
  if (!game || game.status !== GAME_STATUS.PLAYING) return game;
  if (game.turn !== CPU) return game;
  const index = aiPickMove(game.board, CPU);
  if (index < 0) return game; // tablero lleno (defensivo)
  const board = game.board.slice();
  board[index] = CPU;
  return settle(game, board, CPU);
}

/** Pasa el turno del humano (timeout). Cede la jugada a la IA. */
export function passHuman(game) {
  if (!game || game.status !== GAME_STATUS.PLAYING || game.turn !== HUMAN) return game;
  return { ...game, turn: CPU, moveDeadline: Date.now() + TURN_MS };
}

export { HUMAN as AI_HUMAN, CPU as AI_CPU };
