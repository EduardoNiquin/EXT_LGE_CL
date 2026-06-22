// Revisión automática de destacados (segundo plano).
//
// Corre dentro del content script de una pestaña de www.lg.com: mientras haya
// una pestaña abierta, revisa los destacados cada X minutos (configurable por
// el usuario). Se apoya en el ultimo run guardado en storage para ser robusto
// ante navegaciones dentro de lg.com (cada carga de pagina no reinicia el
// reloj: calcula cuanto falta desde el ultimo run real). Si no hay ninguna
// pestaña de lg.com abierta, simplemente no corre (best-effort).

import {
  DESTACADOS_AUTO_DEFAULT,
  DESTACADOS_AUTO_MAX_MINUTES,
  DESTACADOS_AUTO_MIN_MINUTES,
  DESTACADOS_URLS,
  STORAGE_KEYS,
} from '../../constants.js';
import { getStorage, setStorage } from '../../../../shared/storage/storage.js';
import { toMessage } from '../../../../shared/errors/index.js';
import { logger } from '../../../../shared/utils/logger.js';
import { checkUrls } from './check.js';

const log = logger('lgcom');

let timer = null;
let running = false;

function clampMinutes(min) {
  const n = Number(min);
  if (!Number.isFinite(n)) return DESTACADOS_AUTO_DEFAULT.intervalMinutes;
  return Math.max(DESTACADOS_AUTO_MIN_MINUTES, Math.min(DESTACADOS_AUTO_MAX_MINUTES, Math.round(n)));
}

async function readConfig() {
  const cfg = (await getStorage(STORAGE_KEYS.DESTACADOS_AUTO)) || {};
  return {
    enabled: Boolean(cfg.enabled),
    intervalMinutes: clampMinutes(cfg.intervalMinutes ?? DESTACADOS_AUTO_DEFAULT.intervalMinutes),
  };
}

function clearTimer() {
  if (timer) { clearTimeout(timer); timer = null; }
}

// Re-evalua cuando correr segun config y ultimo run. Llamado al iniciar y cada
// vez que cambia la config o se guarda un nuevo resultado.
async function reschedule() {
  clearTimer();
  const cfg = await readConfig();
  if (!cfg.enabled) return;

  const last = (await getStorage(STORAGE_KEYS.DESTACADOS_LAST)) || null;
  const lastRanAt = last?.ranAt || 0;
  const intervalMs = cfg.intervalMinutes * 60 * 1000;
  const dueIn = Math.max(0, lastRanAt + intervalMs - Date.now());

  timer = setTimeout(() => { runAuto(); }, dueIn);
  log.debug('destacados auto: proximo run', { dueInMs: dueIn, intervalMin: cfg.intervalMinutes });
}

async function runAuto() {
  if (running) return;
  running = true;
  try {
    // Re-chequea que siga habilitado (pudo apagarse mientras esperabamos).
    const cfg = await readConfig();
    if (!cfg.enabled) return;

    // Evita duplicar si otra pestaña ya corrio dentro del intervalo.
    const last = (await getStorage(STORAGE_KEYS.DESTACADOS_LAST)) || null;
    const intervalMs = cfg.intervalMinutes * 60 * 1000;
    if (last?.ranAt && Date.now() - last.ranAt < intervalMs - 1000) {
      log.debug('destacados auto: otro tab ya reviso, se omite');
      return;
    }

    log.info('destacados auto: revisando', { categorias: DESTACADOS_URLS.length });
    const results = await checkUrls(DESTACADOS_URLS);
    await setStorage(STORAGE_KEYS.DESTACADOS_LAST, {
      ranAt: Date.now(),
      trigger: 'auto',
      results,
    });
  } catch (err) {
    log.error('destacados auto: fallo', new Error(toMessage(err)));
  } finally {
    running = false;
    // Programa el siguiente ciclo (usa el intervalo vigente).
    reschedule();
  }
}

export function initAuto() {
  // El llamador ya garantiza top frame + host lg.com.
  reschedule();

  // Reacciona a cambios de config (encender/apagar, cambiar intervalo) y a
  // resultados escritos por otra pestaña o por el run manual del popup.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEYS.DESTACADOS_AUTO] || changes[STORAGE_KEYS.DESTACADOS_LAST]) {
      reschedule();
    }
  });
}
