// Donde se va el tiempo de la captura. Puro: acumula los `timing` que devuelve
// cada ficha y los resume en numeros que una persona pueda leer.
//
// Lo que se busca responder es UNA pregunta: si la corrida es lenta, ¿es el
// servidor (espera hasta la cabecera), el tunel (descarga) o esta maquina
// (parseo)? Sin esto solo queda adivinar y subir carriles a ciegas, que es
// justo lo que no ayuda cuando Magento atiende las peticiones de una misma
// sesion de a una.

/** Forma inicial de `run.stats`. */
export function emptyStats() {
  return {
    count: 0, // fichas medidas (las que respondieron)
    requests: 0, // peticiones hechas (ficha + logs)
    retries: 0,
    bytes: 0,
    ttfbMs: 0,
    downloadMs: 0,
    parseMs: 0,
    logsMs: 0,
  };
}

/** Suma el `timing` de una ficha (inmutable: devuelve un objeto nuevo). */
export function addTiming(stats, timing) {
  const base = stats || emptyStats();
  if (!timing) return base;
  return {
    count: base.count + 1,
    requests: base.requests + (timing.requests || 0),
    retries: base.retries + (timing.retries || 0),
    bytes: base.bytes + (timing.bytes || 0),
    ttfbMs: base.ttfbMs + (timing.ttfbMs || 0),
    downloadMs: base.downloadMs + (timing.downloadMs || 0),
    parseMs: base.parseMs + (timing.parseMs || 0),
    logsMs: base.logsMs + (timing.logsMs || 0),
  };
}

/**
 * Resumen legible del run: ritmo, lo que falta y los promedios por ficha.
 * `now` se inyecta para poder probarlo.
 * @returns {null | {
 *   done, pending, elapsedMs, perMinute, etaMs,
 *   avgTtfbMs, avgDownloadMs, avgParseMs, avgLogsMs, kbPerOrder, retries, requests
 * }}
 */
export function summarizeRun(run, now = Date.now()) {
  if (!run) return null;
  const stats = run.stats || emptyStats();
  const done = run.doneCount || 0;
  const total = run.total || 0;
  const startedAt = run.fetchStartedAt || 0;
  if (!startedAt || !done) return null;

  const endAt = run.active ? now : (run.finishedAt || now);
  const elapsedMs = Math.max(1, endAt - startedAt);
  const perMinute = (done / elapsedMs) * 60000;
  const pending = Math.max(0, total - done);
  const etaMs = perMinute > 0 ? Math.round((pending / perMinute) * 60000) : null;
  const count = stats.count || 0;
  const avg = (value) => (count ? Math.round(value / count) : 0);

  return {
    done,
    pending,
    elapsedMs,
    perMinute,
    etaMs,
    avgTtfbMs: avg(stats.ttfbMs),
    avgDownloadMs: avg(stats.downloadMs),
    avgParseMs: avg(stats.parseMs),
    avgLogsMs: avg(stats.logsMs),
    kbPerOrder: count ? Math.round(stats.bytes / count / 1024) : 0,
    retries: stats.retries || 0,
    requests: stats.requests || 0,
  };
}

/** "1 h 05 min", "12 min 30 s", "45 s". */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.round(total % 60);
  if (hours) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes) return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
  return `${seconds} s`;
}

/** "2,8 s" o "350 ms". */
export function formatMs(ms) {
  const value = Math.max(0, Number(ms) || 0);
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace('.', ',')} s`;
  return `${Math.round(value)} ms`;
}

/**
 * Una linea para el registro y el popup: cuanto se lleva por ficha y donde.
 * La espera es hasta que llega la cabecera de la ficha (cola del navegador +
 * tunel + servidor); la descarga, lo que tarda en bajar el cuerpo.
 */
export function describeSummary(summary) {
  if (!summary) return '';
  const parts = [`${summary.perMinute.toFixed(1).replace('.', ',')} fichas/min`];
  if (summary.avgTtfbMs || summary.avgDownloadMs) {
    parts.push(`espera ${formatMs(summary.avgTtfbMs)} y descarga ${formatMs(summary.avgDownloadMs)} por ficha`);
  }
  if (summary.avgLogsMs) parts.push(`logs ${formatMs(summary.avgLogsMs)} mas`);
  if (summary.kbPerOrder) parts.push(`${summary.kbPerOrder} KB por ficha`);
  if (summary.retries) parts.push(`${summary.retries} reintento(s)`);
  return parts.join(' - ');
}
