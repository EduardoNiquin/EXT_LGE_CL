// Pedir una descarga desde donde `chrome.downloads` NO existe.
//
// `chrome.downloads` solo esta en las paginas de la extension y en el service
// worker: un content script no lo ve. Y un content script es justo el que tiene
// los datos en la mano en las features que corren dentro de la pagina
// (Informacion de Orden baja un CSV por cada tanda de ordenes que cierra).
//
// Por eso el texto viaja al service worker y el service worker lo baja. Ver
// `background.js` para el por que de la data URL.

export const DOWNLOAD_MESSAGE = 'shared:downloads:text';

/**
 * Pide al service worker que baje un archivo de texto.
 *
 * No lanza: devuelve `{ ok:false, error }` para que quien lo llama decida. En
 * medio de una corrida larga, que una descarga falle no puede cortar el trabajo
 * (los datos siguen en storage).
 *
 * @param {object} o
 * @param {string} o.filename  ruta relativa a Descargas (acepta subcarpetas)
 * @param {string} o.text      contenido del archivo
 * @param {string} [o.mime]
 * @param {boolean} [o.wait=true]  esperar a que el archivo este escrito
 * @returns {Promise<{ok:boolean,id?:number,error?:string}>}
 */
export async function requestDownload({ filename, text, mime, wait = true }) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: DOWNLOAD_MESSAGE,
      filename,
      text,
      mime,
      wait,
    });
    return response || { ok: false, error: 'el service worker no respondio' };
  } catch (err) {
    // Contexto invalidado (la extension se recargo) o SW caido.
    return { ok: false, error: err?.message || String(err) };
  }
}
