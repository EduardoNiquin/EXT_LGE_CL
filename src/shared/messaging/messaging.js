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
