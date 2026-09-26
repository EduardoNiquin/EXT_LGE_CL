// Mira de disparo: circulo rojo con una X dentro, apoyada sobre la casilla bajo
// el mouse (sigue su flotacion). Solo se muestra donde se puede disparar.

import { Group, Mesh, RingGeometry, PlaneGeometry, MeshBasicMaterial, DoubleSide } from 'three';
import { cellCenter } from './layout.js';

export function createReticle() {
  const mat = new MeshBasicMaterial({ color: '#e53935', side: DoubleSide, transparent: true, opacity: 0.95, depthTest: false });
  const ringGeo = new RingGeometry(0.34, 0.42, 20);
  const barGeo = new PlaneGeometry(0.52, 0.07);
  const g = new Group();
  const ring = new Mesh(ringGeo, mat);
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new Mesh(barGeo, mat);
    bar.rotation.set(-Math.PI / 2, 0, a);
    g.add(bar);
  }
  g.traverse((o) => { o.renderOrder = 10; });
  g.visible = false;
  let cell = null;

  return {
    object: g,
    show(r, c) {
      cell = { r, c };
      const { x, z } = cellCenter(r, c);
      g.position.x = x;
      g.position.z = z;
      g.visible = true;
    },
    hide() { cell = null; g.visible = false; },
    update(t, heightAt) {
      if (!cell) return;
      g.position.y = heightAt(cell.r, cell.c, t) + 0.03;
      const pulse = 1 + Math.sin(t * 6) * 0.04;
      g.scale.set(pulse, 1, pulse);
    },
    dispose() { mat.dispose(); ringGeo.dispose(); barGeo.dispose(); },
  };
}
