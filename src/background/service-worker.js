import { onMessage } from '../shared/messaging/messaging.js';

chrome.runtime.onInstalled.addListener(() => {
  console.log('[background] Extension installed');
});

onMessage((message, sender, sendResponse) => {
  console.log('[background] Message received:', message);
});
