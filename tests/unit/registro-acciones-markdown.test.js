// Generacion del Markdown.
//
// Es el entregable de la feature: el archivo que se descarga y que despues lee
// una IA. Lo que se prueba:
//   · que cada accion quede con su selector y su valor,
//   · que las consecuencias queden DENTRO de la accion que las causo,
//   · que la relacion "este clic provoco esta navegacion" sobreviva incluso
//     cuando las dos puntas caen en partes distintas,
//   · que la division en partes se anuncie en las dos direcciones,
//   · y que nada enmascarado se filtre al texto final.

import { describe, expect, it } from 'vitest';
import { TIPOS } from '../../src/features/registro-acciones/constants.js';
import {
  construirIndice,
  duracion,
  generarPartes,
} from '../../src/features/registro-acciones/markdown.js';

const T0 = new Date('2026-09-15T14:09:00').getTime();

/** Azucar para escribir eventos de prueba sin repetir el sobre. */
function evento(id, tipo, extra = {}) {
  return {
    id,
    ts: T0 + id * 1000,
    tipo,
    origen: 'content',
    pestanaId: 1,
    frameId: 0,
    url: 'https://obsadm.lge.cl/admin/sales/order/',
    titulo: 'Orders / Magento Admin',
    datos: {},
    ...extra,
  };
}

function elemento(extra = {}) {
  return {
    tag: 'button',
    rol: 'boton',
    texto: 'Buscar',
    selector: '#search_form button.action-default',
    selectorCorto: 'button.action-default',
    datos: {},
    contexto: { formulario: { selector: '#search_form' }, frame: [] },
    ...extra,
  };
}

const SESION = { sesionId: '2026-09-15_14-09-00', startedAt: T0 };

describe('generarPartes', () => {
  it('abre una seccion por pagina, con inventario y acciones', () => {
    const { partes } = generarPartes([
      evento(1, TIPOS.SESION_INICIO),
      evento(2, TIPOS.PAGINA_VISITA, { datos: { titulo: 'Orders / Magento Admin' } }),
      evento(3, TIPOS.PAGINA_INVENTARIO, {
        datos: {
          formularios: [{ id: 'F1', selector: '#search_form', accion: '/admin/buscar', metodo: 'GET', campos: 2 }],
          campos: [{ etiqueta: 'Palabra clave', selector: '#fulltext', tipo: 'text', formulario: 'F1', valor: '' }],
          botones: [{ texto: 'Buscar', selector: '#search_form button', deshabilitado: false }],
          tablas: [{ selector: '#grid', columnas: ['ID', 'Cliente'], filas: 20, muestra: [['111', 'Ana']] }],
        },
      }),
      evento(4, TIPOS.CLIC, { datos: { elemento: elemento(), boton: 'izquierdo' } }),
    ], SESION);

    expect(partes).toHaveLength(1);
    const md = partes[0].contenido;

    expect(md).toContain('## P1 - 14:09:02 - Orders / Magento Admin');
    expect(md).toContain('- **URL:** `https://obsadm.lge.cl/admin/sales/order/`');
    expect(md).toContain('### Inventario');
    expect(md).toContain('| F1 | #search_form | /admin/buscar | GET | 2 |');
    expect(md).toContain('**Tabla `#grid`:** 20 filas - columnas: ID, Cliente');
    expect(md).toContain('### Acciones');
    expect(md).toContain('#### #4 - 14:09:04 - clic');
    expect(md).toContain('- **Selector:** `#search_form button.action-default`');
  });

  it('mete las consecuencias dentro de la accion que las provoco', () => {
    const { partes } = generarPartes([
      evento(1, TIPOS.PAGINA_VISITA),
      evento(2, TIPOS.ENVIO_FORMULARIO, {
        datos: {
          formulario: elemento({ tag: 'form', selector: '#search_form' }),
          metodo: 'GET',
          accion: '/admin/buscar',
          campos: [{ nombre: 'search', tipo: 'text', valor: '000123456', enmascarado: false }],
        },
      }),
      evento(3, TIPOS.APARECIO, {
        accionId: 2,
        datos: {
          clase: 'cargando',
          elemento: { selector: '.loading-mask' },
          texto: '',
          msDesdeAccion: 400,
        },
      }),
      evento(4, TIPOS.DESAPARECIO, {
        accionId: 2,
        datos: { clase: 'cargando', elemento: { selector: '.loading-mask' }, msDesdeAccion: 1600 },
      }),
    ], SESION);

    const md = partes[0].contenido;
    const bloque = md.slice(md.indexOf('#### #2'));

    expect(bloque).toContain('- **Campos enviados:** search=000123456');
    expect(bloque).toContain('- **Efecto (+0.4 s):** aparece cargando `.loading-mask`');
    expect(bloque).toContain('- **Efecto (+1.6 s):** desaparece cargando `.loading-mask`');

    // No quedaron sueltas como acciones propias.
    expect(md).not.toContain('#### #3');
    expect(md).not.toContain('#### #4');
  });

  it('enlaza la navegacion con el clic que la causo', () => {
    const { partes } = generarPartes([
      evento(1, TIPOS.PAGINA_VISITA),
      evento(2, TIPOS.CLIC, {
        datos: { elemento: elemento({ texto: 'Ver', href: '/admin/sales/order/view/order_id/98213/' }) },
      }),
      evento(3, TIPOS.NAVEGACION, {
        ts: T0 + 9000,
        url: 'https://obsadm.lge.cl/admin/sales/order/view/order_id/98213/',
        accionId: 2,
        datos: {
          urlAnterior: 'https://obsadm.lge.cl/admin/sales/order/',
          tipo: 'link',
          calificadores: [],
        },
      }),
    ], SESION);

    const md = partes[0].contenido;

    expect(md).toContain('## P2');
    expect(md).toContain('- **Llegada:** #2 (Clic en boton "Ver") -> navegacion `link`');
    expect(md).toContain('> Causado por #2 (Clic en boton "Ver").');
  });

  it('marca la pausa como un corte visible en la linea de tiempo', () => {
    const { partes } = generarPartes([
      evento(1, TIPOS.PAGINA_VISITA),
      evento(2, TIPOS.CLIC, { datos: { elemento: elemento() } }),
      evento(3, TIPOS.SESION_PAUSA, { datos: { motivo: 'usuario' } }),
      evento(4, TIPOS.SESION_REANUDAR, { datos: { pausaMs: 60000 } }),
      evento(5, TIPOS.CLIC, { datos: { elemento: elemento({ texto: 'Guardar' }) } }),
    ], SESION);

    const md = partes[0].contenido;

    expect(md).toContain('> **PAUSA a las 14:09:03 - lo que el usuario hizo mientras tanto no se grabo**');
    expect(md).toContain('> **Se reanuda la grabacion a las 14:09:04**');
    expect(md.indexOf('#### #2')).toBeLessThan(md.indexOf('PAUSA'));
    expect(md.indexOf('PAUSA')).toBeLessThan(md.indexOf('#### #5'));
  });

  it('divide en partes y deja la continuidad anunciada en ambos sentidos', () => {
    const eventos = [evento(1, TIPOS.PAGINA_VISITA)];
    for (let i = 2; i <= 30; i++) {
      eventos.push(evento(i, TIPOS.CLIC, { datos: { elemento: elemento({ texto: `Boton ${i}` }) } }));
    }

    const { partes, indice } = generarPartes(eventos, SESION, { eventosPorParte: 10 });

    expect(partes.length).toBeGreaterThan(1);
    expect(partes[0].nombre).toBe('registro_1.md');
    expect(partes[1].nombre).toBe('registro_2.md');

    expect(partes[0].contenido).toContain('sigue_en: registro_2.md');
    expect(partes[1].contenido).toContain('continua_de: registro_1.md');
    expect(partes[1].contenido).toContain('> Viene de `registro_1.md`');
    expect(partes[1].contenido).toContain('(continuacion)');

    // Ningun evento se perdio ni se duplico en el corte.
    const total = partes.reduce((suma, p) => suma + p.eventos, 0);
    expect(total).toBe(29);   // 30 eventos menos la visita, que no es accion
    expect(indice).toContain('| `registro_1.md` |');
  });

  it('ignora las paginas donde el usuario no hizo nada', () => {
    // Caso real: varias pestanas abiertas con la misma pagina. Cada una anuncia
    // su visita, pero el usuario solo trabaja en una.
    const { partes, paginas } = generarPartes([
      evento(1, TIPOS.PAGINA_VISITA, { pestanaId: 1, datos: { titulo: 'Ordenes' } }),
      evento(2, TIPOS.PAGINA_VISITA, { pestanaId: 2, datos: { titulo: 'Ordenes' } }),
      evento(3, TIPOS.PAGINA_VISITA, { pestanaId: 3, datos: { titulo: 'Ordenes' } }),
      evento(4, TIPOS.CLIC, { pestanaId: 3, datos: { elemento: elemento() } }),
    ], SESION);

    expect(paginas).toHaveLength(1);
    expect(paginas[0].pestanaId).toBe(3);
    expect(partes[0].contenido).toContain('## P1');
    expect(partes[0].contenido).not.toContain('## P2');
  });

  it('completa el titulo que la navegacion del service worker no trae', () => {
    const { partes } = generarPartes([
      evento(1, TIPOS.PAGINA_VISITA, { datos: { titulo: 'Listado' } }),
      evento(2, TIPOS.CLIC, { datos: { elemento: elemento({ texto: 'Ver' }) } }),
      // El service worker ve la navegacion pero no conoce el titulo...
      evento(3, TIPOS.NAVEGACION, {
        url: 'http://localhost/detalle.html',
        titulo: null,
        accionId: 2,
        datos: { tipo: 'link' },
      }),
      // ... y el frame lo aporta despues.
      evento(4, TIPOS.PAGINA_VISITA, {
        url: 'http://localhost/detalle.html',
        titulo: 'Detalle de la orden 000123456',
        datos: { titulo: 'Detalle de la orden 000123456' },
      }),
      evento(5, TIPOS.CLIC, {
        url: 'http://localhost/detalle.html',
        datos: { elemento: elemento({ texto: 'Guardar' }) },
      }),
    ], SESION);

    expect(partes[0].contenido).toContain('## P2 - 14:09:03 - Detalle de la orden 000123456');
  });

  it('mantiene el inventario dentro de la pagina aunque llegue antes de la primera accion', () => {
    const { partes } = generarPartes([
      evento(1, TIPOS.PAGINA_VISITA, { datos: { titulo: 'Ordenes' } }),
      evento(2, TIPOS.PAGINA_INVENTARIO, {
        datos: { botones: [{ texto: 'Buscar', selector: '#buscar' }] },
      }),
      evento(3, TIPOS.CLIC, { datos: { elemento: elemento() } }),
    ], SESION);

    const md = partes[0].contenido;
    expect(md.indexOf('## P1')).toBeLessThan(md.indexOf('### Inventario'));
    expect(md.indexOf('### Inventario')).toBeLessThan(md.indexOf('### Acciones'));
    expect(md.indexOf('### Acciones')).toBeLessThan(md.indexOf('#### #3'));
  });

  it('no pega el inventario de una pestana bajo el encabezado de otra', () => {
    const { partes } = generarPartes([
      evento(1, TIPOS.PAGINA_VISITA, { pestanaId: 1, url: 'http://x/lista', datos: { titulo: 'Lista' } }),
      // Inventario de OTRA pestana, que esta en otra pagina.
      evento(2, TIPOS.PAGINA_INVENTARIO, {
        pestanaId: 2,
        url: 'http://x/otra',
        datos: { botones: [{ texto: 'Boton de otra pantalla', selector: '#otro' }] },
      }),
      evento(3, TIPOS.PAGINA_INVENTARIO, {
        pestanaId: 1,
        url: 'http://x/lista',
        datos: { botones: [{ texto: 'Boton correcto', selector: '#correcto' }] },
      }),
      evento(4, TIPOS.CLIC, { pestanaId: 1, url: 'http://x/lista', datos: { elemento: elemento() } }),
    ], SESION);

    const md = partes[0].contenido;
    expect(md).toContain('Boton correcto');
    expect(md).not.toContain('Boton de otra pantalla');
  });

  it('corta tambien por tamano', () => {
    const eventos = [evento(1, TIPOS.PAGINA_VISITA)];
    for (let i = 2; i <= 40; i++) {
      eventos.push(evento(i, TIPOS.CAMPO_CAMBIO, {
        datos: {
          elemento: elemento({ tag: 'input', selector: `#campo-${i}` }),
          etiqueta: `Campo ${i}`,
          valor: 'x'.repeat(200),
          longitud: 200,
        },
      }));
    }

    const { partes } = generarPartes(eventos, SESION, { bytesPorParte: 2000 });
    expect(partes.length).toBeGreaterThan(1);
    for (const parte of partes.slice(0, -1)) {
      expect(parte.bytes).toBeGreaterThan(0);
    }
  });

  it('nunca escribe un valor enmascarado', () => {
    const { partes } = generarPartes([
      evento(1, TIPOS.PAGINA_VISITA),
      evento(2, TIPOS.CAMPO_CAMBIO, {
        datos: {
          elemento: elemento({ tag: 'input', selector: '#clave', texto: 'Contrasena' }),
          etiqueta: 'Contrasena',
          valor: '(oculto, 12 caracteres)',
          enmascarado: true,
          motivoEnmascarado: 'tipo-password',
          longitud: 12,
        },
      }),
      evento(3, TIPOS.ENVIO_FORMULARIO, {
        datos: {
          formulario: elemento({ tag: 'form', selector: '#login' }),
          metodo: 'POST',
          accion: '/login',
          campos: [
            { nombre: 'user', tipo: 'text', valor: 'eniquin', enmascarado: false },
            { nombre: 'password', tipo: 'password', valor: '(oculto, 12 caracteres)', enmascarado: true },
          ],
        },
      }),
    ], SESION);

    const md = partes[0].contenido;

    expect(md).toContain('*(enmascarado)*');
    expect(md).toContain('- **Selector:** `#clave`');   // el paso sigue siendo automatizable
    expect(md).toContain('password=(oculto)');
    expect(md).toContain('user=eniquin');
  });

  it('registra el detalle de tabla de un clic en una grilla', () => {
    const { partes } = generarPartes([
      evento(1, TIPOS.PAGINA_VISITA),
      evento(2, TIPOS.CLIC, {
        datos: {
          elemento: elemento({
            tag: 'a',
            rol: 'enlace',
            texto: 'Ver',
            href: '/ver/98213',
            contexto: {
              tabla: {
                selector: '#grid',
                fila: 3,
                columna: 11,
                encabezado: 'Accion',
                textoFila: '000123456 Juan Perez Pendiente',
              },
              frame: [],
            },
          }),
        },
      }),
    ], SESION);

    const md = partes[0].contenido;
    expect(md).toContain('- **En tabla:** `#grid` fila 3, columna 11 (Accion)');
    expect(md).toContain('- fila: `000123456 Juan Perez Pendiente`');
    expect(md).toContain('- **Enlace:** `/ver/98213`');
  });

  it('deja anotado el shadow DOM cuando el selector lo cruza', () => {
    const { partes } = generarPartes([
      evento(1, TIPOS.PAGINA_VISITA),
      evento(2, TIPOS.CLIC, {
        datos: {
          elemento: elemento({
            selector: '#return-app >>> button.enviar',
            rutaShadow: ['#return-app', 'button.enviar'],
          }),
        },
      }),
    ], SESION);

    expect(partes[0].contenido).toContain('- **Shadow DOM:** `#return-app` -> `button.enviar`');
  });
});

describe('construirIndice', () => {
  it('resume la sesion, las partes y el recorrido', () => {
    const { partes, estadisticas, paginas } = generarPartes([
      evento(1, TIPOS.PAGINA_VISITA, { datos: { titulo: 'Orders' } }),
      evento(2, TIPOS.CLIC, { datos: { elemento: elemento() } }),
      evento(3, TIPOS.TECLA, { datos: { tecla: 'Enter', modificadores: [] } }),
    ], SESION);

    const indice = construirIndice({
      sesion: { ...SESION, finishedAt: T0 + 300000, duracionMs: 300000, motivoFin: 'usuario' },
      partes,
      estadisticas,
      paginas,
    });

    expect(indice).toContain('sesion: 2026-09-15_14-09-00');
    expect(indice).toContain('duracion: 5m 0s');
    expect(indice).toContain('**Fin de la grabacion:** usuario.');
    expect(indice).toContain('## Partes');
    expect(indice).toContain('| `registro_1.md` | 2 |');
    expect(indice).toContain('## Recorrido');
    expect(indice).toContain('## Acciones por tipo');
    expect(indice).toContain('| clic | 1 |');
    expect(indice).toContain('## Como leer estos archivos');
  });
});

describe('duracion', () => {
  it('se lee de un vistazo', () => {
    expect(duracion(0)).toBe('0s');
    expect(duracion(45000)).toBe('45s');
    expect(duracion(305000)).toBe('5m 5s');
    expect(duracion(3725000)).toBe('1h 2m 5s');
  });
});
