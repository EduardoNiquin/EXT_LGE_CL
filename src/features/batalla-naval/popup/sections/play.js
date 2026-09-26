// Vista unica del feature "BATALLA NAVAL": nombre -> buscar/retar ->
// despliegue (barcos + bombas) -> batalla por turnos -> resultado.
// Tambien: clasificaciones (ranking global).
//
// Toda la coordinacion ocurre mientras el popup/sidepanel esta abierto. El
// "puntero" de la vista (fase + gameId + rol + borrador de despliegue) se
// persiste en chrome.storage (state.js) para restaurar al reabrir; la verdad
// de la partida vive en Firebase y se sondea por polling (net.js).

import {
  PHASE,
  GAME_STATUS,
  ROLE,
  GRID,
  FLEET,
  BOMBS_PER_PLAYER,
  POLL_MS,
  SEARCHERS_POLL_MS,
  PRESENCE_BEAT_MS,
  shipSvg,
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
  getGame as netGetGame,
  submitSetup as netSubmitSetup,
  startBattle as netStartBattle,
  fireShot as netFireShot,
  passTurn as netPassTurn,
  requestRematch as netRequestRematch,
  markLeft as netMarkLeft,
  surrender as netSurrender,
  getLeaderboard,
} from '../../net.js';
import {
  makeAiGame,
  submitHumanSetup,
  applyShot as aiApplyShot,
  passTurn as aiPassTurn,
  rematch as aiRematch,
  surrender as aiSurrender,
  aiMove,
  AI_ROLE,
  AI_NAME,
  AI_THINK_MS,
} from '../../ai-game.js';
import {
  otherRole,
  cellKey,
  shipCells,
  clampShip,
  canPlaceShip,
  canPlaceBomb,
  coordLabel,
} from '../../game.js';
import { placementVisualState, battleVisualState } from '../scene/visual-state.js';
import { shipIconSvg, shipName, mineIconSvg } from '../icons.js';
import { logger } from '../../../../shared/utils/logger.js';

const log = logger('batalla-naval');

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
  clearTimeout(ctrl.hintTimer);
  releaseBoard();
  if (ctrl.keyHandler) document.removeEventListener('keydown', ctrl.keyHandler);
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
    game: null,         // ultimo estado leido de la partida (Firebase)
    shell: null,        // pantalla montada del juego: 'placing' | 'battle' | null
    place: null,        // estado local de despliegue (barcos/bombas en mano)
    seenSeq: 0,         // ultimo evento ya mostrado (feedback)
    startPending: false,
    keyHandler: null,
    pollTimer: null,
    tickTimer: null,
    presenceTimer: null,
    lastPassDeadline: 0,
    rematchPending: false,
    aiTimer: null,      // jugada pendiente de la IA (partida local)
    board: null,        // tablero 3D (scene/board3d.js), vive mientras dura la partida
    boardPromise: null,
  };

  // Rotar con R el barco seleccionado durante el despliegue.
  ctrl.keyHandler = (e) => {
    if (e.code !== 'KeyR' && e.key !== 'r' && e.key !== 'R') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.target?.closest?.('input, textarea')) return;
    if (rotateSelected()) e.preventDefault();
  };
  document.addEventListener('keydown', ctrl.keyHandler);

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
  ctrl.aiTimer = null;
}

async function route() {
  clearTimers();
  releaseBoard();
  ctrl.shell = null;
  switch (ctrl.run.phase) {
    case PHASE.SEARCHING:   return renderSearching();
    case PHASE.CHALLENGED:  return renderChallenged();
    case PHASE.LEADERBOARD: return renderLeaderboard();
    case PHASE.PLAYING:
    case PHASE.FINISHED:    return reconnectGame();
    default:                return renderIdle();
  }
}

// --- Backend de la partida: Firebase o local (IA) ------------------------------------
// Misma interfaz para ambos; la partida local vive en run.ai (chrome.storage) y
// cada operacion la reemplaza por la version nueva que devuelve ai-game.js.

function isAiGame() {
  return ctrl?.run?.mode === 'ai';
}

async function saveAi(game) {
  await persist({ ai: game });
  return game;
}

const localApi = {
  getGame: async () => ctrl.run.ai || null,
  submitSetup: async (_id, _role, ships, bombs) => saveAi(submitHumanSetup(ctrl.run.ai, ships, bombs)),
  startBattle: async () => ctrl.run.ai,
  fireShot: async (_id, role, r, c) => saveAi(aiApplyShot(ctrl.run.ai, role, r, c)),
  passTurn: async (_id, role) => saveAi(aiPassTurn(ctrl.run.ai, role)),
  requestRematch: async () => saveAi(aiRematch(ctrl.run.ai)),
  markLeft: async () => {},
  surrender: async (_id, role) => saveAi(aiSurrender(ctrl.run.ai, role)),
};

const netApi = {
  getGame: netGetGame,
  submitSetup: netSubmitSetup,
  startBattle: netStartBattle,
  fireShot: netFireShot,
  passTurn: netPassTurn,
  requestRematch: netRequestRematch,
  markLeft: netMarkLeft,
  surrender: netSurrender,
};

function api() {
  return isAiGame() ? localApi : netApi;
}

/** Si le toca a la IA, agenda su disparo (una sola jugada pendiente a la vez). */
function scheduleAiMove() {
  const g = ctrl.game;
  if (!isAiGame() || ctrl.aiTimer || g?.status !== GAME_STATUS.PLAYING || g.turn !== AI_ROLE) return;
  const owner = ctrl;
  ctrl.aiTimer = setTimeout(async () => {
    owner.aiTimer = null;
    if (ctrl !== owner || !aliveAndAttached() || !isAiGame()) return;
    ctrl.game = await saveAi(aiMove(ctrl.run.ai));
    renderByStatus();
  }, AI_THINK_MS);
}

// --- IDLE: nombre + jugadores activos + jugar / ranking ------------------------

async function renderIdle() {
  ctrl.game = null;
  const { container, run } = ctrl;
  container.innerHTML = `
    <div class="bn-view">
      <div class="bn-hero">${shipSvg(64)}<span>BATALLA NAVAL</span></div>
      <label class="bn-label" for="bn-name">Tu nombre</label>
      <input id="bn-name" class="bn-input" type="text" maxlength="20"
        placeholder="Escribe tu nombre" autocomplete="off" spellcheck="false"
        value="${esc(run.name)}" />
      <p class="bn-presence" id="bn-presence">Buscando jugadores activos…</p>
      <button id="bn-play" class="ct-btn ct-btn--primary bn-play">Buscar partida</button>
      <div class="bn-actions">
        <button id="bn-ai" class="ct-btn ct-btn--ghost">Jugar contra la IA</button>
        <button id="bn-rank" class="ct-btn ct-btn--ghost">Clasificaciones</button>
      </div>
    </div>
  `;

  const nameInput = container.querySelector('#bn-name');
  const presenceEl = container.querySelector('#bn-presence');

  nameInput.addEventListener('input', () => { ctrl.run.name = nameInput.value; });

  const refreshPresence = async () => {
    if (!aliveAndAttached()) return teardown();
    try {
      const n = await countActivePlayers(ctrl.uid);
      if (!presenceEl.isConnected) return;
      presenceEl.textContent = n > 0
        ? `Hay ${n} jugador${n === 1 ? '' : 'es'} activo${n === 1 ? '' : 's'}`
        : 'No hay jugadores activos por ahora';
      presenceEl.classList.toggle('bn-presence--on', n > 0);
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
      nameInput.classList.add('bn-input--error');
      return null;
    }
    return name;
  };

  container.querySelector('#bn-play').addEventListener('click', async () => {
    const name = requireName();
    if (!name) return;
    await setDraft({ name });
    await persist({ name, phase: PHASE.SEARCHING, mode: null, ai: null, gameId: null, role: null, opponentName: null });
    await route();
  });

  // Partida local contra la IA: no pasa por matchmaking ni puntua en el ranking.
  container.querySelector('#bn-ai').addEventListener('click', async () => {
    const name = requireName();
    if (!name) return;
    await setDraft({ name });
    await persist({
      name,
      phase: PHASE.PLAYING,
      mode: 'ai',
      gameId: 'ai',
      role: 'P1',
      opponentName: AI_NAME,
      ai: makeAiGame(name),
      place: null,
    });
    await route();
  });

  container.querySelector('#bn-rank').addEventListener('click', async () => {
    await persist({ phase: PHASE.LEADERBOARD });
    await route();
  });
}

// --- LEADERBOARD: clasificaciones globales -----------------------------------

function renderLeaderboard() {
  const { container } = ctrl;
  container.innerHTML = `
    <div class="bn-view">
      <div class="bn-hero bn-hero--sm">${shipSvg(40)}<span>Clasificaciones</span></div>
      <div class="bn-rank-list" id="bn-rank-list">
        <div class="ct-state"><span class="ct-spinner"></span><p>Cargando ranking…</p></div>
      </div>
      <button id="bn-rank-back" class="ct-btn ct-btn--ghost">Volver</button>
    </div>
  `;
  container.querySelector('#bn-rank-back').addEventListener('click', async () => {
    await persist({ phase: PHASE.IDLE });
    await route();
  });

  const listEl = container.querySelector('#bn-rank-list');
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
        <ol class="bn-rank">
          ${rows.map((r, i) => `
            <li class="bn-rank-row">
              <span class="bn-rank-pos">${i + 1}</span>
              <span class="bn-rank-name">${esc(r.name)}</span>
              <span class="bn-rank-wins">${r.wins} <small>${r.wins === 1 ? 'victoria' : 'victorias'}</small></span>
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
    <div class="bn-view">
      <div class="bn-hero bn-hero--sm">${shipSvg(40)}<span>Buscando partida</span></div>
      <div class="bn-searching">
        <span class="ct-spinner ct-spinner--inline"></span>
        <span>Buscando rivales… reta a alguien o espera a que te reten</span>
      </div>
      <p class="bn-mm-msg" id="bn-mm-msg" hidden></p>
      <div class="bn-searchers" id="bn-searchers">
        <p class="ct-state-hint">Cargando jugadores…</p>
      </div>
      <button id="bn-cancel" class="ct-btn ct-btn--ghost">Cancelar</button>
    </div>
  `;
  container.querySelector('#bn-cancel').addEventListener('click', async () => {
    await dequeue(ctrl.uid);
    await persist({ phase: PHASE.IDLE });
    await route();
  });

  enqueue(ctrl.uid, ctrl.run.name).catch((err) => log.warn('enqueue fallo', err));

  const listEl = container.querySelector('#bn-searchers');
  const msgEl = container.querySelector('#bn-mm-msg');

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
      <div class="bn-searcher">
        <span class="bn-searcher-name">${esc(p.name)}</span>
        <button class="ct-btn ct-btn--primary bn-challenge-btn" data-uid="${esc(p.uid)}" data-name="${esc(p.name)}">Retar</button>
      </div>
    `).join('');
    listEl.querySelectorAll('.bn-challenge-btn').forEach((btn) => {
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
  ctrl.container.querySelectorAll('.bn-challenge-btn').forEach((b) => { b.disabled = true; });
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
    ctrl.container.querySelectorAll('.bn-challenge-btn').forEach((b) => { b.disabled = false; });
    if (btn.isConnected) btn.textContent = 'Retar';
  }
}

// --- CHALLENGED: "X te ha retado" (forzado) -----------------------------------

function renderChallenged() {
  const { container, run } = ctrl;
  const who = esc(run.challengedBy || run.opponentName || 'Alguien');
  container.innerHTML = `
    <div class="bn-view">
      <div class="bn-hero">${shipSvg(64)}<span>¡Reto!</span></div>
      <div class="ct-state">
        <p class="bn-challenge-msg"><strong>${who}</strong> te ha retado</p>
        <p class="ct-state-hint">Estas obligado a jugar ⚓</p>
      </div>
      <button id="bn-accept" class="ct-btn ct-btn--primary bn-play">¡A jugar!</button>
    </div>
  `;
  container.querySelector('#bn-accept').addEventListener('click', async () => {
    await persist({ phase: PHASE.PLAYING });
    await route();
  });
}

// --- Partida: reconexion y router por status ------------------------------------

async function reconnectGame() {
  const { gameId } = ctrl.run;
  if (!gameId) {
    await persist({ phase: PHASE.IDLE });
    return route();
  }
  ctrl.game = await api().getGame(gameId).catch(() => null);
  if (!ctrl.game) {
    await persist({ phase: PHASE.IDLE, gameId: null, role: null });
    return route();
  }
  ctrl.shell = null;
  renderByStatus();

  // Partida local: no hay nada que sondear (la IA juega via scheduleAiMove).
  if (!isAiGame()) ctrl.pollTimer = setInterval(async () => {
    if (!aliveAndAttached()) return teardown();
    try {
      const g = await api().getGame(gameId);
      if (!g) return;
      ctrl.game = g;
      renderByStatus();
    } catch (err) {
      log.warn('poll partida fallo', err);
    }
  }, POLL_MS);

  ctrl.tickTimer = setInterval(tickClock, 250);
}

// Monta/actualiza la pantalla que corresponde al status actual (idempotente:
// corre en cada poll; solo re-monta el shell cuando cambia la fase).
function renderByStatus() {
  const g = ctrl.game;
  if (!g) return;

  if (g.status === GAME_STATUS.PLACING) {
    ctrl.rematchPending = false;
    ctrl.lastPassDeadline = 0;
    if (ctrl.shell !== 'placing') {
      ctrl.shell = 'placing';
      renderPlacementShell();
    }
    applyPlacementState();
    // Si ambos ya publicaron su flota, cualquiera arranca (claim atomico).
    const setup = g.setup || {};
    if (setup[ROLE.P1]?.ready && setup[ROLE.P2]?.ready && !ctrl.startPending) {
      ctrl.startPending = true;
      api().startBattle(ctrl.run.gameId)
        .then((ng) => {
          if (!aliveAndAttached()) return;
          if (ng) { ctrl.game = ng; renderByStatus(); }
        })
        .catch((err) => log.warn('startBattle fallo', err))
        .finally(() => { if (ctrl) ctrl.startPending = false; });
    }
    return;
  }

  if (ctrl.shell !== 'battle') {
    ctrl.shell = 'battle';
    renderBattleShell();
  }
  applyBattleState();
  scheduleAiMove();
}

/**
 * Grilla 16x16 de botones invisibles (solo teclado / lector de pantalla): el
 * tablero visible es el canvas 3D, que no es accesible por si mismo.
 */
function boardCellsHtml() {
  let html = '';
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      html += `<button type="button" class="bn-cell" data-r="${r}" data-c="${c}" aria-label="${coordLabel(r, c)}"></button>`;
    }
  }
  return html;
}

// --- Tablero 3D -------------------------------------------------------------------
// Three.js y los modelos se cargan con import() dinamico solo al entrar a la
// partida (el inicio del popup no los paga). El tablero se crea una vez por
// partida y su canvas se re-monta al pasar de despliegue a batalla.

/** Monta el tablero 3D en `stageEl` (lo crea si hace falta). */
async function mountBoard(stageEl) {
  document.body.classList.add('bn-wide');
  const owner = ctrl;
  if (!owner.boardPromise) {
    owner.boardPromise = import('../scene/board3d.js')
      .then(({ createBoard3D }) => createBoard3D({
        onCellClick: (r, c) => onBoardClick(r, c),
        onCellHover: (cell) => onBoardHover(cell),
      }))
      .then((board) => {
        if (ctrl !== owner || !owner.alive || owner.boardPromise === null) {
          board.dispose();
          return null;
        }
        owner.board = board;
        return board;
      });
  }
  let board;
  try {
    board = await owner.boardPromise;
  } catch (err) {
    log.error('No se pudo cargar el tablero 3D', err);
    owner.boardPromise = null;
    if (stageEl.isConnected) stageEl.innerHTML = '<p class="bn-stage-msg">No se pudo cargar el tablero 3D.</p>';
    return null;
  }
  if (!board || ctrl !== owner || !stageEl.isConnected) return null;
  stageEl.querySelector('.bn-stage-msg')?.remove();
  board.attach(stageEl);
  return board;
}

function releaseBoard() {
  if (!ctrl) return;
  ctrl.board?.dispose();
  ctrl.board = null;
  ctrl.boardPromise = null;
  document.body.classList.remove('bn-wide');
}

/** Gira el barco en mano (R o el boton del aviso). Devuelve true si giro. */
function rotateSelected() {
  const p = ctrl?.place;
  if (ctrl?.shell !== 'placing' || !p || p.submitted || p.sel?.kind !== 'ship') return false;
  p.sel.dir = p.sel.dir === 'h' ? 'v' : 'h';
  updatePlacementBoard();
  showRotateHint(p.sel.dir === 'h' ? 'Horizontal' : 'Vertical');
  return true;
}

/**
 * Aviso en el centro del escenario mientras hay un barco en mano: recuerda que
 * se gira con R. Al tomar el barco se muestra grande unos segundos y despues
 * queda como una pastilla discreta (para no tapar donde se esta apuntando).
 */
function showRotateHint(flash = null) {
  const el = ctrl?.container.querySelector('#bn-rotate-hint');
  if (!el) return;
  const p = ctrl.place;
  const holding = !!p && !p.submitted && p.sel?.kind === 'ship';
  el.hidden = !holding;
  if (!holding) {
    ctrl.hintSelKey = null;
    return;
  }
  const dir = p.sel.dir === 'h' ? 'Horizontal' : 'Vertical';
  el.querySelector('.bn-rotate-dir').textContent = flash || dir;
  const key = p.sel.id;
  if (ctrl.hintSelKey !== key || flash) {
    ctrl.hintSelKey = key;
    el.classList.add('bn-rotate-hint--big');
    clearTimeout(ctrl.hintTimer);
    ctrl.hintTimer = setTimeout(() => el.classList.remove('bn-rotate-hint--big'), flash ? 900 : 2600);
  }
}

function onBoardClick(r, c) {
  if (ctrl?.shell === 'placing') onPlaceCellClick(r, c);
  else if (ctrl?.shell === 'battle') onFireClick(r, c);
}

function onBoardHover(cell) {
  const p = ctrl?.place;
  if (ctrl?.shell !== 'placing' || !p) return;
  p.hover = cell && p.sel ? cell : null;
  updatePlacementBoard();
}

/** HTML comun del escenario: canvas 3D + paneles HUD encima + grilla accesible. */
function stageHtml(left, right, extra = '') {
  return `
    <div class="bn-stage" id="bn-stage">
      <div class="bn-canvas" id="bn-canvas"><p class="bn-stage-msg"><span class="ct-spinner ct-spinner--inline"></span> Preparando el mar…</p></div>
      <div class="bn-hud">
        <div class="bn-panel bn-panel--left">${left}</div>
        <div class="bn-panel bn-panel--right">${right}</div>
      </div>
      ${extra}
    </div>
    <div class="bn-a11y" id="bn-board" aria-label="Tablero">${boardCellsHtml()}</div>
  `;
}

// --- Despliegue: colocar barcos y bombas ----------------------------------------

function newPlaceState() {
  return { ships: [], bombs: [], sel: null, hover: null, submitted: false };
}

// Estado local de colocacion. Restaura la flota ya publicada (si recargamos
// con ready=true) o el borrador persistido en run.place.
function initPlaceState() {
  const mine = ctrl.game?.setup?.[ctrl.run.role];
  if (mine?.ready) {
    ctrl.place = {
      ships: (mine.ships || []).map((s) => ({ id: s.id, size: s.size, r: s.r, c: s.c, dir: s.dir })),
      bombs: (mine.bombs || []).map((b) => ({ r: b.r, c: b.c })),
      sel: null,
      hover: null,
      submitted: true,
    };
    return;
  }
  const saved = ctrl.run.place;
  ctrl.place = saved
    ? { ...newPlaceState(), ships: (saved.ships || []).slice(), bombs: (saved.bombs || []).slice() }
    : newPlaceState();
}

function savePlaceDraft() {
  const p = ctrl.place;
  return persist({ place: { ships: p.ships, bombs: p.bombs } });
}

function renderPlacementShell() {
  initPlaceState();
  const { container } = ctrl;
  container.innerHTML = `
    <div class="bn-view bn-game">
      ${stageHtml(`
        <div class="bn-rival">
          <span class="bn-rival-label">Rival</span>
          <span class="bn-rival-name">${esc(ctrl.run.opponentName || 'Rival')}</span>
        </div>
        <span class="bn-phase-tag">Despliegue</span>
        <p class="bn-turn" id="bn-place-hint"></p>
      `, `
        <div class="bn-tray" id="bn-tray"></div>
        <div class="bn-actions bn-actions--stack">
          <button id="bn-ready" class="ct-btn ct-btn--primary" disabled>¡Listo!</button>
          <button id="bn-exit" class="ct-btn ct-btn--ghost">Salir</button>
        </div>
      `, `
        <div class="bn-rotate-hint" id="bn-rotate-hint" hidden role="status">
          <span class="bn-rotate-text">Pulsa <kbd>R</kbd> para girar el barco</span>
          <span class="bn-rotate-dir">Horizontal</span>
          <button type="button" class="bn-rotate-btn" id="bn-rotate-btn" title="Girar (R)">↻ Girar</button>
        </div>
      `)}
    </div>
  `;

  container.querySelector('#bn-tray').addEventListener('click', (e) => {
    const piece = e.target.closest('.bn-piece');
    if (!piece || piece.disabled) return;
    onTrayClick(piece);
  });

  // Grilla accesible (teclado): mismo efecto que el clic/hover en el canvas.
  const cells = container.querySelector('#bn-board');
  cells.addEventListener('click', (e) => {
    const cell = e.target.closest('.bn-cell');
    if (cell) onPlaceCellClick(Number(cell.dataset.r), Number(cell.dataset.c));
  });
  cells.addEventListener('focusin', (e) => {
    const cell = e.target.closest('.bn-cell');
    if (cell) onBoardHover({ r: Number(cell.dataset.r), c: Number(cell.dataset.c) });
  });

  container.querySelector('#bn-ready').addEventListener('click', onReady);
  container.querySelector('#bn-exit').addEventListener('click', leaveGame);
  container.querySelector('#bn-rotate-btn').addEventListener('click', () => rotateSelected());

  mountBoard(container.querySelector('#bn-canvas')).then((board) => {
    if (!board || ctrl?.shell !== 'placing') return;
    board.setMode('placing');
    updatePlacementBoard();
  });
}

function trayHtml() {
  const p = ctrl.place;
  const placedIds = new Set(p.ships.map((s) => s.id));
  const ships = FLEET.map((f) => {
    const placed = placedIds.has(f.id);
    const selected = p.sel?.kind === 'ship' && p.sel.id === f.id;
    return `<button type="button"
      class="bn-piece bn-piece--ship${placed ? ' bn-piece--placed' : ''}${selected ? ' bn-piece--sel' : ''}"
      data-ship="${f.id}" ${p.submitted || placed ? 'disabled' : ''}
      title="${shipName(f.id)} (${f.size} casillas)${placed ? ' · clic en el tablero para recolocarlo' : ''}">
      ${shipIconSvg(f.id, f.size)}
      <span class="bn-piece-label">${shipName(f.id)} <b>${f.size}</b></span>
    </button>`;
  }).join('');

  const holding = p.sel?.kind === 'bomb' ? 1 : 0;
  const free = BOMBS_PER_PLAYER - p.bombs.length - holding;
  const bombs = Array.from({ length: BOMBS_PER_PLAYER }, (_, i) => {
    const state = i < free ? 'free' : (i < free + holding ? 'sel' : 'placed');
    return `<button type="button"
      class="bn-piece bn-piece--bomb${state === 'placed' ? ' bn-piece--placed' : ''}${state === 'sel' ? ' bn-piece--sel' : ''}"
      data-bomb="${i}" ${p.submitted || state === 'placed' ? 'disabled' : ''}
      title="Mina (1 casilla, invisible para el rival)">${mineIconSvg(24)}</button>`;
  }).join('');

  return `<div class="bn-tray-ships">${ships}</div><div class="bn-tray-bombs">${bombs}</div>`;
}

function onTrayClick(piece) {
  const p = ctrl.place;
  if (!p || p.submitted) return;
  if (piece.dataset.ship) {
    const id = piece.dataset.ship;
    if (p.ships.some((s) => s.id === id)) return; // colocado: se retoma desde el tablero
    if (p.sel?.kind === 'ship' && p.sel.id === id) {
      p.sel = null; // volver a dejarlo en la barra
    } else {
      const spec = FLEET.find((f) => f.id === id);
      p.sel = { kind: 'ship', id, size: spec.size, dir: p.sel?.kind === 'ship' ? p.sel.dir : 'h' };
    }
  } else if (piece.dataset.bomb != null) {
    if (p.sel?.kind === 'bomb') p.sel = null;
    else if (p.bombs.length < BOMBS_PER_PLAYER) p.sel = { kind: 'bomb' };
  }
  applyPlacementState();
}

async function onPlaceCellClick(r, c) {
  const p = ctrl.place;
  if (!p || p.submitted) return;

  if (p.sel?.kind === 'ship') {
    // Colocar el barco en mano (la cabeza se ajusta para no salirse del mapa).
    const cand = clampShip({ id: p.sel.id, size: p.sel.size, r, c, dir: p.sel.dir });
    if (!canPlaceShip(cand, p.ships, p.bombs)) return;
    p.ships.push(cand);
    p.sel = null;
    p.hover = null;
  } else if (p.sel?.kind === 'bomb') {
    if (!canPlaceBomb(r, c, p.ships, p.bombs)) return;
    p.bombs.push({ r, c });
    p.sel = null;
    p.hover = null;
  } else {
    // Sin pieza en mano: clic sobre un elemento colocado lo retoma (recolocar).
    const k = cellKey(r, c);
    const ship = p.ships.find((s) => shipCells(s).some((cc) => cellKey(cc.r, cc.c) === k));
    if (ship) {
      p.ships = p.ships.filter((s) => s.id !== ship.id);
      p.sel = { kind: 'ship', id: ship.id, size: ship.size, dir: ship.dir };
      p.hover = { r, c };
    } else {
      const bi = p.bombs.findIndex((b) => b.r === r && b.c === c);
      if (bi >= 0) {
        p.bombs.splice(bi, 1);
        p.sel = { kind: 'bomb' };
        p.hover = { r, c };
      }
    }
  }

  applyPlacementState();
  savePlaceDraft().catch(() => {});
}

// Pinta el tablero de despliegue: elementos colocados (solidos) + pieza en
// mano (ghost translucido, verde si cabe / rojo si no).
function updatePlacementBoard() {
  const p = ctrl.place;
  if (!p) return;

  let ghost = null;
  if (!p.submitted && p.sel && p.hover) {
    if (p.sel.kind === 'ship') {
      const cand = clampShip({ id: p.sel.id, size: p.sel.size, r: p.hover.r, c: p.hover.c, dir: p.sel.dir });
      ghost = { kind: 'ship', ...cand, ok: canPlaceShip(cand, p.ships, p.bombs) };
    } else {
      ghost = { kind: 'bomb', r: p.hover.r, c: p.hover.c, ok: canPlaceBomb(p.hover.r, p.hover.c, p.ships, p.bombs) };
    }
  }

  const board = ctrl.board;
  if (board && ctrl.shell === 'placing') {
    board.setState(placementVisualState(p));
    board.setGhost(ghost);
  }

  // Grilla accesible: estado legible por lector de pantalla.
  const shipKeys = new Set();
  for (const s of p.ships) for (const cc of shipCells(s)) shipKeys.add(cellKey(cc.r, cc.c));
  const bombKeys = new Set(p.bombs.map((b) => cellKey(b.r, b.c)));
  ctrl.container.querySelectorAll('.bn-cell').forEach((cell) => {
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    const k = cellKey(r, c);
    const what = shipKeys.has(k) ? ', tu barco' : (bombKeys.has(k) ? ', tu mina' : '');
    cell.setAttribute('aria-label', `${coordLabel(r, c)}${what}`);
    cell.disabled = !!p.submitted;
  });
}

function applyPlacementState() {
  const { container } = ctrl;
  const p = ctrl.place;
  if (!p || !container.querySelector('#bn-board')) return;

  const trayEl = container.querySelector('#bn-tray');
  if (trayEl) trayEl.innerHTML = trayHtml();
  updatePlacementBoard();
  showRotateHint();

  const complete = !p.sel && p.ships.length === FLEET.length && p.bombs.length === BOMBS_PER_PLAYER;
  const readyBtn = container.querySelector('#bn-ready');
  if (readyBtn) {
    readyBtn.disabled = !complete || p.submitted;
    readyBtn.textContent = p.submitted ? 'Esperando al rival…' : '¡Listo!';
  }

  const hint = container.querySelector('#bn-place-hint');
  if (hint) {
    const leaver = ctrl.game?.leaver;
    if (leaver && leaver !== ctrl.run.role) hint.innerHTML = 'El rival abandono la partida.';
    else if (p.submitted) hint.innerHTML = 'Flota publicada. Esperando a que el rival termine…';
    else if (p.sel?.kind === 'ship') hint.innerHTML = 'Clic para colocar el barco · <b>R</b> para rotar';
    else if (p.sel?.kind === 'bomb') hint.innerHTML = 'Clic para colocar la bomba (invisible para el rival)';
    else if (complete) hint.innerHTML = 'Todo listo. Clic en una pieza para moverla, o pulsa <b>¡Listo!</b>';
    else hint.innerHTML = 'Elige una pieza de la barra · <b>R</b> rota el barco en mano';
  }
}

async function onReady() {
  const p = ctrl.place;
  const complete = p && !p.sel && p.ships.length === FLEET.length && p.bombs.length === BOMBS_PER_PLAYER;
  if (!complete || p.submitted) return;
  const btn = ctrl.container.querySelector('#bn-ready');
  if (btn) btn.disabled = true;
  try {
    await api().submitSetup(ctrl.run.gameId, ctrl.run.role, p.ships, p.bombs);
    p.submitted = true;
    applyPlacementState();
    // Si el rival ya estaba listo, intentamos arrancar de inmediato.
    const ng = await api().startBattle(ctrl.run.gameId);
    if (aliveAndAttached() && ng) {
      ctrl.game = ng;
      renderByStatus();
    }
  } catch (err) {
    log.warn('submitSetup fallo', err);
    if (btn) btn.disabled = false;
  }
}

// --- Batalla ---------------------------------------------------------------------

function snapshot() {
  const g = ctrl.game;
  const run = ctrl.run;
  const myRole = run.role;
  const oppRole = otherRole(myRole);
  return {
    g,
    status: g.status,
    turn: g.turn,
    winner: g.winner,
    leaver: g.leaver,
    myRole,
    oppRole,
    myName: g.players?.[myRole]?.name || run.name,
    oppName: g.players?.[oppRole]?.name || run.opponentName || 'Rival',
    myScore: g.score?.[myRole] || 0,
    oppScore: g.score?.[oppRole] || 0,
    moveDeadline: g.moveDeadline,
    isMyTurn: g.status === GAME_STATUS.PLAYING && g.turn === myRole,
    mySetup: g.setup?.[myRole] || {},
    oppSetup: g.setup?.[oppRole] || {},
    shots: g.shots || {},
    last: g.last || null,
  };
}

function renderBattleShell() {
  ctrl.seenSeq = 0; // re-mostrar el ultimo evento al (re)entrar a la batalla
  const { container } = ctrl;
  container.innerHTML = `
    <div class="bn-view bn-game">
      ${stageHtml(`
        <div class="bn-rival">
          <span class="bn-rival-label">Rival</span>
          <span class="bn-rival-name" id="bn-rival-name">—</span>
        </div>
        <div class="bn-timer" id="bn-timer">30</div>
        <p class="bn-turn" id="bn-turn"></p>
        <div class="bn-score" id="bn-score"></div>
        <div class="bn-surrender" id="bn-surrender"></div>
      `, `
        <p class="bn-event" id="bn-event" hidden></p>
        <div class="bn-legend">
          <span>🔥 Impacto</span>
          <span>⚫ Agua</span>
          <span>✹ Tu mina</span>
        </div>
      `, '<div class="bn-result" id="bn-result" hidden></div>')}
    </div>
  `;

  container.querySelector('#bn-board').addEventListener('click', async (e) => {
    const cell = e.target.closest('.bn-cell');
    if (!cell || cell.disabled) return;
    await onFireClick(Number(cell.dataset.r), Number(cell.dataset.c));
  });

  mountBoard(container.querySelector('#bn-canvas')).then((board) => {
    if (!board || ctrl?.shell !== 'battle') return;
    board.setMode('battle');
    applyBattleState();
  });
}

async function onFireClick(r, c) {
  const snap = snapshot();
  if (!snap.isMyTurn) return;
  if (snap.shots[`${snap.myRole}_${r}_${c}`]) return; // ya disparaste ahi
  try {
    ctrl.game = await api().fireShot(ctrl.run.gameId, ctrl.run.role, r, c);
    renderByStatus();
  } catch (err) {
    log.warn('fireShot fallo', err);
  }
}

function tickClock() {
  if (!ctrl.game || ctrl.shell !== 'battle') return;
  const snap = snapshot();
  const timerEl = ctrl.container.querySelector('#bn-timer');
  if (!timerEl) return;
  if (snap.status !== GAME_STATUS.PLAYING) {
    timerEl.textContent = '—';
    return;
  }
  const remaining = Math.max(0, Math.ceil(((snap.moveDeadline || 0) - Date.now()) / 1000));
  timerEl.textContent = String(remaining);
  timerEl.classList.toggle('bn-timer--low', remaining <= 5);

  if (remaining > 0 || !snap.isMyTurn) return;
  if (snap.moveDeadline === ctrl.lastPassDeadline) return; // ya lo pasamos
  ctrl.lastPassDeadline = snap.moveDeadline;

  api().passTurn(ctrl.run.gameId, ctrl.run.role)
    .then((ng) => { if (aliveAndAttached() && ng) { ctrl.game = ng; renderByStatus(); } })
    .catch((err) => log.warn('passTurn fallo', err));
}

// Refleja el estado de la batalla en el DOM (idempotente; corre en cada poll).
// Niebla de guerra: del rival solo se ven impactos, barcos hundidos (enteros)
// y bombas ya explotadas. Las bombas propias sin explotar solo las ves tu.
function applyBattleState() {
  if (!ctrl.game) return;
  const snap = snapshot();
  const { container, run } = ctrl;
  if (!container.querySelector('#bn-board')) return;

  // Persistir datos para restaurar al reabrir.
  if (run.opponentName !== snap.oppName) persist({ opponentName: snap.oppName });

  const rivalEl = container.querySelector('#bn-rival-name');
  if (rivalEl) rivalEl.textContent = snap.oppName;

  // Escena 3D: barcos, minas, aguas y restos (con niebla de guerra). Los
  // cambios nuevos (impacto, agua, mina, hundido) los anima el propio tablero.
  const vs = battleVisualState(snap);
  const myShots = new Set(vs.shotByMe);
  const board = ctrl.board;
  if (board && board.mode === 'battle') {
    board.setState(vs);
    board.setTargetable(snap.isMyTurn ? (r, c) => !myShots.has(cellKey(r, c)) : null);
  }

  // Grilla accesible (teclado / lector de pantalla).
  const hitKeys = new Set(vs.enemyHits);
  for (const s of vs.myShips) s.hits.forEach((k) => hitKeys.add(k));
  const missKeys = new Set(vs.misses);
  container.querySelectorAll('.bn-cell').forEach((cell) => {
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    const k = cellKey(r, c);
    const what = hitKeys.has(k) ? ', impacto' : (missKeys.has(k) ? ', agua' : '');
    cell.setAttribute('aria-label', `${coordLabel(r, c)}${what}`);
    cell.disabled = !snap.isMyTurn || myShots.has(k);
  });

  // Mensaje del ultimo evento (una sola vez por seq).
  const eventEl = container.querySelector('#bn-event');
  if (snap.last?.seq && snap.last.seq !== ctrl.seenSeq) {
    ctrl.seenSeq = snap.last.seq;
    const msg = describeEvent(snap);
    if (eventEl && msg) {
      eventEl.textContent = msg;
      eventEl.hidden = false;
      eventEl.classList.toggle('bn-event--enemy', snap.last.by !== snap.myRole);
    }
  }

  const scoreEl = container.querySelector('#bn-score');
  if (scoreEl) {
    scoreEl.innerHTML = `
      <span class="bn-score-me">${esc(snap.myName)} <b>${snap.myScore}</b></span>
      <span class="bn-score-sep">–</span>
      <span class="bn-score-opp"><b>${snap.oppScore}</b> ${esc(snap.oppName)}</span>
    `;
  }

  const turnEl = container.querySelector('#bn-turn');
  const resultEl = container.querySelector('#bn-result');

  // El rival abandono.
  if (snap.leaver && snap.leaver === snap.oppRole) {
    if (turnEl) turnEl.textContent = '';
    showResult(resultEl, `${esc(snap.oppName)} abandono la partida`, true);
    return;
  }

  renderSurrender(snap.status === GAME_STATUS.PLAYING);

  if (snap.status === GAME_STATUS.PLAYING) {
    if (resultEl) resultEl.hidden = true;
    ctrl.rematchPending = false;
    if (turnEl) {
      turnEl.textContent = snap.isMyTurn ? 'Tu turno: dispara a una casilla' : `Turno de ${snap.oppName}…`;
      turnEl.classList.toggle('bn-turn--you', snap.isMyTurn);
    }
    if (run.phase !== PHASE.PLAYING) persist({ phase: PHASE.PLAYING });
    return;
  }

  // FINISHED.
  if (turnEl) turnEl.textContent = '';
  if (run.phase !== PHASE.FINISHED) persist({ phase: PHASE.FINISHED });

  const won = snap.winner === snap.myRole;
  let msg;
  if (snap.last?.res === 'surrender') {
    msg = won ? `¡Victoria! ${esc(snap.oppName)} se rindio ⚓` : `Te rendiste. Gana ${esc(snap.oppName)}`;
  } else {
    msg = won
      ? `¡Victoria! Hundiste la flota de ${esc(snap.oppName)} ⚓`
      : `Derrota: ${esc(snap.oppName)} hundio tu flota`;
  }
  showResult(resultEl, msg, false);
}

// Mensaje legible del ultimo evento, desde el punto de vista de este jugador.
function describeEvent(snap) {
  const e = snap.last;
  if (!e) return '';
  const byMe = e.by === snap.myRole;
  const at = typeof e.r === 'number' ? coordLabel(e.r, e.c) : '';
  const dmg = (e.dmg || []).length;
  const sunk = (e.sunk || []).length;

  switch (e.res) {
    case 'surrender':
      return byMe ? 'Te rendiste.' : `${snap.oppName} se rindio.`;
    case 'pass':
      return byMe ? 'Se te acabo el tiempo: turno perdido.' : `${snap.oppName} dejo pasar su turno.`;
    case 'miss':
      return byMe ? `Disparaste a ${at}: agua.` : `${snap.oppName} disparo a ${at}: agua.`;
    case 'hit':
      if (byMe) return sunk ? `¡Impacto en ${at}! Hundiste un barco enemigo ☠` : `¡Impacto en ${at}!`;
      return sunk
        ? `${snap.oppName} disparo a ${at} y hundio uno de tus barcos ☠`
        : `${snap.oppName} impacto uno de tus barcos en ${at}.`;
    case 'boom':
      if (byMe) {
        return dmg
          ? `¡${at} era una bomba trampa! 💥 Tus barcos recibieron ${dmg} de dano${sunk ? ' y perdiste un barco ☠' : ''}.`
          : `¡${at} era una bomba trampa! 💥 Por suerte no tenias barcos cerca.`;
      }
      return dmg
        ? `${snap.oppName} detono tu bomba en ${at} 💥 Sus barcos recibieron ${dmg} de dano${sunk ? ' y perdio un barco ☠' : ''}.`
        : `${snap.oppName} detono tu bomba en ${at} 💥 No tenia barcos cerca.`;
    default:
      return '';
  }
}

// Boton "Rendirse" con confirmacion en dos pasos (un clic suelto no te hace
// perder la partida). Solo existe mientras la batalla esta en curso.
function renderSurrender(visible) {
  const el = ctrl.container.querySelector('#bn-surrender');
  if (!el) return;
  if (!visible) {
    el.innerHTML = '';
    el.dataset.mode = '';
    ctrl.surrenderAsk = false;
    return;
  }
  const mode = ctrl.surrenderAsk ? 'ask' : 'idle';
  if (el.dataset.mode === mode && el.childElementCount) return;
  el.dataset.mode = mode;
  el.innerHTML = mode === 'ask'
    ? `<p class="bn-surrender-q">¿Rendirte? Pierdes esta partida.</p>
       <div class="bn-actions">
         <button type="button" class="ct-btn bn-surrender-yes" id="bn-surrender-yes">Si, rendirme</button>
         <button type="button" class="ct-btn ct-btn--ghost" id="bn-surrender-no">No</button>
       </div>`
    : '<button type="button" class="ct-btn ct-btn--ghost bn-surrender-btn" id="bn-surrender-btn">🏳 Rendirse</button>';
  el.querySelector('#bn-surrender-btn')?.addEventListener('click', () => {
    ctrl.surrenderAsk = true;
    renderSurrender(true);
  });
  el.querySelector('#bn-surrender-no')?.addEventListener('click', () => {
    ctrl.surrenderAsk = false;
    renderSurrender(true);
  });
  el.querySelector('#bn-surrender-yes')?.addEventListener('click', onSurrender);
}

async function onSurrender() {
  ctrl.surrenderAsk = false;
  const btn = ctrl.container.querySelector('#bn-surrender-yes');
  if (btn) btn.disabled = true;
  clearTimeout(ctrl.aiTimer);
  ctrl.aiTimer = null;
  try {
    const g = await api().surrender(ctrl.run.gameId, ctrl.run.role);
    if (g) ctrl.game = g;
    renderByStatus();
  } catch (err) {
    log.warn('surrender fallo', err);
    renderSurrender(true);
  }
}

function showResult(resultEl, message, leaver) {
  if (!resultEl) return;
  const waiting = ctrl.rematchPending && !leaver;
  resultEl.hidden = false;
  resultEl.innerHTML = `
    <p class="bn-result-msg">${message}</p>
    ${waiting
      ? '<p class="ct-state-hint">Esperando al rival…</p>'
      : `<div class="bn-actions">
           ${leaver ? '' : '<button id="bn-again" class="ct-btn ct-btn--primary">Nueva partida</button>'}
           <button id="bn-exit" class="ct-btn ct-btn--ghost">Salir</button>
         </div>`}
  `;

  const again = resultEl.querySelector('#bn-again');
  if (again) again.addEventListener('click', onRematch);
  const exit = resultEl.querySelector('#bn-exit');
  if (exit) exit.addEventListener('click', leaveGame);
}

async function onRematch() {
  ctrl.rematchPending = true;
  ctrl.lastPassDeadline = 0;
  try {
    ctrl.game = await api().requestRematch(ctrl.run.gameId, ctrl.run.role, ctrl.uid);
    renderByStatus();
  } catch (err) {
    log.warn('rematch fallo', err);
  }
}

async function leaveGame() {
  clearTimers();
  const { gameId, role } = ctrl.run;
  if (gameId && role) await api().markLeft(gameId, role);
  await dequeue(ctrl.uid);
  await persist({
    phase: PHASE.IDLE,
    mode: null,
    ai: null,
    gameId: null,
    role: null,
    opponentName: null,
    place: null,
  });
  await route();
}
