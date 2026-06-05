// Lee el DOM de la página de detalle de una orden de Magento y produce una
// estructura lista para mostrar en el popup:
//   { orderNumber, status, alerts:[...], groups:[{ id, label, fields:[...] }] }
//
// Además decodifica las notas de transacción (Transbank Webpay / MercadoPago)
// para explicar el motivo de aprobaciones y rechazos.

import {
  GATEWAY,
  MERCADOPAGO_STATUS,
  MERCADOPAGO_STATUS_DETAIL,
  SELECTORS,
  TRANSBANK_PAYMENT_TYPE,
  TRANSBANK_RESPONSE_CODES,
  TRANSBANK_STATUS,
  TRANSBANK_VCI,
} from '../constants.js';

// -----------------------------------------------------------------------------
// API principal
// -----------------------------------------------------------------------------

export function parseOrder() {
  const infoTable = document.querySelector(SELECTORS.orderInfoTable);
  if (!infoTable) {
    return { ok: false, reason: 'No se encontró la información de la orden en esta página.' };
  }

  const groups = [];
  const alerts = [];

  const orderNumber = readOrderNumber();
  const statusText = document.querySelector(SELECTORS.orderStatus)?.textContent?.trim() || '';

  // 1) Resumen (Order Information + título)
  const summaryFields = [];
  if (orderNumber) summaryFields.push(field('Orden', `#${orderNumber}`));
  if (statusText) summaryFields.push(field('Estado de la orden', statusText));
  summaryFields.push(...tableToFields(infoTable));
  groups.push(group('resumen', 'Resumen de la orden', dedupeByLabel(summaryFields)));

  // 2) Cliente (Account Information)
  const accountTable = document.querySelector(SELECTORS.accountInfoTable);
  if (accountTable) {
    groups.push(group('cliente', 'Cliente', tableToFields(accountTable)));
  }

  // 3) Full In House Information (sección custom con <p>)
  const inHouse = parseCustomSection();
  if (inHouse.length) {
    groups.push(group('in-house', 'Full In House Information', inHouse));
  }

  // 4) Totales
  const totals = parseTotals();
  if (totals.length) {
    groups.push(group('totales', 'Totales de la orden', totals));
  }

  // 5) Información de pago (sección Payment Information — fuente fiable de MP)
  const payments = parsePaymentMethods();
  groups.push(...payments.groups);
  alerts.push(...payments.alerts);

  // 6) Transacciones / notas (decodificadas)
  const { txGroups, txAlerts, historyFields } = parseNotes();
  groups.push(...txGroups);
  alerts.push(...txAlerts);

  if (historyFields.length) {
    groups.push(group('historial', 'Historial de notas', historyFields));
  }

  return {
    ok: true,
    data: { orderNumber, status: statusText, alerts, groups },
  };
}

// -----------------------------------------------------------------------------
// helpers de lectura del DOM
// -----------------------------------------------------------------------------

function readOrderNumber() {
  const title = document.querySelector(SELECTORS.orderTitle)?.textContent || '';
  const m = title.match(/Order\s*#\s*(\d+)/i) || title.match(/(\d{6,})/);
  return m ? m[1] : '';
}

/** Convierte una tabla admin (<tr><th/><td/>) en fields [{label,value,raw}]. */
function tableToFields(tableEl) {
  const fields = [];
  tableEl.querySelectorAll('tr').forEach((tr) => {
    const th = tr.querySelector('th');
    const td = tr.querySelector('td');
    if (!th || !td) return;
    const label = cleanText(th.textContent);
    const value = cellText(td);
    if (label && value) fields.push(field(label, value));
  });
  return fields;
}

/** Texto de una celda: <br> → " / ", colapsa espacios. */
function cellText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('br').forEach((br) => br.replaceWith(' / '));
  return cleanText(clone.textContent);
}

function cleanText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Sección "Full In House Information": cada <p> "Etiqueta: valor". */
function parseCustomSection() {
  const section = document.querySelector(SELECTORS.customSection);
  if (!section) return [];
  const fields = [];
  section.querySelectorAll('p').forEach((p) => {
    const text = cleanText(p.textContent);
    if (!text) return;
    const idx = text.indexOf(':');
    if (idx === -1) {
      fields.push(field('—', text));
    } else {
      const label = text.slice(0, idx).trim();
      const value = text.slice(idx + 1).trim();
      if (label && value) fields.push(field(label, value));
    }
  });
  return fields;
}

/** Tabla de totales (.order-subtotal-table): tfoot (totales) + tbody (detalle). */
function parseTotals() {
  const table = document.querySelector(SELECTORS.totalsTable);
  if (!table) return [];
  const fields = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 2) return;
    const label = cleanText(cells[0].textContent);
    const value = cleanText(cells[cells.length - 1].textContent);
    if (label && value) fields.push(field(label, value));
  });
  return fields;
}

// -----------------------------------------------------------------------------
// Payment Information (.order-payment-method)
// -----------------------------------------------------------------------------

function parsePaymentMethods() {
  const sections = Array.from(document.querySelectorAll(SELECTORS.paymentMethod));
  const groups = [];
  const alerts = [];

  sections.forEach((sec, idx) => {
    const titleEl = sec.querySelector(SELECTORS.paymentTitle);
    const table = sec.querySelector('.data-table');

    const fields = [];
    let methodTitle = '';
    if (titleEl) {
      const clone = titleEl.cloneNode(true);
      clone.querySelectorAll('table').forEach((t) => t.remove());
      methodTitle = cleanText(clone.textContent);
    }
    if (methodTitle) fields.push(field('Método', methodTitle));

    let statusVal = '';
    let detailVal = '';
    if (table) {
      table.querySelectorAll('tr').forEach((tr) => {
        const th = tr.querySelector('th');
        const td = tr.querySelector('td');
        if (!th || !td) return;
        const label = cleanText(th.textContent).replace(/:\s*$/, '');
        let value = cleanText(td.textContent);
        const ll = label.toLowerCase();
        if (ll.includes('payment status detail') || ll.includes('status detail')) {
          detailVal = value;
          value = appendMeaning(value, MERCADOPAGO_STATUS_DETAIL[value.toLowerCase()]);
        } else if (ll.includes('payment status') || ll === 'status') {
          statusVal = value;
          value = appendMeaning(value, MERCADOPAGO_STATUS[value.toLowerCase()]);
        }
        if (label && value) fields.push(field(label, value));
      });
    }

    const label = sections.length > 1 ? `Información de pago ${idx + 1}` : 'Información de pago';
    groups.push(group(`payment-${idx + 1}`, label, fields));

    const gw = /mercado\s*pago/i.test(methodTitle) ? 'MercadoPago' : 'Pago';
    const st = statusVal.toLowerCase();
    const sd = detailVal.toLowerCase();
    const meaning = MERCADOPAGO_STATUS_DETAIL[sd] || MERCADOPAGO_STATUS[st] || '';
    if (st === 'approved' || sd === 'accredited') {
      alerts.push({ level: 'success', title: `Pago aprobado (${gw})`, message: meaning || 'Pago acreditado.' });
    } else if (st === 'rejected' || st === 'cancelled' || sd.startsWith('cc_rejected') || sd.startsWith('rejected')) {
      alerts.push({ level: 'error', title: `Pago rechazado (${gw})`, message: meaning || 'Pago rechazado por el emisor.' });
    } else if (st === 'pending' || st === 'in_process' || sd.startsWith('pending')) {
      alerts.push({ level: 'warning', title: `Pago pendiente (${gw})`, message: meaning || 'El pago está en proceso.' });
    }
  });

  return { groups, alerts };
}

// -----------------------------------------------------------------------------
// notas / transacciones
// -----------------------------------------------------------------------------

function parseNotes() {
  const items = Array.from(document.querySelectorAll(SELECTORS.noteItem));
  const txGroups = [];
  const txAlerts = [];
  const historyFields = [];

  let txIndex = 0;
  items.forEach((li) => {
    const date = cleanText(li.querySelector(SELECTORS.noteDate)?.textContent);
    const time = cleanText(li.querySelector(SELECTORS.noteTime)?.textContent);
    const noteStatus = cleanText(li.querySelector(SELECTORS.noteStatus)?.textContent);
    const commentEl = li.querySelector(SELECTORS.noteComment);
    const when = [date, time].filter(Boolean).join(' ');

    if (!commentEl) {
      if (noteStatus) historyFields.push(field(when || 'Nota', noteStatus));
      return;
    }

    const parsed = parseComment(commentEl);
    const gateway = detectGateway(parsed);

    if (gateway === GATEWAY.UNKNOWN) {
      // Nota informativa (JSON de estado, esperando pago, etc.).
      const short = parsed.title || summarizeMap(parsed.map) || cleanText(commentEl.textContent);
      historyFields.push(field(`${when}${noteStatus ? ` · ${noteStatus}` : ''}`, short));
      return;
    }

    txIndex += 1;
    const decoded = gateway === GATEWAY.TRANSBANK
      ? decodeTransbank(parsed)
      : decodeMercadoPago(parsed);

    const gwLabel = gateway === GATEWAY.TRANSBANK ? 'Transbank / Webpay' : 'MercadoPago';
    const headParts = [gwLabel];
    if (decoded.outcome) headParts.push(decoded.outcome);
    const groupFields = [];
    if (when) groupFields.push(field('Fecha', when));
    if (parsed.title) groupFields.push(field('Detalle', parsed.title));
    groupFields.push(...decoded.fields);

    txGroups.push(group(`tx-${txIndex}`, `Pago ${txIndex} — ${headParts.join(' · ')}`, groupFields));

    if (decoded.alert) {
      txAlerts.push({
        level: decoded.alert.level,
        title: `${decoded.alert.title} (${gwLabel})`,
        message: decoded.alert.message,
      });
    }
  });

  return { txGroups, txAlerts, historyFields };
}

/**
 * Parsea el comentario de una nota:
 *   - Si es JSON ("{...}") → map de pares.
 *   - Si es "<strong>Label</strong>: value<br>..." → pares por línea, con la
 *     primera línea sin ":" como título.
 */
function parseComment(commentEl) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(commentEl.innerHTML || '').replace(/<br\s*\/?>/gi, '\n');
  const text = cleanLines(tmp.textContent);

  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      const map = {};
      const order = [];
      for (const [k, v] of Object.entries(obj)) {
        map[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
        order.push(k);
      }
      return { map, order, title: '', text: trimmed, isJson: true };
    } catch { /* cae al parseo por líneas */ }
  }

  const map = {};
  const order = [];
  let title = '';
  for (const lineRaw of text.split('\n')) {
    const line = lineRaw.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) {
      if (!title) title = line;
      continue;
    }
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) {
      if (!(key in map)) order.push(key);
      map[key] = val;
    }
  }
  return { map, order, title, text, isJson: false };
}

function cleanLines(s) {
  return String(s ?? '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n');
}

function detectGateway(parsed) {
  const keys = Object.keys(parsed.map).map((k) => k.toLowerCase());
  const blob = parsed.text.toLowerCase();
  if (
    keys.includes('vci') ||
    keys.some((k) => k.includes('código de respuesta') || k.includes('codigo de respuesta')) ||
    keys.some((k) => k.includes('código de autorización') || k.includes('codigo de autorizacion')) ||
    blob.includes('webpay') ||
    blob.includes('transbank') ||
    blob.includes('tbk')
  ) {
    return GATEWAY.TRANSBANK;
  }
  if (
    blob.includes('mercadopago') ||
    blob.includes('mercado pago') ||
    blob.includes('status_detail') ||
    blob.includes('cc_rejected') ||
    keys.includes('status_detail')
  ) {
    return GATEWAY.MERCADOPAGO;
  }
  return GATEWAY.UNKNOWN;
}

// -----------------------------------------------------------------------------
// decodificadores
// -----------------------------------------------------------------------------

function findKey(parsed, matcher) {
  const key = parsed.order.find((k) => matcher(k.toLowerCase()));
  return key ? { key, value: parsed.map[key] } : null;
}

function decodeTransbank(parsed) {
  const fields = [];
  const norm = (k) => k.replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u');

  const responseCode = findKey(parsed, (k) => norm(k).includes('codigo de respuesta') || k === 'responsecode');
  const vci          = findKey(parsed, (k) => k === 'vci');
  const estado       = findKey(parsed, (k) => k === 'estado' || k === 'status');
  const authCode     = findKey(parsed, (k) => norm(k).includes('codigo de autorizacion'));

  // Volcamos todos los pares, decorando los que sabemos interpretar.
  for (const key of parsed.order) {
    const raw = parsed.map[key];
    let value = raw;
    const nk = norm(key.toLowerCase());
    if (nk.includes('codigo de respuesta') || key.toLowerCase() === 'responsecode') {
      value = appendMeaning(raw, TRANSBANK_RESPONSE_CODES[String(raw).trim()]);
    } else if (key.toLowerCase() === 'vci') {
      value = appendMeaning(raw, TRANSBANK_VCI[String(raw).trim().toUpperCase()]);
    } else if (key.toLowerCase() === 'estado' || key.toLowerCase() === 'status') {
      value = appendMeaning(raw, TRANSBANK_STATUS[String(raw).trim().toUpperCase()]);
    } else if (nk.includes('tipo de pago') || key.toLowerCase() === 'paymenttypecode') {
      value = appendMeaning(raw, TRANSBANK_PAYMENT_TYPE[String(raw).trim().toUpperCase()]);
    }
    fields.push(field(key, value));
  }

  // Resultado y alerta.
  const rc = responseCode ? String(responseCode.value).trim() : null;
  const est = estado ? String(estado.value).trim().toUpperCase() : '';
  const approved = (rc === '0') || est === 'AUTHORIZED' || est === 'CAPTURED';
  const rejected = (rc != null && rc !== '0') || est === 'FAILED' || est === 'NULLIFIED';

  let outcome = '';
  let alert = null;
  if (approved && !rejected) {
    outcome = 'Aprobado';
    alert = { level: 'success', title: 'Pago aprobado', message: buildTbkMessage(rc, vci, true) };
  } else if (rejected) {
    outcome = 'Rechazado';
    alert = { level: 'error', title: 'Pago rechazado', message: buildTbkMessage(rc, vci, false) };
  }

  return { fields, outcome, alert, authCode: authCode?.value };
}

function buildTbkMessage(rc, vci, approved) {
  const parts = [];
  if (rc != null) {
    const meaning = TRANSBANK_RESPONSE_CODES[String(rc).trim()];
    parts.push(meaning ? `${meaning} (código ${rc})` : `Código de respuesta ${rc}`);
  } else if (approved) {
    parts.push('Transacción autorizada por el emisor.');
  }
  if (vci) {
    const v = TRANSBANK_VCI[String(vci.value).trim().toUpperCase()];
    if (v && String(vci.value).trim().toUpperCase() !== 'TSY') {
      parts.push(`Autenticación: ${v}`);
    }
  }
  return parts.join(' · ') || (approved ? 'Pago autorizado.' : 'Pago no autorizado.');
}

function decodeMercadoPago(parsed) {
  const fields = [];
  const status       = findKey(parsed, (k) => k === 'status');
  const statusDetail = findKey(parsed, (k) => k === 'status_detail' || k.includes('status_detail'));

  for (const key of parsed.order) {
    const raw = parsed.map[key];
    let value = raw;
    const lk = key.toLowerCase();
    if (lk === 'status') {
      value = appendMeaning(raw, MERCADOPAGO_STATUS[String(raw).trim().toLowerCase()]);
    } else if (lk === 'status_detail' || lk.includes('status_detail')) {
      value = appendMeaning(raw, MERCADOPAGO_STATUS_DETAIL[String(raw).trim().toLowerCase()]);
    }
    fields.push(field(key, value));
  }

  const st = status ? String(status.value).trim().toLowerCase() : '';
  const sd = statusDetail ? String(statusDetail.value).trim().toLowerCase() : '';
  const approved = st === 'approved' || sd === 'accredited';
  const rejected = st === 'rejected' || st === 'cancelled' || sd.startsWith('cc_rejected') || sd.startsWith('rejected');
  const pending  = st === 'pending' || st === 'in_process' || sd.startsWith('pending');

  let outcome = '';
  let alert = null;
  const detailMeaning = MERCADOPAGO_STATUS_DETAIL[sd] || MERCADOPAGO_STATUS[st] || '';
  if (approved) {
    outcome = 'Aprobado';
    alert = { level: 'success', title: 'Pago aprobado', message: detailMeaning || 'Pago acreditado.' };
  } else if (rejected) {
    outcome = 'Rechazado';
    alert = { level: 'error', title: 'Pago rechazado', message: detailMeaning || 'Pago rechazado por el emisor.' };
  } else if (pending) {
    outcome = 'Pendiente';
    alert = { level: 'warning', title: 'Pago pendiente', message: detailMeaning || 'El pago está en proceso.' };
  }

  return { fields, outcome, alert };
}

function appendMeaning(raw, meaning) {
  const value = String(raw ?? '').trim();
  if (!meaning) return value;
  return `${value} — ${meaning}`;
}

function summarizeMap(map) {
  const entries = Object.entries(map);
  if (!entries.length) return '';
  return entries.map(([k, v]) => `${k}: ${v}`).join(' · ');
}

// -----------------------------------------------------------------------------
// helpers de estructura
// -----------------------------------------------------------------------------

function field(label, value) {
  const v = String(value ?? '');
  return { label: String(label ?? ''), value: v, raw: v };
}

function group(id, label, fields) {
  return { id, label, fields: (fields || []).filter((f) => f.label && f.value) };
}

function dedupeByLabel(fields) {
  const seen = new Set();
  const out = [];
  for (const f of fields) {
    const key = f.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
