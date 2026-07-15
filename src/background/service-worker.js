import { install } from '../shared/debug/index.js';
import { installGlobalErrorCapture } from '../shared/diagnostics/index.js';
import { logger } from '../shared/utils/logger.js';
import { onMessage } from '../shared/messaging/messaging.js';
import { wireDestacadosBackground } from '../features/lgcom/background/destacados.js';
import { wireInformeBackground } from '../features/e-promoters/background/informe.js';
import { wireDevolucionesBackground } from '../features/seller-center-falabella/devoluciones/background/runner.js';
import '../features/e-promoters/debug.js';

const log = logger('service-worker');
const version = chrome?.runtime?.getManifest?.()?.version;

install({ version, context: 'service-worker' });
installGlobalErrorCapture('service-worker');

// Revisar Destacados (LG.com): disparo manual desde el popup + alarma automática.
wireDestacadosBackground();

// E-promoters — Informe ordenes: procesa y descarga el CSV en segundo plano.
wireInformeBackground();

// Devoluciones SellerCenter: sondea la API, baja los resultados y los guarda.
wireDevolucionesBackground();

chrome.runtime.onInstalled.addListener((details) => {
  log.info('Extensión instalada/actualizada', { reason: details?.reason, version });
});

onMessage((message) => {
  log.debug('mensaje recibido', message);
});
