// @vitest-environment happy-dom
//
// Inventario de pagina: la "foto" de que habia disponible en pantalla.
//
// Los topes son la parte delicada: sin ellos una grilla de Magento con 500 filas
// se lleva puesto el archivo final. Lo que se prueba es que se recorte Y que el
// recorte quede declarado en `truncado` (no mentir por omision).

import { beforeEach, describe, expect, it } from 'vitest';
import { inventarioPagina, resumenPagina } from '../../src/shared/dom/inventario.js';

function montar(html) {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.title = 'Sin titulo';
});

describe('inventarioPagina', () => {
  it('describe formularios y asocia cada campo al suyo', () => {
    document.title = 'Orders / Magento Admin';
    montar(`
      <h1>Ordenes</h1>
      <form id="buscador" action="/admin/buscar" method="get">
        <label for="texto">Palabra clave</label>
        <input id="texto" name="search" type="text" required>
        <select id="estado" name="status">
          <option>Cualquiera</option>
          <option>Pendiente</option>
        </select>
        <button type="submit">Buscar</button>
      </form>
    `);

    const inventario = inventarioPagina(document);

    expect(inventario.titulo).toBe('Orders / Magento Admin');
    expect(inventario.encabezados).toEqual([{ nivel: 1, texto: 'Ordenes' }]);

    expect(inventario.formularios).toHaveLength(1);
    expect(inventario.formularios[0]).toMatchObject({
      id: 'F1',
      selector: '#buscador',
      accion: '/admin/buscar',
      metodo: 'GET',
      campos: 2,
    });

    const texto = inventario.campos.find((c) => c.selector === '#texto');
    expect(texto).toMatchObject({
      etiqueta: 'Palabra clave',
      tipo: 'text',
      nombre: 'search',
      requerido: true,
      formulario: 'F1',
    });

    const estado = inventario.campos.find((c) => c.selector === '#estado');
    expect(estado.opciones).toEqual(['Cualquiera', 'Pendiente']);

    expect(inventario.botones).toHaveLength(1);
    expect(inventario.botones[0]).toMatchObject({ texto: 'Buscar', tipo: 'submit' });
  });

  it('aplica la politica de enmascarado a los valores de los campos', () => {
    montar('<input id="clave" type="password" value="secreta123">');

    const inventario = inventarioPagina(document, {
      valor: (valor, el) => (el.type === 'password'
        ? { valor: '(oculto)', enmascarado: true }
        : { valor, enmascarado: false }),
    });

    expect(inventario.campos[0].valor).toBe('(oculto)');
    expect(inventario.campos[0].enmascarado).toBe(true);
    expect(JSON.stringify(inventario)).not.toContain('secreta123');
  });

  it('resume las tablas con columnas, conteo de filas y una muestra', () => {
    const filas = Array.from({ length: 20 }, (_, i) => (
      `<tr><td>${1000 + i}</td><td>Cliente ${i}</td><td>Pendiente</td></tr>`
    )).join('');

    montar(`
      <table id="grid">
        <caption>Ordenes recientes</caption>
        <thead><tr><th>ID</th><th>Cliente</th><th>Estado</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    `);

    const [tabla] = inventarioPagina(document).tablas;

    expect(tabla.selector).toBe('#grid');
    expect(tabla.titulo).toBe('Ordenes recientes');
    expect(tabla.columnas).toEqual(['ID', 'Cliente', 'Estado']);
    expect(tabla.filas).toBe(20);
    expect(tabla.muestra).toHaveLength(3);          // solo la muestra, no las 20
    expect(tabla.muestra[0]).toEqual(['1000', 'Cliente 0', 'Pendiente']);
  });

  it('descarta enlaces vacios, javascript: y duplicados', () => {
    montar(`
      <a href="/ordenes">Ordenes</a>
      <a href="/ordenes">Ordenes</a>
      <a href="#">Ancla</a>
      <a href="javascript:void(0)">Falso</a>
      <a href="/clientes"></a>
    `);

    const { enlaces } = inventarioPagina(document);

    expect(enlaces).toHaveLength(1);
    expect(enlaces[0]).toMatchObject({ texto: 'Ordenes', href: '/ordenes' });
  });

  it('recorta lo que pasa el tope y lo declara en truncado', () => {
    const botones = Array.from({ length: 30 }, (_, i) => `<button>Boton ${i}</button>`).join('');
    montar(botones);

    const inventario = inventarioPagina(document, { limites: { botones: 10 } });

    expect(inventario.botones).toHaveLength(10);
    expect(inventario.truncado.join(' ')).toContain('botones: 30 encontrados, se listan 10');
  });

  it('lista iframes y dialogos abiertos', () => {
    montar(`
      <iframe src="about:blank" title="Modulo" id="modulo"></iframe>
      <div role="dialog"><h3 class="modal-title">Confirmar</h3><p>Seguro?</p></div>
    `);

    const inventario = inventarioPagina(document);

    expect(inventario.iframes[0]).toMatchObject({ src: 'about:blank', id: 'modulo', titulo: 'Modulo' });
    expect(inventario.dialogos[0].titulo).toBe('Confirmar');
    expect(inventario.dialogos[0].texto).toContain('Seguro?');
  });

  it('no lanza sin documento', () => {
    expect(inventarioPagina(null)).toBeNull();
  });
});

describe('resumenPagina', () => {
  it('cuenta lo que hay sin recorrer el detalle', () => {
    document.title = 'Panel';
    montar(`
      <input><input><select><option>A</option></select>
      <button>Uno</button>
      <table><tr><td>x</td></tr></table>
    `);

    const resumen = resumenPagina(document);

    expect(resumen).toMatchObject({ titulo: 'Panel', campos: 3, botones: 1, tablas: 1, iframes: 0 });
    expect(resumen.dialogo).toBeNull();
  });
});
