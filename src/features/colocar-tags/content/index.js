import { MESSAGES } from '../constants.js';
import { isMarketingInfoMappingPage } from './detector.js';
import { parsePage } from './parser.js';

function handleMessage(message, _sender, sendResponse) {
  if (message?.type !== MESSAGES.GET_PAGE_DATA) return false;

  if (!isMarketingInfoMappingPage()) {
    sendResponse({
      ok: false,
      reason: 'No se detectó la pantalla "Marketing Info Mapping" en GP1.',
    });
    return true;
  }

  try {
    sendResponse({ ok: true, data: parsePage() });
  } catch (err) {
    sendResponse({ ok: false, reason: `Error al leer la página: ${err.message}` });
  }
  return true;
}

export function init() {
  chrome.runtime.onMessage.addListener(handleMessage);
}
