// Vista unica del feature "GATO": nombre -> buscar/retar -> tablero -> resultado.
// Tambien: clasificaciones (ranking global) y partida contra la IA (no puntua).
//
// Toda la coordinacion ocurre mientras el popup/sidepanel esta abierto. El
// "puntero" de la vista (fase + gameId + rol, o la partida IA local) se persiste
// en chrome.storage (state.js) para restaurar al reabrir; la verdad de la
// partida multijugador vive en Firebase y se sondea por polling (net.js).

import {
  PHASE,
  GAME_STATUS,
  WINNER,
  ROLE,
  AI_ROLE,
  AI_NAME,
  AI_THINK_MS,
  POLL_MS,
  SEARCHERS_POLL_MS,
  PRESENCE_BEAT_MS,
  catSvg,
} from '../../constants.js';
import {
  getRun,
  setRun,
  getDraft,
  setDraft,
  makeRun,
  getUid,
} from '../../state.js';
import {
  beatPresence,
  clearPresence,
  countActivePlayers,
  enqueue,
  dequeue,
  listSearchers,
  pollTicket,
  challengePlayer,
  getGame,
  makeMove,
  passTurn,
  requestRematch,
  markLeft,
  getLeaderboard,
} from '../../net.js';
import { otherRole, findWinner } from '../../game.js';
import { makeAiGame, humanMove, cpuMove, passHuman } from '../../ai-game.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('gato');

// Controlador activo (uno por montaje de la vista). Permite limpiar timers al
// re-montar o al navegar fuera del feature.
let ctrl = null;

function teardown() {
  if (!ctrl) return;
  ctrl.alive = false;
  clearInterval(ctrl.pollTimer);
  clearInterval(ctrl.tickTimer);
  clearInterval(ctrl.presenceTimer);
  clearTimeout(ctrl.aiTimer);
  if (ctrl.uid) {
    clearPresence(ctrl.uid);
    // Solo dejamos un ticket vivo si seguimos buscando a proposito; al desmontar
    // (navegar fuera) lo sacamos para no quedar "fantasma" en la lista.
    if (ctrl.run?.phase === PHASE.SEARCHING) dequeue(ctrl.uid);
  }
  ctrl = null;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export async function render(container) {
  teardown();

  const uid = getUid();
  const draft = await getDraft();
  let run = await getRun();
  if (!run || run.uid !== uid) {
    run = makeRun(draft?.name || '', uid);
    await setRun(run);
  }

  ctrl = {
    container,
    alive: true,
    uid,
    run,
    mode: 'mp',         // 'mp' (multijugador) | 'ai'
    game: null,         // partida actual (firebase o IA local)
    pollTimer: null,
    tickTimer: null,
    presenceTimer: null,
    aiTimer: null,
    lastPassDeadline: 0,
    rematchPending: false,
  };

  // Heartbeat de presencia mientras la vista esta montada.
  beatPresence(uid, run.name).catch(() => {});
  ctrl.presenceTimer = setInterval(() => {
    if (!aliveAndAttached()) return teardown();
    beatPresence(ctrl.uid, ctrl.run.name).catch(() => {});
  }, PRESENCE_BEAT_MS);

  await route();
}

// True si el controlador sigue vigente y su contenedor sigue en el DOM (cubre
// la navegacion "Volver" del popup, que no llama a un teardown explicito).
function aliveAndAttached() {
  return !!ctrl && ctrl.alive && document.body.contains(ctrl.container);
}

async function persist(patch) {
  ctrl.run = { ...ctrl.run, ...patch };
  await setRun(ctrl.run);
}

function clearTimers() {
  clearInterval(ctrl.pollTimer);
  clearInterval(ctrl.tickTimer);
  clearTimeout(ctrl.aiTimer);
}

async function route() {
  clearTimers();
  switch (ctrl.run.phase) {
    case PHASE.SEARCHING:   return renderSearching();
    case PHASE.CHALLENGED:  return renderChallenged();
    case PHASE.LEADERBOARD: return renderLeaderboard();
    case PHASE.AI:          return resumeAiGame();
    case PHASE.PLAYING:
    case PHASE.FINISHED:    return reconnectGame();
    default:                return renderIdle();
  }
}

// --- IDLE: nombre + jugadores activos + jugar / IA / ranking -------------------

async function renderIdle() {
  ctrl.mode = 'mp';
  ctrl.game = null;
  const { container, run } = ctrl;
  container.innerHTML = `
    <div class="gato-view">
      <div class="gato-hero">${catSvg(48)}<span>GATO</span></div>
      <label class="gato-label" for="gato-name">Tu nombre</label>
      <input id="gato-name" class="gato-input" type="text" maxlength="20"
        placeholder="Escribe tu nombre" autocomplete="off" spellcheck="false"
        value="${esc(run.name)}" />
      <p class="gato-presence" id="gato-presence">Buscando jugadores activos…</p>
      <button id="gato-play" class="ct-btn ct-btn--primary gato-play">Buscar partida</button>
      <div class="gato-actions">
        <button id="gato-ai" class="ct-btn ct-btn--ghost">Jugar contra la IA</button>
        <button id="gato-rank" class="ct-btn ct-btn--ghost">Clasificaciones</button>
      </div>
    </div>
  `;

  const nameInput = container.querySelector('#gato-name');
  const presenceEl = container.querySelector('#gato-presence');

  nameInput.addEventListener('input', () => { ctrl.run.name = nameInput.value; });

  const refreshPresence = async () => {
    if (!aliveAndAttached()) return teardown();
    try {
      const n = await countActivePlayers(ctrl.uid);
      if (!presenceEl.isConnected) return;
      presenceEl.textContent = n > 0
        ? `Hay ${n} jugador${n === 1 ? '' : 'es'} activo${n === 1 ? '' : 's'}`
        : 'No hay jugadores activos por ahora';
      presenceEl.classList.toggle('gato-presence--on', n > 0);
    } catch {
      presenceEl.textContent = 'No se pudo consultar jugadores activos';
    }
  };
  refreshPresence();
  ctrl.pollTimer = setInterval(refreshPresence, 4000);

  const requireName = () => {
    const name = (nameInput.value || '').trim();
    if (!name) {
      nameInput.focus();
      nameInput.classList.add('gato-input--error');
      return null;
    }
    return name;
  };

  container.querySelector('#gato-play').addEventListener('click', async () => {
    const name = requireName();
    if (!name) return;
    await setDraft({ name });
    await persist({ name, phase: PHASE.SEARCHING, gameId: null, role: null, opponentName: null });
    await route();
  });

  container.querySelector('#gato-ai').addEventListener('click', async () => {
    const name = requireName();
    if (!name) return;
    await setDraft({ name });
    await persist({ name, phase: PHASE.AI, ai: makeAiGame(), gameId: null, role: null });
    await route();
  });

  container.querySelector('#gato-rank').addEventListener('click', async () => {
    await persist({ phase: PHASE.LEADERBOARD });
    await route();
  });
}

// --- LEADERBOARD: clasificaciones globales -----------------------------------

function renderLeaderboard() {
  const { container } = ctrl;
  container.innerHTML = `
    <div class="gato-view">
      <div class="gato-hero gato-hero--sm">${catSvg(32)}<span>Clasificaciones</span></div>
      <div class="gato-rank-list" id="gato-rank-list">
        <div class="ct-state"><span class="ct-spinner"></span><p>Cargando ranking…</p></div>
      </div>
      <button id="gato-rank-back" class="ct-btn ct-btn--ghost">Volver</button>
    </div>
  `;
  container.querySelector('#gato-rank-back').addEventListener('click', async () => {
    await persist({ phase: PHASE.IDLE });
    await route();
  });

  const listEl = container.querySelector('#gato-rank-list');
  const refresh = async () => {
    if (!aliveAndAttached()) return teardown();
    try {
      const rows = await getLeaderboard();
      if (!listEl.isConnected) return;
      if (!rows.length) {
        listEl.innerHTML = '<p class="ct-empty">Todavia no hay victorias registradas.</p>';
        return;
      }
      listEl.innerHTML = `
        <ol class="gato-rank">
          ${rows.map((r, i) => `
            <li class="gato-rank-row">
              <span class="gato-rank-pos">${i + 1}</span>
              <span class="gato-rank-name">${esc(r.name)}</span>
              <span class="gato-rank-wins">${r.wins} <small>${r.wins === 1 ? 'victoria' : 'victorias'}</small></span>
            </li>`).join('')}
        </ol>
      `;
    } catch (err) {
      log.warn('getLeaderboard fallo', err);
      if (listEl.isConnected) listEl.innerHTML = '<p class="ct-empty">No se pudo cargar el ranking.</p>';
    }
  };
  refresh();
  ctrl.pollTimer = setInterval(refresh, 5000);
}

// --- SEARCHING: buscando + lista de jugadores para retar ----------------------

function renderSearching() {
  const { container } = ctrl;
  container.innerHTML = `
    <div class="gato-view">
      <div class="gato-hero gato-hero--sm">${catSvg(32)}<span>Buscando partida</span></div>
      <div class="gato-searching">
        <span class="ct-spinner ct-spinner--inline"></span>
        <span>Buscando rivales… reta a alguien o espera a que te reten</span>
      </div>
      <p class="gato-mm-msg" id="gato-mm-msg" hidden></p>
      <div class="gato-searchers" id="gato-searchers">
        <p class="ct-state-hint">Cargando jugadores…</p>
      </div>
      <button id="gato-cancel" class="ct-btn ct-btn--ghost">Cancelar</button>
    </div>
  `;
  container.querySelector('#gato-cancel').addEventListener('click', async () => {
    await dequeue(ctrl.uid);
    await persist({ phase: PHASE.IDLE });
    await route();
  });

  enqueue(ctrl.uid, ctrl.run.name).catch((err) => log.warn('enqueue fallo', err));

  const listEl = container.querySelector('#gato-searchers');
  const msgEl = container.querySelector('#gato-mm-msg');

  const showMsg = (text) => {
    if (!msgEl.isConnected) return;
    msgEl.textContent = text;
    msgEl.hidden = false;
    setTimeout(() => { if (msgEl.isConnected) msgEl.hidden = true; }, 2500);
  };

  const renderList = (players) => {
    if (!listEl.isConnected) return;
    if (!players.length) {
      listEl.innerHTML = '<p class="ct-state-hint">No hay otros jugadores buscando. Espera o invita a alguien.</p>';
      return;
    }
    listEl.innerHTML = players.map((p) => `
      <div class="gato-searcher">
        <span class="gato-searcher-name">${esc(p.name)}</span>
        <button class="ct-btn ct-btn--primary gato-challenge-btn" data-uid="${esc(p.uid)}" data-name="${esc(p.name)}">Retar</button>
      </div>
    `).join('');
    listEl.querySelectorAll('.gato-challenge-btn').forEach((btn) => {
      btn.addEventListener('click', () => onChallenge(btn, showMsg));
    });
  };

  // Poll de mi propio ticket (¿me retaron?) + refresco de la lista.
  let listTick = 0;
  const poll = async () => {
    if (!aliveAndAttached()) return teardown();
    try {
      const mine = await pollTicket(ctrl.uid);
      if (mine && mine.gameId && mine.role) {
        clearInterval(ctrl.pollTimer);
        await dequeue(ctrl.uid);
        if (mine.challengedBy) {
          await persist({
            phase: PHASE.CHALLENGED,
            gameId: mine.gameId,
            role: mine.role,
            opponentName: mine.opponentName,
            challengedBy: mine.challengedBy,
          });
        } else {
          await persist({
            phase: PHASE.PLAYING,
            gameId: mine.gameId,
            role: mine.role,
            opponentName: mine.opponentName,
          });
        }
        return route();
      }
      // Refrescar la lista cada SEARCHERS_POLL_MS (no en cada POLL_MS).
      listTick += POLL_MS;
      if (listTick >= SEARCHERS_POLL_MS) {
        listTick = 0;
        const players = await listSearchers(ctrl.uid);
        renderList(players);
      }
    } catch (err) {
      log.warn('poll matchmaking fallo', err);
    }
  };

  // Primera carga inmediata de la lista.
  listSearchers(ctrl.uid).then(renderList).catch(() => {});
  ctrl.pollTimer = setInterval(poll, POLL_MS);
}

async function onChallenge(btn, showMsg) {
  const target = { uid: btn.dataset.uid, name: btn.dataset.name };
  // Evitar dobles clics / retos en paralelo desde esta UI.
  ctrl.container.querySelectorAll('.gato-challenge-btn').forEach((b) => { b.disabled = true; });
  btn.textContent = 'Retando…';
  try {
    const res = await challengePlayer(ctrl.uid, ctrl.run.name, target);
    if (res.ok) {
      clearInterval(ctrl.pollTimer);
      await dequeue(ctrl.uid);
      await persist({
        phase: PHASE.PLAYING,
        gameId: res.gameId,
        role: res.role,
        opponentName: res.opponentName,
      });
      return route();
    }
    if (res.reason === 'busy') showMsg(`${target.name} ya esta en otra partida.`);
    else if (res.reason === 'already-matched') showMsg('Te retaron a ti primero: entrando a esa partida…');
    else showMsg('No se pudo retar. Intenta de nuevo.');
  } catch (err) {
    log.warn('challenge fallo', err);
    showMsg('No se pudo retar. Intenta de nuevo.');
  } finally {
    // Re-habilitar (si seguimos en la lista).
    ctrl.container.querySelectorAll('.gato-challenge-btn').forEach((b) => { b.disabled = false; });
    if (btn.isConnected) btn.textContent = 'Retar';
  }
}

// --- CHALLENGED: "X te ha retado" (forzado) -----------------------------------

function renderChallenged() {
  const { container, run } = ctrl;
  const who = esc(run.challengedBy || run.opponentName || 'Alguien');
  container.innerHTML = `
    <div class="gato-view">
      <div class="gato-hero">${catSvg(48)}<span>¡Reto!</span></div>
      <div class="ct-state">
        <p class="gato-challenge-msg"><strong>${who}</strong> te ha retado</p>
        <p class="ct-state-hint">Estas obligado a jugar 😼</p>
      </div>
      <button id="gato-accept" class="ct-btn ct-btn--primary gato-play">¡A jugar!</button>
    </div>
  `;
  container.querySelector('#gato-accept').addEventListener('click', async () => {
    await persist({ phase: PHASE.PLAYING });
    await route();
  });
}

// --- Tablero (multijugador) ---------------------------------------------------

async function reconnectGame() {
  ctrl.mode = 'mp';
  const { gameId } = ctrl.run;
  if (!gameId) {
    await persist({ phase: PHASE.IDLE });
    return route();
  }
  ctrl.game = await getGame(gameId).catch(() => null);
  if (!ctrl.game) {
    await persist({ phase: PHASE.IDLE, gameId: null, role: null });
    return route();
  }
  renderGameShell();
  applyGameState();

  ctrl.pollTimer = setInterval(async () => {
    if (!aliveAndAttached()) return teardown();
    try {
      const g = await getGame(gameId);
      if (!g) return;
      ctrl.game = g;
      applyGameState();
    } catch (err) {
      log.warn('poll partida fallo', err);
    }
  }, POLL_MS);

  ctrl.tickTimer = setInterval(tickClock, 250);
}

// --- Tablero (IA local) -------------------------------------------------------

function resumeAiGame() {
  ctrl.mode = 'ai';
  ctrl.game = ctrl.run.ai || makeAiGame();
  if (!ctrl.run.ai) persist({ ai: ctrl.game });
  renderGameShell();
  applyGameState();
  ctrl.tickTimer = setInterval(tickClock, 250);
  maybeScheduleCpu();
}

function persistAi() {
  return persist({ ai: ctrl.game });
}

function maybeScheduleCpu() {
  const g = ctrl.game;
  if (ctrl.mode !== 'ai' || !g || g.status !== GAME_STATUS.PLAYING || g.turn !== AI_ROLE.CPU) return;
  clearTimeout(ctrl.aiTimer);
  ctrl.aiTimer = setTimeout(async () => {
    if (!aliveAndAttached() || ctrl.mode !== 'ai') return;
    if (ctrl.game?.status !== GAME_STATUS.PLAYING || ctrl.game.turn !== AI_ROLE.CPU) return;
    ctrl.game = cpuMove(ctrl.game);
    await persistAi();
    applyGameState();
  }, AI_THINK_MS);
}

// --- Render comun del tablero -------------------------------------------------

function snapshot() {
  const g = ctrl.game;
  const run = ctrl.run;
  if (ctrl.mode === 'ai') {
    const myRole = AI_ROLE.HUMAN;
    const oppRole = AI_ROLE.CPU;
    return {
      g, status: g.status, board: g.board || [], turn: g.turn, winner: g.winner, leaver: null,
      myRole, oppRole, myName: run.name, oppName: AI_NAME,
      myScore: g.score?.[myRole] || 0, oppScore: g.score?.[oppRole] || 0,
      moveDeadline: g.moveDeadline, isMyTurn: g.status === GAME_STATUS.PLAYING && g.turn === myRole,
    };
  }
  const myRole = run.role;
  const oppRole = otherRole(myRole);
  return {
    g, status: g.status, board: Array.isArray(g.board) ? g.board : [], turn: g.turn,
    winner: g.winner, leaver: g.leaver,
    myRole, oppRole,
    myName: g.players?.[myRole]?.name || run.name,
    oppName: g.players?.[oppRole]?.name || run.opponentName || 'Rival',
    myScore: g.score?.[myRole] || 0, oppScore: g.score?.[oppRole] || 0,
    moveDeadline: g.moveDeadline, isMyTurn: g.status === GAME_STATUS.PLAYING && g.turn === myRole,
  };
}

function renderGameShell() {
  const { container } = ctrl;
  const aiNote = ctrl.mode === 'ai'
    ? '<p class="gato-ai-note">Partida contra la IA — no cuenta para las clasificaciones</p>'
    : '';
  container.innerHTML = `
    <div class="gato-view gato-game">
      <div class="gato-topbar">
        <div class="gato-rival">
          <span class="gato-rival-label">Rival</span>
          <span class="gato-rival-name" id="gato-rival-name">—</span>
        </div>
        <div class="gato-timer" id="gato-timer">10</div>
      </div>
      ${aiNote}
      <p class="gato-turn" id="gato-turn"></p>
      <div class="gato-board" id="gato-board">
        ${Array.from({ length: 9 }, (_, i) => `<button class="gato-cell" data-i="${i}" aria-label="Casilla ${i + 1}"></button>`).join('')}
      </div>
      <div class="gato-score" id="gato-score"></div>
      <div class="gato-result" id="gato-result" hidden></div>
    </div>
  `;

  container.querySelector('#gato-board').addEventListener('click', async (e) => {
    const cell = e.target.closest('.gato-cell');
    if (!cell) return;
    await onCellClick(Number(cell.dataset.i));
  });
}

async function onCellClick(i) {
  const snap = snapshot();
  if (snap.status !== GAME_STATUS.PLAYING || !snap.isMyTurn || snap.board[i]) return;

  if (ctrl.mode === 'ai') {
    ctrl.game = humanMove(ctrl.game, i);
    await persistAi();
    applyGameState();
    maybeScheduleCpu();
    return;
  }
  try {
    ctrl.game = await makeMove(ctrl.run.gameId, ctrl.run.role, i);
    applyGameState();
  } catch (err) {
    log.warn('makeMove fallo', err);
  }
}

function tickClock() {
  if (!ctrl.game) return;
  const snap = snapshot();
  const timerEl = ctrl.container.querySelector('#gato-timer');
  if (!timerEl) return;
  if (snap.status !== GAME_STATUS.PLAYING) {
    timerEl.textContent = '—';
    return;
  }
  const remaining = Math.max(0, Math.ceil(((snap.moveDeadline || 0) - Date.now()) / 1000));
  timerEl.textContent = String(remaining);
  timerEl.classList.toggle('gato-timer--low', remaining <= 3);

  if (remaining > 0 || !snap.isMyTurn) return;
  if (snap.moveDeadline === ctrl.lastPassDeadline) return; // ya lo pasamos
  ctrl.lastPassDeadline = snap.moveDeadline;

  if (ctrl.mode === 'ai') {
    ctrl.game = passHuman(ctrl.game);
    persistAi();
    applyGameState();
    maybeScheduleCpu();
  } else {
    passTurn(ctrl.run.gameId, ctrl.run.role)
      .then((ng) => { if (ng) { ctrl.game = ng; applyGameState(); } })
      .catch((err) => log.warn('passTurn fallo', err));
  }
}

// Refleja el estado en el DOM (idempotente; corre en cada poll/jugada).
function applyGameState() {
  if (!ctrl.game) return;
  const snap = snapshot();
  const { container, run } = ctrl;

  // Persistir datos para restaurar al reabrir.
  if (ctrl.mode === 'mp' && run.opponentName !== snap.oppName) persist({ opponentName: snap.oppName });

  const rivalEl = container.querySelector('#gato-rival-name');
  if (rivalEl) rivalEl.textContent = snap.oppName;

  // Tablero: rojo = P1, negro = P2.
  container.querySelectorAll('.gato-cell').forEach((cell) => {
    const i = Number(cell.dataset.i);
    const mark = snap.board[i];
    cell.classList.toggle('gato-cell--p1', mark === ROLE.P1);
    cell.classList.toggle('gato-cell--p2', mark === ROLE.P2);
    cell.textContent = mark ? (mark === ROLE.P1 ? '✕' : '○') : '';
    cell.disabled = !(snap.isMyTurn && !mark);
  });

  const win = snap.status === GAME_STATUS.FINISHED && snap.winner && snap.winner !== WINNER.DRAW
    ? findWinner(snap.board) : null;
  container.querySelectorAll('.gato-cell').forEach((cell) => {
    const i = Number(cell.dataset.i);
    cell.classList.toggle('gato-cell--win', !!win && win.line.includes(i));
  });

  const scoreEl = container.querySelector('#gato-score');
  if (scoreEl) {
    scoreEl.innerHTML = `
      <span class="gato-score-me">${esc(snap.myName)} <b>${snap.myScore}</b></span>
      <span class="gato-score-sep">–</span>
      <span class="gato-score-opp"><b>${snap.oppScore}</b> ${esc(snap.oppName)}</span>
    `;
  }

  const turnEl = container.querySelector('#gato-turn');
  const resultEl = container.querySelector('#gato-result');

  // El rival abandono (solo multijugador).
  if (snap.leaver && snap.leaver === snap.oppRole) {
    if (turnEl) turnEl.textContent = '';
    showResult(resultEl, `${esc(snap.oppName)} abandono la partida`, true);
    return;
  }

  if (snap.status === GAME_STATUS.PLAYING) {
    if (resultEl) resultEl.hidden = true;
    ctrl.rematchPending = false;
    if (turnEl) {
      turnEl.textContent = snap.isMyTurn ? 'Tu turno' : `Turno de ${snap.oppName}`;
      turnEl.classList.toggle('gato-turn--you', snap.isMyTurn);
    }
    if (ctrl.mode === 'mp' && run.phase !== PHASE.PLAYING) persist({ phase: PHASE.PLAYING });
    return;
  }

  // FINISHED.
  if (turnEl) turnEl.textContent = '';
  if (ctrl.mode === 'mp' && run.phase !== PHASE.FINISHED) persist({ phase: PHASE.FINISHED });

  let msg;
  if (snap.winner === WINNER.DRAW) {
    msg = 'Empate';
  } else {
    const winnerName = snap.winner === snap.myRole ? snap.myName : snap.oppName;
    msg = `Ganador: ${esc(winnerName)}`;
  }
  showResult(resultEl, msg, false);
}

function showResult(resultEl, message, leaver) {
  if (!resultEl) return;
  const waiting = ctrl.mode === 'mp' && ctrl.rematchPending && !leaver;
  resultEl.hidden = false;
  resultEl.innerHTML = `
    <p class="gato-result-msg">${message}</p>
    ${waiting
      ? '<p class="ct-state-hint">Esperando al rival…</p>'
      : `<div class="gato-actions">
           ${leaver ? '' : '<button id="gato-again" class="ct-btn ct-btn--primary">Volver a jugar</button>'}
           <button id="gato-exit" class="ct-btn ct-btn--ghost">Salir</button>
         </div>`}
  `;

  const again = resultEl.querySelector('#gato-again');
  if (again) again.addEventListener('click', onRematch);
  const exit = resultEl.querySelector('#gato-exit');
  if (exit) exit.addEventListener('click', leaveGame);
}

async function onRematch() {
  if (ctrl.mode === 'ai') {
    ctrl.game = makeAiGame(ctrl.game.score);
    ctrl.lastPassDeadline = 0;
    await persistAi();
    applyGameState();
    maybeScheduleCpu();
    return;
  }
  ctrl.rematchPending = true;
  try {
    ctrl.game = await requestRematch(ctrl.run.gameId, ctrl.run.role, ctrl.uid);
    applyGameState();
  } catch (err) {
    log.warn('rematch fallo', err);
  }
}

async function leaveGame() {
  clearTimers();
  if (ctrl.mode === 'ai') {
    await persist({ phase: PHASE.IDLE, ai: null });
    return route();
  }
  const { gameId, role } = ctrl.run;
  if (gameId && role) await markLeft(gameId, role);
  await dequeue(ctrl.uid);
  await persist({ phase: PHASE.IDLE, gameId: null, role: null, opponentName: null });
  await route();
}
