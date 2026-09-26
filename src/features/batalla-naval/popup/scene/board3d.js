// Tablero 3D de la Batalla Naval (Three.js). API publica de la escena:
//
//   const board = await createBoard3D({ onCellClick, onCellHover });
//   board.attach(hostEl)          monta el canvas (se puede re-montar entre pantallas)
//   board.setMode('placing'|'battle')
//   board.setState(visualState)   (visual-state.js) idempotente; detecta los cambios
//                                 (impactos, aguas, minas, hundidos) y los anima
//   board.setGhost(ghost|null)    pieza en mano durante el despliegue
//   board.setTargetable(fn|null)  (r,c) => bool: donde se muestra la mira
//   board.dispose()
//
// Los cambios que llegan con animacion se "retienen" SMOKE_COVER_MS: el modelo
// viejo sigue visible hasta que el humo lo tapa, y recien ahi se cambia.

import {
  WebGLRenderer, Scene, Color, HemisphereLight, DirectionalLight,
  Raycaster, Vector2, Plane, Vector3, Group,
} from 'three';
import { cellKey, shipCells } from '../../game.js';
import { createCamera, fitCamera } from './camera.js';
import { createWater } from './water.js';
import { createTiles } from './tiles.js';
import { createShip, createGhostShip, segmentIndex } from './ships.js';
import { createMine, createBall, createWreck, createScorch, disposeProps } from './props.js';
import { createFx, SMOKE_COVER_MS } from './fx.js';
import { createReticle } from './reticle.js';
import { loadModels, sharedMaterials } from './models.js';
import { cellAt, TILE_Y } from './layout.js';

const EMPTY_STATE = { myShips: [], enemySunk: [], enemyHits: [], mines: [], misses: [], shotByMe: [] };

export async function createBoard3D({ onCellClick, onCellHover } = {}) {
  const models = await loadModels();

  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.className = 'bn-canvas-el';

  const scene = new Scene();
  scene.background = new Color('#0b3f63');
  const camera = createCamera();
  const camBase = new Vector3(); // posicion encuadrada (el temblor se suma encima)
  scene.add(new HemisphereLight('#d6ecff', '#0f3a57', 1.7));
  const sun = new DirectionalLight('#fff3dc', 2.1);
  sun.position.set(6, 14, 9);
  scene.add(sun);

  const water = createWater();
  const tiles = createTiles();
  const fx = createFx();
  const reticle = createReticle();
  const layer = new Group(); // barcos, minas, balas, restos
  scene.add(water.mesh, tiles.mesh, layer, fx.object, reticle.object);

  // --- Estado dibujado ----------------------------------------------------------
  let mode = 'placing';
  let state = EMPTY_STATE;
  let baseline = null;          // lo ya conocido (para detectar cambios a animar)
  const revealAt = new Map();   // key -> ms en que se muestra el cambio retenido
  let nextReveal = Infinity;
  const myShips = new Map();    // id -> { sig, view }
  const enemySunk = new Map();  // id -> { sig, view }
  const items = new Map();      // "tipo:key" -> { update, object, dispose? }
  let ghost = null;             // { key, view }
  let targetable = null;

  function revealed(key, now) {
    const at = revealAt.get(key);
    return at == null || now >= at;
  }

  function hold(key, now) {
    const at = now + SMOKE_COVER_MS;
    revealAt.set(key, at);
    nextReveal = Math.min(nextReveal, at);
  }

  function shipSig(s) { return `${s.r},${s.c},${s.dir},${s.size}`; }

  function syncShips(map, list, { enemy }, now) {
    const seen = new Set();
    for (const s of list) {
      seen.add(s.id);
      let entry = map.get(s.id);
      if (!entry || entry.sig !== shipSig(s)) {
        if (entry) layer.remove(entry.view.object);
        entry = { sig: shipSig(s), view: createShip(models.ships[s.id] || models.ships.s2a, s) };
        map.set(s.id, entry);
        layer.add(entry.view.object);
      }
      const keys = shipCells(s).map((cc) => cellKey(cc.r, cc.c));
      const allRevealed = keys.every((k) => revealed(k, now));
      const broken = new Set(s.hits.filter((k) => revealed(k, now)).map((k) => segmentIndex(s, k)));
      entry.view.apply(broken, s.sunk && allRevealed);
      // Un barco rival hundido aparece recien cuando el humo lo tapa.
      entry.view.object.visible = !enemy || allRevealed;
    }
    for (const [id, entry] of map) {
      if (!seen.has(id)) {
        layer.remove(entry.view.object);
        map.delete(id);
      }
    }
  }

  function syncItems(desired) {
    for (const [k, make] of desired) {
      if (!items.has(k)) {
        const it = make();
        items.set(k, it);
        layer.add(it.object);
      }
    }
    for (const [k, it] of items) {
      if (!desired.has(k)) {
        layer.remove(it.object);
        it.dispose?.();
        items.delete(k);
      }
    }
  }

  function applyState(now = performance.now()) {
    const s = state;
    syncShips(myShips, s.myShips, { enemy: false }, now);
    syncShips(enemySunk, s.enemySunk, { enemy: true }, now);

    const desired = new Map();
    for (const m of s.mines) {
      const k = cellKey(m.r, m.c);
      if (m.exploded && revealed(k, now)) {
        desired.set(`scorch:${k}`, () => createScorch(m.r, m.c));
      } else if (m.mine || !m.exploded) {
        desired.set(`mine:${k}`, () => createMine(models.mine, m.r, m.c));
      }
    }
    for (const k of s.misses) {
      if (!revealed(k, now)) continue;
      const [r, c] = k.split('_').map(Number);
      desired.set(`ball:${k}`, () => createBall(models.ball, r, c));
    }
    const sunkCells = new Set();
    for (const sh of s.enemySunk) for (const cc of shipCells(sh)) sunkCells.add(cellKey(cc.r, cc.c));
    for (const k of s.enemyHits) {
      if (!revealed(k, now) || sunkCells.has(k)) continue;
      const [r, c] = k.split('_').map(Number);
      desired.set(`wreck:${k}`, () => createWreck(r, c));
    }
    syncItems(desired);
    tiles.setShot(new Set(mode === 'battle' ? s.shotByMe : []));
  }

  /** Compara con lo ya conocido y dispara las animaciones de lo nuevo. */
  function animateChanges(s, now) {
    const hitKeys = new Set([...s.enemyHits]);
    for (const sh of s.myShips) sh.hits.forEach((k) => hitKeys.add(k));
    const sunkIds = new Set([
      ...s.myShips.filter((x) => x.sunk).map((x) => `me:${x.id}@${shipSig(x)}`),
      ...s.enemySunk.map((x) => `op:${x.id}@${shipSig(x)}`),
    ]);
    const exploded = new Set(s.mines.filter((m) => m.exploded).map((m) => cellKey(m.r, m.c)));
    const misses = new Set(s.misses);
    const next = { hitKeys, sunkIds, exploded, misses };
    if (!baseline) { baseline = next; return; }

    for (const k of exploded) {
      if (baseline.exploded.has(k)) continue;
      const [r, c] = k.split('_').map(Number);
      fx.explosion(r, c);
      hold(k, now);
    }
    for (const k of hitKeys) {
      if (baseline.hitKeys.has(k)) continue;
      const [r, c] = k.split('_').map(Number);
      fx.impact(r, c);
      hold(k, now);
    }
    const sunkNow = [
      ...s.myShips.filter((x) => x.sunk).map((x) => ({ sh: x, id: `me:${x.id}@${shipSig(x)}` })),
      ...s.enemySunk.map((x) => ({ sh: x, id: `op:${x.id}@${shipSig(x)}` })),
    ];
    for (const { sh, id } of sunkNow) {
      if (baseline.sunkIds.has(id)) continue;
      for (const cc of shipCells(sh)) {
        const k = cellKey(cc.r, cc.c);
        // Al hundirse arde y humea todo el casco (no solo la casilla del ultimo disparo).
        if (!hitKeys.has(k) || baseline.hitKeys.has(k)) fx.smoke(cc.r, cc.c, { scale: 1.3, dark: true, count: 14 });
        hold(k, now);
      }
    }
    for (const k of misses) {
      if (baseline.misses.has(k)) continue;
      const [r, c] = k.split('_').map(Number);
      fx.splash(r, c);
      hold(k, now);
    }
    baseline = next;
  }

  // --- API ----------------------------------------------------------------------

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    baseline = null;
    revealAt.clear();
    nextReveal = Infinity;
    if (m !== 'placing') setGhost(null);
    if (m !== 'battle') setTargetable(null);
  }

  function setState(next) {
    const now = performance.now();
    state = next || EMPTY_STATE;
    if (mode === 'battle') animateChanges(state, now);
    applyState(now);
  }

  function setGhost(g) {
    if (!g) {
      if (ghost) {
        layer.remove(ghost.view.object);
        ghost.view.dispose();
        ghost = null;
      }
      return;
    }
    const key = g.kind === 'ship' ? `ship:${g.id}` : 'bomb';
    if (!ghost || ghost.key !== key) {
      setGhost(null);
      const view = g.kind === 'ship'
        ? createGhostShip(models.ships[g.id] || models.ships.s2a, g.size)
        : createMine(models.mine, g.r, g.c, { ghost: true });
      ghost = { key, view };
      layer.add(view.object);
    }
    if (g.kind === 'ship') ghost.view.place(g, g.ok);
    else ghost.view.moveTo(g.r, g.c, g.ok);
  }

  function setTargetable(fn) {
    targetable = fn;
    if (!fn) reticle.hide();
    else if (hoverCell && fn(hoverCell.r, hoverCell.c)) reticle.show(hoverCell.r, hoverCell.c);
    else reticle.hide();
    canvas.style.cursor = fn && hoverCell && fn(hoverCell.r, hoverCell.c) ? 'crosshair' : '';
  }

  // --- Puntero -------------------------------------------------------------------
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const tilePlane = new Plane(new Vector3(0, 1, 0), -TILE_Y);
  const hit = new Vector3();
  let hoverCell = null;

  function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(tilePlane, hit)) return null;
    return cellAt(hit.x, hit.z);
  }

  function onMove(e) {
    const cell = cellFromEvent(e);
    const same = cell && hoverCell && cell.r === hoverCell.r && cell.c === hoverCell.c;
    if (same || (!cell && !hoverCell)) return;
    hoverCell = cell;
    if (cell && targetable?.(cell.r, cell.c)) {
      reticle.show(cell.r, cell.c);
      canvas.style.cursor = 'crosshair';
    } else {
      reticle.hide();
      canvas.style.cursor = cell && mode === 'placing' ? 'pointer' : '';
    }
    onCellHover?.(cell);
  }

  function onLeave() {
    hoverCell = null;
    reticle.hide();
    onCellHover?.(null);
  }

  function onClick(e) {
    const cell = cellFromEvent(e);
    if (cell) onCellClick?.(cell.r, cell.c);
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('click', onClick);

  // --- Tamano y loop -------------------------------------------------------------
  let host = null;
  const ro = new ResizeObserver(() => resize());

  function resize() {
    if (!host) return;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    fitCamera(camera, w / h);
    camBase.copy(camera.position);
  }

  function attach(el) {
    if (host) ro.unobserve(host);
    host = el;
    el.appendChild(canvas);
    ro.observe(el);
    resize();
  }

  let raf = 0;
  const flame = sharedMaterials.get('flame');
  function frame(ms) {
    raf = requestAnimationFrame(frame);
    const t = ms / 1000;
    if (ms >= nextReveal) {
      nextReveal = Infinity;
      for (const at of revealAt.values()) if (at > ms) nextReveal = Math.min(nextReveal, at);
      applyState(ms);
    }
    water.update(t);
    tiles.update(t);
    for (const { view } of myShips.values()) view.update(t);
    for (const { view } of enemySunk.values()) view.update(t);
    for (const it of items.values()) it.update(t);
    if (ghost) ghost.view.update?.(t);
    if (flame) flame.emissiveIntensity = 1.2 + Math.sin(t * 11) * 0.5;
    reticle.update(t, tiles.heightAt);
    fx.update(ms);
    const sh = fx.shake(ms);
    camera.position.set(
      camBase.x + (Math.random() - 0.5) * sh,
      camBase.y + (Math.random() - 0.5) * sh * 0.5,
      camBase.z + (Math.random() - 0.5) * sh,
    );
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  function dispose() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('click', onClick);
    setGhost(null);
    for (const it of items.values()) it.dispose?.();
    items.clear();
    water.dispose();
    tiles.dispose();
    fx.dispose();
    reticle.dispose();
    disposeProps();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }

  return { attach, setMode, setState, setGhost, setTargetable, resize, dispose, get mode() { return mode; } };
}
