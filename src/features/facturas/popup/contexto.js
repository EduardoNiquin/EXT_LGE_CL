// Lo que las vistas del popup necesitan saber de la factura elegida, armado
// una sola vez por render: documento, receta, elegibilidad, adjuntos y plan.

import { getDraft, getResultados } from '../state.js';
import { listarAdjuntos } from '../adjuntos/store.js';
import { armarReceta } from '../reglas/receta.js';
import { evaluarElegibilidad } from '../reglas/validar.js';
import { armarPlan } from '../reglas/plan.js';

/** Receta y elegibilidad de un documento con las hojas del borrador. */
export function evaluarDocumento(draft, documento) {
  const { receta, avisos } = armarReceta({ master2: draft.master2, mapa: draft.mapa, customer: documento.customer, docType: documento.docType });
  return { receta, avisosReceta: avisos, elegibilidad: evaluarElegibilidad(documento, receta) };
}

export async function cargarContexto() {
  const [draft, adjuntos, resultados] = await Promise.all([getDraft(), listarAdjuntos().catch(() => []), getResultados()]);
  const documento = draft?.documentos?.find((d) => d.clave === draft.claveElegida) || null;
  if (!documento) return { draft, adjuntos, resultados, documento: null, receta: null, plan: null };

  const { receta, avisosReceta, elegibilidad } = evaluarDocumento(draft, documento);
  return {
    draft,
    adjuntos,
    resultados,
    documento,
    receta,
    avisosReceta,
    elegibilidad,
    plan: receta ? armarPlan({ documento, receta, adjuntos }) : null,
    yaProcesada: resultados.find((r) => r.clave === documento.clave) || null,
  };
}
