// Crear Promo-Id: GP1 > PROMOTION > Promotion Management.
// Detalle de la pantalla, la API interna y los quirks en docs/features/crear-promo-id.md.

export const FEATURE_ID = 'crear-promo-id';

export const MESSAGES = {
  // popup -> content (one-shot): detectar la pantalla en la pestana activa.
  PING:    'crear-promo-id:ping',
  // popup -> content (one-shot): catalogo de modelos + resolucion de la lista de SKUs.
  RESOLVE: 'crear-promo-id:resolve',
  // popup -> content (one-shot): arrancar la corrida (el content responde al toque
  // y sigue solo; el progreso viaja por chrome.storage).
  START:   'crear-promo-id:start',
};

export const STORAGE_KEYS = {
  RUN:   'crear-promo-id:run',
  DRAFT: 'crear-promo-id:draft',
};

export const LOG_CAP = 200;

// Bridge con el mundo MAIN (content/bridge.js). Los datasets RUI de la pagina
// solo existen ahi.
export const BRIDGE = {
  SOURCE: 'ext-lge-cl/crear-promo-id-bridge',
  TIMEOUT_MS: 60000,
  OPS: {
    PING: 'ping',
    CATALOG: 'catalog',
    LIST: 'list',
    ADD_MODELS: 'add-models',
    SET_MAIN: 'set-main',
    SET_DATES: 'set-dates',
    STATE: 'state',
    MARK_STG_ROW: 'mark-stg-row',
  },
};

export const GP1_ORIGIN = 'https://admin.gp1.aws.lge.com';
export const PAGE_PATH = '/admin/promotionManage/cudPromotionManageForm.lg';
export const PAGE_URL = `${GP1_ORIGIN}${PAGE_PATH}?topMenuId=MN09000000&menuId=MN09010100`;
export const GP1_HOME_URL = `${GP1_ORIGIN}/common/main.lg`;

export const SELECTORS = {
  newBtn:          '#newBtn-button',
  searchBtn:       '#searchBtn-button',
  dialog:          '#promotionDialog',
  dialogClose:     '#promotionDialog a.container-close',
  title:           '#mTitle input[name="mTitle"]',
  tag:             'input[name="mTag"]',
  bodyCopy:        'input[name="mBodyCopy"]',
  radio:           (group, value) => `#${group} input[type="radio"][value="${value}"]`,
  modelNewBtn:     '#mPromotionNewBtn-button',
  modelDialog:     '#modelDialog',
  modelSelectBtn:  '#modelSelectBtn-button',
  saveStgBtn:      '#mPromotionSaveBtn-button',
};

// Limites que valida la propia pantalla (mPromotionValidator).
export const LIMITS = {
  TITLE: 60,
  TAG: 40,
  BODY_COPY: 250,
};

// GP1 exige 1 o 3 filas con Main Model = Y (LGEIS-154).
export const MAIN_MODEL_COUNTS = [1, 3];

// Filas de modelo que se inyectan por llamada al bridge: solo marca el ritmo
// de la barra de progreso (el SELECT de la pagina es O(n*m), con miles de filas
// conviene ir por partes igual).
export const ADD_CHUNK = 40;

export const CATEGORY_MODE = {
  ALL:   'all',    // todas las rutas de categoria del modelo (lo que se hace hoy a mano)
  FIRST: 'first',  // solo la primera
};

export const RUN_PHASE = {
  RESOLVING: 'resolving',
  OPENING:  'opening',
  FILLING:  'filling',
  MODELS:   'models',
  MAIN:     'main',
  SAVING:   'saving',
  FINDING:  'finding',
  DONE:     'done',
};

export const RUN_PHASE_LABEL = {
  [RUN_PHASE.RESOLVING]: 'Buscando los SKUs en el catalogo de GP1',
  [RUN_PHASE.OPENING]: 'Abriendo el formulario NEW',
  [RUN_PHASE.FILLING]: 'Llenando los datos de la promo',
  [RUN_PHASE.MODELS]:  'Agregando modelos',
  [RUN_PHASE.MAIN]:    'Marcando Main Model',
  [RUN_PHASE.SAVING]:  'Guardando en STG',
  [RUN_PHASE.FINDING]: 'Buscando el Promo-Id creado',
  [RUN_PHASE.DONE]:    'Listo',
};

// Estado de cada SKU de la lista dentro de la corrida.
export const SKU_STATUS = {
  PENDING:   'pending',    // todavia no se busco
  FOUND:     'found',      // esta en el catalogo, falta agregarlo
  ADDED:     'added',      // ya esta en la grilla de la promo
  NOT_FOUND: 'not-found',
  AMBIGUOUS: 'ambiguous',  // Model Name que corresponde a varios Sales Model
  REPEATED:  'repeated',   // mismo modelo que otro SKU de la lista
};

export const SKU_STATUS_LABEL = {
  [SKU_STATUS.PENDING]:   'pendiente',
  [SKU_STATUS.FOUND]:     'encontrado',
  [SKU_STATUS.ADDED]:     'agregado',
  [SKU_STATUS.NOT_FOUND]: 'no existe en GP1',
  [SKU_STATUS.AMBIGUOUS]: 'ambiguo',
  [SKU_STATUS.REPEATED]:  'repetido',
};

export const FINISH_REASON = {
  DONE:        'done',
  CANCELLED:   'cancelled',
  ERROR:       'error',
  INTERRUPTED: 'interrupted',
};

// Si el content no renueva el latido en este tiempo, el popup da la corrida por
// perdida (pestana cerrada o recargada a mitad).
export const HEARTBEAT_MS = 3000;
export const STALE_MS = 20000;

// Textos de los messagebox de la pantalla.
export const TEXTS = {
  CONFIRM_SAVE: 'do you want to save',
  SUCCESS:      'successful',
  FAILED:       'failed',
};
