// Que se guarda y que no.
//
// El registro graba TODO lo que el usuario hace en cualquier pestana, asi que la
// clave del correo o el numero de una tarjeta pueden pasar por delante. La regla
// es: se conserva siempre el SELECTOR, la ETIQUETA y el LARGO — con eso el paso
// se puede automatizar igual — pero no el contenido.
//
// Modulo puro (sin DOM propio ni `chrome.*`) porque lo usan los tres contextos:
// el content al describir un campo, el service worker al exportar y el popup al
// mostrar el feed.

import { normalizar } from '../../shared/dom/describe.js';

export const MOTIVOS = {
  PASSWORD: 'tipo-password',
  AUTOCOMPLETE: 'autocomplete',
  NOMBRE: 'nombre-sensible',
  MARCADO: 'marcado-en-la-pagina',
  TARJETA: 'parece-tarjeta',
  CONTACTO: 'dato-de-contacto',
};

/** Nombres/ids/etiquetas que delatan un dato secreto. */
const PISTAS_SENSIBLES = /(pass|pwd|clave|contrasen|cvv|cvc|csc|tarjeta|card|creditcard|cuenta|pin\b|otp|token|secret|secreto|seguridad|firma|apikey|api-key)/;

/** Valores de autocomplete que el estandar reserva para datos secretos. */
const AUTOCOMPLETE_SENSIBLE = new Set([
  'current-password', 'new-password', 'cc-number', 'cc-csc', 'cc-exp',
  'cc-exp-month', 'cc-exp-year', 'one-time-code',
]);

const RUT_RE = /^\s*\d{1,2}\.?\d{3}\.?\d{3}\s*-?\s*[\dkK]\s*$/;
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Luhn: separa un numero de tarjeta de un numero de orden largo. */
export function pareceTarjeta(valor) {
  const digitos = String(valor || '').replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digitos)) return false;

  let suma = 0;
  let alternar = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let n = Number(digitos[i]);
    if (alternar) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    suma += n;
    alternar = !alternar;
  }
  return suma % 10 === 0;
}

/**
 * Decide si un campo es sensible mirando el elemento. Devuelve el motivo (para
 * dejarlo escrito en el registro) o `null`.
 *
 * @param {Element} el
 * @param {string} [valor]  el contenido, para las heuristicas por valor
 * @param {{ enmascararContacto?: boolean }} [opciones]
 */
export function motivoSensible(el, valor = '', opciones = {}) {
  try {
    if (el) {
      if (el.type === 'password') return MOTIVOS.PASSWORD;

      const autocompletar = normalizar(el.getAttribute?.('autocomplete'));
      if (autocompletar && AUTOCOMPLETE_SENSIBLE.has(autocompletar)) return MOTIVOS.AUTOCOMPLETE;

      if (el.hasAttribute?.('data-sensitive') || el.hasAttribute?.('data-private')) return MOTIVOS.MARCADO;
      if (el.closest?.('[data-sensitive], [data-private]')) return MOTIVOS.MARCADO;

      const pistas = normalizar([
        el.getAttribute?.('name'),
        el.id,
        el.getAttribute?.('aria-label'),
        el.getAttribute?.('placeholder'),
      ].filter(Boolean).join(' '));
      if (pistas && PISTAS_SENSIBLES.test(pistas)) return MOTIVOS.NOMBRE;
    }

    const texto = String(valor || '');
    if (pareceTarjeta(texto)) return MOTIVOS.TARJETA;

    if (opciones.enmascararContacto && texto) {
      const limpio = texto.trim();
      if (CORREO_RE.test(limpio) || RUT_RE.test(limpio)) return MOTIVOS.CONTACTO;
    }
  } catch { /* ante la duda se sigue: el fallback de abajo no expone nada */ }

  return null;
}

/** Texto de reemplazo: dice que habia algo y cuanto medía, nunca que era. */
export function ocultar(valor) {
  const largo = String(valor ?? '').length;
  if (!largo) return '(vacio)';
  return `(oculto, ${largo} caracteres)`;
}

/**
 * Politica lista para pasarle a `describeElement` / `inventarioPagina`:
 * `(valor, el) => ({ valor, enmascarado, motivo })`.
 *
 * @param {{ enmascararContacto?: boolean, tope?: number }} [opciones]
 */
export function crearPolitica(opciones = {}) {
  const tope = opciones.tope || 300;

  return function politica(valor, el) {
    const motivo = motivoSensible(el, valor, opciones);
    if (motivo) return { valor: ocultar(valor), enmascarado: true, motivo };

    const texto = valor == null ? '' : String(valor);
    const recortado = texto.length > tope ? `${texto.slice(0, tope)}...` : texto;
    return { valor: recortado, enmascarado: false, motivo: null };
  };
}

/**
 * Texto suelto (portapapeles, seleccion): no hay elemento que mirar, asi que
 * solo se aplican las heuristicas por contenido.
 */
export function tratarTexto(texto, opciones = {}) {
  const crudo = String(texto ?? '');
  const motivo = motivoSensible(null, crudo, opciones);
  const tope = opciones.tope || 120;

  if (motivo) {
    return { texto: ocultar(crudo), longitud: crudo.length, enmascarado: true, motivo };
  }

  return {
    texto: crudo.length > tope ? `${crudo.slice(0, tope)}...` : crudo,
    longitud: crudo.length,
    enmascarado: false,
    motivo: null,
  };
}
