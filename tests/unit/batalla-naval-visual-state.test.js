import { describe, it, expect } from 'vitest';
import { battleVisualState, placementVisualState } from '../../src/features/batalla-naval/popup/scene/visual-state.js';
import { cellAt, cellCenter } from '../../src/features/batalla-naval/popup/scene/layout.js';

const mySetup = {
  ships: [
    { id: 's4', size: 4, r: 2, c: 2, dir: 'h', hits: { '2_3': true } },
    { id: 's2a', size: 2, r: 10, c: 5, dir: 'v', hits: { '10_5': true, '11_5': true } },
  ],
  bombs: [{ r: 5, c: 5, exploded: false }, { r: 6, c: 6, exploded: true }],
};
const oppSetup = {
  ships: [
    { id: 's3', size: 3, r: 0, c: 8, dir: 'h', hits: { '0_9': true } },
    { id: 's2b', size: 2, r: 14, c: 0, dir: 'h', hits: { '14_0': true, '14_1': true } },
    { id: 's4', size: 4, r: 8, c: 12, dir: 'v', hits: {} },
  ],
  bombs: [{ r: 3, c: 3, exploded: false }, { r: 12, c: 12, exploded: true }],
};
const shots = {
  P1_0_9: { by: 'P1', r: 0, c: 9, res: 'hit' },
  P1_7_7: { by: 'P1', r: 7, c: 7, res: 'miss' },
  P2_9_1: { by: 'P2', r: 9, c: 1, res: 'miss' },
  P2_2_3: { by: 'P2', r: 2, c: 3, res: 'hit' },
  // Agua sobre una celda con barco propio (tablero compartido): no se dibuja bala.
  P1_2_4: { by: 'P1', r: 2, c: 4, res: 'miss' },
};

describe('battleVisualState', () => {
  const vs = battleVisualState({ mySetup, oppSetup, shots, myRole: 'P1' });

  it('mis barcos siempre, con sus impactos y hundidos', () => {
    expect(vs.myShips.map((s) => s.id)).toEqual(['s4', 's2a']);
    expect(vs.myShips[0]).toMatchObject({ hits: ['2_3'], sunk: false });
    expect(vs.myShips[1]).toMatchObject({ sunk: true });
  });

  it('niebla de guerra: del rival solo impactos sueltos y hundidos enteros', () => {
    expect(vs.enemyHits).toEqual(['0_9']);
    expect(vs.enemySunk.map((s) => s.id)).toEqual(['s2b']);
    expect(vs.enemySunk.some((s) => s.id === 's4')).toBe(false);
  });

  it('minas: las mias siempre; del rival solo las explotadas', () => {
    expect(vs.mines).toEqual([
      { r: 5, c: 5, mine: true, exploded: false },
      { r: 6, c: 6, mine: true, exploded: true },
      { r: 12, c: 12, mine: false, exploded: true },
    ]);
  });

  it('aguas de ambos, salvo donde hay algo visible; mis disparos aparte', () => {
    expect(vs.misses.sort()).toEqual(['7_7', '9_1']);
    expect(vs.shotByMe.sort()).toEqual(['0_9', '2_4', '7_7']);
  });
});

describe('placementVisualState', () => {
  it('solo lo propio, sin danos', () => {
    const vs = placementVisualState({ ships: [mySetup.ships[0]], bombs: [{ r: 1, c: 1 }] });
    expect(vs.myShips[0]).toMatchObject({ id: 's4', hits: [], sunk: false });
    expect(vs.mines).toEqual([{ r: 1, c: 1, mine: true, exploded: false }]);
    expect(vs.misses).toEqual([]);
  });
});

describe('layout', () => {
  it('cellAt invierte cellCenter y descarta fuera del tablero', () => {
    const { x, z } = cellCenter(3, 12);
    expect(cellAt(x, z)).toEqual({ r: 3, c: 12 });
    expect(cellAt(-9, 0)).toBeNull();
    expect(cellAt(0, 8.01)).toBeNull();
  });
});
