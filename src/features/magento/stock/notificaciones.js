// Textos y plan de las notificaciones del modulo "Stock". PURO (sin chrome.*):
// decide QUE notificar y con que texto; mostrarlas es cosa del service worker
// (shared/notifications).
//
// Hasta MAX_NOTIF_INDIVIDUALES alertas nuevas -> una notificacion por alerta
// (el clic abre la ficha del producto). Mas -> una sola agrupada con el conteo
// por tipo y una lista corta (el clic intenta abrir el popup).

import {
  ESTADO_LABEL,
  MAX_ITEMS_LISTA,
  MAX_NOTIF_INDIVIDUALES,
  NOTIF,
  PORTAL_ATRASADO_MS,
  TIPOS,
  TIPO_LABEL,
} from './constants.js';
import { aTs, fechaHoraChile } from './tiempo.js';
import { formatClp } from '../../../shared/ui/format.js';

/** Solo las alertas de los tipos que la config pide notificar. */
export function filtrarPorTipo(alertas, notificar) {
  const lista = Array.isArray(alertas) ? alertas : [];
  return lista.filter((a) => Boolean(notificar?.[a?.tipo]));
}

export function tituloAlerta(alerta) {
  if (alerta?.tipo === TIPOS.SIN_STOCK) return 'Sin stock en lg.com/cl';
  if (alerta?.tipo === TIPOS.FUERA_DE_TIENDA) return 'Fuera de la tienda';
  if (alerta?.tipo === TIPOS.POCO_STOCK) {
    return alerta.quedan != null ? `Poco stock: quedan ${alerta.quedan}` : 'Poco stock';
  }
  return 'Alerta de stock en lg.com/cl';
}

/** Nombre del producto (o modelo / SKU si el portal no lo trae). */
export function nombreDe(alerta) {
  return String(alerta?.nombre || alerta?.modelo || alerta?.sku || 'Producto sin nombre').trim();
}

export function mensajeAlerta(alerta) {
  const sku = alerta?.sku ? `SKU ${alerta.sku}` : '';
  return [nombreDe(alerta), sku].filter(Boolean).join('\n');
}

function etiquetaEstado(valor) {
  return ESTADO_LABEL[valor] || String(valor ?? '').replace(/_/g, ' ');
}

/** "En stock -> Agotado" (o solo el ahora). */
export function textoCambio(alerta) {
  const ahora = etiquetaEstado(alerta?.ahora);
  if (!alerta?.antes) return ahora;
  return `${etiquetaEstado(alerta.antes)} -> ${ahora}`;
}

function contextoAlerta(alerta) {
  const partes = [];
  if (alerta?.antes || alerta?.ahora) partes.push(textoCambio(alerta));
  if (alerta?.precio_final != null) partes.push(`$${formatClp(alerta.precio_final)}`);
  return partes.join(' · ') || 'lg.com/cl';
}

export function conteoPorTipo(alertas) {
  const out = { [TIPOS.SIN_STOCK]: 0, [TIPOS.FUERA_DE_TIENDA]: 0, [TIPOS.POCO_STOCK]: 0 };
  for (const a of Array.isArray(alertas) ? alertas : []) {
    if (a?.tipo in out) out[a.tipo] += 1;
  }
  return out;
}

/** "2 sin stock, 1 fuera de la tienda, 3 poco stock" (solo los tipos con alertas). */
export function textoConteo(conteo) {
  return [
    [TIPOS.SIN_STOCK, 'sin stock'],
    [TIPOS.FUERA_DE_TIENDA, 'fuera de la tienda'],
    [TIPOS.POCO_STOCK, 'poco stock'],
  ]
    .filter(([tipo]) => (conteo?.[tipo] || 0) > 0)
    .map(([tipo, texto]) => `${conteo[tipo]} ${texto}`)
    .join(', ');
}

/**
 * Que notificaciones mostrar para un lote de alertas nuevas (ya filtradas).
 * @returns {Array<{id:string, opciones:object, url:string|null, alertaId:number|null}>}
 */
export function planNotificaciones(alertas, { ahora = Date.now(), max = MAX_NOTIF_INDIVIDUALES } = {}) {
  const lista = Array.isArray(alertas) ? alertas : [];
  if (!lista.length) return [];
  if (lista.length <= max) {
    return lista.map((a) => ({
      id: `${NOTIF.ALERTA}${a.id}`,
      alertaId: a.id,
      url: a.url || null,
      opciones: {
        type: 'basic',
        title: tituloAlerta(a),
        message: mensajeAlerta(a),
        contextMessage: contextoAlerta(a),
        priority: a.tipo === TIPOS.POCO_STOCK ? 0 : 1,
      },
    }));
  }
  const items = lista.slice(0, MAX_ITEMS_LISTA).map((a) => ({
    title: TIPO_LABEL[a.tipo] || 'Alerta',
    message: `${nombreDe(a)}${a.sku ? ` (${a.sku})` : ''}`,
  }));
  const resto = lista.length - items.length;
  return [{
    id: `${NOTIF.GRUPO}${ahora}`,
    alertaId: null,
    url: null,
    opciones: {
      type: 'list',
      title: `${lista.length} alertas de stock en lg.com/cl`,
      message: textoConteo(conteoPorTipo(lista)),
      items,
      contextMessage: resto > 0 ? `y ${resto} mas: detalle en la extension` : 'Detalle en la extension',
      priority: 1,
    },
  }];
}

/** Notificacion de prueba (para ver que el sistema las deja pasar). */
export function notificacionPrueba(ahora = Date.now()) {
  return {
    id: `${NOTIF.PRUEBA}${ahora}`,
    opciones: {
      type: 'basic',
      title: 'Prueba de notificacion: Stock lg.com/cl',
      message: 'Si ves esto, los avisos de stock van a llegar asi.',
      contextMessage: `EXT LGE CL · ${fechaHoraChile(ahora)}`,
      priority: 0,
    },
  };
}

// -----------------------------------------------------------------------------
// Estado del portal y resumen diario
// -----------------------------------------------------------------------------

/** Instante de una revision (termino o, si no termino, inicio). */
export function instanteRevision(revision) {
  return aTs(revision?.terminada_en) ?? aTs(revision?.empezada_en);
}

/**
 * Si el portal esta atrasado: la ultima revision fallo, o la ultima ok tiene
 * mas de `PORTAL_ATRASADO_MS`.
 * @returns {string|null} el aviso, o null si esta al dia
 */
export function avisoPortal(foto, ahora = Date.now()) {
  if (!foto) return null;
  const avisos = [];
  if (foto.revision?.estado === 'error') {
    avisos.push(`La ultima revision del portal fallo${foto.revision.mensaje ? `: ${foto.revision.mensaje}` : '.'}`);
  }
  const ultimaOk = instanteRevision(foto.ultima_ok);
  if (ultimaOk == null) {
    avisos.push('El portal todavia no tiene una revision ok de la tienda.');
  } else if (ahora - ultimaOk > PORTAL_ATRASADO_MS) {
    avisos.push(`El portal no revisa la tienda desde ${fechaHoraChile(ultimaOk)}.`);
  }
  return avisos.length ? avisos.join(' ') : null;
}

/** Linea de contadores del resumen del portal. */
export function textoResumen(resumen) {
  const r = resumen || {};
  const partes = [
    `En stock ${r.en_stock ?? 0}`,
    `Agotados ${r.agotado ?? 0}`,
    `Poco stock ${r.poco_stock ?? 0}`,
    `Fuera ${r.fuera ?? 0}`,
  ];
  if (r.preventa) partes.splice(1, 0, `Preventa ${r.preventa}`);
  return partes.join(' · ');
}

/** Alertas creadas en las ultimas `ventanaMs`. */
export function alertasRecientes(alertas, ahora = Date.now(), ventanaMs = 24 * 60 * 60 * 1000) {
  return (Array.isArray(alertas) ? alertas : []).filter((a) => {
    const t = aTs(a?.creada_en);
    return t != null && t >= ahora - ventanaMs && t <= ahora + 60000;
  });
}

/**
 * Notificacion del resumen diario.
 * @param {object} o
 * @param {object|null} o.foto        GET /stock normalizado (null si fallo)
 * @param {Array} [o.alertas24h]      alertas de las ultimas 24 h
 * @param {string} [o.error]          por que no hay foto
 * @returns {{id:string, opciones:object, atrasado:boolean}}
 */
export function notificacionResumen({ foto, alertas24h = [], error = null, ahora = Date.now() } = {}) {
  const id = `${NOTIF.RESUMEN}${ahora}`;
  if (!foto) {
    return {
      id,
      atrasado: true,
      opciones: {
        type: 'basic',
        title: 'Revision diaria de stock: sin datos',
        message: `No se pudo leer el estado del portal${error ? `: ${error}` : '.'}`,
        contextMessage: `lg.com/cl · ${fechaHoraChile(ahora)}`,
        priority: 1,
      },
    };
  }
  const aviso = avisoPortal(foto, ahora);
  const n = alertas24h.length;
  const conteo = textoConteo(conteoPorTipo(alertas24h));
  const lineas = [
    aviso,
    textoResumen(foto.resumen),
    `Alertas 24 h: ${n}${n && conteo ? ` (${conteo})` : ''}`,
  ].filter(Boolean);
  const ultimaOk = instanteRevision(foto.ultima_ok);
  return {
    id,
    atrasado: Boolean(aviso),
    opciones: {
      type: 'basic',
      title: aviso ? 'Revision diaria de stock: el portal esta atrasado' : 'Revision diaria de stock lg.com/cl',
      message: lineas.join('\n'),
      contextMessage: ultimaOk != null ? `Ultima revision ok: ${fechaHoraChile(ultimaOk)}` : 'lg.com/cl',
      priority: aviso ? 1 : 0,
    },
  };
}
