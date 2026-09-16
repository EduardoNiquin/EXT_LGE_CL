// La normalizacion de valores de la ficha. Lo que se cuida aca es la
// ambiguedad del punto: en CLP es separador de miles ("$555.980" son 555980
// pesos) pero la misma ficha emite en-US en otras pantallas ("$588,565.00").
// Equivocarse cambia el importe en tres ordenes de magnitud.

import { describe, expect, it } from 'vitest';
import {
  moneyNumber,
  normalizeDateTime,
  normalizeMoney,
  parseComment,
  splitLabeled,
} from '../../src/features/magento/informacion_de_orden/format.js';

describe('normalizeMoney', () => {
  it('trata el punto con 3 digitos detras como separador de miles (CLP)', () => {
    expect(normalizeMoney('$555.980')).toBe('555980');
    expect(normalizeMoney('$15.990')).toBe('15990');
    expect(normalizeMoney('$1.234.567')).toBe('1234567');
  });

  it('con menos de 3 digitos detras el punto es decimal', () => {
    expect(normalizeMoney('$539.99')).toBe('539.99');
    expect(normalizeMoney('12.5')).toBe('12.5');
  });

  it('con los dos separadores manda el ultimo', () => {
    expect(normalizeMoney('$588,565.00')).toBe('588565.00');
    expect(normalizeMoney('$1.234,56')).toBe('1234.56');
  });

  it('conserva el signo, venga donde venga', () => {
    expect(normalizeMoney('-$65,396.00')).toBe('-65396.00');
    expect(normalizeMoney('$-65.396')).toBe('-65396');
  });

  it('lo que no es un importe vuelve tal cual', () => {
    expect(normalizeMoney('N/A')).toBe('N/A');
    expect(normalizeMoney('')).toBe('');
    expect(normalizeMoney(null)).toBe('');
    expect(normalizeMoney('Boleta')).toBe('Boleta');
  });

  it('moneyNumber devuelve Number, o null si no lo es', () => {
    expect(moneyNumber('$555.980')).toBe(555980);
    expect(moneyNumber('-$65,396.00')).toBe(-65396);
    expect(moneyNumber('N/A')).toBe(null);
  });
});

describe('normalizeDateTime', () => {
  it('pasa el formato largo de la ficha a uno ordenable', () => {
    expect(normalizeDateTime('Sep 10, 2026, 07:40:08 PM')).toBe('2026-09-10 19:40:08');
    expect(normalizeDateTime('Sep 14, 2026, 1:12:20 PM')).toBe('2026-09-14 13:12:20');
    // Las notas del historial llegan con la fecha y la hora unidas por un espacio.
    expect(normalizeDateTime('Sep 11, 2026 9:18:49 PM')).toBe('2026-09-11 21:18:49');
  });

  it('resuelve las 12 de AM/PM, que es donde se rompen estas conversiones', () => {
    expect(normalizeDateTime('Jan 1, 2026, 12:00:00 AM')).toBe('2026-01-01 00:00:00');
    expect(normalizeDateTime('Jan 1, 2026, 12:30:00 PM')).toBe('2026-01-01 12:30:00');
  });

  it('lo que no matchea vuelve tal cual', () => {
    expect(normalizeDateTime('2026-09-10 19:40:08')).toBe('2026-09-10 19:40:08');
    expect(normalizeDateTime('N/A')).toBe('N/A');
  });
});

describe('splitLabeled', () => {
  const LABELS = ['Rule Name', 'Expected delivery date', 'Installation Service'];

  it('corta por las etiquetas conocidas aunque el valor lleve espacios', () => {
    expect(splitLabeled(
      'Rule Name: Envio Normal RM + Pack OMO Expected delivery date: N/A Installation Service: Si',
      LABELS,
    )).toEqual({
      'Rule Name': 'Envio Normal RM + Pack OMO',
      'Expected delivery date': 'N/A',
      'Installation Service': 'Si',
    });
  });

  it('respeta el orden en que aparecen, no el de la lista', () => {
    expect(splitLabeled('Installation Service: No Rule Name: Retiro', LABELS)).toEqual({
      'Installation Service': 'No',
      'Rule Name': 'Retiro',
    });
  });

  it('sin ninguna etiqueta devuelve null (se conserva el texto original)', () => {
    expect(splitLabeled('N/A', LABELS)).toBe(null);
    expect(splitLabeled('', LABELS)).toBe(null);
  });
});

describe('parseComment', () => {
  it('anida el JSON que Magento deja crudo en el comentario', () => {
    expect(parseComment('{"on_delivery":"complete","global":null}'))
      .toEqual({ on_delivery: 'complete', global: null });
  });

  it('abre a objeto las notas de pasarela, que son "Etiqueta: valor" por linea', () => {
    expect(parseComment('Transaccion Aprobada\nEstado: AUTHORIZED\nCodigo de respuesta: 0')).toEqual({
      texto: 'Transaccion Aprobada',
      Estado: 'AUTHORIZED',
      'Codigo de respuesta': '0',
    });
  });

  it('un comentario suelto queda como texto', () => {
    expect(parseComment('Update order status from Ecss')).toBe('Update order status from Ecss');
    expect(parseComment('')).toBe('');
  });

  it('un JSON roto no revienta: vuelve como texto', () => {
    expect(parseComment('{"a":')).toBe('{"a":');
  });
});
