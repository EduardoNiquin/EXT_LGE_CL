// Registro de acciones — constantes.
//
// Grabador de lo que hace el usuario en el navegador, pensado para que despues
// una IA lea el archivo y proponga como automatizar ese proceso manual.

export const FEATURE_ID = 'registro-acciones';

export const STORAGE_KEYS = {
  RUN: `${FEATURE_ID}:run`,
  OPCIONES: `${FEATURE_ID}:opciones`,
};

/** Canales persistentes con el service worker. */
export const PORTS = {
  EVENTOS: `${FEATURE_ID}:eventos`,   // content -> SW, un port por frame activo
  PANEL: `${FEATURE_ID}:panel`,       // popup <-> SW, feed en vivo
};

/** Mensajes one-shot popup -> service worker. */
export const MESSAGES = {
  INICIAR: `${FEATURE_ID}:iniciar`,
  PAUSAR: `${FEATURE_ID}:pausar`,
  REANUDAR: `${FEATURE_ID}:reanudar`,
  DETENER: `${FEATURE_ID}:detener`,
  DESCARTAR: `${FEATURE_ID}:descartar`,
  EXPORTAR: `${FEATURE_ID}:exportar`,
  ESTADO: `${FEATURE_ID}:estado`,
  ULTIMOS: `${FEATURE_ID}:ultimos`,
};

/**
 * Catalogo de eventos. El valor es el que se escribe en el archivo, asi que se
 * mantiene corto y en espanol: lo va a leer tanto una persona como una IA.
 */
export const TIPOS = {
  // Sesion (los emite el service worker)
  SESION_INICIO: 'sesion.inicio',
  SESION_PAUSA: 'sesion.pausa',
  SESION_REANUDAR: 'sesion.reanudar',
  SESION_FIN: 'sesion.fin',
  NOTA: 'nota',

  // Pestanas y navegacion (service worker)
  PESTANA_ABIERTA: 'pestana.abierta',
  PESTANA_ACTIVADA: 'pestana.activada',
  PESTANA_CERRADA: 'pestana.cerrada',
  NAVEGACION: 'navegacion',
  NAVEGACION_SPA: 'navegacion.spa',
  NAVEGACION_ERROR: 'navegacion.error',
  DESCARGA: 'descarga',

  // Pagina (content)
  PAGINA_VISITA: 'pagina.visita',
  PAGINA_INVENTARIO: 'pagina.inventario',
  PAGINA_OCULTA: 'pagina.oculta',
  PAGINA_VISIBLE: 'pagina.visible',

  // Interaccion (content)
  CLIC: 'clic',
  CAMPO_CAMBIO: 'campo.cambio',
  TECLA: 'tecla',
  ENVIO_FORMULARIO: 'envio-formulario',
  COPIAR: 'copiar',
  CORTAR: 'cortar',
  PEGAR: 'pegar',

  // Consecuencia de una accion (content)
  APARECIO: 'aparecio',
  DESAPARECIO: 'desaparecio',
};

/** Como termino la grabacion. */
export const MOTIVO_FIN = {
  USUARIO: 'usuario',
  TOPE: 'tope-eventos',
  ERROR: 'error',
  INTERRUMPIDO: 'interrumpido',
};

/** Estado de la generacion de los archivos. */
export const EXPORTACION = {
  PENDIENTE: 'pendiente',
  GENERANDO: 'generando',
  LISTO: 'listo',
  ERROR: 'error',
};

/**
 * Topes de rendimiento y de volumen. Esto corre en cada frame de cada pagina que
 * visite el usuario: todo lo que no este acotado se nota.
 */
export const LIMITES = {
  loteMs: 400,              // cada cuanto el content manda lo acumulado
  loteEventos: 50,          // ... o cuando junta esta cantidad
  colaMaxima: 500,          // tope de la cola local antes de descartar
  eventosPorSegundo: 40,    // freno por frame ante rafagas
  ventanaCausaMs: 2500,     // cuanto se espera para atribuir un efecto a una accion
  consecuenciasMax: 6,      // efectos que se anotan por accion
  inventarioEsperaMs: 1200, // espera antes de inventariar (si no hay requestIdleCallback)
  inventarioDebounceMs: 800,
  ringUltimos: 60,          // resumenes que guarda el run para el feed en vivo
  feedMs: 3000,             // cada cuanto se persiste ese ring
  eventosMaximos: 200000,   // corte duro de la sesion
  textoPortapapeles: 120,
};

/** Teclas que se registran siempre (las demas solo con Ctrl/Alt/Meta). */
export const TECLAS_REGISTRADAS = new Set([
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

/** Generacion de los archivos Markdown. */
export const EXPORT = {
  carpeta: 'registro-acciones',
  bytesPorParte: 350000,    // ~470 KB en base64; data: URLs mas largas son fragiles
  eventosPorParte: 1500,
  nombreParte: 'registro',
  nombreIndice: 'registro_indice',
};

export const LOG_CAP = 200;
