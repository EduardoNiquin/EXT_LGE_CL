// Comandos de la feature "VPN" en window.__extLgeCl.vpn
//
// Se importa desde el service worker (donde vive la conexion) y desde el popup
// (via popup/view.js). Los comandos que tocan chrome.proxy solo funcionan en el
// contexto del service worker; desde el popup se usan los de lectura.

import { register, cmd } from '../../shared/debug/index.js';
import { construirPac } from './pac.js';
import { comprobar, reconciliar } from './background/conexion.js';
import { getConfig, getEstadoOInicial, setConfig, clearEstado } from './state.js';

register('vpn', {
  estado: cmd(() => getEstadoOInicial(), 'Estado actual de la conexion (vpn:estado)'),
  config: cmd(() => getConfig(), 'Configuracion guardada (vpn:config)'),
  setConfig: cmd((parcial) => setConfig(parcial), 'Cambia la configuracion; recibe un objeto parcial'),
  pac: cmd(
    async () => {
      const { socks, dominios, redes } = await getConfig();
      return construirPac({ socks, dominios, redes });
    },
    'Imprime el PAC que se aplicaria en modo "Solo sitios de LG"',
  ),
  proxyActual: cmd(
    () => chrome.proxy.settings.get({}),
    'Lo que el navegador tiene puesto ahora mismo, con su levelOfControl',
  ),
  comprobar: cmd(() => comprobar(), 'Sondea el tunel ahora; si cayo, vuelve a directo'),
  reconciliar: cmd(
    () => reconciliar(),
    'Cuadra el estado guardado con el proxy real (lo que corre al arrancar el navegador)',
  ),
  reset: cmd(() => clearEstado(), 'Borra el estado guardado (no toca el proxy)'),
});
