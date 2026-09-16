// @vitest-environment happy-dom
//
// Descripcion de elementos para el Registro de acciones.
//
// Lo que se prueba aqui es lo que hace o rompe la feature entera: si el selector
// que se guarda no vuelve a encontrar el elemento, el archivo final no sirve
// para automatizar nada. Por eso varios tests no comparan strings sino que
// **usan el selector generado para buscar el elemento de vuelta**.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  contextoTabla,
  cssPath,
  describeBreve,
  describeElement,
  etiquetaDe,
  normalizar,
  rutaSelector,
  seccionDe,
  selectorCorto,
  textoAccesible,
  valorDeCampo,
} from '../../src/shared/dom/describe.js';

function montar(html) {
  document.body.innerHTML = html;
}

/** Busca con un selector que puede traer tramos de shadow DOM. */
function buscarPorRuta(tramos) {
  let raiz = document;
  let encontrado = null;
  for (const tramo of tramos) {
    encontrado = raiz.querySelector(tramo);
    if (!encontrado) return null;
    raiz = encontrado.shadowRoot || encontrado;
  }
  return encontrado;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('cssPath', () => {
  it('usa el id cuando es estable', () => {
    montar('<div><button id="add" class="primary">Agregar</button></div>');
    const boton = document.querySelector('#add');
    expect(cssPath(boton)).toBe('#add');
  });

  it('ignora los ids autogenerados por frameworks', () => {
    montar('<div class="caja"><button id="ember1423">Guardar</button></div>');
    const boton = document.querySelector('button');
    const selector = cssPath(boton);

    expect(selector).not.toContain('ember1423');
    expect(document.querySelectorAll(selector)).toHaveLength(1);
    expect(document.querySelector(selector)).toBe(boton);
  });

  it('prefiere un atributo de identidad antes que las clases', () => {
    montar(`
      <div class="wrap">
        <button data-testid="guardar-orden" class="css-1x2y3z">Guardar</button>
      </div>
    `);
    const boton = document.querySelector('button');
    expect(cssPath(boton)).toBe('button[data-testid="guardar-orden"]');
  });

  it('descarta clases con hash del bundler y encuentra igual el elemento', () => {
    montar(`
      <section class="panel">
        <span class="css-9f8a7b etiqueta">Total</span>
      </section>
    `);
    const span = document.querySelector('span');
    const selector = cssPath(span);

    expect(selector).not.toContain('css-9f8a7b');
    expect(document.querySelector(selector)).toBe(span);
  });

  it('desambigua hermanos iguales con nth-of-type', () => {
    montar(`
      <ul id="lista">
        <li><a href="/uno">Uno</a></li>
        <li><a href="/dos">Dos</a></li>
        <li><a href="/tres">Tres</a></li>
      </ul>
    `);
    const segundo = document.querySelectorAll('li')[1];
    const selector = cssPath(segundo);

    expect(document.querySelectorAll(selector)).toHaveLength(1);
    expect(document.querySelector(selector)).toBe(segundo);
  });

  it('sube por los ancestros hasta que el selector es unico', () => {
    montar(`
      <div id="izquierda"><p class="dato">A</p></div>
      <div id="derecha"><p class="dato">B</p></div>
    `);
    const derecho = document.querySelector('#derecha .dato');
    const selector = cssPath(derecho);

    expect(document.querySelectorAll(selector)).toHaveLength(1);
    expect(document.querySelector(selector)).toBe(derecho);
  });

  it('parte el selector en tramos al cruzar un shadow root abierto', () => {
    montar('<div id="app"><my-widget id="widget"></my-widget></div>');
    const host = document.querySelector('#widget');
    const sombra = host.attachShadow({ mode: 'open' });
    sombra.innerHTML = '<div class="interior"><button id="enviar">Enviar</button></div>';

    const boton = sombra.querySelector('#enviar');
    const tramos = rutaSelector(boton);

    expect(tramos).toHaveLength(2);
    expect(tramos[0]).toBe('#widget');
    expect(tramos[1]).toBe('#enviar');
    expect(cssPath(boton)).toBe('#widget >>> #enviar');
    expect(buscarPorRuta(tramos)).toBe(boton);
  });

  it('no lanza con entradas invalidas', () => {
    expect(cssPath(null)).toBe('');
    expect(cssPath(undefined)).toBe('');
    expect(rutaSelector(document.createTextNode('hola'))).toEqual([]);
  });
});

describe('selectorCorto', () => {
  it('resume el elemento para el feed en vivo', () => {
    montar(`
      <button id="add">A</button>
      <button data-testid="quitar">B</button>
      <button class="accion-principal">C</button>
      <button>D</button>
    `);
    const [a, b, c, d] = document.querySelectorAll('button');

    expect(selectorCorto(a)).toBe('#add');
    expect(selectorCorto(b)).toBe('button[quitar]');
    expect(selectorCorto(c)).toBe('button.accion-principal');
    expect(selectorCorto(d)).toBe('button');
  });
});

describe('textoAccesible', () => {
  it('respeta el orden aria-label > aria-labelledby > label > placeholder', () => {
    montar(`
      <span id="rotulo">Numero de orden</span>
      <input id="a" aria-label="Buscar orden" placeholder="Escriba aqui">
      <input id="b" aria-labelledby="rotulo" placeholder="Escriba aqui">
      <label for="c">Comuna</label><input id="c" placeholder="Escriba aqui">
      <input id="d" placeholder="Escriba aqui">
      <input id="e" title="Solo titulo">
    `);

    expect(textoAccesible(document.querySelector('#a'))).toBe('Buscar orden');
    expect(textoAccesible(document.querySelector('#b'))).toBe('Numero de orden');
    expect(textoAccesible(document.querySelector('#c'))).toBe('Comuna');
    expect(textoAccesible(document.querySelector('#d'))).toBe('Escriba aqui');
    expect(textoAccesible(document.querySelector('#e'))).toBe('Solo titulo');
  });

  it('usa el texto del boton cuando no hay nada mas', () => {
    montar('<button>  Guardar   cambios </button>');
    expect(textoAccesible(document.querySelector('button'))).toBe('Guardar cambios');
  });

  it('no le pone a un enlace de tabla el rotulo de la celda vecina', () => {
    // Caso real medido: el enlace "Ver" de una grilla terminaba llamandose
    // "Ana Perez" porque `etiquetaDe` mira la celda anterior. Ese rescate es
    // para campos de formulario, no para enlaces ni botones.
    montar(`
      <table>
        <tr><td>000123456</td><td>Ana Perez</td><td><a href="/ver/1">Ver</a></td></tr>
      </table>
    `);
    expect(textoAccesible(document.querySelector('a'))).toBe('Ver');
  });

  it('lee el value de los input tipo boton', () => {
    montar('<input type="submit" value="Enviar formulario">');
    expect(textoAccesible(document.querySelector('input'))).toBe('Enviar formulario');
  });
});

describe('etiquetaDe', () => {
  it('encuentra el label envolvente', () => {
    montar('<label>Correo <input id="mail"></label>');
    expect(etiquetaDe(document.querySelector('#mail'))).toBe('Correo');
  });

  it('cae en la celda anterior de la fila, como los admin viejos', () => {
    montar(`
      <table><tr>
        <td>Lead time</td>
        <td><input id="lt" value="3"></td>
      </tr></table>
    `);
    expect(etiquetaDe(document.querySelector('#lt'))).toBe('Lead time');
  });
});

describe('contextoTabla', () => {
  it('ubica el elemento por fila, columna y encabezado', () => {
    montar(`
      <table id="grid">
        <thead><tr><th>ID</th><th>Cliente</th><th>Accion</th></tr></thead>
        <tbody>
          <tr><td>111</td><td>Ana</td><td><a href="/ver/111">Ver</a></td></tr>
          <tr><td>222</td><td>Luis</td><td><a href="/ver/222">Ver</a></td></tr>
        </tbody>
      </table>
    `);
    const enlace = document.querySelectorAll('tbody a')[1];
    const contexto = contextoTabla(enlace);

    expect(contexto.selector).toBe('#grid');
    expect(contexto.columna).toBe(3);
    expect(contexto.encabezado).toBe('Accion');
    expect(contexto.textoFila).toContain('222');
    expect(contexto.textoFila).toContain('Luis');
  });

  it('separa las celdas al resumir la fila', () => {
    montar(`
      <table id="grid">
        <thead><tr><th>ID</th><th>Cliente</th><th>Accion</th></tr></thead>
        <tbody><tr><td>000123456</td><td>Ana Perez</td><td><a href="/ver">Ver</a></td></tr></tbody>
      </table>
    `);
    const contexto = contextoTabla(document.querySelector('tbody a'));
    expect(contexto.textoFila).toBe('000123456 | Ana Perez | Ver');
  });

  it('devuelve null fuera de una tabla', () => {
    montar('<div><button>Solo</button></div>');
    expect(contextoTabla(document.querySelector('button'))).toBeNull();
  });
});

describe('seccionDe', () => {
  it('toma el encabezado mas cercano por encima', () => {
    montar(`
      <h2>Datos de despacho</h2>
      <div class="bloque"><input id="dir"></div>
    `);
    expect(seccionDe(document.querySelector('#dir'))).toBe('Datos de despacho');
  });
});

describe('valorDeCampo', () => {
  it('lee cada tipo de campo como corresponde', () => {
    montar(`
      <input id="texto" value="ABC123">
      <input id="check" type="checkbox" checked>
      <select id="lista"><option value="1">Uno</option><option value="2" selected>Dos</option></select>
      <textarea id="area">linea</textarea>
    `);

    expect(valorDeCampo(document.querySelector('#texto'))).toBe('ABC123');
    expect(valorDeCampo(document.querySelector('#check'))).toBe('marcado');
    expect(valorDeCampo(document.querySelector('#lista'))).toBe('Dos');
    expect(valorDeCampo(document.querySelector('#area'))).toBe('linea');
  });
});

describe('describeElement', () => {
  it('arma el retrato completo de un boton dentro de un formulario', () => {
    montar(`
      <h2>Ordenes</h2>
      <form id="buscador" action="/admin/buscar" method="post">
        <button id="enviar" type="submit" class="action-primary" data-accion="buscar">Buscar</button>
      </form>
    `);
    const descripcion = describeElement(document.querySelector('#enviar'));

    expect(descripcion.tag).toBe('button');
    expect(descripcion.tipo).toBe('submit');
    expect(descripcion.rol).toBe('boton');
    expect(descripcion.texto).toBe('Buscar');
    expect(descripcion.selector).toBe('#enviar');
    expect(descripcion.datos).toEqual({ 'data-accion': 'buscar' });
    expect(descripcion.contexto.formulario).toEqual({
      selector: '#buscador',
      nombre: null,
      accion: '/admin/buscar',
      metodo: 'POST',
    });
    expect(descripcion.contexto.seccion).toBe('Ordenes');
  });

  it('delega el valor de los campos en la politica de privacidad que se le pase', () => {
    montar('<input id="clave" type="password" value="secreta123">');
    const descripcion = describeElement(document.querySelector('#clave'), {
      valor: (valor, el) => (el.type === 'password'
        ? { valor: `(oculto, ${valor.length} caracteres)`, enmascarado: true, motivo: 'tipo-password' }
        : { valor, enmascarado: false }),
    });

    expect(descripcion.valor).toBe('(oculto, 10 caracteres)');
    expect(descripcion.enmascarado).toBe(true);
    expect(descripcion.motivoEnmascarado).toBe('tipo-password');
    expect(JSON.stringify(descripcion)).not.toContain('secreta123');
  });

  it('guarda el valor tal cual cuando no se le pasa politica', () => {
    montar('<input id="sku" value="OLED55C4">');
    const descripcion = describeElement(document.querySelector('#sku'));
    expect(descripcion.valor).toBe('OLED55C4');
    expect(descripcion.enmascarado).toBe(false);
  });

  it('registra el href y el contexto de tabla de un enlace de grilla', () => {
    montar(`
      <table id="grid">
        <thead><tr><th>ID</th><th>Accion</th></tr></thead>
        <tbody><tr><td>98213</td><td><a href="/ver/98213">Ver</a></td></tr></tbody>
      </table>
    `);
    const descripcion = describeElement(document.querySelector('a'));

    expect(descripcion.href).toBe('/ver/98213');
    expect(descripcion.rol).toBe('enlace');
    expect(descripcion.contexto.tabla.fila).toBe(2);   // fila 1 es la cabecera
    expect(descripcion.contexto.tabla.encabezado).toBe('Accion');
  });

  it('es serializable y no lanza con un nodo raro', () => {
    expect(describeElement(null)).toBeNull();
    montar('<div id="x"></div>');
    const descripcion = describeElement(document.querySelector('#x'));
    expect(() => JSON.stringify(descripcion)).not.toThrow();
  });
});

describe('describeBreve', () => {
  it('trae solo lo indispensable', () => {
    montar('<input id="campo" type="text" aria-label="SKU">');
    const breve = describeBreve(document.querySelector('#campo'));

    expect(breve).toEqual({
      tag: 'input',
      tipo: 'text',
      selector: '#campo',
      selectorCorto: '#campo',
      texto: 'SKU',
    });
  });
});

describe('normalizar', () => {
  it('saca acentos y baja a minusculas', () => {
    expect(normalizar('  Contraseña  ')).toBe('contrasena');
    expect(normalizar('NÚMERO de Orden')).toBe('numero de orden');
    expect(normalizar(null)).toBe('');
  });
});
