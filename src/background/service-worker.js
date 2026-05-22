import { onMessage } from '../shared/messaging/messaging.js';

chrome.runtime.onInstalled.addListener(() => {
  console.log('[background] Extension installed');
});

onMessage((message) => {
  console.log('[background] Message received:', message);
});
