// Registro tecnico de "Crear Promo-Id": que paso, en que contexto y con que
// datos, para saber por que algo no anduvo sin abrir DevTools.
//
// Cada contexto (popup / content) escribe en SU key de chrome.storage, asi dos
// writers nunca se pisan el read-modify-write; al leer se mezclan por hora.
// Ademas pasa todo por el logger del scope (consola + buffer de errores de
// Ajustes). Las escrituras se agrupan cada 250 ms.

import { getStorage, setStorage, removeStorage } from '../../shared/storage/storage.js';
import { logger } from '../../shared/utils/logger.js';
import { toMessage } from '../../shared/errors/index.js';

const PREFIX = 'crear-promo-id:trace:';
const CONTEXTS = ['popup', 'content'];
const CAP = 400;
const DATA_MAX = 800;

const log = logger('crear-promo-id');

function serialize(data) {
  if (data === undefined) return undefined;
  if (data instanceof Error) return { error: toMessage(data), stack: String(data.stack || '').split('\n').slice(0, 4).join(' | ') };
  try {
    const text = JSON.stringify(data, (_k, v) => (v instanceof Error ? toMessage(v) : v));
    return text && text.length > DATA_MAX ? `${text.slice(0, DATA_MAX)}…` : JSON.parse(text);
  } catch {
    return String(data);
  }
}

export function createTrace(context) {
  const key = PREFIX + context;
  let pending = [];
  let timer = null;

  async function flush() {
    timer = null;
    const batch = pending;
    pending = [];
    if (!batch.length) return;
    try {
      const prev = (await getStorage(key)) || [];
      const next = prev.concat(batch);
      if (next.length > CAP) next.splice(0, next.length - CAP);
      await setStorage(key, next);
    } catch { /* el registro nunca debe romper la corrida */ }
  }

  function write(level, msg, data) {
    const entry = { ts: Date.now(), ctx: context, level, msg: String(msg) };
    const extra = serialize(data);
    if (extra !== undefined) entry.data = extra;
    pending.push(entry);
    if (!timer) timer = setTimeout(flush, 250);
    const args = extra === undefined ? [msg] : [msg, data];
    if (level === 'error') log.error(...args);
    else if (level === 'warn') log.warn(...args);
    else if (level === 'debug') log.debug(...args);
    else log.info(...args);
  }

  return {
    debug: (msg, data) => write('debug', msg, data),
    info: (msg, data) => write('info', msg, data),
    warn: (msg, data) => write('warn', msg, data),
    error: (msg, data) => write('error', msg, data),
    flush,
  };
}

/** Las entradas de todos los contextos, ordenadas por hora. */
export async function readTrace() {
  const lists = await Promise.all(CONTEXTS.map((c) => getStorage(PREFIX + c).then((v) => v || [])));
  return lists.flat().sort((a, b) => a.ts - b.ts);
}

export function clearTrace() {
  return Promise.all(CONTEXTS.map((c) => removeStorage(PREFIX + c)));
}

export function subscribeTrace(callback) {
  const listener = (changes, area) => {
    if (area !== 'local') return;
    if (CONTEXTS.some((c) => changes[PREFIX + c])) callback();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => { try { chrome.storage.onChanged.removeListener(listener); } catch { /* no-op */ } };
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

export function formatTraceTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Texto plano para copiar/descargar (encabezado con el entorno + entradas). */
export function traceToText(entries, header = {}) {
  const lines = Object.entries(header).map(([k, v]) => `# ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  lines.push('');
  for (const e of entries) {
    const data = e.data === undefined ? '' : ` ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}`;
    lines.push(`${formatTraceTime(e.ts)} [${e.ctx}] ${e.level.toUpperCase()} ${e.msg}${data}`);
  }
  return lines.join('\n');
}
