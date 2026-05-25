// Registro central de la API de debug expuesta en `window.__extLgeCl`.
// Cada feature llama a `register(namespace, api)` desde su propio debug.js
// y queda accesible como `window.__extLgeCl.<namespace>.<comando>()`.
//
// Diseño:
//   - Funciona en cualquier contexto con `window` (content script, popup, options).
//   - Es idempotente: instalar dos veces no duplica nada.
//   - Cada API expone funciones con `.doc` para que `help()` las describa.
//   - El nivel de log persiste en localStorage para sobrevivir reloads.

export const NAMESPACE = '__extLgeCl';
export const LOG_LEVEL_KEY = '__extLgeCl.logLevel';
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];

const registry = new Map();

export function register(namespace, api) {
  registry.set(namespace, api);
  const root = globalThis?.[NAMESPACE];
  if (root) root[namespace] = api;
}

export function install({ version, context } = {}) {
  if (typeof globalThis === 'undefined') return null;
  if (globalThis[NAMESPACE]) return globalThis[NAMESPACE];

  const root = {
    version: version ?? 'dev',
    context: context ?? 'unknown',
    features: () => Array.from(registry.keys()),
    log: createLogControl(),
    help,
  };
  for (const [name, api] of registry) root[name] = api;

  globalThis[NAMESPACE] = root;

  const prefix = `[EXT_LGE_CL][debug]`;
  console.info(
    `${prefix} API disponible en window.${NAMESPACE}` +
      ` (contexto: ${root.context}) — usa ${NAMESPACE}.help() para ver comandos`,
  );
  return root;
}

function help() {
  const lines = [];
  lines.push(`window.${NAMESPACE} — API de debug`);
  lines.push(`  .version          → ${globalThis[NAMESPACE]?.version}`);
  lines.push(`  .context          → ${globalThis[NAMESPACE]?.context}`);
  lines.push(`  .features()       → lista features registradas`);
  lines.push(`  .log.setLevel(l)  → niveles: ${LOG_LEVELS.join(' | ')}`);
  lines.push(`  .log.getLevel()`);
  lines.push('');
  for (const [name, api] of registry) {
    lines.push(`  ${NAMESPACE}.${name}`);
    for (const key of Object.keys(api)) {
      const v = api[key];
      const doc = typeof v === 'function' && v.doc ? `  — ${v.doc}` : '';
      const sig = typeof v === 'function' ? `${key}()` : key;
      lines.push(`    .${sig}${doc}`);
    }
    lines.push('');
  }
  console.info(lines.join('\n'));
  return undefined;
}

function createLogControl() {
  return {
    setLevel(level) {
      if (!LOG_LEVELS.includes(level)) {
        console.warn(`[EXT_LGE_CL][debug] nivel inválido. Usá uno de: ${LOG_LEVELS.join(', ')}`);
        return;
      }
      try { localStorage.setItem(LOG_LEVEL_KEY, level); } catch { /* no-op */ }
      console.info(`[EXT_LGE_CL][debug] nivel de log: ${level}`);
    },
    getLevel() {
      try { return localStorage.getItem(LOG_LEVEL_KEY) || 'info'; } catch { return 'info'; }
    },
  };
}

/**
 * Helper para que las features marquen sus comandos con documentación
 * legible desde `help()`. Uso: `cmd(fn, 'descripción corta')`.
 */
export function cmd(fn, doc) {
  fn.doc = doc;
  return fn;
}
