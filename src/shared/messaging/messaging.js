export function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No hay pestana activa.');
  return tab;
}

export async function sendMessageToActiveTab(message) {
  const tab = await getActiveTab();
  return chrome.tabs.sendMessage(tab.id, message);
}

export async function navigateActiveTab(url) {
  const tab = await getActiveTab();
  return chrome.tabs.update(tab.id, { url });
}

export function onMessage(handler) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handler(message, sender, sendResponse);
    return true;
  });
}

/**
 * Abre un canal persistente con el service worker.
 *
 * Se usa cuando un flujo manda muchos mensajes seguidos o no puede perder los
 * ultimos: a diferencia de `sendMessage`, el port entrega lo que se postea justo
 * antes de que el documento se descargue (navegacion), le da al receptor la
 * identidad del emisor (`port.sender.tab.id` / `frameId`) sin que el emisor
 * tenga que conocerla, y mantiene vivo al service worker mientras este abierto.
 *
 * Devuelve `null` si no hay runtime (contexto invalidado tras una recarga de la
 * extension): quien llama decide si reintenta.
 *
 * @param {string} nombre  nombre del port (constante `PORTS.*` de la feature)
 */
export function connectToBackground(nombre) {
  try {
    return chrome.runtime.connect({ name: nombre });
  } catch {
    return null;
  }
}
