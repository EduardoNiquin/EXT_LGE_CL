// Comandos de debug de "Falabella SellerCenter" → window.__extLgeCl.falabellaSellercenter.*
// Se registran en el service worker (donde corren las llamadas a la API).
// Ninguno devuelve la API Key.

import { register, cmd } from '../../shared/debug/index.js';
import { clearResult, clearRun, getResult, getRun } from './state.js';
import { cancelPaquetes, probarCredenciales, runPaquetes } from './paquetes/background/run.js';
import { estadoCredenciales, resolverCredenciales } from './api/credenciales.js';
import { llamar } from './api/cliente.js';
import { analizarItems } from './paquetes/analisis.js';

const cred = async () => (await resolverCredenciales())?.cred;

register('falabellaSellercenter', {
  paquetes: cmd(
    ({ desde, hasta } = {}) => runPaquetes({ desde, hasta }),
    'Corre "Identificar paquetes": paquetes({desde:"2026-10-01", hasta:"2026-10-07"})',
  ),
  cancel: cmd(() => cancelPaquetes(), 'Cancela el analisis en curso'),
  state: cmd(() => getRun(), 'Estado de la corrida'),
  result: cmd(() => getResult(), 'Ordenes con problema del ultimo analisis'),
  reset: cmd(async () => { await clearRun(); await clearResult(); return true; }, 'Limpia corrida y resultado'),
  credenciales: cmd(() => estadoCredenciales(), 'Fuente de las credenciales (incluidas/propias) y UserID'),
  probar: cmd(() => probarCredenciales(), 'Prueba las credenciales vigentes'),
  api: cmd(
    async (action, filtros = {}) => llamar(await cred(), action, filtros),
    'Llamada firmada cruda: api("GetOrder", {OrderId:"1167611729"})',
  ),
  orden: cmd(async (orderId) => {
    const ok = await llamar(await cred(), 'GetOrderItems', { OrderId: String(orderId) });
    const items = [].concat(ok.Body?.OrderItems?.OrderItem ?? []);
    return { items: items.map((i) => ({ sku: i.Sku, estado: i.Status, paquete: i.PackageId, guia: i.TrackingCode })), analisis: analizarItems(items) };
  }, 'Items y veredicto de una orden por OrderId interno: orden("1167611729")'),
});
