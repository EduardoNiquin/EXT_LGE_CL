export function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

export function sendTabMessage(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

export function onMessage(handler) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handler(message, sender, sendResponse);
    return true; // keep channel open for async responses
  });
}
