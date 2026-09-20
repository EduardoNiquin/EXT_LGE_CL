// Persistencia de "Facturas". Cuatro cosas separadas:
//
//   facturas:draft       lo que el popup cargo del Excel (documentos ya agrupados,
//                        recetas y Map) y la factura elegida. No guarda el workbook.
//   facturas:plan        el plan de carga de la corrida (lo que el content escribe).
//   facturas:run         la corrida: paso en curso, batchId, esperas (LOV, adjuntos).
//                        La abre el SW (MESSAGES.INICIAR, porque antes abre la
//                        bitacora), el content es el writer y el popup solo
//                        cancela o la da por terminada.
//   facturas:resultados  facturas ya guardadas/enviadas, para no repetirlas.

import { createPersistedValue, createRunStore } from '../../shared/run-store/index.js';
import { FASE, LOG_CAP, STORAGE_KEYS } from './constants.js';

const store = createRunStore({ key: STORAGE_KEYS.RUN, logCap: LOG_CAP });
export const { getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun } = store;

const draft = createPersistedValue(STORAGE_KEYS.DRAFT, null);
export const getDraft = draft.get;
export const setDraft = draft.set;

const plan = createPersistedValue(STORAGE_KEYS.PLAN, null);
export const getPlan = plan.get;
export const setPlan = plan.set;

const resultados = createPersistedValue(STORAGE_KEYS.RESULTADOS, []);
export const getResultados = resultados.get;

/** Registra (o actualiza) el resultado de una factura, identificada por su clave. */
export async function registrarResultado(entrada) {
  const lista = (await resultados.get()).filter((r) => r.clave !== entrada.clave);
  lista.push({ ...entrada, fecha: Date.now() });
  await resultados.set(lista);
}

/**
 * Forma inicial de una corrida.
 * @param {object} o
 * @param {object} o.plan     salida de armarPlan (sin errores)
 * @param {object} [o.config] { pasoAPaso: boolean, bitacora: boolean }
 * @param {object|null} [o.bitacora] { sesionId, propia } si la corrida se graba en Registro de acciones
 */
export function makeRun({ plan: planDeCarga, config = {}, bitacora = null }) {
  return {
    active: true,
    claimed: null,          // token del frame que la reclamo
    heartbeatAt: null,
    fase: FASE.CARGANDO,
    paso: null,             // id del paso en curso
    pasosHechos: [],        // ids ya verificados en pantalla
    pausado: false,         // en modo paso a paso: espera "Continuar"
    batchId: null,          // lo asigna GEVS en el primer Save
    reference: null,        // lo devuelve GEVS tras el Submit de la persona
    esperaLov: null,        // { campo, valor } mientras se espera que la ventana LOV resuelva
    adjuntoEnCurso: null,   // { id, nombre } mientras el iframe de upload lo sube
    adjuntoSubido: false,
    config: { pasoAPaso: !!config.pasoAPaso, bitacora: !!config.bitacora },
    bitacora,               // { sesionId, propia }: propia = la abrio esta corrida y la cierra al terminar
    plan: planDeCarga,
    startedAt: Date.now(),
    finishedAt: null,
    finishReason: null,
    error: '',
    log: [{ ts: Date.now(), level: 'info', message: `Preparando la carga de ${planDeCarga.customer} ${planDeCarga.invoiceNumber}` }],
  };
}
