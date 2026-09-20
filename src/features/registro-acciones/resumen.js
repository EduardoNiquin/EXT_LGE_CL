// Resumir un evento en una linea.
//
// La misma frase se usa en dos lados: el feed en vivo del popup (para que el
// usuario vea que se esta grabando lo que cree) y el encabezado de cada accion
// en el Markdown. Tenerla en un solo lugar evita que diverjan.
//
// Modulo puro: sin DOM, sin `chrome.*`, sin estado.

import { TIPOS } from './constants.js';

/** Etiqueta corta por tipo, para el badge del feed. */
export const ETIQUETAS = {
  [TIPOS.SESION_INICIO]: 'INICIO',
  [TIPOS.SESION_PAUSA]: 'PAUSA',
  [TIPOS.SESION_REANUDAR]: 'SIGUE',
  [TIPOS.SESION_FIN]: 'FIN',
  [TIPOS.NOTA]: 'NOTA',
  [TIPOS.EXTENSION]: 'EXT',
  [TIPOS.PESTANA_ABIERTA]: 'PESTANA',
  [TIPOS.PESTANA_ACTIVADA]: 'PESTANA',
  [TIPOS.PESTANA_CERRADA]: 'PESTANA',
  [TIPOS.NAVEGACION]: 'NAVEGA',
  [TIPOS.NAVEGACION_SPA]: 'NAVEGA',
  [TIPOS.NAVEGACION_ERROR]: 'ERROR',
  [TIPOS.DESCARGA]: 'DESCARGA',
  [TIPOS.PAGINA_VISITA]: 'PAGINA',
  [TIPOS.PAGINA_INVENTARIO]: 'MAPA',
  [TIPOS.PAGINA_OCULTA]: 'PAGINA',
  [TIPOS.PAGINA_VISIBLE]: 'PAGINA',
  [TIPOS.CLIC]: 'CLIC',
  [TIPOS.CAMPO_CAMBIO]: 'CAMPO',
  [TIPOS.TECLA]: 'TECLA',
  [TIPOS.ENVIO_FORMULARIO]: 'ENVIO',
  [TIPOS.COPIAR]: 'COPIA',
  [TIPOS.CORTAR]: 'CORTA',
  [TIPOS.PEGAR]: 'PEGA',
  [TIPOS.APARECIO]: 'APARECE',
  [TIPOS.DESAPARECIO]: 'CIERRA',
};

/** Nombre util de un elemento descrito: lo primero que lo identifique. */
export function nombreDe(elemento) {
  if (!elemento) return 'elemento';
  return elemento.texto
    || elemento.etiqueta
    || elemento.selectorCorto
    || elemento.selector
    || elemento.tag
    || 'elemento';
}

/** Solo la ruta de una URL, para no llenar el feed de dominios repetidos. */
export function rutaDe(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return String(url);
  }
}

function comillas(texto) {
  return texto ? `"${texto}"` : '';
}

/**
 * Una linea que describa el evento para una persona.
 *
 * @param {object} evento
 * @returns {string}
 */
export function resumirEvento(evento) {
  if (!evento) return '';
  const datos = evento.datos || {};

  switch (evento.tipo) {
    case TIPOS.CLIC: {
      const nombre = nombreDe(datos.elemento);
      const rol = datos.elemento?.rol === 'enlace' ? 'enlace' : datos.elemento?.rol || 'elemento';
      const boton = datos.boton && datos.boton !== 'izquierdo' ? ` (boton ${datos.boton})` : '';
      const doble = datos.dobleClic ? ' (doble)' : '';
      return `Clic en ${rol} ${comillas(nombre)}${boton}${doble}`;
    }

    case TIPOS.CAMPO_CAMBIO: {
      const etiqueta = datos.etiqueta || nombreDe(datos.elemento);
      if (datos.marcado !== undefined) return `${datos.marcado ? 'Marca' : 'Desmarca'} ${comillas(etiqueta)}`;
      if (datos.archivos?.length) return `Adjunta ${datos.archivos.length} archivo(s) en ${comillas(etiqueta)}`;
      return `Campo ${comillas(etiqueta)} = ${datos.valor || '(vacio)'}`;
    }

    case TIPOS.TECLA: {
      const combo = [...(datos.modificadores || []), datos.tecla].join('+');
      const donde = datos.elemento ? ` en ${nombreDe(datos.elemento)}` : '';
      return `Tecla ${combo}${donde}`;
    }

    case TIPOS.ENVIO_FORMULARIO:
      return `Envia formulario ${datos.formulario?.selectorCorto || ''} (${datos.metodo || 'GET'} ${datos.accion || ''})`.trim();

    case TIPOS.COPIAR:
      return `Copia ${datos.longitud || 0} caracteres`;
    case TIPOS.CORTAR:
      return `Corta ${datos.longitud || 0} caracteres`;
    case TIPOS.PEGAR:
      return `Pega ${datos.longitud || 0} caracteres en ${nombreDe(datos.destino)}`;

    case TIPOS.NAVEGACION: {
      const tipo = datos.tipo ? ` (${datos.tipo})` : '';
      return `Navega a ${rutaDe(evento.url)}${tipo}`;
    }
    case TIPOS.NAVEGACION_SPA:
      return `Cambia de pantalla a ${rutaDe(evento.url)}`;
    case TIPOS.NAVEGACION_ERROR:
      return `Falla la navegacion a ${rutaDe(evento.url)}: ${datos.error || 'sin detalle'}`;

    case TIPOS.PESTANA_ABIERTA:
      return `Abre pestana ${rutaDe(evento.url)}`;
    case TIPOS.PESTANA_ACTIVADA:
      return `Cambia a la pestana ${evento.titulo || rutaDe(evento.url)}`;
    case TIPOS.PESTANA_CERRADA:
      return `Cierra pestana ${evento.titulo || rutaDe(evento.url)}`;

    case TIPOS.PAGINA_VISITA:
      return `Entra a ${datos.titulo || rutaDe(evento.url)}`;
    case TIPOS.PAGINA_INVENTARIO: {
      const campos = datos.campos?.length || 0;
      const botones = datos.botones?.length || 0;
      const tablas = datos.tablas?.length || 0;
      return `Mapa de la pagina: ${campos} campos, ${botones} botones, ${tablas} tablas`;
    }
    case TIPOS.PAGINA_OCULTA:
      return 'Deja de mirar la pestana';
    case TIPOS.PAGINA_VISIBLE:
      return 'Vuelve a la pestana';

    case TIPOS.APARECIO:
      return `Aparece ${datos.clase || 'algo'}: ${datos.texto || nombreDe(datos.elemento)}`;
    case TIPOS.DESAPARECIO:
      return `Desaparece ${datos.clase || 'algo'}`;

    case TIPOS.DESCARGA:
      return `Descarga ${datos.nombreArchivo || ''}`.trim();

    case TIPOS.SESION_INICIO:
      return 'Comienza la grabacion';
    case TIPOS.SESION_PAUSA:
      return 'Grabacion en pausa';
    case TIPOS.SESION_REANUDAR:
      return 'Grabacion reanudada';
    case TIPOS.SESION_FIN:
      return `Fin de la grabacion (${datos.motivo || 'usuario'})`;
    case TIPOS.NOTA:
      return datos.mensaje || 'Nota';
    case TIPOS.EXTENSION:
      return `[${datos.feature || 'extension'}] ${datos.mensaje || 'accion de la extension'}`;

    default:
      return evento.tipo;
  }
}

/** Lo que guarda el ring del feed: corto y ya listo para pintar. */
export function resumenParaFeed(evento) {
  return {
    ts: evento.ts,
    tipo: evento.tipo,
    etiqueta: ETIQUETAS[evento.tipo] || 'EVENTO',
    resumen: resumirEvento(evento),
    detalle: evento.datos?.elemento?.selector || evento.datos?.formulario?.selector || null,
    url: evento.url || null,
  };
}

/** Agrupa los eventos por visita de pagina, que es como se arma el Markdown. */
export function agruparPorVisita(eventos) {
  const visitas = [];
  let actual = null;

  const abrir = (evento) => {
    actual = {
      numero: visitas.length + 1,
      url: evento.url || null,
      titulo: evento.titulo || evento.datos?.titulo || null,
      pestanaId: evento.pestanaId ?? null,
      frameId: evento.frameId ?? 0,
      desde: evento.ts,
      hasta: evento.ts,
      causaId: evento.accionId || null,
      tipoNavegacion: evento.datos?.tipo || null,
      inventario: null,
      eventos: [],
    };
    visitas.push(actual);
  };

  for (const evento of eventos) {
    const esVisita = evento.tipo === TIPOS.PAGINA_VISITA
      || evento.tipo === TIPOS.NAVEGACION
      || evento.tipo === TIPOS.NAVEGACION_SPA;

    // Una visita nueva empieza cuando cambia la URL o la pestana; los eventos de
    // sesion no abren pagina (no pertenecen a ninguna).
    const cambio = !actual
      || (esVisita && (evento.url !== actual.url || evento.pestanaId !== actual.pestanaId));

    if (cambio && evento.url) abrir(evento);

    if (!actual) {
      abrir(evento);
    }

    if (evento.tipo === TIPOS.PAGINA_INVENTARIO) {
      actual.inventario = evento.datos;
      actual.titulo = actual.titulo || evento.datos?.titulo || null;
      continue;
    }

    if (evento.tipo === TIPOS.PAGINA_VISITA) {
      actual.titulo = evento.datos?.titulo || actual.titulo;
    }

    actual.hasta = evento.ts;
    actual.eventos.push(evento);
  }

  return visitas;
}

/** Numeros para el indice: cuanto de cada cosa hubo. */
export function estadisticas(eventos) {
  const porTipo = {};
  const urls = new Set();
  const pestanas = new Set();

  for (const evento of eventos) {
    porTipo[evento.tipo] = (porTipo[evento.tipo] || 0) + 1;
    if (evento.url) urls.add(evento.url);
    if (evento.pestanaId != null) pestanas.add(evento.pestanaId);
  }

  return {
    total: eventos.length,
    porTipo,
    paginas: urls.size,
    pestanas: pestanas.size,
    desde: eventos.length ? eventos[0].ts : null,
    hasta: eventos.length ? eventos[eventos.length - 1].ts : null,
  };
}
