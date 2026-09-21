export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function downloadText(text, filename, mime = 'text/csv;charset=utf-8') {
  return downloadBlob(new Blob([text], { type: mime }), filename);
}

/**
 * Baja un archivo ya armado. Se prefiere `chrome.downloads` (la extension ya
 * pide el permiso) porque bajar VARIOS archivos seguidos con clics sintetizados
 * en un `<a>` dispara el aviso de "descargas multiples" del navegador y puede
 * perder alguno; ademas avisa cuando la descarga arranco, asi el que baja varias
 * las encadena. El `<a>` queda como respaldo.
 *
 * Se recibe un Blob y no un string para poder armar un archivo grande por
 * pedazos (`new Blob([parte1, parte2, ...])`) sin concatenarlo todo en memoria.
 */
export async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    if (chrome?.downloads?.download) {
      await new Promise((resolve, reject) => {
        chrome.downloads.download({ url, filename, saveAs: false }, (id) => {
          const error = chrome.runtime.lastError;
          if (error || id == null) reject(new Error(error?.message || 'chrome.downloads fallo'));
          else resolve(id);
        });
      });
      return;
    }
    clickToDownload(url, filename);
  } catch {
    clickToDownload(url, filename);
  } finally {
    // El blob se libera tarde: la descarga lee la URL despues de arrancar, y si
    // se revoca enseguida queda a medias.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function clickToDownload(url, filename) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
