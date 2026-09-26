// Barcos en la escena: un clon del .glb por barco, orientado segun `dir` y
// centrado sobre sus casillas. Se balancean sobre el agua (mas que las casillas)
// y muestran el dano por seccion: `segN` <-> `segN_broken`, o `sunk` entero.

import { Group, MeshBasicMaterial } from 'three';
import { cellCenter, swell } from './layout.js';

// Desde una camara casi cenital el casco se ve angosto: se ensancha la manga y
// se sube un poco la altura (el largo sigue siendo 1 casilla por seccion).
const SHIP_SCALE_BEAM = 1.45;
const SHIP_SCALE_Y = 1.3;

/** Posicion del centro del barco y rotacion Y segun su orientacion. */
export function shipPlacement(ship) {
  const head = cellCenter(ship.r, ship.c);
  const off = (ship.size - 1) / 2;
  return ship.dir === 'v'
    ? { x: head.x, z: head.z + off, rotY: -Math.PI / 2 }
    : { x: head.x + off, z: head.z, rotY: 0 };
}

/** Indice de seccion (0 = popa = primera casilla) de la key "r_c" en el barco. */
export function segmentIndex(ship, key) {
  const [r, c] = key.split('_').map(Number);
  return ship.dir === 'v' ? r - ship.r : c - ship.c;
}

function nodes(model, size) {
  const segs = [];
  for (let i = 0; i < size; i++) {
    segs.push({ ok: model.getObjectByName(`seg${i}`), broken: model.getObjectByName(`seg${i}_broken`) });
  }
  return { segs, sunk: model.getObjectByName('sunk') };
}

/**
 * @param {import('three').Object3D} template  escena del .glb del tipo de barco
 * @param {{ id, size, r, c, dir }} ship
 */
export function createShip(template, ship) {
  const outer = new Group();
  const inner = new Group();
  const model = template.clone(true);
  model.scale.set(1, SHIP_SCALE_Y, SHIP_SCALE_BEAM);
  inner.add(model);
  outer.add(inner);
  const { x, z, rotY } = shipPlacement(ship);
  outer.position.set(x, 0, z);
  outer.rotation.y = rotY;

  const { segs, sunk } = nodes(model, ship.size);
  const phase = (ship.r * 1.7 + ship.c * 2.3) % 6.28;
  let isSunk = false;

  /** @param {Set<number>} broken indices de secciones rotas; @param {boolean} sunkNow */
  function apply(broken, sunkNow) {
    isSunk = sunkNow;
    segs.forEach((s, i) => {
      if (s.ok) s.ok.visible = !sunkNow && !broken.has(i);
      if (s.broken) s.broken.visible = !sunkNow && broken.has(i);
    });
    if (sunk) sunk.visible = sunkNow;
  }
  apply(new Set(), false);

  // Ejes del barco en el mundo (largo y manga) para leer la pendiente de la ola.
  const half = ship.size / 2;
  const ax = { x: Math.cos(rotY), z: -Math.sin(rotY) };
  const bx = { x: Math.sin(rotY), z: Math.cos(rotY) };
  const BEAM = 0.45;

  function update(t) {
    const h = swell(x, z, t);
    const bow = swell(x + ax.x * half, z + ax.z * half, t);
    const stern = swell(x - ax.x * half, z - ax.z * half, t);
    const port = swell(x + bx.x * BEAM, z + bx.z * BEAM, t);
    const starboard = swell(x - bx.x * BEAM, z - bx.z * BEAM, t);
    // Pendiente de la ola bajo el casco (los barcos chicos la sienten mas).
    const wavePitch = Math.atan2(bow - stern, ship.size);
    const waveRoll = -Math.atan2(port - starboard, BEAM * 2);
    const light = 1 + (4 - ship.size) * 0.18;

    if (isSunk) {
      // Hundido: se mece pesado y mas abajo, escorado por el agua que embarco.
      inner.position.y = h * 0.8 - 0.05;
      inner.rotation.z = wavePitch * 0.5;
      inner.rotation.x = waveRoll * 0.5 + Math.sin(t * 0.5 + phase) * 0.03;
      inner.rotation.y = 0;
      return;
    }
    // Arfada: sube y baja con la ola + un vaiven propio.
    inner.position.y = h * 1.05 + Math.sin(t * 1.35 + phase) * 0.03 * light;
    // Cabeceo (proa/popa) y rolido (bandas): ola + oscilacion propia desfasada.
    inner.rotation.z = wavePitch * 1.2 + Math.sin(t * 0.85 + phase * 1.3) * 0.045 * light;
    inner.rotation.x = waveRoll * 1.1
      + (Math.sin(t * 1.15 + phase) * 0.1 + Math.sin(t * 2.3 + phase * 0.7) * 0.025) * light;
    // Leve deriva de rumbo (guinada).
    inner.rotation.y = Math.sin(t * 0.4 + phase) * 0.04;
  }

  return { object: outer, apply, update };
}

/**
 * Fantasma translucido del barco en mano (despliegue). Verde si cabe, rojo si no.
 */
export function createGhostShip(template, size) {
  const mat = new MeshBasicMaterial({ color: '#4caf50', transparent: true, opacity: 0.55, depthWrite: false });
  const model = template.clone(true);
  model.scale.set(1, SHIP_SCALE_Y, SHIP_SCALE_BEAM);
  model.traverse((o) => { if (o.isMesh) o.material = mat; });
  const { segs, sunk } = nodes(model, size);
  segs.forEach((s) => { if (s.broken) s.broken.visible = false; });
  if (sunk) sunk.visible = false;
  const outer = new Group();
  outer.add(model);
  outer.renderOrder = 5;
  return {
    object: outer,
    place(ship, ok) {
      const { x, z, rotY } = shipPlacement(ship);
      outer.position.set(x, 0.1, z);
      outer.rotation.y = rotY;
      mat.color.set(ok ? '#4caf50' : '#e53935');
    },
    dispose() { mat.dispose(); },
  };
}
