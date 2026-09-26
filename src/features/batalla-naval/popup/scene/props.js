// Objetos chicos del tablero: minas (flotan y giran), balas hundidas en las
// casillas de agua, restos en llamas (impactos a barcos rivales aun ocultos) y
// la mancha quemada donde exploto una mina.

import {
  Group, Mesh, BoxGeometry, ConeGeometry, CircleGeometry,
  MeshStandardMaterial, MeshBasicMaterial,
} from 'three';
import { cellCenter, cellPhase, swell } from './layout.js';

// Geometrias/materiales compartidos por todas las instancias (se liberan en disposeProps).
const plankGeo = new BoxGeometry(0.22, 0.03, 0.06);
const flameGeo = new ConeGeometry(0.06, 0.16, 4);
const scorchGeo = new CircleGeometry(0.38, 7);
const plankMat = new MeshStandardMaterial({ color: '#2a2019', flatShading: true, roughness: 0.9 });
const flameMat = new MeshBasicMaterial({ color: '#ff8a1f' });
const scorchMat = new MeshBasicMaterial({ color: '#10171c', transparent: true, opacity: 0.45, depthWrite: false });

export function disposeProps() {
  for (const x of [plankGeo, flameGeo, scorchGeo, plankMat, flameMat, scorchMat]) x.dispose();
}

/** Mina: flota a media agua, gira sobre si misma y cabecea un poco. */
export function createMine(template, r, c, { ghost = false } = {}) {
  const { x, z } = cellCenter(r, c);
  const outer = new Group();
  const spin = template.clone(true);
  spin.scale.setScalar(1.35);
  outer.add(spin);
  outer.position.set(x, 0, z);
  let ghostMat = null;
  if (ghost) {
    ghostMat = new MeshBasicMaterial({ color: '#4caf50', transparent: true, opacity: 0.55, depthWrite: false });
    spin.traverse((o) => { if (o.isMesh) o.material = ghostMat; });
  }
  const phase = cellPhase(r, c);
  return {
    object: outer,
    update(t) {
      outer.position.y = 0.06 + swell(x, z, t) + Math.sin(t * 1.6 + phase) * 0.025;
      spin.rotation.y = t * 0.9 + phase;
      spin.rotation.x = Math.sin(t * 1.1 + phase) * 0.18;
      spin.rotation.z = Math.cos(t * 0.9 + phase) * 0.12;
    },
    moveTo(rr, cc, ok) {
      const p = cellCenter(rr, cc);
      outer.position.x = p.x;
      outer.position.z = p.z;
      if (ghostMat) ghostMat.color.set(ok ? '#4caf50' : '#e53935');
    },
    dispose() { ghostMat?.dispose(); },
  };
}

/** Bala de canon hundida (disparo al agua): asoma apenas entre las olas. */
export function createBall(template, r, c) {
  const { x, z } = cellCenter(r, c);
  const obj = template.clone(true);
  obj.position.set(x + 0.12, -0.05, z - 0.1);
  obj.scale.setScalar(1.15);
  return {
    object: obj,
    update(t) { obj.position.y = -0.04 + swell(x, z, t) * 0.5; },
  };
}

/** Restos en llamas: marca un impacto en un barco rival que sigue oculto. */
export function createWreck(r, c) {
  const { x, z } = cellCenter(r, c);
  const g = new Group();
  const planks = [];
  for (let i = 0; i < 3; i++) {
    const p = new Mesh(plankGeo, plankMat);
    p.position.set((i - 1) * 0.1, 0, ((i * 37) % 3 - 1) * 0.08);
    p.rotation.y = i * 1.1;
    planks.push(p);
    g.add(p);
  }
  const flames = [0, 1].map((i) => {
    const f = new Mesh(flameGeo, flameMat);
    f.position.set(i ? 0.07 : -0.05, 0.09, i ? -0.03 : 0.04);
    g.add(f);
    return f;
  });
  g.position.set(x, 0, z);
  const phase = cellPhase(r, c);
  return {
    object: g,
    update(t) {
      g.position.y = 0.02 + swell(x, z, t);
      g.rotation.y = Math.sin(t * 0.4 + phase) * 0.3;
      flames.forEach((f, i) => {
        const k = 0.8 + 0.35 * Math.abs(Math.sin(t * (9 + i * 3) + phase));
        f.scale.set(1, k, 1);
      });
    },
  };
}

/** Mancha quemada sobre el agua donde exploto una mina. */
export function createScorch(r, c) {
  const { x, z } = cellCenter(r, c);
  const m = new Mesh(scorchGeo, scorchMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.07, z);
  m.renderOrder = 1;
  return {
    object: m,
    update(t) { m.position.y = 0.07 + swell(x, z, t); },
  };
}
