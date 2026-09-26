// Casillas: un InstancedMesh de 256 losas blancas semitransparentes que flotan
// levemente (cada una con su fase). Las ya disparadas se tinen y se apagan.

import {
  InstancedMesh, BoxGeometry, MeshStandardMaterial, Object3D, Color,
} from 'three';
import { GRID } from '../../constants.js';
import { cellCenter, cellPhase, TILE_Y } from './layout.js';

const SIZE = 0.9;
const BOB = 0.025;
const WHITE = new Color('#ffffff');
const SHOT = new Color('#7fa3bd');

export function createTiles() {
  const geo = new BoxGeometry(SIZE, 0.035, SIZE);
  const mat = new MeshStandardMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.3,
    roughness: 0.4,
    flatShading: true,
    depthWrite: false,
  });
  const mesh = new InstancedMesh(geo, mat, GRID * GRID);
  mesh.renderOrder = 2;
  const dummy = new Object3D();
  const phases = new Float32Array(GRID * GRID);
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const i = r * GRID + c;
      phases[i] = cellPhase(r, c);
      mesh.setColorAt(i, WHITE);
    }
  }

  /** Altura actual de la casilla (la usan la reticula y el fantasma). */
  function heightAt(r, c, t) {
    return TILE_Y + Math.sin(t * 1.4 + phases[r * GRID + c]) * BOB;
  }

  function update(t) {
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const i = r * GRID + c;
        const { x, z } = cellCenter(r, c);
        const p = phases[i];
        dummy.position.set(x, heightAt(r, c, t), z);
        dummy.rotation.set(Math.sin(t * 1.1 + p) * 0.025, 0, Math.cos(t * 0.9 + p) * 0.025);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Marca las casillas ya disparadas (Set de keys "r_c"). */
  function setShot(keys) {
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        mesh.setColorAt(r * GRID + c, keys.has(`${r}_${c}`) ? SHOT : WHITE);
      }
    }
    mesh.instanceColor.needsUpdate = true;
  }

  return {
    mesh,
    update,
    heightAt,
    setShot,
    dispose() { geo.dispose(); mat.dispose(); mesh.dispose(); },
  };
}
