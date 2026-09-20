// Feature "Facturas": carga de facturas de comision en GEVS (Complex Voucher
// Entry, Oracle OA Framework). El detalle del proceso esta en
// docs/features/facturas*.md: leerlos antes de tocar esto.
//
// Este archivo no importa nada de chrome.*: lo comparten popup, content, SW y
// los tests de la capa pura.

export const FEATURE_ID = 'facturas';

export const STORAGE_KEYS = {
  RUN: `${FEATURE_ID}:run`,             // corrida en curso (content es el writer)
  DRAFT: `${FEATURE_ID}:draft`,         // lo elegido en el popup (sin el workbook)
  PLAN: `${FEATURE_ID}:plan`,           // plan de carga de la factura elegida
  RESULTADOS: `${FEATURE_ID}:resultados`, // facturas guardadas/enviadas (batchId, reference)
};

export const MESSAGES = {
  GET_PAGE_DATA: `${FEATURE_ID}:get-page-data`, // popup -> content
  ADJUNTO_GET: `${FEATURE_ID}:adjunto-get`,     // content -> SW: bytes de un adjunto en base64
  INICIAR: `${FEATURE_ID}:iniciar`,             // popup -> SW: { plan, config } abre la bitacora (si se pidio) y el run
};

// Tope de lo que viaja por sendMessage en base64 (los reales pesan ~100 KB).
export const ADJUNTO_MAX_BYTES = 25 * 1024 * 1024;

// Hosts de GEVS: la pantalla (9q) y el iframe de upload de adjuntos (1q). Se
// usan para permitirles ventanas emergentes (ver background/index.js).
export const HOSTS_GEVS = ['http://lgegltase9q.lge.com:8032', 'http://lgegltase1q.lge.com:8032'];

// --- GEVS ------------------------------------------------------------------

export const GEVS = {
  // <option value> de "Vendor Invoice(CHL)" en #InvoiceTypeId.
  INVOICE_TYPE_VENDOR_CHL: '55001',
  // Como aparece el Invoice Type en Master 2 y su value en la pantalla.
  INVOICE_TYPE_POR_NOMBRE: { 'vendor invoice (chl)': '55001', 'vendor invoice(chl)': '55001' },
  LINE_TYPE_ITEM: 'ITEM',
  LINE_TYPE_VAT: 'VAT',
  // Cuenta que OAF pone solo en la fila VAT al resolver el tax code CLIDD19.
  VAT_ACCOUNT: '11330101',
  IVA: 0.19,
  PRODUCT_TYPE_DIV: 'DIV', // <option value> de "DIV/DIV Group"
  MODULO_SOPORTADO: 'complex voucher', // Master 2 col "System Module", normalizado
};

// Estados de Master 1 (col "Invoice Status") y que significa cada uno.
export const ESTADO_FACTURA = {
  PENDING: 'pending',
  APPROVING: 'approving',
  AP_COMPLETED: 'ap completed',
  DRAFT: 'draft',
  PENDING_REPORT: 'pending report',
};

export const DOC_TYPE = {
  INVOICE: 'invoice',
  CREDIT_NOTE: 'credit note',
  DEBIT_NOTE: 'debit note',
};

// Prefijo de la Description por tipo de documento.
export const PREFIJO_DESCRIPCION = {
  [DOC_TYPE.INVOICE]: 'F',
  [DOC_TYPE.CREDIT_NOTE]: 'CN',
};

// Orden fijo de las BUs (Master 1 col "BU" / hoja Map). Es el orden de las
// filas Debit en GEVS.
export const BUS = ['CNT', 'CVT', 'CDT', 'DFT', 'DVT', 'GLT', 'PNT', 'GTT', 'DGT', 'DLT', 'DMT'];
export const BU_TOTAL = 'TOTAL';

export const MESES_EN = {
  JAN: 'January', FEB: 'February', MAR: 'March', APR: 'April', MAY: 'May', JUN: 'June',
  JUL: 'July', AUG: 'August', SEP: 'September', OCT: 'October', NOV: 'November', DEC: 'December',
};

// Roles de los adjuntos. "distribution" existe en el proceso pero por ahora no
// se sube (decision del usuario).
export const ROL_ADJUNTO = {
  FACTURA: 'factura',
  DETALLE: 'detalle',
};
export const ROLES_OBLIGATORIOS = [ROL_ADJUNTO.FACTURA, ROL_ADJUNTO.DETALLE];

// --- Pantalla ---------------------------------------------------------------

export const URL_ENTRY_RE = /ComplexVoucherEntryPG/;
export const URL_INQUIRY_RE = /ComplexVoucherInquiryPG/;
export const URL_LOV_TAX_RE = /TaxCodeLovRN/;
export const URL_UPLOAD_RE = /\/xxlge\/com\/upload\.jsp/;
export const URL_UPLOAD_RESULT_RE = /\/xxlge\/com\/uploadResult\.jsp/;

export const PANTALLA = {
  ENTRY: 'entry',
  INQUIRY: 'inquiry',
  LOV_TAX: 'lov-tax',
  UPLOAD: 'upload',
  UPLOAD_RESULT: 'upload-result',
  OTRA: 'otra',
};

export const SELECTORS = {
  form: '#DefaultFormName',
  mensajes: '#FwkErrorBeanId',
  cabecera: {
    invoiceType: '#InvoiceTypeId',
    invoiceNo: '#InvoiceNo',
    invoiceDate: '#InvoiceDate',
    accountingDate: '#AccountingDate',
    payeeCode: '#PayeeCode',
    payeeNo: '#PayeeNo',
    payeeName: '#PayeeName',
    termsDate: '#PTermsDate',
    dueDate: '#PDueDate',
    description: '#Description',
  },
  credito: {
    department: 'input[name="CreditTable:DepartmentCode:0"]',
    account: 'input[name="CreditTable:AccountCode:0"]',
    amount: 'input[name="CreditTable:Amount:0"]',
  },
  // Campos de la fila i de la tabla Debit. `debito.campo(i)`.
  debito: {
    tabla: '#DebitTable',
    amounts: 'input[name^="DebitTable:DAmount:"]',
    lineType: (i) => `select[name="DebitTable:DLineTypeLookupCode:${i}"]`,
    taxCode: (i) => `input[name="DebitTable:DVatRateCode:${i}"]`,
    department: (i) => `input[name="DebitTable:DDepartmentCode:${i}"]`,
    account: (i) => `input[name="DebitTable:DAccountCode:${i}"]`,
    amount: (i) => `input[name="DebitTable:DAmount:${i}"]`,
    productType: (i) => `select[name="DebitTable:DirImposProductTypeCode:${i}"]`,
    product: (i) => `input[name="DebitTable:DirImposProductLOV:${i}"]`,
    description: (i) => `input[name="DebitTable:DDescription:${i}"]`,
    dff: (i) => `a[name="DebitTable:DebitDff:${i}"]`,
  },
  dff: {
    issueDate: '#LineDffItem1',
    supplyPrice: '#LineDffItem2',
    originalTaxAmount: '#LineDffItem3',
    supplier: '#LineDffItem4',
    taxRateCode: '#LineDffItem7',
    apply: '#hideDffBtn',
  },
  botones: {
    add: '#AddBtn',
    save: '#ABSaveBtn',
    submit: '#ABSubmitBtn',
    delete: '#ABDeleteBtn',
    addFile: '#NewFAAddFileBtn',
    fileApply: '#__NewFileAttachCloseBTN',
    // El Submit (#ABSubmitBtn) lo pulsa la persona: la extension nunca lo toca.
    // Los selectores de esa etapa (Reset #AIResetBtn, modal ConfirmMsgResultAT,
    // #ConfirmApplyBtn) estan medidos en docs/features/facturas-flujo-gevs.md.
  },
  adjuntos: {
    enlaces: 'a[href*="download.jsp?file_id="]',
  },
  lov: {
    tabla: '#InquiryTable',
    filas: '#InquiryTable table.x1o tr',
    radio: 'input[type="radio"]',
    boton: 'button', // se elige por texto ("Select"): no tienen id
  },
  upload: {
    file: 'input[name="txt_attachFileKey"]',
    submit: 'input[name="save"]',
  },
};

// --- Corrida ----------------------------------------------------------------

export const FASE = {
  CARGANDO: 'cargando',           // pasos hasta Save + adjuntos
  LISTO_PARA_ENVIAR: 'listo',     // guardado y adjuntado; la persona hace el Submit en GEVS
  DONE: 'done',                   // GEVS confirmo ese Submit (Reference) en la pantalla Inquiry
};

// Pasos de la carga, en orden. El content los ejecuta por id; el popup muestra
// el rotulo. Ver la maquina de pasos en docs/features/facturas.md.
export const PASOS = [
  { id: 'precondiciones', label: 'Comprobar pantalla y plan' },
  { id: 'invoice-type', label: 'Invoice Type' },
  { id: 'payee', label: 'Payee Code' },
  { id: 'invoice-no', label: 'Invoice No' },
  { id: 'invoice-date', label: 'Invoice Date' },
  { id: 'description', label: 'Description' },
  { id: 'credito', label: 'Credit: cuenta' },
  { id: 'debito-dept', label: 'Debit: departamento' },
  { id: 'debito-add', label: 'Debit: agregar filas' },
  { id: 'iva-line-type', label: 'IVA: tipo de linea' },
  { id: 'iva-tax-code', label: 'IVA: tax code' },
  { id: 'debito-account', label: 'Debit: cuentas' },
  { id: 'debito-amount', label: 'Debit: montos' },
  { id: 'iva-amount', label: 'IVA: monto' },
  { id: 'credito-amount', label: 'Credit: monto' },
  { id: 'producto', label: 'Product por fila' },
  { id: 'descripcion-filas', label: 'Description por fila' },
  { id: 'dff', label: 'DFF de la fila IVA' },
  { id: 'verificar', label: 'Verificar contra el plan' },
  { id: 'guardar', label: 'Save' },
  { id: 'adjuntos', label: 'Adjuntar archivos' },
  { id: 'guardar-2', label: 'Save final' },
];

export const FASE_LABEL = {
  [FASE.CARGANDO]: 'Cargando la factura en GEVS...',
  [FASE.LISTO_PARA_ENVIAR]: 'Guardada con adjuntos: te toca el Submit en GEVS',
  [FASE.DONE]: 'Submit confirmado por GEVS',
};

export const FINISH_REASON = {
  DONE: 'done',           // la persona hizo Submit y GEVS devolvio la Reference
  GUARDADO: 'guardado',   // termino en Save; la persona cerro la corrida sin esperar la Reference
  CANCELLED: 'cancelled',
  ERROR: 'error',
  NOT_DETECTED: 'not-detected',
};

export const LOG_CAP = 400;
export const CLAIM_SETTLE_MS = 250;
export const HEARTBEAT_MS = 5000;
export const HEARTBEAT_STALE_MS = 20000;
export const PPR_TIMEOUT_MS = 20000; // el PPR mas lento medido fue 3.6 s
export const PPR_SETTLE_MS = 300;
