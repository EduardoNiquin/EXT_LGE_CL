// @vitest-environment happy-dom
//
// Enmascarado del Registro de acciones.
//
// Es la prueba que mas importa de toda la feature: el archivo que se descarga se
// va a compartir con una IA, asi que una clave que se filtre no se puede
// "deshacer". Cada caso comprueba las dos mitades: que el secreto NO este, y que
// el paso siga siendo automatizable (selector, etiqueta y largo intactos).

import { beforeEach, describe, expect, it } from 'vitest';
import {
  MOTIVOS,
  crearPolitica,
  motivoSensible,
  ocultar,
  pareceTarjeta,
  tratarTexto,
} from '../../src/features/registro-acciones/privacidad.js';
import { describeElement } from '../../src/shared/dom/describe.js';

function montar(html) {
  document.body.innerHTML = html;
  return (selector) => document.querySelector(selector);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('motivoSensible', () => {
  it('detecta el campo de clave por su tipo', () => {
    const $ = montar('<input id="c" type="password">');
    expect(motivoSensible($('#c'), 'loquesea')).toBe(MOTIVOS.PASSWORD);
  });

  it('detecta por autocomplete aunque el tipo sea texto', () => {
    const $ = montar('<input id="c" type="text" autocomplete="cc-number">');
    expect(motivoSensible($('#c'), '4111111111111111')).toBe(MOTIVOS.AUTOCOMPLETE);
  });

  it('detecta por nombre, id, aria-label o placeholder, con y sin acentos', () => {
    const $ = montar(`
      <input id="a" name="user_password">
      <input id="b" aria-label="Contraseña actual">
      <input id="c" placeholder="CVV">
      <input id="clave_sii">
      <input id="e" name="numero_tarjeta">
    `);

    expect(motivoSensible($('#a'))).toBe(MOTIVOS.NOMBRE);
    expect(motivoSensible($('#b'))).toBe(MOTIVOS.NOMBRE);
    expect(motivoSensible($('#c'))).toBe(MOTIVOS.NOMBRE);
    expect(motivoSensible($('#clave_sii'))).toBe(MOTIVOS.NOMBRE);
    expect(motivoSensible($('#e'))).toBe(MOTIVOS.NOMBRE);
  });

  it('respeta el marcado explicito de la pagina, incluso en un ancestro', () => {
    const $ = montar('<div data-sensitive><input id="x" name="dato"></div>');
    expect(motivoSensible($('#x'))).toBe(MOTIVOS.MARCADO);
  });

  it('atrapa un numero de tarjeta en un campo de nombre inocente', () => {
    const $ = montar('<input id="dato" name="referencia">');
    expect(motivoSensible($('#dato'), '4111 1111 1111 1111')).toBe(MOTIVOS.TARJETA);
  });

  it('deja pasar los datos de negocio normales', () => {
    const $ = montar(`
      <input id="orden" name="increment_id">
      <input id="sku" name="sku">
      <input id="comuna" name="comuna">
    `);

    expect(motivoSensible($('#orden'), '000123456')).toBeNull();
    expect(motivoSensible($('#sku'), 'OLED55C4PSA')).toBeNull();
    expect(motivoSensible($('#comuna'), 'Las Condes')).toBeNull();
  });

  it('solo enmascara correo y RUT si se pide expresamente', () => {
    const $ = montar('<input id="mail" name="email">');

    expect(motivoSensible($('#mail'), 'juan@lge.cl')).toBeNull();
    expect(motivoSensible($('#mail'), 'juan@lge.cl', { enmascararContacto: true })).toBe(MOTIVOS.CONTACTO);
    expect(motivoSensible($('#mail'), '12.345.678-9', { enmascararContacto: true })).toBe(MOTIVOS.CONTACTO);
  });
});

describe('pareceTarjeta', () => {
  it('distingue una tarjeta de un numero largo cualquiera', () => {
    expect(pareceTarjeta('4111111111111111')).toBe(true);     // Visa de prueba
    expect(pareceTarjeta('5500 0000 0000 0004')).toBe(true);
    expect(pareceTarjeta('4111111111111112')).toBe(false);    // falla Luhn
    expect(pareceTarjeta('000123456')).toBe(false);           // orden de Magento
    expect(pareceTarjeta('OLED55C4PSA')).toBe(false);
  });
});

describe('ocultar', () => {
  it('deja el largo y nada mas', () => {
    expect(ocultar('secreta123')).toBe('(oculto, 10 caracteres)');
    expect(ocultar('')).toBe('(vacio)');
    expect(ocultar(null)).toBe('(vacio)');
  });
});

describe('crearPolitica', () => {
  it('oculta el secreto pero conserva lo que hace falta para automatizar', () => {
    const $ = montar('<label for="clave">Contraseña</label><input id="clave" type="password" value="Sup3rS3cret@">');
    const politica = crearPolitica();
    const descripcion = describeElement($('#clave'), { valor: politica });

    expect(descripcion.valor).toBe('(oculto, 12 caracteres)');
    expect(descripcion.enmascarado).toBe(true);
    expect(descripcion.motivoEnmascarado).toBe(MOTIVOS.PASSWORD);

    // Lo que si tiene que sobrevivir:
    expect(descripcion.selector).toBe('#clave');
    expect(descripcion.etiqueta).toBe('Contraseña');
    expect(descripcion.tipo).toBe('password');

    expect(JSON.stringify(descripcion)).not.toContain('Sup3rS3cret@');
  });

  it('recorta los valores muy largos de los campos normales', () => {
    const politica = crearPolitica({ tope: 10 });
    expect(politica('0123456789ABCDEF', null).valor).toBe('0123456789...');
    expect(politica('corto', null)).toEqual({ valor: 'corto', enmascarado: false, motivo: null });
  });
});

describe('tratarTexto', () => {
  it('guarda una muestra y el largo del texto copiado', () => {
    const resultado = tratarTexto('000123456', { tope: 120 });
    expect(resultado).toEqual({ texto: '000123456', longitud: 9, enmascarado: false, motivo: null });
  });

  it('recorta el texto largo pero informa el largo real', () => {
    const largo = 'x'.repeat(400);
    const resultado = tratarTexto(largo, { tope: 120 });

    expect(resultado.longitud).toBe(400);
    expect(resultado.texto).toHaveLength(123);   // 120 + '...'
  });

  it('oculta el contenido si lo pegado parece una tarjeta', () => {
    const resultado = tratarTexto('4111 1111 1111 1111');
    expect(resultado.enmascarado).toBe(true);
    expect(resultado.motivo).toBe(MOTIVOS.TARJETA);
    expect(resultado.texto).not.toContain('4111');
  });
});
