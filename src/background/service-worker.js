import { install } from '../shared/debug/index.js';
import { installGlobalErrorCapture } from '../shared/diagnostics/index.js';
import { logger } from '../shared/utils/logger.js';
import { onMessage } from '../shared/messaging/messaging.js';
import { wireDestacadosBackground } from '../features/lgcom/background/destacados.js';
import { wireBusquedaBackground } from '../features/lgcom/background/busqueda.js';
import { wireInformeBackground } from '../features/e-promoters/background/informe.js';
import { wireDevolucionesBackground } from '../features/devoluciones/falabella/background/runner.js';
import { wireGestionBackground } from '../features/devoluciones/falabella/gestion/background/runner.js';
import { wireRegistroAccionesBackground } from '../features/registro-acciones/background/grabador.js';
import { wireVpnBackground } from '../features/vpn/background/conexion.js';
import { wireFacturasBackground } from '../features/facturas/background/index.js';
import '../features/e-promoters/debug.js';
import '../features/registro-acciones/debug.js';
import '../features/vpn/debug.js';

const log = logger('service-worker');
const version = chrome?.runtime?.getManifest?.()?.version;

install({ version, context: 'service-worker' });
installGlobalErrorCapture('service-worker');

// Revisar Destacados (LG.com): disparo manual desde el popup + alarma automática.
wireDestacadosBackground();

// Búsqueda (LG.com): busca una lista de SKUs en el buscador (pestañas de fondo).
wireBusquedaBackground();

// E-promoters — Informe ordenes: procesa y descarga el CSV en segundo plano.
wireInformeBackground();

// Devoluciones: sondea la API, baja los resultados y los guarda en disco.
wireDevolucionesBackground();

// Devoluciones — gestión automática: apela o levanta el ticket en la plataforma.
wireGestionBackground();

// Registro de acciones: graba lo que hace el usuario y arma el Markdown final.
wireRegistroAccionesBackground();

// VPN: apunta el navegador al SOCKS5 de Enlace LG y vigila que siga en pie.
wireVpnBackground();

// Facturas: entrega los adjuntos (base64) al content script del iframe de upload de GEVS.
wireFacturasBackground();

chrome.runtime.onInstalled.addListener((details) => {
  log.info('Extensión instalada/actualizada', { reason: details?.reason, version });
});

onMessage((message) => {
  log.debug('mensaje recibido', message);
});
