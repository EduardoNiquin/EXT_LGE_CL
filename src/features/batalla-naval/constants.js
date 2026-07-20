// Constantes del feature "BATALLA NAVAL" (multijugador, secreto).
//
// Es una feature SOLO de popup (sin content script): el matchmaking y la
// partida corren mientras el popup/sidepanel esta abierto, contra Firebase
// Realtime Database via su API REST (no se usa el SDK: el CSP estricto
// `script-src 'self'` impediria cargarlo). El estado "de lo que el usuario ve"
// se persiste en chrome.storage.local; la verdad de la partida vive en Firebase.

// --- Firebase Realtime Database ---------------------------------------------
// Reglas abiertas (read/write true en presence/matchmaking/games), asi que la
// API REST funciona sin token de auth. host_permissions: <all_urls> cubre el
// fetch cross-origin.
export const RTDB_BASE = 'https://obs-ext-default-rtdb.firebaseio.com';

// Config completa (referencia; solo usamos databaseURL via RTDB_BASE).
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyADWm_wCP0cMCNqNg8_XwW2B00lm86OOr0',
  authDomain: 'obs-ext.firebaseapp.com',
  projectId: 'obs-ext',
  storageBucket: 'obs-ext.firebasestorage.app',
  messagingSenderId: '1045555957180',
  appId: '1:1045555957180:web:be6d648cdb9a21a0adafb9',
  measurementId: 'G-C57BE6HBWX',
};

// --- Storage (chrome.storage.local) -----------------------------------------
// NOTA: las claves conservan a proposito el prefijo legacy "gato" para no
// invalidar el estado ya guardado de quienes desbloquearon el secreto antes
// del rename a "Batalla Naval" (mantiene su identidad y desbloqueo).
export const STORAGE_KEYS = {
  RUN: 'gato:run',          // estado de lo que el usuario esta viendo (persistido)
  DRAFT: 'gato:draft',      // { name } recordado entre sesiones
};

// Flag de desbloqueo del "secreto" (localStorage, sincrono para el arranque).
export const UNLOCK_KEY = 'ext:gato-unlocked';
// Identidad estable del jugador (localStorage).
export const UID_KEY = 'ext:gato-uid';
// Cantidad de clics seguidos en el toggle de tema para desbloquear.
export const UNLOCK_CLICKS = 10;
// Ventana (ms) entre clics para considerarlos "seguidos".
export const UNLOCK_WINDOW_MS = 1500;

// --- Maquina de estados de la vista -----------------------------------------
export const PHASE = {
  IDLE: 'idle',                 // pantalla de nombre + buscar
  SEARCHING: 'searching',       // "Buscando rivales..." + lista de jugadores
  CHALLENGED: 'challenged',     // "X te ha retado" (forzado a jugar)
  PLAYING: 'playing',           // partida en curso (despliegue o batalla)
  FINISHED: 'finished',         // resultado (ganador) multijugador
  LEADERBOARD: 'leaderboard',   // tabla de clasificaciones
};

// Estado de una partida en Firebase.
export const GAME_STATUS = {
  PLACING: 'placing',   // ambos jugadores colocando barcos y bombas
  PLAYING: 'playing',   // batalla por turnos
  FINISHED: 'finished',
};

// Roles. P1 = jugador con uid menor (orden lexicografico); P2 = uid mayor.
export const ROLE = { P1: 'P1', P2: 'P2' };

// --- Reglas del tablero ------------------------------------------------------
// Tablero COMPARTIDO de 16x16: ambos jugadores despliegan su flota en el mismo
// mapa (ocultos entre si) y disparan a cualquier casilla. Asi las bombas
// (trampas) del rival pueden danar a los barcos de quien las detona.
export const GRID = 16;

// Flota de cada jugador: 1 barco 4x1, 1 barco 3x1 y 2 barcos 2x1.
export const FLEET = [
  { id: 's4', size: 4 },
  { id: 's3', size: 3 },
  { id: 's2a', size: 2 },
  { id: 's2b', size: 2 },
];

// Bombas (trampas de 1 casilla) por jugador. Solo las ve su dueno hasta que
// explotan; al dispararle a una, explota en un area 3x3 (recortada en bordes y
// esquinas) y dana UNICAMENTE a los barcos del jugador que disparo.
export const BOMBS_PER_PLAYER = 2;

// Tiempo por turno (ms). Al agotarse pasa el turno.
export const TURN_MS = 30000;

// Presencia: se considera activo un jugador con heartbeat reciente.
export const PRESENCE_FRESH_MS = 30000;   // ventana de "activo"
export const PRESENCE_BEAT_MS = 10000;    // cada cuanto refrescamos nuestro ts
// Ticket de matchmaking valido (ts reciente) para emparejar / listar.
export const TICKET_FRESH_MS = 20000;
// Cadencia de polling de matchmaking y de la partida.
export const POLL_MS = 1000;
// Cadencia (mas lenta) para refrescar la lista de jugadores buscando.
export const SEARCHERS_POLL_MS = 1500;

// Nodo del ranking global (persistente, visible para todos). Se indexa por el
// nombre normalizado (minusculas, sin acentos), asi "Pedro08" == "pedro08".
export const LEADERBOARD_PATH = 'leaderboard';

export const LOG_CAP = 200;

// --- Logo del gato (SVG limpio) ---------------------------------------------
// Twemoji "cat face" (CC-BY 4.0, Twitter). Limpiado: sin comentarios, sin
// xmlns:xlink/aria/class/preserveAspectRatio; viewBox conservado para escalar.
export const CAT_SVG_PATHS = `
<path fill="#FFCC4D" d="M32.348 13.999s3.445-8.812 1.651-11.998c-.604-1.073-8 1.998-10.723 5.442c0 0-2.586-.86-5.276-.86s-5.276.86-5.276.86C10.001 3.999 2.605.928 2.001 2.001C.207 5.187 3.652 13.999 3.652 13.999c-.897 1.722-1.233 4.345-1.555 7.16c-.354 3.086.35 5.546.658 6.089c.35.617 2.123 2.605 4.484 4.306c3.587 2.583 8.967 3.445 10.761 3.445s7.174-.861 10.761-3.445c2.361-1.701 4.134-3.689 4.484-4.306c.308-.543 1.012-3.003.659-6.089c-.324-2.814-.659-5.438-1.556-7.16z"/>
<path fill="#F18F26" d="M2.359 2.971c.2-.599 5.348 2.173 6.518 5.404c0 0-3.808 2.624-4.528 4.624c0 0-2.99-7.028-1.99-10.028z"/>
<path fill="#FFCC4D" d="M5.98 7.261c0-1.414 5.457 2.733 4.457 3.733s-1.255.72-2.255 1.72S5.98 8.261 5.98 7.261z"/>
<path fill="#F18F26" d="M33.641 2.971c-.2-.599-5.348 2.173-6.518 5.404c0 0 3.808 2.624 4.528 4.624c0 0 2.99-7.028 1.99-10.028z"/>
<path fill="#FFCC4D" d="M30.02 7.261c0-1.414-5.457 2.733-4.457 3.733s1.255.72 2.255 1.72s2.202-4.453 2.202-5.453z"/>
<path fill="#292F33" d="M14.001 20.001a2 2 0 1 1-3.998 0A2 2 0 0 1 14 20zm11.998 0a2 2 0 1 1-3.998 0a2 2 0 0 1 3.998 0z"/>
<path fill="#FEE7B8" d="M2.201 30.458a.5.5 0 0 1-.31-.892c.162-.127 4.02-3.12 10.648-2.605a.5.5 0 0 1 .46.536c-.021.275-.257.501-.537.46c-6.233-.474-9.915 2.366-9.951 2.395a.516.516 0 0 1-.31.106zm8.868-4.663a.512.512 0 0 1-.149-.022c-4.79-1.497-8.737-.347-8.777-.336a.499.499 0 1 1-.288-.957c.173-.052 4.286-1.247 9.362.338a.5.5 0 0 1-.148.977zm22.73 4.663a.5.5 0 0 0 .31-.892c-.162-.127-4.02-3.12-10.648-2.605a.5.5 0 0 0-.46.536c.022.275.257.501.537.46c6.233-.474 9.915 2.366 9.951 2.395c.093.07.202.106.31.106zm-8.868-4.663c.049 0 .1-.007.149-.022c4.79-1.497 8.737-.347 8.777-.336a.499.499 0 1 0 .288-.957c-.173-.052-4.286-1.247-9.362.338a.5.5 0 0 0 .148.977z"/>
<path fill="#67757F" d="M24.736 30.898a.5.5 0 0 0-.643-.294c-.552.206-1.076.311-1.559.311c-1.152 0-1.561-.306-2.033-.659c-.451-.338-.956-.715-1.99-.803v-2.339a.5.5 0 0 0-1 0v2.373c-.81.115-1.346.439-1.816.743c-.568.367-1.059.685-2.083.685c-.482 0-1.006-.104-1.558-.311a.501.501 0 0 0-.35.938c.664.247 1.306.373 1.907.373c1.319 0 2.014-.449 2.627-.845c.524-.339.98-.631 1.848-.635c.992.008 1.358.278 1.815.621c.538.403 1.147.859 2.633.859c.601 0 1.244-.126 1.908-.373a.5.5 0 0 0 .294-.644z"/>
<path fill="#E75A70" d="M19.4 24.807h-2.8c-.64 0-1.163.523-1.163 1.163c0 .639.523 1.163 1.163 1.163h.237v.345c0 .639.523 1.163 1.163 1.163s1.163-.523 1.163-1.163v-.345h.237c.639 0 1.163-.523 1.163-1.163s-.524-1.163-1.163-1.163z"/>
<path fill="#F18F26" d="M18.022 17.154a.5.5 0 0 1-.5-.5V8.37a.5.5 0 0 1 1 0v8.284c0 .277-.223.5-.5.5zM21 15.572a.5.5 0 0 1-.5-.5c0-2.882 1.232-5.21 1.285-5.308a.5.5 0 0 1 .881.473c-.012.021-1.166 2.213-1.166 4.835a.5.5 0 0 1-.5.5zm-6 0a.5.5 0 0 1-.5-.5c0-2.623-1.155-4.814-1.167-4.835a.501.501 0 0 1 .881-.473c.053.098 1.285 2.426 1.285 5.308a.499.499 0 0 1-.499.5z"/>
`.trim();

/** SVG completo del gato a un tamano dado (px). */
export function catSvg(size = 22) {
  return `<svg viewBox="0 0 36 36" width="${size}" height="${size}" fill="none" aria-hidden="true">${CAT_SVG_PATHS}</svg>`;
}

// --- Logo del barco (SVG simple, hecho a mano) --------------------------------
export const SHIP_SVG_PATHS = `
<rect fill="#78909c" x="30" y="4" width="4" height="10"/>
<rect fill="#90a4ae" x="24" y="14" width="16" height="8" rx="1"/>
<rect fill="#78909c" x="14" y="20" width="8" height="4"/>
<rect fill="#78909c" x="8" y="21" width="6" height="2"/>
<path fill="#546e7a" d="M4 26h56l-8 12H12z"/>
<circle fill="#cfd8dc" cx="20" cy="31" r="1.5"/>
<circle fill="#cfd8dc" cx="28" cy="31" r="1.5"/>
<circle fill="#cfd8dc" cx="36" cy="31" r="1.5"/>
<circle fill="#cfd8dc" cx="44" cy="31" r="1.5"/>
<path stroke="#4fc3f7" stroke-width="2" stroke-linecap="round" fill="none" d="M2 41q4-3 8 0t8 0t8 0t8 0t8 0t8 0t8 0"/>
`.trim();

/** SVG completo del barco a un tamano dado (px de ancho). */
export function shipSvg(size = 22) {
  return `<svg viewBox="0 0 64 44" width="${size}" height="${Math.round(size * 0.69)}" fill="none" aria-hidden="true">${SHIP_SVG_PATHS}</svg>`;
}
