// Constantes de la gestion automatica de devoluciones en Falabella.
//
// La web del modulo deja la orden con gestion PENDIENTE; aca la extension la
// reclama, abre SellerCenter y la gestiona sola. Dos desenlaces felices:
//   - OK: la orden estaba en el modulo de devoluciones y se apelo ahi.
//   - TICKET: no estaba, se levanto un ticket de soporte en ayudaseller.
// El resultado se reporta a la API del modulo y aparece en la web del usuario.

export const GESTION_FEATURE = 'devoluciones:falabella:gestion';

export const GESTION_STORAGE_KEYS = {
  RUN: `${GESTION_FEATURE}:run`,
};

// Mensajes. START/CANCEL van del popup al service worker; el resto los manda el
// content script, que pregunta que tiene que hacer y reporta como le fue (el
// service worker es quien guarda la maquina de estados y habla con la API).
export const GESTION_MESSAGES = {
  START: `${GESTION_FEATURE}:start`,
  CANCEL: `${GESTION_FEATURE}:cancel`,
  GET_JOB: `${GESTION_FEATURE}:get-job`,   // content -> SW: que gestiono en esta pestana
  FILES: `${GESTION_FEATURE}:files`,       // content -> SW: dame los PDF (base64)
  ADVANCE: `${GESTION_FEATURE}:advance`,   // content -> SW: cambio de fase
  REPORT: `${GESTION_FEATURE}:report`,     // content -> SW: resultado final
  LOG: `${GESTION_FEATURE}:log`,           // content -> SW: linea de bitacora
};

// Alarma de respaldo que resucita el service worker en mitad de un run.
export const GESTION_ALARM = `${GESTION_FEATURE}:poll`;
export const ALARM_PERIOD_MIN = 0.5;
export const POLL_INTERVAL_MS = 2500;

// Paginas que se automatizan. Solo se navega por URL al listado de
// devoluciones; a la mesa de ayuda hay que llegar SIEMPRE por la navbar de
// SellerCenter (Ayuda -> Centro de ayuda): entrar directo por la URL cae en
// otro login y pide credenciales distintas. Por eso aqui hay hosts y rutas para
// reconocer donde estamos, no URLs a las que saltar.
export const RETURNS_URL = 'https://sellercenter.falabella.com/order/return/returns_pending_review';
export const SELLERCENTER_HOST = 'sellercenter.falabella.com';
export const HELP_HOST = 'ayudaseller.falabella.com';
export const HELP_SUPPORT_PATH = '/s/soporteseller';

// Fases de un job (persisten en el run: el flujo cruza navegaciones de pagina).
export const FASE = {
  PENDIENTE: 'pendiente',       // aun sin reclamar
  BUSCAR: 'buscar',             // buscar la orden en el modulo de devoluciones
  APELAR: 'apelar',             // formulario "No, rechazar" (apelacion)
  AYUDA: 'ayuda',               // navbar de SellerCenter -> Centro de ayuda
  SOPORTE: 'soporte',           // navbar de la mesa de ayuda -> Soporte
  TICKET: 'ticket',             // pestana "Nuevo caso" + formulario del ticket
  CONFIRMACION: 'confirmacion', // leer el n° de caso de la pantalla final
};

export const RESULTADO = {
  OK: 'OK',
  TICKET: 'TICKET',
  ERROR: 'ERROR',
};

// Marcador para un ticket que se envio pero cuyo numero no se pudo leer. Es
// preferible a inventarlo: la orden queda gestionada y con aviso de que hay que
// buscar el numero a mano en "Casos creados".
export const TICKET_SIN_NUMERO = 'SIN-NUMERO';

// Numero de guia cuando no se pudo leer de las imagenes: el formulario del
// ticket lo exige, y un 0 es la convencion acordada para "no identificado".
export const GUIA_NO_IDENTIFICADA = '0';

// Esperas: las paginas de SellerCenter/Salesforce tardan en montar.
export const PAGE_TIMEOUT_MS = 45_000;
export const STEP_TIMEOUT_MS = 15_000;

// Watchdog del service worker: si un job no avanza en este plazo, se reporta
// ERROR y se sigue con el siguiente (la pestana pudo quedar colgada). Da margen
// al camino largo: buscar -> navbar -> mesa de ayuda -> navbar -> formulario ->
// envio -> confirmacion, cada salto con su propia carga de pagina.
export const JOB_TIMEOUT_MS = 8 * 60_000;

// Opciones del dropdown "razon para apelar" del formulario de apelacion, con
// las palabras clave de la observacion que las eligen. La primera que matchea
// gana; sin match se usa DEFAULT_MOTIVO ("Producto dañado" es el caso tipico:
// nos conviene posicionarnos en que el producto esta malo).
export const MOTIVO_KEYWORDS = [
  { motivo: 'Caja vacía', keywords: ['caja vacia', 'vacio', 'vacía', 'vacio la caja'] },
  { motivo: 'Producto llegó sin empaque', keywords: ['sin empaque', 'sin caja', 'sin embalaje'] },
  { motivo: 'Producto llegó con el empaque dañado o sucio', keywords: ['empaque dañado', 'caja dañada', 'caja rota', 'embalaje dañado', 'sucio'] },
  { motivo: 'Producto usado', keywords: ['usado', 'uso previo', 'con uso'] },
  { motivo: 'Producto no funciona', keywords: ['no funciona', 'no enciende', 'no prende', 'defectuoso', 'falla tecnica'] },
  { motivo: 'Producto incompleto', keywords: ['incompleto', 'falta', 'faltan', 'sin accesorio', 'sin control', 'sin cable'] },
];
export const DEFAULT_MOTIVO = 'Producto dañado';

// Radio del informe tecnico + su sub-motivo cuando es "Malo".
export const INFORME_STATUS = 'Malo';
export const SUBSTATUS_INCOMPLETO = 'Incomplete';
export const SUBSTATUS_DANO_SEVERO = 'Severe damage';

// Cascada del formulario de ticket (ayudaseller).
export const TICKET_CASCADA = {
  nivel1: 'Pos venta',
  nivel2: 'Devoluciones',
  nivel3: 'Quiero rechazar una devolución',
};

// Selectores. Agrupados por pagina para que un cambio del portal se arregle en
// un solo sitio (los ids de Salesforce llevan sufijos que cambian por render:
// siempre por prefijo, nunca por el id completo).
export const SEL = {
  // Modulo de devoluciones (listado + busqueda).
  buscar: {
    input: '.search-content .container-searchbar input',
    tabla: 'table.ui-list-table',
    filas: 'table.ui-list-table tbody tr',
    celdaOrden: 'td.details',
    vacio: '.helper-message',
    acciones: 'td.actions button',
  },
  // Formulario de apelacion (rejectAppeals).
  apelar: {
    caja: '.box',
    cajaTitulo: '.title-box .title',
    cajaCuerpo: '.title-box + div',
    dropdownHeader: '.custom-dropdown .dropdown-header',
    dropdownOpcion: '.custom-dropdown .dropdown-select .dropdown-option',
    comentario: 'textarea#comment',
    archivos: 'input#files[type="file"]',
    radioEstado: 'input[type="radio"][name="status"]',
    subEstado: 'select#subStatus',
    subComentario: 'textarea#subcomment',
    enviar: 'button[type="submit"].submit-button, button[type="submit"].submit-button-active',
  },
  // Navegacion hasta la mesa de ayuda (no se puede entrar por URL directa).
  navegacion: {
    // Menu "Ayuda" de la navbar de SellerCenter y su enlace al centro de ayuda.
    menuAyuda: '.support-coachmark',
    enlaceAyuda: 'a',
    // Navbar de la mesa de ayuda (Salesforce Communities).
    soporte: `nav a[href="${HELP_SUPPORT_PATH}"]`,
    // Pestanas de la pantalla de soporte: "Casos creados" | "Nuevo caso" | …
    pestana: 'a.slds-tabs_default__link',
  },
  // Formulario de ticket (ayudaseller, Salesforce LWC).
  ticket: {
    contacto: 'lightning-combobox[id^="contact-list"]',
    correo: 'lightning-input[id^="caseAdditEmail"] input',
    nivel1: 'lightning-combobox[id^="first-list"]',
    nivel2: 'lightning-combobox[id^="second-list"]',
    nivel3: 'lightning-combobox[id^="third-list"]',
    detalle: 'lightning-textarea[id^="desc"] textarea',
    numeroOrden: 'input[name="ordernumber"]',
    numeroGuia: 'input[name="nGuia"]',
    archivos: 'input.hidden-upload[type="file"]',
    enviar: 'button.submit-button[title="Enviar"]',
    // Dentro de un lightning-combobox.
    comboBoton: 'button.slds-combobox__input',
    comboOpcion: 'lightning-base-combobox-item',
  },
  // Pantalla de confirmacion del ticket ("¡Todo listo, recibimos tu solicitud!").
  confirmacion: {
    cabecera: '.result_header',
    detalle: '.result_header + div p, .result_header ~ div p',
    // Campos con error de validacion: si el envio no paso, es lo que aparece.
    error: '.slds-has-error',
  },
};

// El numero de caso viene embebido en una frase: "Tu n° de caso es el 68989843 ,
// con fecha de creacion 30 de Julio de 2026."
export const CASO_REGEX = /caso\s+es\s+el\s+([\d.\s-]{4,})/i;

// Rotulos de la navegacion (se buscan por texto, sin distinguir acentos).
export const TEXTOS = {
  centroAyuda: 'Centro de ayuda',
  nuevoCaso: 'Nuevo caso',
};

export const LOG_CAP = 400;
