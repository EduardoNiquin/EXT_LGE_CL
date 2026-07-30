// Busqueda de elementos a traves de shadow DOM.
//
// El modulo de devoluciones de SellerCenter monta TODA su pantalla (buscador,
// tabla y formulario de apelacion) dentro del shadow root de
// `#return-app-container`: en el documento de arriba no hay ni un <input> ni una
// <table>. Un `document.querySelector` plano no ve nada, y el sintoma no es un
// error claro sino una espera que se agota ("Timeout esperando la tabla de
// devoluciones") mientras la pantalla esta perfectamente visible.
//
// No hay jsdom en el proyecto: se replica lo justo del DOM (raices con
// `querySelector`/`querySelectorAll` y hosts con `shadowRoot`) porque lo que hay
// que probar es el RECORRIDO, no el motor de selectores CSS.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Raiz de consulta (documento o shadow root) construida desde un mapa
 * selector -> elementos. `querySelectorAll('*')` devuelve los elementos, que es
 * por donde el recorrido descubre los shadow roots.
 */
function crearRaiz(mapa = {}, elementos = []) {
  return {
    querySelector(selector) {
      return (mapa[selector] || [])[0] || null;
    },
    querySelectorAll(selector) {
      if (selector === '*') return elementos;
      return mapa[selector] || [];
    },
  };
}

/**
 * Elemento cualquiera; con `shadowRoot` si aloja una pantalla encapsulada. Sabe
 * responder consultas como cualquier elemento real (su light DOM esta vacio),
 * para poder pasarlo como raiz de una busqueda.
 */
function crearElemento(nombre, shadowRoot = null) {
  return {
    nombre,
    shadowRoot,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

let primero;
let todos;
let raizDe;
let contarShadowRoots;

beforeEach(async () => {
  ({ primero, todos, raizDe, contarShadowRoots } = await import(
    '../../src/features/devoluciones/falabella/gestion/content/dom.js'
  ));
});

afterEach(() => {
  delete globalThis.document;
});

/** El escenario real: el documento vacio y la pantalla dentro de un shadow root. */
function escenarioSellerCenter() {
  const input = crearElemento('input-buscador');
  const tabla = crearElemento('tabla');
  const filas = [crearElemento('fila-1'), crearElemento('fila-2')];

  const shadow = crearRaiz({
    '.container-searchbar input': [input],
    'input[placeholder^="Buscar por"]': [input],
    'table.ui-list-table': [tabla],
    'table.ui-list-table tbody tr': filas,
  }, [input, tabla, ...filas]);

  const host = crearElemento('return-app-container', shadow);

  // El documento: ni un input ni una tabla, solo el host de la micro-app.
  const documento = crearRaiz({}, [host]);

  globalThis.document = documento;

  return { documento, shadow, input, tabla, filas };
}

describe('primero', () => {
  it('encuentra el buscador aunque solo exista dentro del shadow root', () => {
    const { input } = escenarioSellerCenter();

    expect(primero('.container-searchbar input')).toBe(input);
  });

  it('el fallo que esto corrige: el documento por si solo no ve nada', () => {
    const { documento } = escenarioSellerCenter();

    expect(documento.querySelector('table.ui-list-table')).toBeNull();
    expect(primero('table.ui-list-table')).not.toBeNull();
  });

  it('respeta el orden de los selectores alternativos', () => {
    const preferido = crearElemento('preferido');
    const alternativo = crearElemento('alternativo');
    globalThis.document = crearRaiz({ '.a': [preferido], '.b': [alternativo] }, []);

    expect(primero(['.a', '.b'])).toBe(preferido);
    expect(primero(['.zzz', '.b'])).toBe(alternativo);
  });

  it('da prioridad al documento sobre el shadow root', () => {
    const enLaLuz = crearElemento('en-la-luz');
    const enLaSombra = crearElemento('en-la-sombra');
    const host = crearElemento('host', crearRaiz({ '.x': [enLaSombra] }, [enLaSombra]));

    globalThis.document = crearRaiz({ '.x': [enLaLuz] }, [host]);

    expect(primero('.x')).toBe(enLaLuz);
  });

  it('atraviesa shadow roots anidados', () => {
    const hondo = crearElemento('hondo');
    const interno = crearElemento('interno', crearRaiz({ '.x': [hondo] }, [hondo]));
    const externo = crearElemento('externo', crearRaiz({}, [interno]));

    globalThis.document = crearRaiz({}, [externo]);

    expect(primero('.x')).toBe(hondo);
  });

  it('devuelve null cuando de verdad no esta', () => {
    escenarioSellerCenter();

    expect(primero('.no-existe')).toBeNull();
  });

  it('entra en el shadow root de la raiz que recibe, no solo en los de abajo', () => {
    // El caso de la mesa de ayuda: el boton de un `lightning-combobox` vive
    // dentro del shadow root del PROPIO combo. Buscarlo pasando el combo como
    // raiz tiene que encontrarlo; si no, `elegirCombobox` se queda a ciegas.
    const boton = crearElemento('button.slds-combobox__input');
    const combo = crearElemento('lightning-combobox');
    combo.shadowRoot = crearRaiz({ 'button.slds-combobox__input': [boton] }, [boton]);

    globalThis.document = crearRaiz({ 'lightning-combobox': [combo] }, [combo]);

    // El light DOM del combo esta vacio: la consulta directa —lo que hacia
    // `elegirCombobox`— no encuentra nada. Cruzando su shadow root, si.
    expect(combo.querySelector('button.slds-combobox__input')).toBeNull();
    expect(primero('button.slds-combobox__input', combo)).toBe(boton);
  });
});

describe('todos', () => {
  it('recolecta las filas de la tabla encapsulada', () => {
    const { filas } = escenarioSellerCenter();

    expect(todos('table.ui-list-table tbody tr')).toEqual(filas);
  });

  it('no duplica cuando varios selectores apuntan al mismo elemento', () => {
    const { input } = escenarioSellerCenter();

    const encontrados = todos([
      '.container-searchbar input',
      'input[placeholder^="Buscar por"]',
    ]);

    expect(encontrados).toEqual([input]);
  });

  it('junta lo del documento y lo del shadow root', () => {
    const enLaLuz = crearElemento('en-la-luz');
    const enLaSombra = crearElemento('en-la-sombra');
    const host = crearElemento('host', crearRaiz({ '.box': [enLaSombra] }, [enLaSombra]));

    globalThis.document = crearRaiz({ '.box': [enLaLuz] }, [host]);

    expect(todos('.box')).toEqual([enLaLuz, enLaSombra]);
  });

  it('devuelve una lista vacia si no hay nada', () => {
    escenarioSellerCenter();

    expect(todos('.no-existe')).toEqual([]);
  });
});

describe('raizDe', () => {
  it('devuelve el shadow root que contiene la pantalla, no el documento', () => {
    const { shadow, documento } = escenarioSellerCenter();

    const raiz = raizDe('.container-searchbar input');

    expect(raiz).toBe(shadow);
    expect(raiz).not.toBe(documento);
  });

  it('una vez resuelta la raiz, las consultas directas ya encuentran todo', () => {
    const { tabla, filas } = escenarioSellerCenter();

    // Es lo que hacen buscar.js y apelar.js: resolver la raiz una vez y
    // consultar siempre contra ella (coherente y sin recorrer el arbol entero).
    const raiz = raizDe('.container-searchbar input');

    expect(raiz.querySelector('table.ui-list-table')).toBe(tabla);
    expect(raiz.querySelectorAll('table.ui-list-table tbody tr')).toEqual(filas);
  });

  it('devuelve el documento cuando la pantalla no esta encapsulada', () => {
    const el = crearElemento('suelto');
    const documento = crearRaiz({ '.x': [el] }, []);
    globalThis.document = documento;

    expect(raizDe('.x')).toBe(documento);
  });

  it('devuelve null si el selector no aparece en ninguna raiz', () => {
    escenarioSellerCenter();

    expect(raizDe('.no-existe')).toBeNull();
  });
});

describe('contarShadowRoots', () => {
  it('no cuenta el documento como shadow root', () => {
    globalThis.document = crearRaiz({}, []);

    expect(contarShadowRoots()).toBe(0);
  });

  it('cuenta los anidados', () => {
    const interno = crearElemento('interno', crearRaiz({}, []));
    const externo = crearElemento('externo', crearRaiz({}, [interno]));
    globalThis.document = crearRaiz({}, [externo]);

    expect(contarShadowRoots()).toBe(2);
  });
});
