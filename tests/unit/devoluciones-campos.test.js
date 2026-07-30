// Escritura en campos de formularios controlados por React.
//
// El modulo de devoluciones de SellerCenter es React (Ant Design). React
// intercepta la propiedad `value` del elemento con una propiedad PROPIA que
// lleva su registro interno: si escribes con `el.value = x`, lo que se ve
// cambia pero React sigue creyendo que el campo esta vacio, no dispara su
// `onChange` y la busqueda se hace con el valor anterior. Es un fallo silencioso
// —el formulario se ve bien— asi que conviene tenerlo clavado con un test.
//
// No hay jsdom en el proyecto: se replica a mano lo justo (un prototipo con
// accesor `value` y el "tracker" de React encima) porque es exactamente el
// mecanismo que hay que sortear.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** Elemento con accesor `value` en el prototipo, como los del navegador. */
function definirClaseElemento() {
  class Elemento {
    constructor() {
      this._valor = '';
      this.eventos = [];
    }

    focus() {}

    dispatchEvent(evento) {
      this.eventos.push(evento.type);
      return true;
    }
  }

  Object.defineProperty(Elemento.prototype, 'value', {
    get() { return this._valor; },
    set(v) { this._valor = v; },
    configurable: true,
  });

  return Elemento;
}

/**
 * Lo que hace React: una propiedad propia sobre la instancia que sombrea la del
 * prototipo y guarda el valor en su registro en vez de en el elemento.
 */
function ponerTrackerDeReact(el) {
  const registro = { valor: '' };

  Object.defineProperty(el, 'value', {
    get() { return registro.valor; },
    set(v) { registro.valor = v; },
    configurable: true,
  });

  return registro;
}

let Elemento;
let escribirEn;
let elegirOpcion;

beforeEach(async () => {
  Elemento = definirClaseElemento();

  globalThis.HTMLInputElement = Elemento;
  globalThis.HTMLTextAreaElement = class extends Elemento {};
  globalThis.HTMLSelectElement = Elemento;
  globalThis.Event = class { constructor(type, opts) { this.type = type; Object.assign(this, opts); } };

  ({ escribirEn, elegirOpcion } = await import(
    '../../src/features/devoluciones/falabella/gestion/content/dom.js'
  ));
});

afterEach(() => {
  delete globalThis.HTMLInputElement;
  delete globalThis.HTMLTextAreaElement;
  delete globalThis.HTMLSelectElement;
  delete globalThis.Event;
});

describe('escribirEn', () => {
  it('escribe de verdad en un campo con el tracker de React encima', () => {
    const el = new Elemento();
    ponerTrackerDeReact(el);

    escribirEn(el, '3243349573');

    // El valor real del elemento (el que lee el navegador y el que React
    // compara para decidir si hubo cambio), no el del tracker.
    expect(el._valor).toBe('3243349573');
  });

  it('una asignacion directa NO llega al elemento: el bug que esto evita', () => {
    const el = new Elemento();
    const registro = ponerTrackerDeReact(el);

    el.value = '3243349573';

    expect(registro.valor).toBe('3243349573');
    expect(el._valor).toBe('');
  });

  it('dispara input y change para que el framework se entere', () => {
    const el = new Elemento();
    ponerTrackerDeReact(el);

    escribirEn(el, 'hola');

    expect(el.eventos).toEqual(['input', 'change']);
  });

  it('solo hace blur si se le pide', () => {
    const conBlur = new Elemento();
    escribirEn(conBlur, 'x', { blur: true });
    expect(conBlur.eventos).toContain('blur');

    const sinBlur = new Elemento();
    escribirEn(sinBlur, 'x');
    expect(sinBlur.eventos).not.toContain('blur');
  });

  it('funciona igual en una web sin React', () => {
    const el = new Elemento();

    escribirEn(el, 'sin react');

    expect(el._valor).toBe('sin react');
  });

  it('se queja si el campo no existe, en vez de fallar en silencio', () => {
    expect(() => escribirEn(null, 'x')).toThrow(/elemento nulo/);
  });
});

describe('elegirOpcion', () => {
  it('sortea el tracker de React tambien en los <select>', () => {
    const select = new Elemento();
    ponerTrackerDeReact(select);

    elegirOpcion(select, 'Severe damage');

    expect(select._valor).toBe('Severe damage');
    expect(select.eventos).toEqual(['input', 'change']);
  });
});
