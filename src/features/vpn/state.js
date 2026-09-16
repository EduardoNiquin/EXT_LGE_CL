// Persistencia de la feature "VPN".
//
// Dos cosas separadas a proposito:
//
//   vpn:config  lo que la persona eligio (modo, socks, listas). Sobrevive a
//               desconectar y es lo que se reaplica la proxima vez.
//   vpn:estado  como esta la conexion AHORA, mas un registro de los ultimos
//               eventos. El service worker es el unico writer; el popup solo
//               lee y se suscribe.
//
// El estado usa createRunStore aunque esto no sea un "batch": lo que se
// necesita es exactamente lo que da —updateRun con escrituras coaleascidas,
// appendLog con tope y subscribeToRun— y el registro con tope es justo lo que
// hace explicable una desconexion que ocurrio con el popup cerrado.

import { createPersistedValue, createRunStore } from '../../shared/run-store/index.js';
import {
  CLAVE_POR_DEFECTO,
  DOMINIOS_LG,
  LOG_CAP,
  MODO,
  ORIGEN,
  REDES_LG,
  SERVIDOR_POR_DEFECTO,
  SOCKS_POR_DEFECTO,
  STORAGE_KEYS,
  USUARIO_POR_DEFECTO,
} from './constants.js';

const store = createRunStore({ key: STORAGE_KEYS.ESTADO, logCap: LOG_CAP });
export const {
  getRun: getEstado,
  setRun: setEstado,
  clearRun: clearEstado,
  updateRun: updateEstado,
  appendLog,
  subscribeToRun: subscribeToEstado,
} = store;

const config = createPersistedValue(STORAGE_KEYS.CONFIG, null);

/**
 * La configuracion de fabrica.
 *
 * Origen "servidor" porque es el que no exige instalar nada, y modo acotado
 * porque es el que no rompe el resto de la navegacion si el tunel cae.
 */
export function configPorDefecto() {
  return {
    origen: ORIGEN.SERVIDOR,
    modo: MODO.LG,
    servidor: SERVIDOR_POR_DEFECTO,
    usuario: USUARIO_POR_DEFECTO,
    clave: CLAVE_POR_DEFECTO,
    socks: SOCKS_POR_DEFECTO,
    dominios: [...DOMINIOS_LG],
    redes: [...REDES_LG],
  };
}

/** Lee la config completando lo que falte; nunca devuelve null. */
export async function getConfig() {
  const guardada = await config.get();
  return { ...configPorDefecto(), ...(guardada || {}) };
}

export async function setConfig(parcial) {
  const actual = await getConfig();
  const nueva = { ...actual, ...parcial };
  await config.set(nueva);
  return nueva;
}

/** El estado con el que arranca todo: desconectado y sin historia. */
export function estadoInicial() {
  return {
    conectado: false,
    modo: null,
    desde: null,
    ultimoSondeo: null,
    ultimoError: null,
    motivo: null,
    ipSalida: null,
    log: [],
  };
}

/** Como getEstado, pero sin null: la UI no tiene que saber del primer arranque. */
export async function getEstadoOInicial() {
  return (await getEstado()) || estadoInicial();
}

/**
 * Deja el estado escrito si todavia no existe.
 *
 * Hace falta porque updateRun() del run-store no escribe cuando no hay nada
 * guardado —resuelve null y no toca storage—, asi que el primerisimo
 * updateEstado de una instalacion nueva se perderia en silencio.
 */
export async function asegurarEstado() {
  const actual = await getEstado();
  if (actual) return actual;
  const inicial = estadoInicial();
  await setEstado(inicial);
  return inicial;
}
