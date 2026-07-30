// Decisiones de la gestion automatica de devoluciones (Falabella).
//
// Lo que se prueba aqui es lo que NO depende del DOM del portal: como se
// traduce la observacion de posventa a las opciones del formulario y como se
// arman los textos que se envian. Es la parte que decide el resultado de la
// apelacion, asi que conviene tenerla clavada.

import { describe, expect, it } from 'vitest';
import {
  armarComentario,
  elegirMotivo,
  elegirSubEstado,
} from '../../src/features/devoluciones/falabella/gestion/content/apelar.js';
import { armarDetalle, numeroDeCaso } from '../../src/features/devoluciones/falabella/gestion/content/ticket.js';
import {
  DEFAULT_MOTIVO,
  SUBSTATUS_DANO_SEVERO,
  SUBSTATUS_INCOMPLETO,
} from '../../src/features/devoluciones/falabella/gestion/constants.js';

describe('elegirMotivo', () => {
  it('sin observacion cae al motivo por defecto', () => {
    expect(elegirMotivo('')).toBe(DEFAULT_MOTIVO);
    expect(elegirMotivo(null)).toBe(DEFAULT_MOTIVO);
  });

  it('reconoce el caso aunque la observacion venga sin acentos', () => {
    expect(elegirMotivo('Llego la caja vacia, sin el producto')).toBe('Caja vacía');
    expect(elegirMotivo('La CAJA VACÍA')).toBe('Caja vacía');
  });

  it('distingue empaque dañado de producto sin empaque', () => {
    expect(elegirMotivo('Producto sin empaque original')).toBe('Producto llegó sin empaque');
    expect(elegirMotivo('Vino con la caja rota y sucia')).toBe('Producto llegó con el empaque dañado o sucio');
  });

  it('detecta producto que no funciona y producto incompleto', () => {
    expect(elegirMotivo('El equipo no enciende')).toBe('Producto no funciona');
    expect(elegirMotivo('Falta el control remoto')).toBe('Producto incompleto');
  });

  it('una observacion que no matchea nada usa el motivo por defecto', () => {
    expect(elegirMotivo('El cliente se arrepintio de la compra')).toBe(DEFAULT_MOTIVO);
  });
});

describe('elegirSubEstado', () => {
  it('marca incompleto cuando falta algo', () => {
    expect(elegirSubEstado('Faltan accesorios en la caja')).toBe(SUBSTATUS_INCOMPLETO);
    expect(elegirSubEstado('Producto incompleto')).toBe(SUBSTATUS_INCOMPLETO);
  });

  it('en el resto de casos sostiene daños severos', () => {
    expect(elegirSubEstado('Pantalla quebrada')).toBe(SUBSTATUS_DANO_SEVERO);
    expect(elegirSubEstado('')).toBe(SUBSTATUS_DANO_SEVERO);
  });
});

describe('armarComentario', () => {
  const job = {
    orden: '3240720077',
    numero_guia: '140111',
    reembolso: {
      producto: 'Televisor',
      modelo: '65UA8050PSA',
      serie: '603RMWVC6081',
      observacion: 'Caja dañada, pantalla quebrada',
    },
  };

  it('incluye observacion, modelo, serie y guia', () => {
    const texto = armarComentario(job);
    expect(texto).toContain('Caja dañada, pantalla quebrada');
    expect(texto).toContain('65UA8050PSA');
    expect(texto).toContain('603RMWVC6081');
    expect(texto).toContain('140111');
  });

  it('sin data del correo deja un texto generico, nunca vacio', () => {
    const texto = armarComentario({ orden: '1', numero_guia: '', reembolso: null });
    expect(texto.length).toBeGreaterThan(20);
  });

  it('respeta el limite de 500 caracteres del campo', () => {
    const largo = { ...job, reembolso: { ...job.reembolso, observacion: 'x'.repeat(900) } };
    expect(armarComentario(largo)).toHaveLength(500);
  });
});

describe('armarDetalle (ticket)', () => {
  it('lleva la orden y lo que se sepa de la devolucion', () => {
    const texto = armarDetalle({
      orden: '3222475480',
      numero_guia: '140222',
      reembolso: { producto: 'Televisor', modelo: '55QNED83ASG', serie: null, observacion: 'Sin embalaje' },
    });

    expect(texto).toContain('3222475480');
    expect(texto).toContain('140222');
    expect(texto).toContain('55QNED83ASG');
    expect(texto).toContain('Sin embalaje');
    // La serie no estaba: no se inventa ni deja el rotulo suelto.
    expect(texto).not.toContain('Serie:');
  });

  it('funciona con una orden sin data extraida', () => {
    const texto = armarDetalle({ orden: '900000001', numero_guia: '', reembolso: null });
    expect(texto).toContain('900000001');
    expect(texto).not.toContain('undefined');
  });
});

describe('numeroDeCaso', () => {
  /** Caja de confirmación falsa, sin necesidad de un DOM completo. */
  const caja = (texto) => ({
    querySelector: (sel) => (sel.includes('result_header')
      ? { parentElement: { textContent: texto } }
      : null),
  });

  const CONFIRMACION = '¡Todo listo, recibimos tu solicitud!'
    + 'Tu n° de caso es el 68989843 , con fecha de creación 30 de Julio de 2026. '
    + '• Tipo de registro: Pos venta• Motivo: Quiero rechazar una devolución'
    + 'Te contactaremos antes del 3 de Agosto de 2026.';

  it('saca el número de la frase, sin arrastrar la fecha', () => {
    expect(numeroDeCaso(caja(CONFIRMACION))).toBe('68989843');
  });

  it('tolera el número con separador de miles', () => {
    expect(numeroDeCaso(caja('Tu n° de caso es el 68.989.843 , con fecha'))).toBe('68989843');
  });

  it('sin la caja de confirmación no inventa nada', () => {
    expect(numeroDeCaso({ querySelector: () => null })).toBeNull();
  });

  it('si la frase no trae número devuelve null', () => {
    expect(numeroDeCaso(caja('Tu n° de caso es el , con fecha de creación'))).toBeNull();
  });
});
