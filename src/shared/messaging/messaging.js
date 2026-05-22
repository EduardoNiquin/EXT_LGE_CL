export function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

export async function sendMessageToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No hay pestaña activa.');
  return chrome.tabs.sendMessage(tab.id, message);
}

export function onMessage(handler) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handler(message, sender, sendResponse);
    return true;
  });
}
