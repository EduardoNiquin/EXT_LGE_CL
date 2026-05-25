import { LOG_LEVEL_KEY, LOG_LEVELS } from '../debug/index.js';

const ROOT = '[EXT_LGE_CL]';
const LEVEL_RANK = Object.fromEntries(LOG_LEVELS.map((l, i) => [l, i]));

function currentRank() {
  try {
    return LEVEL_RANK[localStorage.getItem(LOG_LEVEL_KEY)] ?? LEVEL_RANK.info;
  } catch {
    return LEVEL_RANK.info;
  }
}

function emit(level, prefix, args) {
  if (currentRank() > LEVEL_RANK[level]) return;
  const target = console[level] || console.log;
  target(prefix, ...args);
}

export function logger(scope) {
  const prefix = `${ROOT}[${scope}]`;
  return {
    debug: (...args) => emit('debug', prefix, args),
    info:  (...args) => emit('info',  prefix, args),
    warn:  (...args) => emit('warn',  prefix, args),
    error: (...args) => emit('error', prefix, args),
    group: (label) => console.group(`${prefix} ${label}`),
    groupEnd: () => console.groupEnd(),
  };
}
