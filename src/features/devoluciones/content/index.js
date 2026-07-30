// Content script del apartado Devoluciones.
//
// Dos cosas, ninguna con UI propia:
//   - Emparejamiento: en la web del modulo lee las <meta> con el token de la
//     sesion, para que lo que suba la extension aparezca en la web del usuario.
//   - Gestion automatica: en las paginas de Falabella, ejecuta el flujo que le
//     indique el service worker (buscar la devolucion, apelar o levantar ticket).
//
// Al sumar Walmart/Paris: importar aqui el init de su carpeta.

import { initPairing } from '../falabella/content.js';
import { init as initGestionFalabella } from '../falabella/gestion/content/index.js';

export function init() {
  initPairing();
  initGestionFalabella();
}
