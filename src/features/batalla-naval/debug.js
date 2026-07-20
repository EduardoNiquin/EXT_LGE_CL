// Comandos de debug de "GATO" -> window.__extLgeCl.gato.*
// Se registran en el contexto del popup (donde corre la feature).

import { register, cmd } from '../../shared/debug/index.js';
import { getRun, clearRun, getUid } from './state.js';
import {
  countActivePlayers,
  listSearchers,
  getLeaderboard,
  getGame,
  dequeue,
  clearPresence,
} from './net.js';

register('gato', {
  uid: cmd(() => getUid(), 'uid estable de este jugador'),
  state: cmd(() => getRun(), 'Estado persistido de la vista (gato:run)'),
  active: cmd(() => countActivePlayers(getUid()), 'Cantidad de otros jugadores activos'),
  searchers: cmd(() => listSearchers(getUid()), 'Otros jugadores buscando partida'),
  leaderboard: cmd(() => getLeaderboard(), 'Ranking global (nombre + victorias)'),
  game: cmd((id) => getGame(id), 'Lee una partida por id: game("uidA__uidB")'),
  leave: cmd(async () => {
    const uid = getUid();
    await dequeue(uid);
    await clearPresence(uid);
    await clearRun();
    return true;
  }, 'Sale de la cola, limpia presencia y resetea el estado local'),
  reset: cmd(() => clearRun(), 'Limpia el estado local de la vista'),
});
