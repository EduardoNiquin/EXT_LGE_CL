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
  getGame,
  submitSetup,
  startBattle,
  fireShot,
  passTurn,
  requestRematch,
  markLeft,
  getLeaderboard,
} from '../../net.js';
import {
  otherRole,
  cellKey,
  shipCells,
  clampShip,
  canPlaceShip,
  canPlaceBomb,
  isSunk,
  coordLabel,
} from '../../game.js';
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
  };

  // Rotar con R el barco seleccionado durante el despliegue.
  ctrl.keyHandler = (e) => {
    if (e.key !== 'r' && e.key !== 'R') return;
    const p = ctrl?.place;
    if (ctrl?.shell !== 'placing' || !p || p.submitted || p.sel?.kind !== 'ship') return;
    p.sel.dir = p.sel.dir === 'h' ? 'v' : 'h';
    updatePlacementBoard();
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
}

async function route() {
  clearTimers();
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

// --- IDLE: nombre + jugadores activos + jugar / ranking ------------------------

async function renderIdle() {
  ctrl.game = null;
  const { container, run } = ctrl;
  container.innerHTML = `
    <div class="gato-view">
      <div class="gato-hero">${shipSvg(64)}<span>BATALLA NAVAL</span></div>
      <label class="gato-label" for="gato-name">Tu nombre</label>
      <input id="gato-name" class="gato-input" type="text" maxlength="20"
        placeholder="Escribe tu nombre" autocomplete="off" spellcheck="false"
        value="${esc(run.name)}" />
      <p class="gato-presence" id="gato-presence">Buscando jugadores activos…</p>
      <button id="gato-play" class="ct-btn ct-btn--primary gato-play">Buscar partida</button>
      <div class="gato-actions">
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
      <div class="gato-hero gato-hero--sm">${shipSvg(40)}<span>Clasificaciones</span></div>
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
      <div class="gato-hero gato-hero--sm">${shipSvg(40)}<span>Buscando partida</span></div>
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
      <div class="gato-hero">${shipSvg(64)}<span>¡Reto!</span></div>
      <div class="ct-state">
        <p class="gato-challenge-msg"><strong>${who}</strong> te ha retado</p>
        <p class="ct-state-hint">Estas obligado a jugar ⚓</p>
      </div>
      <button id="gato-accept" class="ct-btn ct-btn--primary gato-play">¡A jugar!</button>
    </div>
  `;
  container.querySelector('#gato-accept').addEventListener('click', async () => {
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
  ctrl.game = await getGame(gameId).catch(() => null);
  if (!ctrl.game) {
    await persist({ phase: PHASE.IDLE, gameId: null, role: null });
    return route();
  }
  ctrl.shell = null;
  renderByStatus();

  ctrl.pollTimer = setInterval(async () => {
    if (!aliveAndAttached()) return teardown();
    try {
      const g = await getGame(gameId);
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
      startBattle(ctrl.run.gameId)
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
}

/** Grilla 16x16 de botones (compartida por despliegue y batalla). */
function boardCellsHtml() {
  let html = '';
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      html += `<button type="button" class="bn-cell" data-r="${r}" data-c="${c}" aria-label="${coordLabel(r, c)}"></button>`;
    }
  }
  return html;
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
    <div class="gato-view gato-game">
      <div class="gato-topbar">
        <div class="gato-rival">
          <span class="gato-rival-label">Rival</span>
          <span class="gato-rival-name">${esc(ctrl.run.opponentName || 'Rival')}</span>
        </div>
        <span class="bn-phase-tag">Despliegue</span>
      </div>
      <p class="gato-turn" id="bn-place-hint"></p>
      <div class="bn-tray" id="bn-tray"></div>
      <div class="bn-board" id="bn-board">${boardCellsHtml()}</div>
      <div class="gato-actions">
        <button id="bn-ready" class="ct-btn ct-btn--primary" disabled>¡Listo!</button>
        <button id="bn-exit" class="ct-btn ct-btn--ghost">Salir</button>
      </div>
    </div>
  `;

  container.querySelector('#bn-tray').addEventListener('click', (e) => {
    const piece = e.target.closest('.bn-piece');
    if (!piece || piece.disabled) return;
    onTrayClick(piece);
  });

  const board = container.querySelector('#bn-board');
  board.addEventListener('click', (e) => {
    const cell = e.target.closest('.bn-cell');
    if (!cell) return;
    onPlaceCellClick(Number(cell.dataset.r), Number(cell.dataset.c));
  });
  // El "mouse se vuelve la pieza": preview translucido siguiendo el hover.
  board.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('.bn-cell');
    if (!cell || !ctrl.place?.sel) return;
    ctrl.place.hover = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
    updatePlacementBoard();
  });
  board.addEventListener('mouseleave', () => {
    if (!ctrl.place) return;
    ctrl.place.hover = null;
    updatePlacementBoard();
  });

  container.querySelector('#bn-ready').addEventListener('click', onReady);
  container.querySelector('#bn-exit').addEventListener('click', leaveGame);
}

function trayHtml() {
  const p = ctrl.place;
  const placedIds = new Set(p.ships.map((s) => s.id));
  const ships = FLEET.map((f) => {
    const placed = placedIds.has(f.id);
    const selected = p.sel?.kind === 'ship' && p.sel.id === f.id;
    const cells = Array.from({ length: f.size }, () => '<span class="bn-piece-cell"></span>').join('');
    return `<button type="button"
      class="bn-piece${placed ? ' bn-piece--placed' : ''}${selected ? ' bn-piece--sel' : ''}"
      data-ship="${f.id}" ${p.submitted || placed ? 'disabled' : ''}
      title="Barco ${f.size}x1${placed ? ' (clic en el tablero para recolocarlo)' : ''}">${cells}</button>`;
  }).join('');

  const holding = p.sel?.kind === 'bomb' ? 1 : 0;
  const free = BOMBS_PER_PLAYER - p.bombs.length - holding;
  const bombs = Array.from({ length: BOMBS_PER_PLAYER }, (_, i) => {
    const state = i < free ? 'free' : (i < free + holding ? 'sel' : 'placed');
    return `<button type="button"
      class="bn-piece bn-piece--bomb${state === 'placed' ? ' bn-piece--placed' : ''}${state === 'sel' ? ' bn-piece--sel' : ''}"
      data-bomb="${i}" ${p.submitted || state === 'placed' ? 'disabled' : ''}
      title="Bomba (1 casilla, invisible para el rival)">💣</button>`;
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

  const shipKeys = new Set();
  for (const s of p.ships) for (const cc of shipCells(s)) shipKeys.add(cellKey(cc.r, cc.c));
  const bombKeys = new Set(p.bombs.map((b) => cellKey(b.r, b.c)));

  const ghost = new Set();
  let ghostOk = false;
  let ghostBomb = false;
  if (!p.submitted && p.sel && p.hover) {
    if (p.sel.kind === 'ship') {
      const cand = clampShip({ id: p.sel.id, size: p.sel.size, r: p.hover.r, c: p.hover.c, dir: p.sel.dir });
      ghostOk = canPlaceShip(cand, p.ships, p.bombs);
      for (const cc of shipCells(cand)) ghost.add(cellKey(cc.r, cc.c));
    } else {
      ghostBomb = true;
      ghostOk = canPlaceBomb(p.hover.r, p.hover.c, p.ships, p.bombs);
      ghost.add(cellKey(p.hover.r, p.hover.c));
    }
  }

  ctrl.container.querySelectorAll('.bn-cell').forEach((cell) => {
    const k = `${cell.dataset.r}_${cell.dataset.c}`;
    const isGhost = ghost.has(k);
    cell.classList.toggle('bn-cell--ship', shipKeys.has(k));
    cell.classList.toggle('bn-cell--bomb', bombKeys.has(k));
    cell.classList.toggle('bn-cell--ghost-ok', isGhost && ghostOk);
    cell.classList.toggle('bn-cell--ghost-bad', isGhost && !ghostOk);
    cell.textContent = (bombKeys.has(k) || (isGhost && ghostBomb)) ? '💣' : '';
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
    await submitSetup(ctrl.run.gameId, ctrl.run.role, p.ships, p.bombs);
    p.submitted = true;
    applyPlacementState();
    // Si el rival ya estaba listo, intentamos arrancar de inmediato.
    const ng = await startBattle(ctrl.run.gameId);
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
    <div class="gato-view gato-game">
      <div class="gato-topbar">
        <div class="gato-rival">
          <span class="gato-rival-label">Rival</span>
          <span class="gato-rival-name" id="gato-rival-name">—</span>
        </div>
        <div class="gato-timer" id="gato-timer">30</div>
      </div>
      <p class="gato-turn" id="gato-turn"></p>
      <p class="bn-event" id="bn-event" hidden></p>
      <div class="bn-board" id="bn-board">${boardCellsHtml()}</div>
      <div class="bn-legend">
        <span><i class="bn-dot bn-dot--ship"></i> Tu barco</span>
        <span>✸ Impacto</span>
        <span>💣 Tu bomba</span>
        <span>• Agua</span>
      </div>
      <div class="gato-score" id="gato-score"></div>
      <div class="gato-result" id="gato-result" hidden></div>
    </div>
  `;

  container.querySelector('#bn-board').addEventListener('click', async (e) => {
    const cell = e.target.closest('.bn-cell');
    if (!cell || cell.disabled) return;
    await onFireClick(Number(cell.dataset.r), Number(cell.dataset.c));
  });
}

async function onFireClick(r, c) {
  const snap = snapshot();
  if (!snap.isMyTurn) return;
  if (snap.shots[`${snap.myRole}_${r}_${c}`]) return; // ya disparaste ahi
  try {
    ctrl.game = await fireShot(ctrl.run.gameId, ctrl.run.role, r, c);
    renderByStatus();
  } catch (err) {
    log.warn('fireShot fallo', err);
  }
}

function tickClock() {
  if (!ctrl.game || ctrl.shell !== 'battle') return;
  const snap = snapshot();
  const timerEl = ctrl.container.querySelector('#gato-timer');
  if (!timerEl) return;
  if (snap.status !== GAME_STATUS.PLAYING) {
    timerEl.textContent = '—';
    return;
  }
  const remaining = Math.max(0, Math.ceil(((snap.moveDeadline || 0) - Date.now()) / 1000));
  timerEl.textContent = String(remaining);
  timerEl.classList.toggle('gato-timer--low', remaining <= 5);

  if (remaining > 0 || !snap.isMyTurn) return;
  if (snap.moveDeadline === ctrl.lastPassDeadline) return; // ya lo pasamos
  ctrl.lastPassDeadline = snap.moveDeadline;

  passTurn(ctrl.run.gameId, ctrl.run.role)
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

  const rivalEl = container.querySelector('#gato-rival-name');
  if (rivalEl) rivalEl.textContent = snap.oppName;

  // Mapas por celda.
  const mine = new Map(); // mis barcos (siempre visibles para mi)
  for (const s of snap.mySetup.ships || []) {
    const sunk = isSunk(s);
    for (const cc of shipCells(s)) {
      const k = cellKey(cc.r, cc.c);
      mine.set(k, { hit: !!s.hits?.[k], sunk });
    }
  }
  const enemy = new Map(); // del rival: solo celdas impactadas o barcos caidos
  for (const s of snap.oppSetup.ships || []) {
    const sunk = isSunk(s);
    for (const cc of shipCells(s)) {
      const k = cellKey(cc.r, cc.c);
      const hit = !!s.hits?.[k];
      if (sunk || hit) enemy.set(k, { hit, sunk });
    }
  }
  const bombs = new Map(); // mias (siempre) + explotadas de cualquiera
  for (const b of snap.mySetup.bombs || []) {
    bombs.set(cellKey(b.r, b.c), { mine: true, exploded: !!b.exploded });
  }
  for (const b of snap.oppSetup.bombs || []) {
    if (b.exploded) bombs.set(cellKey(b.r, b.c), { mine: false, exploded: true });
  }
  const misses = new Set();
  const myShots = new Set();
  for (const sh of Object.values(snap.shots)) {
    if (!sh) continue;
    const k = cellKey(sh.r, sh.c);
    if (sh.by === snap.myRole) myShots.add(k);
    if (sh.res === 'miss') misses.add(k);
  }

  container.querySelectorAll('.bn-cell').forEach((cell) => {
    const k = `${cell.dataset.r}_${cell.dataset.c}`;
    const m = mine.get(k);
    const e = enemy.get(k);
    const b = bombs.get(k);

    cell.classList.toggle('bn-cell--ship', !!m);
    cell.classList.toggle('bn-cell--ship-enemy', !!e);
    cell.classList.toggle('bn-cell--hit', !!(m?.hit || e?.hit));
    cell.classList.toggle('bn-cell--sunk', !!(m?.sunk || e?.sunk));
    cell.classList.toggle('bn-cell--bomb', !!b && !b.exploded);
    cell.classList.toggle('bn-cell--boom', !!b?.exploded);
    cell.classList.toggle('bn-cell--miss', misses.has(k) && !m && !e && !b);

    let icon = '';
    if (b && !b.exploded) icon = '💣';
    else if (b?.exploded) icon = '💥';
    else if (m?.sunk || e?.sunk) icon = '☠';
    else if (m?.hit || e?.hit) icon = '✸';
    else if (misses.has(k)) icon = '•';
    cell.textContent = icon;

    cell.disabled = !snap.isMyTurn || myShots.has(k);
  });

  // Feedback del ultimo evento (una sola vez por seq): mensaje + flash.
  const eventEl = container.querySelector('#bn-event');
  if (snap.last?.seq && snap.last.seq !== ctrl.seenSeq) {
    ctrl.seenSeq = snap.last.seq;
    const msg = describeEvent(snap);
    if (eventEl && msg) {
      eventEl.textContent = msg;
      eventEl.hidden = false;
      eventEl.classList.toggle('bn-event--enemy', snap.last.by !== snap.myRole);
    }
    const flash = [];
    if (typeof snap.last.r === 'number') flash.push(cellKey(snap.last.r, snap.last.c));
    for (const k of snap.last.dmg || []) {
      if (!flash.includes(k)) flash.push(k);
    }
    for (const k of flash) {
      const [r, c] = k.split('_');
      const el = container.querySelector(`.bn-cell[data-r="${r}"][data-c="${c}"]`);
      if (el) {
        el.classList.remove('bn-cell--flash');
        void el.offsetWidth; // reinicia la animacion
        el.classList.add('bn-cell--flash');
      }
    }
  }

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

  // El rival abandono.
  if (snap.leaver && snap.leaver === snap.oppRole) {
    if (turnEl) turnEl.textContent = '';
    showResult(resultEl, `${esc(snap.oppName)} abandono la partida`, true);
    return;
  }

  if (snap.status === GAME_STATUS.PLAYING) {
    if (resultEl) resultEl.hidden = true;
    ctrl.rematchPending = false;
    if (turnEl) {
      turnEl.textContent = snap.isMyTurn ? 'Tu turno: dispara a una casilla' : `Turno de ${snap.oppName}…`;
      turnEl.classList.toggle('gato-turn--you', snap.isMyTurn);
    }
    if (run.phase !== PHASE.PLAYING) persist({ phase: PHASE.PLAYING });
    return;
  }

  // FINISHED.
  if (turnEl) turnEl.textContent = '';
  if (run.phase !== PHASE.FINISHED) persist({ phase: PHASE.FINISHED });

  const msg = snap.winner === snap.myRole
    ? `¡Victoria! Hundiste la flota de ${esc(snap.oppName)} ⚓`
    : `Derrota: ${esc(snap.oppName)} hundio tu flota`;
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

function showResult(resultEl, message, leaver) {
  if (!resultEl) return;
  const waiting = ctrl.rematchPending && !leaver;
  resultEl.hidden = false;
  resultEl.innerHTML = `
    <p class="gato-result-msg">${message}</p>
    ${waiting
      ? '<p class="ct-state-hint">Esperando al rival…</p>'
      : `<div class="gato-actions">
           ${leaver ? '' : '<button id="gato-again" class="ct-btn ct-btn--primary">Nueva partida</button>'}
           <button id="gato-exit" class="ct-btn ct-btn--ghost">Salir</button>
         </div>`}
  `;

  const again = resultEl.querySelector('#gato-again');
  if (again) again.addEventListener('click', onRematch);
  const exit = resultEl.querySelector('#gato-exit');
  if (exit) exit.addEventListener('click', leaveGame);
}

async function onRematch() {
  ctrl.rematchPending = true;
  ctrl.lastPassDeadline = 0;
  try {
    ctrl.game = await requestRematch(ctrl.run.gameId, ctrl.run.role, ctrl.uid);
    renderByStatus();
  } catch (err) {
    log.warn('rematch fallo', err);
  }
}

async function leaveGame() {
  clearTimers();
  const { gameId, role } = ctrl.run;
  if (gameId && role) await markLeft(gameId, role);
  await dequeue(ctrl.uid);
  await persist({
    phase: PHASE.IDLE,
    gameId: null,
    role: null,
    opponentName: null,
    place: null,
  });
  await route();
}
