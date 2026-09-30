// Modulo "Editar Shipping Rules" del apartado Magento.
//
// Activa o desactiva Global Shipping Rules en lote. Por cada rule elegida:
// formulario de edicion -> "Active this shipping rule" al estado pedido -> Save
// -> Magento vuelve con "The rule has been saved." -> la siguiente. Segun como
// se abrio el formulario vuelve al listado o AL MISMO formulario (medido: desde
// el enlace de edicion vuelve al formulario); los dos casos valen.
//
// Lo UNICO que se cambia es el campo `is_active`. El unico boton que se pulsa
// es "Save" (`#save`): nunca "Delete", ni la accion masiva "Delete" del listado
// (que es la unica accion masiva que trae la grilla).

export const MODULE_ID = 'editar-shipping-rules';

export const STORAGE_KEYS = {
  RUN:     `magento:${MODULE_ID}:run`,
  CATALOG: `magento:${MODULE_ID}:catalog`,
  HISTORY: `magento:${MODULE_ID}:history`,
};

export const MESSAGES = {
  // Popup -> content (one-shot): leer todas las rules por el endpoint del grid.
  LOAD_CATALOG: `magento:${MODULE_ID}:load-catalog`,
  // Popup -> content (one-shot): esta pestana es la que ejecuta la corrida.
  CLAIM: `magento:${MODULE_ID}:claim`,
};

// Marca de la pestana que ejecuta la corrida. sessionStorage es por pestana y
// por origen, y sobrevive a las navegaciones de la misma pestana: justo lo que
// hace falta para que otra pestana del admin abierta no ejecute la misma cola.
export const CLAIM_SESSION_KEY = 'ext-lge-cl:editar-shipping-rules:run';

export const ACTION = {
  ACTIVATE:   'activate',
  DEACTIVATE: 'deactivate',
};

export const ACTION_LABEL = {
  activate:   'Activar',
  deactivate: 'Desactivar',
};

export const ITEM_STATUS = {
  PENDING:   'pending',   // en la cola
  APPLYING:  'applying',  // se navego a su formulario
  SAVING:    'saving',    // se pulso Save, se espera la vuelta al listado
  OK:        'ok',        // Magento confirmo el guardado
  UNCHANGED: 'unchanged', // ya estaba en el estado pedido: no se guardo nada
  ERROR:     'error',
};

export const ITEM_STATUS_LABEL = {
  pending:   'En cola',
  applying:  'Abriendo...',
  saving:    'Guardando...',
  ok:        'Cambiada',
  unchanged: 'Sin cambio',
  error:     'Error',
};

export const RUN_PHASE = {
  RUNNING:   'running',
  VERIFYING: 'verifying',
  DONE:      'done',
};

export const FINISH_REASON = {
  DONE:      'done',
  CANCELLED: 'cancelled',
  ERROR:     'error',
};

export const PAGE_TYPE = {
  LISTING: 'listing',
  EDIT:    'edit',
  OTHER:   'other',
};

// Grid del listado (UI component de Magento). Se consulta por el endpoint
// `mui/index/render` en vez de leer el DOM: la grilla no pinta filas con la
// pestana en segundo plano y recuerda la ultima pagina vista (medido: quedaba
// en la pagina 2 con 200 por pagina y mostraba "0 records found").
export const GRID_NAMESPACE = 'shipping_rule_management_listing';
export const GRID_PAGE_SIZE = 500;
export const GRID_MAX_PAGES = 20;

// Formulario de edicion: el data source y el componente del campo.
export const FORM_NAMESPACE = 'shipping_rule_management_form';

export const LISTING_PATH = '/global_shippingrule/management/index';
export const LISTING_URL_RE = /\/global_shippingrule\/management\/(?:index)?(?:[/?#]|$)/i;
export const EDIT_URL_RE = /\/global_shippingrule\/management\/edit\/(?:id|entity_id)\/(\d+)/i;

export const SELECTORS = {
  saveButton: '#save',
  messageSuccess: '#messages .message-success, .messages .message-success',
  messageError: '#messages .message-error, .messages .message-error',
  fieldError: '.admin__field-error, label.mage-error',
};

// Mensaje de Magento tras guardar (medido: "The rule has been saved.").
export const SAVED_RE = /has been saved|se ha guardado|guardad[oa] correctamente/i;

// Espera maxima a que el formulario registre sus componentes (el bridge los
// consulta en el uiRegistry).
export const FORM_READY_TIMEOUT_MS = 30000;
// Espera maxima a que el Save saque a la pestana del formulario. Si no ocurre,
// Magento rechazo el formulario en el propio navegador (validacion).
export const SAVE_TIMEOUT_MS = 30000;
// Rebotes a una pagina que no es ni el formulario ni el listado (tipicamente el
// dashboard, cuando la key de la URL vencio) antes de dar la rule por perdida.
export const MAX_REDIRECTS = 3;

export const HISTORY_CAP = 30;
export const LOG_CAP = 400;
