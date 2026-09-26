import { describe, it, expect } from 'vitest';
import {
  randomFleet, makeAiGame, submitHumanSetup, applyShot, aiPickShot, aiMove,
  targetCandidates, openHits, rematch, surrender, AI_ROLE, HUMAN_ROLE,
} from '../../src/features/batalla-naval/ai-game.js';
import { FLEET, BOMBS_PER_PLAYER, GRID } from '../../src/features/batalla-naval/constants.js';
import { canPlaceShip, canPlaceBomb, shipCells, cellKey } from '../../src/features/batalla-naval/game.js';

/** PRNG determinista (mulberry32) para que los tests no dependan del azar. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HUMAN_SHIPS = [
  { id: 's4', size: 4, r: 5, c: 5, dir: 'h' },
  { id: 's3', size: 3, r: 10, c: 2, dir: 'v' },
  { id: 's2a', size: 2, r: 0, c: 0, dir: 'h' },
  { id: 's2b', size: 2, r: 14, c: 14, dir: 'v' },
];
const HUMAN_BOMBS = [{ r: 8, c: 8 }, { r: 12, c: 12 }];

function battle(seed = 1) {
  const rnd = seeded(seed);
  const g = submitHumanSetup(makeAiGame('Ana', rnd), HUMAN_SHIPS, HUMAN_BOMBS, rnd, 0);
  return { ...g, turn: AI_ROLE };
}

/** Marca impactos en el barco `id` del humano (como si la IA ya hubiese acertado). */
function withHumanHits(game, id, keys) {
  const ships = game.setup[HUMAN_ROLE].ships.map((s) => (
    s.id === id ? { ...s, hits: Object.fromEntries(keys.map((k) => [k, true])) } : s
  ));
  const shots = { ...(game.shots || {}) };
  for (const k of keys) {
    const [r, c] = k.split('_').map(Number);
    shots[`${AI_ROLE}_${k}`] = { by: AI_ROLE, r, c, res: 'hit' };
  }
  return { ...game, shots, setup: { ...game.setup, [HUMAN_ROLE]: { ...game.setup[HUMAN_ROLE], ships } } };
}

describe('randomFleet', () => {
  it('despliega toda la flota y las minas sin pisarse ni salirse', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { ships, bombs } = randomFleet(seeded(seed));
      expect(ships.map((s) => s.id)).toEqual(FLEET.map((f) => f.id));
      expect(bombs).toHaveLength(BOMBS_PER_PLAYER);
      ships.forEach((s, i) => expect(canPlaceShip(s, ships.slice(0, i), [])).toBe(true));
      bombs.forEach((b, i) => expect(canPlaceBomb(b.r, b.c, ships, bombs.slice(0, i))).toBe(true));
    }
  });
});

describe('aiPickShot: caza', () => {
  it('sin impactos pendientes dispara en damero, fuera de lo suyo y sin repetir', () => {
    let g = battle(3);
    const own = new Set();
    for (const s of g.setup[AI_ROLE].ships) for (const cc of shipCells(s)) own.add(cellKey(cc.r, cc.c));
    for (let i = 0; i < 30; i++) {
      const shot = aiPickShot(g, seeded(100 + i));
      expect((shot.r + shot.c) % 2).toBe(0);
      expect(own.has(cellKey(shot.r, shot.c))).toBe(false);
      expect(g.shots?.[`${AI_ROLE}_${shot.r}_${shot.c}`]).toBeUndefined();
      g = { ...g, shots: { ...(g.shots || {}), [`${AI_ROLE}_${shot.r}_${shot.c}`]: { by: AI_ROLE, r: shot.r, c: shot.c, res: 'miss' } } };
    }
  });
});

describe('aiPickShot: remate', () => {
  it('tras un impacto tantea las 4 casillas vecinas', () => {
    const g = withHumanHits(battle(), 's4', ['5_6']);
    const around = new Set(['4_6', '6_6', '5_5', '5_7']);
    for (let seed = 1; seed <= 20; seed++) {
      const shot = aiPickShot(g, seeded(seed));
      expect(around.has(cellKey(shot.r, shot.c))).toBe(true);
    }
  });

  it('con 2 impactos en linea sigue esa linea por sus extremos', () => {
    const g = withHumanHits(battle(), 's4', ['5_6', '5_7']);
    for (let seed = 1; seed <= 20; seed++) {
      const shot = aiPickShot(g, seeded(seed));
      expect(['5_5', '5_8']).toContain(cellKey(shot.r, shot.c));
    }
  });

  it('si un extremo ya fue agua, va por el otro', () => {
    let g = withHumanHits(battle(), 's4', ['5_6', '5_7']);
    g = { ...g, shots: { ...g.shots, [`${AI_ROLE}_5_8`]: { by: AI_ROLE, r: 5, c: 8, res: 'miss' } } };
    expect(aiPickShot(g, seeded(1))).toEqual({ r: 5, c: 5 });
  });

  it('un barco ya hundido no deja impactos pendientes', () => {
    const g = withHumanHits(battle(), 's2a', ['0_0', '0_1']);
    expect(openHits(g)).toEqual([]);
  });

  it('en una esquina solo propone casillas dentro del tablero', () => {
    const cands = targetCandidates([{ r: 0, c: 0 }], (r, c) => r >= 0 && c >= 0 && r < GRID && c < GRID);
    expect(cands).toEqual([{ r: 1, c: 0 }, { r: 0, c: 1 }]);
  });

  it('remata hasta hundir el barco sin irse a otro lado', () => {
    let g = withHumanHits(battle(7), 's3', ['11_2']);
    const s3Hits = () => Object.keys(g.setup[HUMAN_ROLE].ships.find((s) => s.id === 's3').hits);
    for (let i = 0; i < 8 && s3Hits().length < 3; i++) {
      g = aiMove({ ...g, turn: AI_ROLE }, seeded(i + 1), 0);
      const { r, c } = g.last;
      expect(Math.abs(r - 11) + Math.abs(c - 2)).toBeLessThanOrEqual(2);
    }
    const s3 = g.setup[HUMAN_ROLE].ships.find((s) => s.id === 's3');
    expect(Object.keys(s3.hits).sort()).toEqual(['10_2', '11_2', '12_2']);
  });
});

describe('ciclo de la partida local', () => {
  it('al publicar la flota del humano arranca la batalla', () => {
    const rnd = seeded(2);
    const g = submitHumanSetup(makeAiGame('Ana', rnd), HUMAN_SHIPS, HUMAN_BOMBS, rnd, 0);
    expect(g.status).toBe('playing');
    expect([HUMAN_ROLE, AI_ROLE]).toContain(g.turn);
    expect(g.setup[HUMAN_ROLE].ready).toBe(true);
  });

  it('hundir la ultima nave da la victoria y suma al marcador; la revancha lo conserva', () => {
    let g = { ...battle(4), turn: HUMAN_ROLE };
    const targets = g.setup[AI_ROLE].ships.flatMap((s) => shipCells(s));
    for (const { r, c } of targets) {
      g = applyShot({ ...g, turn: HUMAN_ROLE }, HUMAN_ROLE, r, c, 0);
    }
    expect(g.status).toBe('finished');
    expect(g.winner).toBe(HUMAN_ROLE);
    expect(g.score[HUMAN_ROLE]).toBe(1);
    const again = rematch(g, seeded(9));
    expect(again.status).toBe('placing');
    expect(again.score[HUMAN_ROLE]).toBe(1);
    expect(again.setup[AI_ROLE].ready).toBe(true);
  });

  it('rendirse da la victoria al rival, suma a su marcador y deja el evento', () => {
    const g = surrender({ ...battle(5), turn: AI_ROLE }, HUMAN_ROLE, 0);
    expect(g.status).toBe('finished');
    expect(g.winner).toBe(AI_ROLE);
    expect(g.score[AI_ROLE]).toBe(1);
    expect(g.last).toMatchObject({ by: HUMAN_ROLE, res: 'surrender' });
    // Una partida ya terminada no se puede "rendir" de nuevo.
    expect(surrender(g, HUMAN_ROLE, 0)).toBe(g);
  });
});
