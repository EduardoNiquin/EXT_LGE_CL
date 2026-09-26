// Camara casi cenital: inclinada TILT_DEG respecto de la vertical, mirando al
// centro del tablero. El encuadre se ajusta al aspect ratio para que las 16x16
// casillas llenen la vista con un margen minimo (el "zoom").

import { PerspectiveCamera, MathUtils } from 'three';
import { HALF } from './layout.js';

const TILT_DEG = 20;
const FOV = 34;
const MARGIN = 0.35; // casillas de aire alrededor del tablero

export function createCamera() {
  const cam = new PerspectiveCamera(FOV, 1, 0.5, 200);
  return cam;
}

/** Recoloca la camara para el aspect ratio dado. */
export function fitCamera(cam, aspect) {
  cam.aspect = aspect;
  const tilt = MathUtils.degToRad(TILT_DEG);
  const vHalf = MathUtils.degToRad(FOV / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const half = HALF + MARGIN;
  // Distancia para que entre de ancho (el borde cercano es el mas ancho en
  // pantalla: se compensa con un poco de holgura) y de alto (proyeccion del
  // tablero inclinado + altura de mastiles al fondo).
  const dW = (half * 1.04) / Math.tan(hHalf) + half * Math.sin(tilt);
  const dH = (half * Math.cos(tilt) + 0.6 * Math.sin(tilt)) / Math.tan(vHalf) + half * Math.sin(tilt);
  const d = Math.max(dW, dH);
  cam.position.set(0, d * Math.cos(tilt), d * Math.sin(tilt));
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
}
