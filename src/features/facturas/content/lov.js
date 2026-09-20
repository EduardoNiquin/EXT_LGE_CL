// La ventana "Search and Select: Vat Rate Id" que OAF abre al salir del campo
// Tax Code. Es una pestana aparte del mismo host: recibe este content script y
// lee en el run que valor se esperaba (`esperaLov`). Solo actua con un match
// EXACTO del codigo; si no lo hay, avisa y deja la ventana para la persona.

import { SELECTORS } from '../constants.js';
import { anotar, registrar } from './bitacora.js';

let actuado = false;

export async function resolverLov(run) {
  const espera = run.esperaLov;
  if (!espera || actuado) return;
  const url = new URL(location.href);
  const buscado = url.searchParams.get('searchText') || espera.valor;

  const filas = Array.from(document.querySelectorAll(SELECTORS.lov.filas));
  const fila = filas.find((tr) => {
    const celdas = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim());
    return celdas.includes(espera.valor);
  });
  if (!fila) {
    actuado = true;
    await registrar('warn', `La ventana LOV no muestra "${espera.valor}" (busco "${buscado}"): elige la fila a mano.`, { detalle: { filas: filas.length } });
    return;
  }
  const radio = fila.querySelector(SELECTORS.lov.radio);
  const select = Array.from(document.querySelectorAll(SELECTORS.lov.boton)).find((b) => b.textContent.trim() === 'Select');
  if (!radio || !select) return;
  actuado = true;
  radio.click();
  await registrar('info', `LOV: elegido ${espera.valor}`, { elemento: { selector: SELECTORS.lov.radio }, valor: espera.valor });
  anotar('Pulsa "Select" en la ventana LOV (la cierra y GEVS resuelve la cuenta)', { respuesta: 'navega' });
  select.click();
}
