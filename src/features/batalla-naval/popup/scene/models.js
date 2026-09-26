// Carga (una sola vez por popup) de los .glb low poly generados en Blender
// (assets/blender/build_models.py). Vite los emite como assets del paquete, asi
// que se piden por fetch al mismo origen de la extension (sin CSP extra).

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import shipS4Url from '../../assets/models/ship_s4.glb?url';
import shipS3Url from '../../assets/models/ship_s3.glb?url';
import shipS2aUrl from '../../assets/models/ship_s2a.glb?url';
import shipS2bUrl from '../../assets/models/ship_s2b.glb?url';
import mineUrl from '../../assets/models/mine.glb?url';
import ballUrl from '../../assets/models/cannonball.glb?url';

const SHIP_URLS = { s4: shipS4Url, s3: shipS3Url, s2a: shipS2aUrl, s2b: shipS2bUrl };

let cache = null;

/** Materiales compartidos por nombre (el fuego parpadea desde un solo lugar). */
export const sharedMaterials = new Map();

function prepare(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    m.flatShading = true;
    m.needsUpdate = true;
    if (m.name && !sharedMaterials.has(m.name)) sharedMaterials.set(m.name, m);
  });
  return root;
}

async function load(loader, url) {
  const gltf = await loader.loadAsync(url);
  return prepare(gltf.scene);
}

/**
 * @returns {Promise<{ ships: Record<string, import('three').Object3D>, mine: import('three').Object3D, ball: import('three').Object3D }>}
 */
export function loadModels() {
  if (!cache) {
    const loader = new GLTFLoader();
    cache = (async () => {
      const ids = Object.keys(SHIP_URLS);
      const [shipScenes, mine, ball] = await Promise.all([
        Promise.all(ids.map((id) => load(loader, SHIP_URLS[id]))),
        load(loader, mineUrl),
        load(loader, ballUrl),
      ]);
      const ships = {};
      ids.forEach((id, i) => { ships[id] = shipScenes[i]; });
      return { ships, mine, ball };
    })().catch((err) => {
      cache = null; // permitir reintento
      throw err;
    });
  }
  return cache;
}
