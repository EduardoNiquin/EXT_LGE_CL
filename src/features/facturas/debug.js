// Comandos de depuracion: `window.__extLgeCl.facturas.*` en el frame de GEVS
// (cambiar el "JavaScript context" de DevTools al content script del iframe).
// Sirven para las verificaciones previas al driver que lista
// docs/features/facturas-flujo-gevs.md.

import { cmd, register } from '../../shared/debug/index.js';
import { diagnose } from './content/detector.js';
import { leerPantalla } from './content/gevs/lectura.js';
import { elegir, escribir, mensajes } from './content/gevs/campos.js';
import { esperarAccion, tipoDeAccion } from './content/gevs/ppr.js';
import { getPlan, getRun } from './state.js';

register('facturas', {
  diagnose: cmd(() => diagnose(), 'Que pantalla es este frame (ENTRY/LOV/UPLOAD/INQUIRY), batchId, filas'),
  leerPantalla: cmd(() => leerPantalla(), 'Foto de cabecera, credit, filas debit, DFF y adjuntos'),
  run: cmd(() => getRun(), 'La corrida actual en storage'),
  plan: cmd(() => getPlan(), 'El plan de carga actual'),
  mensajes: cmd(() => mensajes(), 'Texto del cuadro de mensajes de OAF'),
  accion: cmd((selector) => tipoDeAccion(document.querySelector(selector)), 'Que hace GEVS al cambiar ese campo: navega | ppr | nada'),
  escribir: cmd(async (selector, valor) => {
    const t0 = Date.now();
    const tipo = await esperarAccion(escribir(selector, valor));
    return { tipo, ms: Date.now() - t0, url: location.href, mensajes: mensajes() };
  }, 'escribir("#PayeeCode", "CL005108"): escribe con blur real y espera la respuesta (PPR o nada)'),
  elegir: cmd(async (selector, value) => {
    const t0 = Date.now();
    const tipo = await esperarAccion(elegir(selector, value));
    return { tipo, ms: Date.now() - t0, url: location.href, mensajes: mensajes() };
  }, 'elegir("#InvoiceTypeId", "55001"): elige en un select y espera la respuesta'),
});
