// De eventos a Markdown.
//
// Este archivo es el producto de la feature: lo que se descarga y lo que va a
// leer una IA para proponer como automatizar el proceso. Decisiones de formato,
// y por que:
//
//   · Una seccion `##` por VISITA de pagina, con el inventario antes de las
//     acciones: primero el mapa, despues el recorrido.
//   · Un bloque `####` por accion, con campos de nombre fijo (Elemento,
//     Selector, Valor, Contexto, Efecto). Legible para una persona y parseable
//     con una expresion regular.
//   · `#N` es la id global del evento, asi que una referencia cruzada entre
//     partes ("causado por #704") sigue funcionando aunque #704 este en otro
//     archivo.
//   · Las consecuencias se escriben DENTRO de la accion que las provoco. Es lo
//     que convierte el registro en algo automatizable: no solo "apreto Guardar"
//     sino "y hay que esperar a que desaparezca la mascara de carga".
//
// Modulo PURO: sin DOM, sin `chrome.*`. Se construye por streaming (evento a
// evento) porque una sesion larga no entra comoda en memoria.

import { EXPORT, LIMITES, MOTIVO_FIN, TIPOS } from './constants.js';
import { nombreDe, resumirEvento, rutaDe } from './resumen.js';

/** Tipos que no son "acciones": aportan contexto, no pasos. */
const NO_SON_ACCION = new Set([
  TIPOS.PAGINA_INVENTARIO,
  TIPOS.PAGINA_VISITA,
  TIPOS.APARECIO,
  TIPOS.DESAPARECIO,
  TIPOS.SESION_INICIO,
  // Cambiar de pestana ya lo cuenta `pestana.activada`, que ademas dice a cual.
  // Aqui solo generaban bloques vacios, uno por pestana abierta.
  TIPOS.PAGINA_VISIBLE,
  TIPOS.PAGINA_OCULTA,
]);

// -----------------------------------------------------------------------------
// Formato
// -----------------------------------------------------------------------------

const dos = (n) => String(n).padStart(2, '0');

export function hora(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

export function fechaHora(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${hora(ts)}`;
}

export function duracion(ms) {
  if (!ms || ms < 0) return '0s';
  const segundos = Math.round(ms / 1000);
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Segundos con una decimal, para los tiempos de reaccion. */
function segundos(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Texto seguro dentro de una celda de tabla Markdown. */
function celda(texto) {
  if (texto == null || texto === '') return '-';
  return String(texto).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Codigo en linea, cuidando los backticks que traiga el contenido. */
function codigo(texto) {
  if (!texto) return '-';
  const limpio = String(texto).replace(/`/g, "'");
  return `\`${limpio}\``;
}

function comillas(texto) {
  return texto ? `"${String(texto).replace(/"/g, "'")}"` : '';
}

function bytesDe(texto) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(texto).length;
  return texto.length;
}

// -----------------------------------------------------------------------------
// Bloques
// -----------------------------------------------------------------------------

/** Cabecera de una visita de pagina. */
function cabeceraVisita(visita, causa) {
  const lineas = [];
  const titulo = visita.titulo || rutaDe(visita.url) || '(sin titulo)';

  lineas.push(`## ${visita.etiqueta} - ${hora(visita.desde)} - ${titulo}`);
  lineas.push('');
  lineas.push(`- **URL:** ${codigo(visita.url)}`);

  const frame = visita.frameId === 0 ? 'frame principal' : `frame ${visita.frameId}`;
  lineas.push(`- **Pestana:** ${visita.pestanaId ?? '?'} (${frame})`);

  if (causa) {
    lineas.push(`- **Llegada:** ${causa}`);
  } else if (visita.tipoNavegacion) {
    lineas.push(`- **Llegada:** navegacion ${codigo(visita.tipoNavegacion)}`);
  }

  lineas.push('');
  return lineas;
}

/** Inventario de la pantalla, en tablas. */
function bloqueInventario(inventario) {
  if (!inventario) return [];
  const lineas = ['### Inventario', ''];

  if (inventario.encabezados?.length) {
    lineas.push(`**En pantalla:** ${inventario.encabezados.map((h) => h.texto).join(' / ')}`, '');
  }

  if (inventario.formularios?.length) {
    lineas.push('**Formularios**', '');
    lineas.push('| id | selector | accion | metodo | campos |');
    lineas.push('|---|---|---|---|---|');
    for (const form of inventario.formularios) {
      lineas.push(`| ${form.id} | ${celda(form.selector)} | ${celda(form.accion)} | ${form.metodo} | ${form.campos} |`);
    }
    lineas.push('');
  }

  if (inventario.campos?.length) {
    lineas.push('**Campos**', '');
    lineas.push('| etiqueta | selector | tipo | form | valor |');
    lineas.push('|---|---|---|---|---|');
    for (const campo of inventario.campos) {
      const valor = campo.enmascarado ? campo.valor : (campo.valor || '');
      lineas.push([
        '',
        celda(campo.etiqueta),
        celda(campo.selector),
        celda(campo.tipo + (campo.requerido ? ' *' : '')),
        celda(campo.formulario),
        celda(valor),
        '',
      ].join(' | ').trim());
    }
    lineas.push('');
  }

  if (inventario.botones?.length) {
    const botones = inventario.botones
      .map((b) => `${comillas(b.texto)} (${codigo(b.selector)})${b.deshabilitado ? ' [deshabilitado]' : ''}`)
      .join(' - ');
    lineas.push(`**Botones (${inventario.botones.length}):** ${botones}`, '');
  }

  if (inventario.tablas?.length) {
    for (const tabla of inventario.tablas) {
      const columnas = tabla.columnas?.length ? tabla.columnas.join(', ') : 'sin encabezados';
      lineas.push(`**Tabla ${codigo(tabla.selector)}:** ${tabla.filas} filas - columnas: ${columnas}`);
      if (tabla.muestra?.length) {
        lineas.push('');
        lineas.push(`| ${(tabla.columnas || []).map(celda).join(' | ')} |`);
        lineas.push(`|${(tabla.columnas || []).map(() => '---').join('|')}|`);
        for (const fila of tabla.muestra) {
          lineas.push(`| ${fila.map(celda).join(' | ')} |`);
        }
      }
      lineas.push('');
    }
  }

  if (inventario.enlaces?.length) {
    const enlaces = inventario.enlaces.slice(0, 20)
      .map((e) => `${comillas(e.texto)} -> ${codigo(e.href)}`)
      .join(' - ');
    lineas.push(`**Enlaces (${inventario.enlaces.length}):** ${enlaces}`, '');
  }

  if (inventario.iframes?.length) {
    lineas.push(`**iframes:** ${inventario.iframes.map((f) => codigo(f.src || f.id)).join(' - ')}`, '');
  }

  if (inventario.truncado?.length) {
    lineas.push(`> Inventario recortado - ${inventario.truncado.join('; ')}.`, '');
  }

  return lineas;
}

/** Detalle de un elemento descrito, en lineas de campo fijo. */
function lineasDeElemento(elemento, rotulo = 'Elemento') {
  if (!elemento) return [];
  const lineas = [];
  const descripcion = [elemento.rol || elemento.tag, comillas(nombreDe(elemento))].filter(Boolean).join(' ');

  lineas.push(`- **${rotulo}:** ${descripcion}`);
  lineas.push(`- **Selector:** ${codigo(elemento.selector)}`);

  if (elemento.rutaShadow) {
    lineas.push(`- **Shadow DOM:** ${elemento.rutaShadow.map(codigo).join(' -> ')}`);
  }
  if (elemento.href) {
    lineas.push(`- **Enlace:** ${codigo(elemento.href)}`);
  }
  if (elemento.datos && Object.keys(elemento.datos).length) {
    const datos = Object.entries(elemento.datos).map(([k, v]) => `${k}=${v}`).join(', ');
    lineas.push(`- **Atributos:** ${datos}`);
  }

  const contexto = elemento.contexto || {};
  const partes = [];
  if (contexto.formulario) partes.push(`formulario ${codigo(contexto.formulario.selector)}`);
  if (contexto.dialogo) partes.push(`modal ${comillas(contexto.dialogo.titulo) || codigo(contexto.dialogo.selector)}`);
  if (contexto.seccion) partes.push(`seccion ${comillas(contexto.seccion)}`);
  if (contexto.frame?.length) partes.push(`iframe ${codigo(contexto.frame[contexto.frame.length - 1])}`);
  if (partes.length) lineas.push(`- **Contexto:** ${partes.join(' - ')}`);

  if (contexto.tabla) {
    const t = contexto.tabla;
    lineas.push(`- **En tabla:** ${codigo(t.selector)} fila ${t.fila}, columna ${t.columna}${t.encabezado ? ` (${t.encabezado})` : ''}`);
    if (t.textoFila) lineas.push(`  - fila: ${codigo(t.textoFila)}`);
  }

  return lineas;
}

/** Cuerpo de una accion, segun su tipo. */
function cuerpoDeAccion(evento) {
  const datos = evento.datos || {};

  switch (evento.tipo) {
    case TIPOS.CLIC: {
      const lineas = lineasDeElemento(datos.elemento);
      const extras = [];
      if (datos.boton && datos.boton !== 'izquierdo') extras.push(`boton ${datos.boton}`);
      if (datos.dobleClic) extras.push('doble clic');
      if (datos.modificadores?.length) extras.push(`con ${datos.modificadores.join('+')}`);
      if (datos.abreEnPestanaNueva) extras.push('abre en pestana nueva');
      if (extras.length) lineas.push(`- **Detalle:** ${extras.join(', ')}`);
      return lineas;
    }

    case TIPOS.CAMPO_CAMBIO: {
      const lineas = lineasDeElemento(datos.elemento, 'Campo');
      if (datos.marcado !== undefined) {
        lineas.push(`- **Queda:** ${datos.marcado ? 'marcado' : 'sin marcar'}`);
      } else if (datos.archivos?.length) {
        const archivos = datos.archivos.map((a) => `${a.nombre} (${a.tamano} bytes)`).join(', ');
        lineas.push(`- **Archivos:** ${archivos}`);
      } else {
        lineas.push(`- **Valor final:** ${codigo(datos.valor)}${datos.enmascarado ? ' *(enmascarado)*' : ` *(${datos.longitud} caracteres)*`}`);
        if (datos.valorAnterior) lineas.push(`- **Valor anterior:** ${codigo(datos.valorAnterior)}`);
      }
      if (datos.opcion) lineas.push(`- **Opcion elegida:** ${comillas(datos.opcion.texto)} (value ${codigo(datos.opcion.valor)})`);
      return lineas;
    }

    case TIPOS.TECLA: {
      const combo = [...(datos.modificadores || []), datos.tecla].join('+');
      const lineas = [`- **Tecla:** ${codigo(combo)}`];
      if (datos.elemento) lineas.push(`- **Foco en:** ${codigo(datos.elemento.selector)} ${comillas(datos.elemento.texto)}`.trim());
      return lineas;
    }

    case TIPOS.ENVIO_FORMULARIO: {
      const lineas = lineasDeElemento(datos.formulario, 'Formulario');
      lineas.push(`- **Destino:** ${datos.metodo || 'GET'} ${codigo(datos.accion)}`);
      if (datos.disparadoPor) lineas.push(`- **Disparado por:** ${comillas(datos.disparadoPor.texto)} (${codigo(datos.disparadoPor.selector)})`);
      if (datos.campos?.length) {
        const campos = datos.campos
          .map((c) => `${c.nombre}=${c.enmascarado ? '(oculto)' : (c.valor || '(vacio)')}`)
          .join(' - ');
        lineas.push(`- **Campos enviados:** ${campos}`);
      }
      return lineas;
    }

    case TIPOS.COPIAR:
    case TIPOS.CORTAR:
    case TIPOS.PEGAR: {
      const lineas = [];
      const destino = datos.destino || datos.origen;
      lineas.push(`- **Texto:** ${codigo(datos.muestra)} *(${datos.longitud} caracteres${datos.enmascarado ? ', enmascarado' : ''})*`);
      if (destino) lineas.push(`- **${evento.tipo === TIPOS.PEGAR ? 'Destino' : 'Origen'}:** ${codigo(destino.selector)} ${comillas(destino.texto)}`.trim());
      return lineas;
    }

    case TIPOS.NAVEGACION:
    case TIPOS.NAVEGACION_SPA: {
      const lineas = [];
      if (datos.urlAnterior) lineas.push(`- **Desde:** ${codigo(datos.urlAnterior)}`);
      lineas.push(`- **Hacia:** ${codigo(evento.url)}`);
      if (datos.tipo) lineas.push(`- **Tipo:** ${codigo(datos.tipo)}`);
      if (datos.calificadores?.length) lineas.push(`- **Calificadores:** ${datos.calificadores.join(', ')}`);
      return lineas;
    }

    case TIPOS.PESTANA_ABIERTA: {
      const lineas = [`- **URL:** ${codigo(evento.url)}`];
      if (datos.abiertaPor != null) lineas.push(`- **Abierta desde la pestana:** ${datos.abiertaPor}`);
      if (datos.enSegundoPlano) lineas.push('- **Detalle:** se abrio en segundo plano');
      return lineas;
    }

    case TIPOS.DESCARGA:
      return [
        `- **Archivo:** ${codigo(datos.nombreArchivo)}`,
        `- **Origen:** ${codigo(evento.url)}`,
      ];

    case TIPOS.NAVEGACION_ERROR:
      return [`- **Error:** ${datos.error || 'sin detalle'}`, `- **URL:** ${codigo(evento.url)}`];

    default: {
      const lineas = [];
      if (datos.elemento) lineas.push(...lineasDeElemento(datos.elemento));
      return lineas;
    }
  }
}

/** Las consecuencias que se le atribuyeron a esta accion. */
function lineasDeEfectos(efectos) {
  return efectos.map((efecto) => {
    const datos = efecto.datos || {};
    const verbo = efecto.tipo === TIPOS.APARECIO ? 'aparece' : 'desaparece';
    const texto = datos.texto ? `: ${datos.texto}` : '';
    const donde = datos.elemento?.selector ? ` ${codigo(datos.elemento.selector)}` : '';
    return `- **Efecto (+${segundos(datos.msDesdeAccion || 0)}):** ${verbo} ${datos.clase || 'algo'}${donde}${texto}`;
  });
}

// -----------------------------------------------------------------------------
// Constructor por streaming
// -----------------------------------------------------------------------------

/**
 * Va recibiendo eventos en orden y devolviendo las partes ya armadas.
 *
 * Las acciones no se escriben apenas llegan: quedan en una cola corta hasta que
 * pasa la ventana de consecuencias (o hasta `terminar()`), porque un
 * `aparecio`/`desaparecio` que llega despues tiene que quedar DENTRO del bloque
 * de la accion que lo provoco.
 *
 * @param {{ sesion: object, limites?: object }} config
 */
export function crearConstructor({ sesion = {}, limites = {} } = {}) {
  const topes = {
    bytesPorParte: limites.bytesPorParte ?? EXPORT.bytesPorParte,
    eventosPorParte: limites.eventosPorParte ?? EXPORT.eventosPorParte,
    ventanaCausaMs: limites.ventanaCausaMs ?? LIMITES.ventanaCausaMs,
  };

  const partes = [];
  const resumenes = new Map();     // id -> resumen corto, para las referencias cruzadas
  const paginas = [];              // indice de visitas, para el archivo indice
  const porTipo = {};

  let parte = null;
  let visita = null;
  let pendientes = [];             // acciones esperando sus consecuencias
  let totalEventos = 0;
  let primerTs = null;
  let ultimoTs = null;
  let numeroVisita = 0;

  function abrirParte() {
    parte = {
      numero: partes.length + 1,
      lineas: [],
      bytes: 0,
      eventos: 0,
      desde: null,
      hasta: null,
      primerId: null,
      ultimoId: null,
    };
    partes.push(parte);
  }

  function escribir(lineas) {
    if (!parte) abrirParte();
    for (const linea of lineas) {
      parte.lineas.push(linea);
      parte.bytes += bytesDe(linea) + 1;
    }
  }

  function parteLlena() {
    return parte && (parte.bytes >= topes.bytesPorParte || parte.eventos >= topes.eventosPorParte);
  }

  /** Corta aca y sigue en una parte nueva, repitiendo la cabecera de la visita. */
  function cortarParte() {
    if (!parte) return;
    abrirParte();
    if (visita) {
      escribir([
        `## ${visita.etiqueta} (continuacion) - ${visita.titulo || rutaDe(visita.url)}`,
        '',
        `- **URL:** ${codigo(visita.url)}`,
        `- **Pestana:** ${visita.pestanaId ?? '?'}`,
        `> El inventario de esta pagina esta en \`${EXPORT.nombreParte}_${visita.parteInicial}.md\`.`,
        '',
        '### Acciones',
        '',
      ]);
    }
  }

  function cerrarAccion(entrada) {
    const { evento, efectos } = entrada;
    asegurarCabecera();
    const lineas = [];

    lineas.push(`#### #${evento.id ?? '?'} - ${hora(evento.ts)} - ${evento.tipo}`);
    lineas.push('');

    if (evento.accionId && resumenes.has(evento.accionId)) {
      lineas.push(`> Causado por #${evento.accionId} (${resumenes.get(evento.accionId)}).`);
      lineas.push('');
    } else if (evento.accionId) {
      lineas.push(`> Causado por #${evento.accionId}.`);
      lineas.push('');
    }

    const cuerpo = cuerpoDeAccion(evento);
    // Un bloque sin una sola linea no le dice nada a nadie: al menos va el
    // resumen en prosa.
    lineas.push(...(cuerpo.length ? cuerpo : [`- **Resumen:** ${resumirEvento(evento)}`]));
    if (efectos.length) lineas.push(...lineasDeEfectos(efectos));
    lineas.push('');

    escribir(lineas);
    parte.eventos++;
    parte.desde = parte.desde ?? evento.ts;
    parte.hasta = evento.ts;
    parte.primerId = parte.primerId ?? evento.id;
    parte.ultimoId = evento.id ?? parte.ultimoId;

    if (parteLlena()) cortarParte();
  }

  /** Suelta las acciones cuya ventana de consecuencias ya vencio. */
  function drenar(hasta) {
    while (pendientes.length) {
      const entrada = pendientes[0];
      if (hasta != null && (hasta - entrada.evento.ts) < topes.ventanaCausaMs) break;
      pendientes.shift();
      cerrarAccion(entrada);
    }
  }

  /**
   * Prepara una visita, pero NO escribe nada todavia.
   *
   * La cabecera se escribe cuando llega su primera accion (ver
   * `asegurarCabecera`). Sin eso, cada pestana abierta de fondo — que emite su
   * `pagina.visita` sin que el usuario toque nada — abriria una seccion vacia, y
   * el recorrido del indice terminaria lleno de paginas donde no paso nada.
   * De paso, para cuando se escribe la cabecera ya llego el `pagina.visita` con
   * el titulo real (la `navegacion` del service worker no lo trae).
   */
  function abrirVisita(evento) {
    drenar(null);   // lo que quedaba pertenece a la pagina anterior

    visita = {
      etiqueta: null,
      url: evento.url || null,
      titulo: evento.titulo || evento.datos?.titulo || null,
      pestanaId: evento.pestanaId ?? null,
      frameId: evento.frameId ?? 0,
      desde: evento.ts,
      parteInicial: null,
      acciones: 0,
      cabeceraEscrita: false,
      inventarioPendiente: null,
      causaId: evento.accionId || null,
      tipoNavegacion: evento.datos?.tipo || null,
    };
  }

  function asegurarCabecera() {
    if (!visita || visita.cabeceraEscrita) return;

    numeroVisita++;
    visita.etiqueta = `P${numeroVisita}`;
    visita.parteInicial = (parte?.numero) || partes.length + 1;
    visita.cabeceraEscrita = true;

    const causa = visita.causaId && resumenes.has(visita.causaId)
      ? `#${visita.causaId} (${resumenes.get(visita.causaId)})${visita.tipoNavegacion ? ` -> navegacion \`${visita.tipoNavegacion}\`` : ''}`
      : null;

    escribir(cabeceraVisita(visita, causa));

    if (visita.inventarioPendiente) {
      escribir(bloqueInventario(visita.inventarioPendiente));
      visita.inventarioPendiente = null;
    }

    escribir(['### Acciones', '']);
    paginas.push(visita);
  }

  function hito(texto) {
    drenar(null);
    escribir(['', `> **${texto}**`, '']);
  }

  return {
    /**
     * @param {object} evento  tal como salio de IndexedDB (con `id`)
     */
    agregar(evento) {
      if (!evento) return;
      totalEventos++;
      primerTs = primerTs ?? evento.ts;
      ultimoTs = evento.ts;
      porTipo[evento.tipo] = (porTipo[evento.tipo] || 0) + 1;

      if (evento.id != null) resumenes.set(evento.id, resumirEvento(evento));

      // Consecuencias: van dentro de su accion si todavia esta en la cola.
      if (evento.tipo === TIPOS.APARECIO || evento.tipo === TIPOS.DESAPARECIO) {
        const duena = pendientes.find((p) => p.evento.id === evento.accionId);
        if (duena) {
          duena.efectos.push(evento);
          return;
        }
      }

      drenar(evento.ts);

      switch (evento.tipo) {
        case TIPOS.SESION_INICIO:
          escribir([
            `> **Inicio de la grabacion** - ${fechaHora(evento.ts)}`,
            '',
          ]);
          return;

        case TIPOS.SESION_PAUSA:
          hito(`PAUSA a las ${hora(evento.ts)} - lo que el usuario hizo mientras tanto no se grabo`);
          return;

        case TIPOS.SESION_REANUDAR:
          hito(`Se reanuda la grabacion a las ${hora(evento.ts)}`);
          return;

        case TIPOS.SESION_FIN:
          hito(`FIN de la grabacion a las ${hora(evento.ts)} (${evento.datos?.motivo || MOTIVO_FIN.USUARIO})`);
          return;

        case TIPOS.NOTA:
          escribir([`> Nota: ${evento.datos?.mensaje || ''}`, '']);
          return;

        case TIPOS.PAGINA_INVENTARIO: {
          // El inventario tiene que ser de ESTA pagina. Con varias pestanas
          // abiertas llegan inventarios de todas, y sin este control el mapa de
          // una pantalla terminaba pegado debajo del encabezado de otra.
          const esDeEstaVisita = visita
            && evento.url === visita.url
            && (evento.pestanaId == null || evento.pestanaId === visita.pestanaId);

          if (esDeEstaVisita && !visita.inventariada) {
            visita.inventariada = true;
            if (visita.cabeceraEscrita) escribir(bloqueInventario(evento.datos));
            else visita.inventarioPendiente = evento.datos;
          }
          return;
        }

        case TIPOS.PAGINA_VISITA:
        case TIPOS.NAVEGACION:
        case TIPOS.NAVEGACION_SPA: {
          const cambio = !visita
            || evento.url !== visita.url
            || (evento.pestanaId != null && evento.pestanaId !== visita.pestanaId);

          if (cambio) {
            abrirVisita(evento);
            // La navegacion tambien se anota como paso: es lo que explica el
            // salto (y trae el tipo y los redirects).
            if (evento.tipo !== TIPOS.PAGINA_VISITA) {
              pendientes.push({ evento, efectos: [] });
            }
            return;
          }

          // Misma pagina: el `pagina.visita` del frame solo aporta el titulo
          // que a la `navegacion` del service worker le faltaba.
          if (evento.tipo === TIPOS.PAGINA_VISITA) {
            if (visita && !visita.titulo) visita.titulo = evento.titulo || evento.datos?.titulo || null;
            return;
          }

          pendientes.push({ evento, efectos: [] });
          return;
        }

        default:
          break;
      }

      if (NO_SON_ACCION.has(evento.tipo)) return;

      if (!visita) abrirVisita(evento);
      if (visita) visita.acciones++;
      pendientes.push({ evento, efectos: [] });
    },

    terminar() {
      drenar(null);

      const total = partes.length;
      const armadas = partes.map((p) => ({
        numero: p.numero,
        nombre: `${EXPORT.nombreParte}_${p.numero}.md`,
        contenido: [
          ...frontMatter({
            sesion, parte: p, total, partes,
          }),
          ...p.lineas,
        ].join('\n'),
        eventos: p.eventos,
        desde: p.desde,
        hasta: p.hasta,
        primerId: p.primerId,
        ultimoId: p.ultimoId,
      })).map((p) => ({ ...p, bytes: bytesDe(p.contenido) }));

      return {
        partes: armadas,
        estadisticas: {
          total: totalEventos,
          porTipo,
          paginas: paginas.length,
          desde: primerTs,
          hasta: ultimoTs,
        },
        paginas,
      };
    },
  };
}

/** Cabecera YAML + navegacion entre partes. */
function frontMatter({ sesion, parte, total }) {
  const lineas = [
    '---',
    'registro: acciones-de-usuario',
    'version: 1',
    `sesion: ${sesion.sesionId || ''}`,
    `parte: ${parte.numero}`,
    `de: ${total}`,
    `eventos: ${parte.eventos}`,
    `rango_ids: ${parte.primerId ?? '-'}-${parte.ultimoId ?? '-'}`,
    `desde: ${fechaHora(parte.desde)}`,
    `hasta: ${fechaHora(parte.hasta)}`,
  ];

  if (parte.numero > 1) lineas.push(`continua_de: ${EXPORT.nombreParte}_${parte.numero - 1}.md`);
  if (parte.numero < total) lineas.push(`sigue_en: ${EXPORT.nombreParte}_${parte.numero + 1}.md`);

  lineas.push('---', '');
  lineas.push(`# Registro de acciones - parte ${parte.numero} de ${total}`, '');

  if (parte.numero > 1) {
    lineas.push(`> Viene de \`${EXPORT.nombreParte}_${parte.numero - 1}.md\`. El resumen de la sesion esta en \`${EXPORT.nombreIndice}.md\`.`, '');
  } else {
    lineas.push(`> Resumen de la sesion en \`${EXPORT.nombreIndice}.md\`.`, '');
  }

  return lineas;
}

// -----------------------------------------------------------------------------
// Indice
// -----------------------------------------------------------------------------

/**
 * El archivo que se lee primero: que se grabo, cuanto, en que paginas y donde
 * esta cada cosa.
 */
export function construirIndice({ sesion = {}, partes = [], estadisticas = {}, paginas = [] } = {}) {
  const lineas = [
    '---',
    'registro: acciones-de-usuario',
    'version: 1',
    'archivo: indice',
    `sesion: ${sesion.sesionId || ''}`,
    `inicio: ${fechaHora(sesion.startedAt || estadisticas.desde)}`,
    `fin: ${fechaHora(sesion.finishedAt || estadisticas.hasta)}`,
    `duracion: ${duracion(sesion.duracionMs ?? ((estadisticas.hasta || 0) - (estadisticas.desde || 0)))}`,
    `eventos: ${estadisticas.total || 0}`,
    `paginas: ${paginas.length}`,
    `partes: ${partes.length}`,
    '---',
    '',
    '# Registro de acciones - resumen',
    '',
    'Grabacion de lo que hizo una persona en el navegador, paso a paso, pensada para',
    'reconstruir el flujo y evaluar como automatizarlo.',
    '',
  ];

  if (sesion.motivoFin) {
    lineas.push(`**Fin de la grabacion:** ${sesion.motivoFin}.`, '');
  }

  lineas.push('## Partes', '');
  lineas.push('| archivo | eventos | desde | hasta |');
  lineas.push('|---|---|---|---|');
  for (const parte of partes) {
    lineas.push(`| \`${parte.nombre}\` | ${parte.eventos} | ${hora(parte.desde)} | ${hora(parte.hasta)} |`);
  }
  lineas.push('');

  if (paginas.length) {
    lineas.push('## Recorrido', '');
    lineas.push('| # | pagina | URL | entro | acciones |');
    lineas.push('|---|---|---|---|---|');
    for (const pagina of paginas) {
      lineas.push([
        '',
        pagina.etiqueta,
        celda(pagina.titulo || '-'),
        celda(pagina.url),
        hora(pagina.desde),
        String(pagina.acciones || 0),
        '',
      ].join(' | ').trim());
    }
    lineas.push('');
  }

  const tipos = Object.entries(estadisticas.porTipo || {}).sort((a, b) => b[1] - a[1]);
  if (tipos.length) {
    lineas.push('## Acciones por tipo', '');
    lineas.push('| tipo | cantidad |');
    lineas.push('|---|---|');
    for (const [tipo, cantidad] of tipos) lineas.push(`| ${tipo} | ${cantidad} |`);
    lineas.push('');
  }

  lineas.push('## Como leer estos archivos', '');
  lineas.push('- Cada `## P<n>` es una **pagina visitada**: primero su inventario (que habia disponible) y despues las acciones que se hicieron ahi.');
  lineas.push('- Cada `#### #<id>` es una **accion**, con la hora, el selector del elemento y el efecto que tuvo.');
  lineas.push('- `Causado por #<id>` enlaza una navegacion con el clic o el envio que la provoco, aunque esten en partes distintas.');
  lineas.push('- Los valores marcados como *(enmascarado)* se omitieron a proposito: solo se guardo el largo.');
  lineas.push('');

  return lineas.join('\n');
}

/** Atajo para pruebas y para lotes que si entran en memoria. */
export function generarPartes(eventos, sesion = {}, limites = {}) {
  const constructor = crearConstructor({ sesion, limites });
  for (const evento of eventos) constructor.agregar(evento);
  const { partes, estadisticas, paginas } = constructor.terminar();
  return {
    partes,
    estadisticas,
    paginas,
    indice: construirIndice({ sesion, partes, estadisticas, paginas }),
  };
}
