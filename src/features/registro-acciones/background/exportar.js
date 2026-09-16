// Genera los archivos y los baja.
//
// Corre en el service worker, donde NO existe `URL.createObjectURL`: la via es
// convertir el texto a una data URL en base64 y pasarsela a `chrome.downloads`
// (mismo camino que `e-promoters/background/informe.js`). El base64 se arma por
// bloques de 0x8000 porque `String.fromCharCode.apply` revienta con arreglos
// grandes.
//
// Los eventos se leen por CURSOR y se le pasan al constructor de Markdown de a
// uno: una sesion larga no tiene por que entrar en memoria para poder exportarse.

import { toMessage } from '../../../shared/errors/index.js';
import { EXPORT, EXPORTACION } from '../constants.js';
import { duracionEfectiva, getRun, updateRun } from '../state.js';
import { construirIndice, crearConstructor } from '../markdown.js';

const MIME = 'text/markdown;charset=utf-8';

function base64DeTexto(texto) {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  const bloque = 0x8000;
  for (let i = 0; i < bytes.length; i += bloque) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + bloque));
  }
  return btoa(binario);
}

function descargar(texto, nombreArchivo) {
  const url = `data:${MIME};base64,${base64DeTexto(texto)}`;
  return new Promise((resolve) => {
    try {
      chrome.downloads.download({ url, filename: nombreArchivo, saveAs: false }, (id) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve({ ok: true, id });
      });
    } catch (err) {
      resolve({ ok: false, error: toMessage(err) });
    }
  });
}

/**
 * Espera a que el archivo este realmente escrito. Sin esto, disparar diez
 * descargas seguidas puede terminar en archivos a medias sin que nadie se entere.
 */
function esperarDescarga(id, timeoutMs = 20000) {
  if (id == null) return Promise.resolve({ ok: false, error: 'sin id de descarga' });

  return new Promise((resolve) => {
    let listo = false;

    const terminar = (resultado) => {
      if (listo) return;
      listo = true;
      try { chrome.downloads.onChanged.removeListener(alCambiar); } catch { /* no-op */ }
      clearTimeout(reloj);
      resolve(resultado);
    };

    function alCambiar(delta) {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') terminar({ ok: true });
      else if (delta.state?.current === 'interrupted') terminar({ ok: false, error: delta.error?.current || 'descarga interrumpida' });
    }

    const reloj = setTimeout(() => terminar({ ok: false, error: 'la descarga no termino a tiempo' }), timeoutMs);
    chrome.downloads.onChanged.addListener(alCambiar);

    // Puede haber terminado antes de que enganchemos el listener.
    chrome.downloads.search({ id }, (resultados) => {
      const estado = resultados?.[0]?.state;
      if (estado === 'complete') terminar({ ok: true });
      else if (estado === 'interrupted') terminar({ ok: false, error: 'descarga interrumpida' });
    });
  });
}

/**
 * Arma el Markdown de la sesion guardada y lo descarga en
 * `registro-acciones/<sesion>/`.
 *
 * @param {{ store: object, log: object }} config
 */
export async function exportarSesion({ store, log }) {
  const run = await getRun();
  if (!run) return { ok: false, reason: 'No hay ninguna grabacion que exportar.' };

  const sesionId = run.sesionId || 'sesion';

  await updateRun((r) => (r ? {
    ...r,
    exportacion: { ...r.exportacion, estado: EXPORTACION.GENERANDO, error: null, partes: [] },
  } : r));

  try {
    const sesion = {
      sesionId,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      duracionMs: duracionEfectiva(run),
      motivoFin: run.finishReason,
    };

    const constructor = crearConstructor({ sesion });
    let leidos = 0;

    await store.recorrer({
      tamano: 500,
      onChunk: (bloque) => {
        for (const evento of bloque) constructor.agregar(evento);
        leidos += bloque.length;
      },
    });

    if (!leidos) {
      await updateRun((r) => (r ? {
        ...r,
        exportacion: { ...r.exportacion, estado: EXPORTACION.ERROR, error: 'No se grabo ningun evento.' },
      } : r));
      return { ok: false, reason: 'No se grabo ningun evento.' };
    }

    const { partes, estadisticas, paginas } = constructor.terminar();
    const indice = construirIndice({ sesion, partes, estadisticas, paginas });
    const carpeta = `${EXPORT.carpeta}/${sesionId}`;

    const archivos = [
      { nombre: `${EXPORT.nombreIndice}.md`, contenido: indice, eventos: 0 },
      ...partes,
    ];

    const descargadas = [];
    for (const archivo of archivos) {
      const ruta = `${carpeta}/${archivo.nombre}`;
      const inicio = await descargar(archivo.contenido, ruta);

      if (!inicio.ok) {
        descargadas.push({ nombre: archivo.nombre, ok: false, error: inicio.error });
        log.warn('no se pudo descargar una parte', { archivo: archivo.nombre, error: inicio.error });
        continue;
      }

      const fin = await esperarDescarga(inicio.id);
      descargadas.push({
        nombre: archivo.nombre,
        ok: fin.ok,
        error: fin.error || null,
        eventos: archivo.eventos || 0,
        bytes: archivo.bytes ?? archivo.contenido.length,
      });
    }

    const fallidas = descargadas.filter((d) => !d.ok);
    const estado = fallidas.length ? EXPORTACION.ERROR : EXPORTACION.LISTO;

    await updateRun((r) => (r ? {
      ...r,
      exportacion: {
        estado,
        carpeta,
        partes: descargadas,
        error: fallidas.length ? `No se pudieron guardar ${fallidas.length} archivo(s).` : null,
      },
    } : r));

    log.info('registro exportado', { carpeta, archivos: descargadas.length, eventos: leidos });

    return {
      ok: !fallidas.length,
      carpeta,
      archivos: descargadas,
      eventos: leidos,
      estadisticas,
    };
  } catch (err) {
    const reason = toMessage(err);
    log.error('fallo la exportacion', err);
    await updateRun((r) => (r ? {
      ...r,
      exportacion: { ...r.exportacion, estado: EXPORTACION.ERROR, error: reason },
    } : r));
    return { ok: false, reason };
  }
}
