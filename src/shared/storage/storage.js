export function getStorage(key) {
  return chrome.storage.local.get(key).then((result) => result[key]);
}

export function setStorage(key, value) {
  return chrome.storage.local.set({ [key]: value });
}

export function removeStorage(key) {
  return chrome.storage.local.remove(key);
}
