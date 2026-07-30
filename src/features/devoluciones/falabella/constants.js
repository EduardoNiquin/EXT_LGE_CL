// Constantes de "Devoluciones SellerCenter".
//
// La extensión hace de puente para el módulo de Devoluciones de la web
// https://147.93.176.66/web/sellercenter/devoluciones : selecciona los
// comprimidos (que la política de TI del PC bloquea en la web), los sube a la
// API y baja los resultados con chrome.downloads. La UI real sigue siendo la web;
// esta sección sólo aporta lo que el navegador no le deja hacer a la web (leer y
// escribir archivos en disco).

export const DEVO_FEATURE = 'seller-center-falabella:devoluciones';

// Base de la API y URL de la web (el content script las puede sobreescribir con
// las <meta> que publica el servidor — DEFAULT_* es sólo el respaldo).
export const DEFAULT_API_BASE = 'https://147.93.176.66/api/devoluciones-seller';
export const WEB_URL = 'https://147.93.176.66/web/sellercenter/devoluciones';

// Autenticación: cabecera en todas las llamadas menos `ping`.
export const TOKEN_HEADER = 'X-Pairing-Token';

// <meta> que la página de devoluciones publica en su HTML.
export const META_TOKEN = 'devoluciones-pairing-token';
export const META_BASE = 'devoluciones-api-base';

export const DEVO_STORAGE_KEYS = {
  PAIRING: `${DEVO_FEATURE}:pairing`,        // { token, base, ts }
  RUN:     `${DEVO_FEATURE}:run`,
  METHOD:  `${DEVO_FEATURE}:upload-method`,  // 'multipart' | 'base64'
};

// Vía de subida (§7/§9). `multipart` = /batches (rápida); `base64` = /uploads
// troceado (plan B, si la política bloquea las subidas de archivo).
export const UPLOAD_METHOD = {
  MULTIPART: 'multipart',
  BASE64: 'base64',
};

// Plan B: tamaño de trozo EN BYTES antes de codificar (por debajo del
// max_chunk_bytes por defecto de 4 MB; el server puede reducirlo en /uploads).
export const CHUNK_BYTES = 3_000_000;

// Prueba B del ping: sólo se envía una muestra (basta para saber si la vía
// base64 funciona; no hace falta codificar 200 MB).
export const PING_SAMPLE_BYTES = 256 * 1024;

// Mensajes popup/panel → service worker (el progreso vuelve por storage).
export const DEVO_MESSAGES = {
  START:  `${DEVO_FEATURE}:start`,  // arranca el polling + guardado en el SW
  CANCEL: `${DEVO_FEATURE}:cancel`,
};

// Alarma de respaldo: si el service worker se duerme/muere en mitad de un run,
// esto lo resucita y reanuda el polling desde el estado en storage.
export const DEVO_ALARM = `${DEVO_FEATURE}:poll`;

// Cadencia de sondeo mientras el SW está vivo. El loop interno usa este intervalo
// (< 30 s); la alarma (mínimo 30 s en MV3) sólo cubre el caso de resurrección.
export const POLL_INTERVAL_MS = 3000;
export const ALARM_PERIOD_MIN = 0.5;

// Subcarpeta dentro de Descargas donde se escriben los resultados.
export const DOWNLOAD_SUBDIR = 'devoluciones';

// Límites por defecto (se LEEN de /session; esto es sólo el fallback de UI).
export const DEFAULT_LIMITS = {
  max_archivos_por_carga: 25,
  max_mb_por_archivo: 200,
  extensiones: ['zip', 'rar', '7z'],
};

// Motivos de finalización del run (para el título del progreso).
export const DEVO_FINISH = {
  DONE:       'done',
  CANCELLED:  'cancelled',
  ERROR:      'error',
  UNPAIRED:   'unpaired',
};

// Motivo que la extensión reporta al servidor si falla el guardado en disco.
export const LOCAL_SAVE_ERROR = 'LOCAL_SAVE_ERROR';

export const LOG_CAP = 400;
