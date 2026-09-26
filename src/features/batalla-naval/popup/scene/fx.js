// Efectos efimeros low poly (todos terminan en <= 1.5 s):
//   impact    impacto en un barco: bola de fuego, astillas que saltan, columna
//             de humo y anillo de agua. Tapa la casilla a SMOKE_COVER_MS.
//   explosion mina: lo mismo mas grande, con destello y humo negro.
//   smoke     solo humo (se usa para cubrir el casco al hundirse).
//   splash    disparo al agua: gotas en arco + anillo.
// Cada efecto vive en `active` hasta que termina. `shake(now)` da cuanto debe
// temblar la camara (lo aplica board3d).

import {
  Group, Mesh, IcosahedronGeometry, RingGeometry, BoxGeometry, TetrahedronGeometry,
  MeshStandardMaterial, MeshBasicMaterial, DoubleSide, Color,
} from 'three';
import { cellCenter } from './layout.js';

export const SMOKE_MS = 1500;
/** Momento del efecto en que ya tapa la casilla: ahi se cambia el modelo. */
export const SMOKE_COVER_MS = 350;

const puffGeo = new IcosahedronGeometry(1, 0);
const fireGeo = new TetrahedronGeometry(1, 0);
const debrisGeo = new BoxGeometry(1, 1, 1);
const dropGeo = new IcosahedronGeometry(0.035, 0);
const ringGeo = new RingGeometry(0.2, 0.27, 14);

const FIRE_COLORS = ['#fff3b0', '#ffd54f', '#ffa726', '#ff7043', '#e64a19'].map((c) => new Color(c));
const EMBER = new Color('#5d1f0a');

function rand(a, b) { return a + Math.random() * (b - a); }
function clamp01(k) { return Math.max(0, Math.min(1, k)); }

export function createFx() {
  const root = new Group();
  const active = [];
  let shakeUntil = 0;
  let shakeAmp = 0;

  function add(fx) {
    root.add(fx.object);
    active.push(fx);
  }

  function kick(amp, ms) {
    const now = performance.now();
    shakeAmp = Math.max(amp, now < shakeUntil ? shakeAmp : 0);
    shakeUntil = Math.max(shakeUntil, now + ms);
  }

  /** Columna de humo: crece rapido, sube y se disipa en SMOKE_MS. */
  function smoke(r, c, { scale = 1, dark = false, count = 20, lag = 0 } = {}) {
    const { x, z } = cellCenter(r, c);
    const g = new Group();
    g.position.set(x, 0.2, z);
    const puffs = [];
    for (let i = 0; i < count; i++) {
      const tone = dark ? rand(0.12, 0.3) : rand(0.45, 0.8);
      const mat = new MeshStandardMaterial({
        color: new Color(tone, tone, tone * 1.03),
        flatShading: true, transparent: true, opacity: 0.95, depthWrite: false, roughness: 1,
      });
      const m = new Mesh(puffGeo, mat);
      const a = (i / count) * Math.PI * 2 + rand(-0.3, 0.3);
      const rad = rand(0.05, 0.42) * scale;
      puffs.push({
        m, mat,
        ox: Math.cos(a) * rad, oz: Math.sin(a) * rad,
        rise: rand(0.5, 1.5) * scale,
        drift: rand(0.1, 0.35) * scale,
        size: rand(0.26, 0.5) * scale,
        delay: lag + rand(0, 180),
        spin: rand(-2.5, 2.5),
      });
      m.scale.setScalar(0.001);
      m.renderOrder = 6;
      g.add(m);
    }
    const start = performance.now();
    add({
      object: g,
      update(now) {
        const el = now - start;
        for (const p of puffs) {
          const k = clamp01((el - p.delay) / (SMOKE_MS - p.delay));
          const grow = Math.min(1, k / 0.2);
          p.m.scale.setScalar(Math.max(0.001, p.size * (0.35 + 0.65 * grow) * (1 + k * 0.8)));
          // Sube desacelerando y se abre; el viento lo corre un poco hacia +x.
          const up = 1 - (1 - k) * (1 - k);
          p.m.position.set(p.ox * (1 + k * 1.4) + p.drift * k, p.rise * up, p.oz * (1 + k * 1.4));
          p.m.rotation.set(k * p.spin, k * p.spin * 0.7, 0);
          p.mat.opacity = k < 0.5 ? 0.9 : 0.9 * (1 - (k - 0.5) / 0.5);
        }
        return el < SMOKE_MS;
      },
      dispose() { puffs.forEach((p) => p.mat.dispose()); },
    });
  }

  /** Bola de fuego: tetraedros que brotan, suben y pasan de amarillo a brasa. */
  function fireball(r, c, { scale = 1, count = 16, dur = 900 } = {}) {
    const { x, z } = cellCenter(r, c);
    const g = new Group();
    g.position.set(x, 0.22, z);
    const flames = [];
    for (let i = 0; i < count; i++) {
      const mat = new MeshBasicMaterial({ color: FIRE_COLORS[i % FIRE_COLORS.length].clone(), transparent: true, depthWrite: false });
      const m = new Mesh(fireGeo, mat);
      const a = rand(0, Math.PI * 2);
      const sp = rand(0.3, 1.1) * scale;
      flames.push({
        m, mat,
        vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: rand(0.6, 1.8) * scale,
        size: rand(0.2, 0.42) * scale,
        base: mat.color.clone(),
        spin: rand(-6, 6),
        delay: rand(0, 90),
      });
      m.renderOrder = 9;
      g.add(m);
    }
    const start = performance.now();
    add({
      object: g,
      update(now) {
        const el = now - start;
        for (const f of flames) {
          const k = clamp01((el - f.delay) / dur);
          const s = k * dur / 1000;
          f.m.position.set(f.vx * s, f.vy * s - 0.6 * s * s, f.vz * s);
          const pop = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
          f.m.scale.setScalar(Math.max(0.001, f.size * (0.4 + pop)));
          f.m.rotation.set(k * f.spin, k * f.spin * 0.8, k * f.spin * 0.5);
          f.mat.color.copy(f.base).lerp(EMBER, clamp01((k - 0.35) / 0.65));
          f.mat.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
        }
        return el < dur + 100;
      },
      dispose() { flames.forEach((f) => f.mat.dispose()); },
    });
  }

  /** Astillas de casco que saltan girando y caen al agua. */
  function debris(r, c, { scale = 1, count = 9 } = {}) {
    const { x, z } = cellCenter(r, c);
    const g = new Group();
    g.position.set(x, 0.25, z);
    const mat = new MeshStandardMaterial({ color: '#3a2716', flatShading: true, roughness: 0.9 });
    const burnt = new MeshStandardMaterial({ color: '#151210', flatShading: true, roughness: 1 });
    const bits = [];
    for (let i = 0; i < count; i++) {
      const m = new Mesh(debrisGeo, i % 3 ? mat : burnt);
      m.scale.set(rand(0.05, 0.16) * scale, rand(0.02, 0.04) * scale, rand(0.03, 0.06) * scale);
      const a = rand(0, Math.PI * 2);
      const sp = rand(0.8, 2.0) * scale;
      bits.push({ m, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: rand(1.6, 3.0) * scale, spin: rand(-12, 12) });
      g.add(m);
    }
    const start = performance.now();
    const DUR = 1200;
    add({
      object: g,
      update(now) {
        const s = (now - start) / 1000;
        for (const b of bits) {
          const y = b.vy * s - 5.5 * s * s;
          b.m.position.set(b.vx * s, Math.max(-0.35, y), b.vz * s);
          b.m.rotation.set(s * b.spin, s * b.spin * 0.6, s * b.spin * 0.3);
        }
        return now - start < DUR;
      },
      dispose() { mat.dispose(); burnt.dispose(); },
    });
  }

  /** Anillo de agua que se abre (onda de la explosion o del disparo). */
  function ring(r, c, { scale = 1, dur = 650, color = '#ffffff' } = {}) {
    const { x, z } = cellCenter(r, c);
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false });
    const m = new Mesh(ringGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.12, z);
    const start = performance.now();
    add({
      object: m,
      update(now) {
        const k = (now - start) / dur;
        m.scale.setScalar(scale * (1 + k * 3));
        mat.opacity = 0.8 * (1 - k);
        return k < 1;
      },
      dispose() { mat.dispose(); },
    });
  }

  /** Destello blanco-amarillo que se infla y se apaga. */
  function flash(r, c, { scale = 1, dur = 380 } = {}) {
    const { x, z } = cellCenter(r, c);
    const mat = new MeshBasicMaterial({ color: '#fff8e1', transparent: true, depthWrite: false });
    const core = new Mesh(puffGeo, mat);
    core.position.set(x, 0.3, z);
    core.renderOrder = 8;
    const start = performance.now();
    add({
      object: core,
      update(now) {
        const k = (now - start) / dur;
        core.scale.setScalar(scale * (0.15 + 0.75 * Math.min(1, k * 2.2)));
        mat.color.set(k < 0.35 ? '#fff8e1' : '#ffb300');
        mat.opacity = Math.max(0, 1 - k);
        return k < 1;
      },
      dispose() { mat.dispose(); },
    });
  }

  /** Impacto de canon en un barco. */
  function impact(r, c, { scale = 1 } = {}) {
    flash(r, c, { scale: 0.7 * scale });
    fireball(r, c, { scale: 1.2 * scale, count: 20, dur: 1000 });
    debris(r, c, { scale });
    smoke(r, c, { scale: 1.15 * scale, lag: 160 });
    smoke(r, c, { scale: 0.8 * scale, dark: true, count: 10, lag: 60 });
    ring(r, c, { scale: 1.2 * scale });
    kick(0.06 * scale, 320);
  }

  /** Mina que explota: mas grande, con humo negro. */
  function explosion(r, c) {
    flash(r, c, { scale: 1.4, dur: 450 });
    fireball(r, c, { scale: 1.8, count: 28, dur: 1100 });
    debris(r, c, { scale: 1.2, count: 12 });
    smoke(r, c, { scale: 1.7, dark: true, count: 26, lag: 180 });
    ring(r, c, { scale: 2, dur: 800 });
    kick(0.12, 450);
  }

  /** Salpicadura: gotas en arco + anillo (disparo al agua). */
  function splash(r, c) {
    const { x, z } = cellCenter(r, c);
    const g = new Group();
    g.position.set(x, 0.12, z);
    const dropMat = new MeshBasicMaterial({ color: '#e3f4ff', transparent: true, opacity: 0.95 });
    const drops = [];
    for (let i = 0; i < 10; i++) {
      const m = new Mesh(dropGeo, dropMat);
      const a = (i / 10) * Math.PI * 2 + rand(-0.3, 0.3);
      drops.push({ m, vx: Math.cos(a) * rand(0.3, 0.8), vz: Math.sin(a) * rand(0.3, 0.8), vy: rand(1.6, 2.6) });
      g.add(m);
    }
    const start = performance.now();
    const DUR = 700;
    add({
      object: g,
      update(now) {
        const el = now - start;
        const s = el / 1000;
        for (const d of drops) {
          const y = d.vy * s - 4.5 * s * s;
          d.m.position.set(d.vx * s, Math.max(-0.1, y), d.vz * s);
        }
        dropMat.opacity = 0.95 * (1 - Math.max(0, el / DUR - 0.5) * 2);
        return el < DUR;
      },
      dispose() { dropMat.dispose(); },
    });
    ring(r, c);
  }

  function update(now) {
    for (let i = active.length - 1; i >= 0; i--) {
      const fx = active[i];
      if (!fx.update(now)) {
        root.remove(fx.object);
        fx.dispose();
        active.splice(i, 1);
      }
    }
  }

  /** Desplazamiento de camara (temblor que decae). */
  function shake(now) {
    if (now >= shakeUntil) return 0;
    const left = (shakeUntil - now) / 400;
    return shakeAmp * Math.min(1, left);
  }

  function dispose() {
    for (const fx of active) fx.dispose();
    active.length = 0;
    for (const geo of [puffGeo, fireGeo, debrisGeo, dropGeo, ringGeo]) geo.dispose();
  }

  return { object: root, smoke, impact, explosion, splash, update, shake, dispose };
}
