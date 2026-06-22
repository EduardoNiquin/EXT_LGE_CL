import { LOG_LEVEL_KEY, LOG_LEVELS } from '../debug/index.js';
import { isScopeEnabled, registerScope } from '../log-config/index.js';
import { isDevMode } from '../dev-mode/index.js';
import { recordError } from '../diagnostics/index.js';

const ROOT = '[EXT_LGE_CL]';
const LEVEL_RANK = Object.fromEntries(LOG_LEVELS.map((l, i) => [l, i]));

function currentRank() {
  // En modo dev se fuerza el nivel más verboso, sin importar lo persistido.
  if (isDevMode()) return LEVEL_RANK.debug;
  try {
    return LEVEL_RANK[localStorage.getItem(LOG_LEVEL_KEY)] ?? LEVEL_RANK.info;
  } catch {
    return LEVEL_RANK.info;
  }
}

// Todo log de nivel error se registra también en el recorder de diagnóstico
// (shared/diagnostics) para ser inspeccionable desde Ajustes, capture o no la
// consola DevTools del contexto. Buscamos el primer Error entre los args para
// preservar el stack; el resto va como `extra`.
function captureError(scope, args) {
  try {
    const errArg = args.find((a) => a instanceof Error);
    const rest = args.filter((a) => a !== errArg);
    const subject = errArg || rest.map((a) => stringifyArg(a)).join(' ') || 'Error';
    recordError(subject, { context: 'logger', scope, extra: errArg ? rest : null });
  } catch { /* el recorder nunca debe romper el logging */ }
}

function stringifyArg(a) {
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}

function emit(scope, level, prefix, args) {
  if (level === 'error') captureError(scope, args);
  if (!isScopeEnabled(scope)) return;
  if (currentRank() > LEVEL_RANK[level]) return;
  const target = console[level] || console.log;
  target(prefix, ...args);
}

export function logger(scope) {
  registerScope(scope);
  const prefix = `${ROOT}[${scope}]`;
  return {
    debug: (...args) => emit(scope, 'debug', prefix, args),
    info:  (...args) => emit(scope, 'info',  prefix, args),
    warn:  (...args) => emit(scope, 'warn',  prefix, args),
    error: (...args) => emit(scope, 'error', prefix, args),
    group: (label) => isScopeEnabled(scope) && console.group(`${prefix} ${label}`),
    groupEnd: () => console.groupEnd(),
    // Acceso al scope para que código diagnóstico pueda chequearlo.
    scope,
    isEnabled: () => isScopeEnabled(scope),
  };
}
