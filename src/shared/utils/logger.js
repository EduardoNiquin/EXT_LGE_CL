import { LOG_LEVEL_KEY, LOG_LEVELS } from '../debug/index.js';
import { isScopeEnabled, registerScope } from '../log-config/index.js';

const ROOT = '[EXT_LGE_CL]';
const LEVEL_RANK = Object.fromEntries(LOG_LEVELS.map((l, i) => [l, i]));

function currentRank() {
  try {
    return LEVEL_RANK[localStorage.getItem(LOG_LEVEL_KEY)] ?? LEVEL_RANK.info;
  } catch {
    return LEVEL_RANK.info;
  }
}

function emit(scope, level, prefix, args) {
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
