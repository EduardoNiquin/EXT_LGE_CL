// "Ventas en vivo": las piezas puras (URLs del export y de la lista de exports,
// consulta, encolado, lista de archivos, login, CSV, fechas de Chile), el ciclo
// completo con un fetch falso (export asincrono: encolar -> esperar el archivo
// -> descargar -> portal -> borrar) y los reducers del estado.

import { describe, expect, it, vi } from 'vitest';
import {
  buildExportUrl,
  contarFilasCsv,
  extractExportListUrl,
  extractExportUrl,
  extractFormKey,
  isEncolado,
  isLoginPage,
  looksLikeOrdersCsv,
  mensajeErrorAdmin,
  normalizarAdminBase,
  rangoDeDias,
} from '../../src/features/magento/ventas-en-vivo/export-url.js';
import { estadoDe, maxIdDe, parseExportItems, pickNuevo } from '../../src/features/magento/ventas-en-vivo/export-list.js';
import {
  borrarArchivo,
  correrCiclo,
  elegirRango,
  obtenerCsv,
} from '../../src/features/magento/ventas-en-vivo/ciclo.js';
import {
  ESTADO_INICIAL,
  aplicarResultado,
  entradaHistorial,
  normalizarConfig,
  pushHistorial,
} from '../../src/features/magento/ventas-en-vivo/state.js';
import { API, DEFAULTS, HISTORIAL_MAX } from '../../src/features/magento/ventas-en-vivo/constants.js';

const ADMIN = 'https://shop.lg.com/obsadm';
const EXPORT_URL = `${ADMIN}/mui/export/gridToCsv/key/abc123def/`;
const LISTADO_URL = `${ADMIN}/sales/order/index/`;
const LIST_URL = `${ADMIN}/lg_order_export/export/index/key/9f8e7d6c/`;

/** Como viaja en el HTML: JSON con las barras escapadas (`\/`). */
const escapar = (obj) => JSON.stringify(obj).replace(/\//g, '\\/');

// Recorte del listado real: la config del boton Export viaja en el JSON del
// x-magento-init con las barras escapadas, y el menu lateral trae la URL de
// "Export Files Listing" (tambien escapada).
const LISTADO_HTML = `<!doctype html><html><head>
<script>window.FORM_KEY = 'fk-123';</script>
</head><body>
<script type="text/x-magento-init">{"#menu-magento-backend":{"menu":{"items":[{"label":"Export Files Listing","url":"https:\\/\\/shop.lg.com\\/obsadm\\/lg_order_export\\/export\\/index\\/key\\/9f8e7d6c\\/"}]}}}</script>
<script type="text/x-magento-init">{"*":{"Magento_Ui/js/core/app":{"types":{},"components":{"sales_order_grid":{"children":{"listing_top":{"children":{"export_button":{"component":"Magento_Ui/js/grid/export","config":{"options":{"cvs":{"value":"csv","label":"CSV","url":"https:\\/\\/shop.lg.com\\/obsadm\\/mui\\/export\\/gridToCsv\\/key\\/abc123def\\/"},"xml":{"value":"xml","label":"Excel XML","url":"https:\\/\\/shop.lg.com\\/obsadm\\/mui\\/export\\/gridToXml\\/key\\/abc123def\\/"}}}}}}}}}}}}</script>
</body></html>`;

// Lo que vuelve al encolar: el mismo listado (tras el 302) con el mensaje de exito.
const MENSAJE_OK = '<div id="messages"><div class="messages"><div class="message message-success success">'
  + '<div data-ui-id="messages-message-success">Message is added to queue, wait to get your file soon</div></div></div></div>';
const ENCOLADO_HTML = LISTADO_HTML.replace('<body>', `<body>${MENSAJE_OK}`);
const LISTADO_REDIRIGIDO_URL = `${ADMIN}/sales/order/index/key/k2k2/`;

const LOGIN_HTML = `<html><body class="adminhtml-auth-login"><form method="post" id="login-form" action="${ADMIN}/admin/">
<input name="login[username]" id="username"><input name="login[password]" type="password"></form></body></html>`;

// Como el export real: sin BOM, ID sin comillas y un campo con salto de linea.
const CSV = 'ID,"Purchase Point","Bill-to Name","Purchase Date",Status\n'
  + '123001,Chile,"Ana\nPerez","Sep 30, 2026 10:00:00 AM",pending\n'
  + '123002,Chile,"Luis Soto","Oct 1, 2026 9:00:00 AM",processing\n';

const RESPUESTA_PORTAL = {
  ok: true,
  carga: { id: 77, estado: 'ok', filas_leidas: 2, creadas: 1, actualizadas: 1, omitidas: 0, duracion_ms: 40 },
  hasta: '2026-10-01 09:00:00',
};

// Instante fijo: 1-oct-2026 12:00 en Chile (UTC-3).
const AHORA = Date.parse('2026-10-01T15:00:00Z');

// -----------------------------------------------------------------------------
// Lista de exports
// -----------------------------------------------------------------------------

const downloadUrl = (id) => `${ADMIN}/lg_order_export/export_file/download/id/${id}/key/bfe5${id}/`;
const deleteUrl = (id) => `${ADMIN}/lg_order_export/export_file/delete/id/${id}/key/fe02${id}/`;

function item(id, { type = 'order', status = 'success' } = {}) {
  return {
    id: String(id),
    type,
    status,
    file_path: `${type}_eduardo.niquin_26_10_01_20_59_15_${id}.csv`,
    user_id: '7524',
    notified: '1',
    id_link: '1790888322.02',
    export_time: '2026-10-01 21:59:16',
    start_time: '2026-10-01 20:58:42',
    actions: {
      view: { href: downloadUrl(id), label: 'Download' },
      delete: {
        href: deleteUrl(id),
        label: 'Delete',
        confirm: { title: 'Delete {file}', message: 'Are you sure?' },
        post: true,
      },
    },
  };
}

/** HTML de "Export Files Listing" con los items embebidos como JSON escapado. */
function listaHtml(items) {
  const init = {
    '*': {
      'Magento_Ui/js/core/app': {
        components: {
          lg_order_export_listing: {
            children: {
              lg_order_export_listing_data_source: {
                config: { data: { items, totalRecords: items.length } },
              },
            },
          },
        },
      },
    },
  };
  return `<!doctype html><html><body>
<script>window.FORM_KEY = 'fk-123';</script>
<script type="text/x-magento-init">${escapar(init)}</script>
</body></html>`;
}

// Lo que ya habia antes del ciclo: un export viejo de ordenes y uno de otro tipo.
const PREVIOS = [item(517900), item(517901, { type: 'pto_v2' })];

// -----------------------------------------------------------------------------
// fetch falso
// -----------------------------------------------------------------------------

function respuesta(cuerpo, status = 200, url = '', redirected = false) {
  const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    redirected,
    text: async () => texto,
  };
}

/** Respuestas en orden; la ultima se repite. */
function secuencia(...salidas) {
  let i = 0;
  return () => {
    const salida = salidas[Math.min(i, salidas.length - 1)];
    i += 1;
    return typeof salida === 'function' ? salida() : salida;
  };
}

/**
 * fetch falso: `rutas` es una lista de [prueba, respuesta|fn]. La prueba recibe
 * (url, opciones). Las llamadas quedan en `fetchImpl.llamadas`.
 */
function fetchFalso(rutas) {
  const llamadas = [];
  const fetchImpl = async (url, opciones = {}) => {
    llamadas.push({ url, opciones });
    for (const [prueba, salida] of rutas) {
      if (prueba(url, opciones)) {
        const r = typeof salida === 'function' ? salida(url, opciones) : salida;
        if (r instanceof Error) throw r;
        return r;
      }
    }
    throw new Error(`ruta no prevista: ${url}`);
  };
  fetchImpl.llamadas = llamadas;
  return fetchImpl;
}

const esListado = (url) => url === LISTADO_URL;
const esLista = (url) => url === LIST_URL;
const esExport = (url) => url.includes('/mui/export/gridToCsv/');
const esDescarga = (url) => url.includes('/export_file/download/');
const esBorrado = (url) => url.includes('/export_file/delete/');
const esPortal = (url) => url === API.BASE_URL;

const encolado = () => respuesta(ENCOLADO_HTML, 200, LISTADO_REDIRIGIDO_URL, true);

const config = (cambio = {}) => normalizarConfig({ ...DEFAULTS, activo: true, ...cambio });

/**
 * Rutas del camino feliz: lista -> encolar -> lista sin archivo -> lista con
 * el archivo pendiente -> lista con el archivo listo -> descarga -> portal 201
 * -> borrado. `cambios` reemplaza rutas por nombre.
 */
function rutasOk(cambios = {}) {
  const r = {
    listado: respuesta(LISTADO_HTML),
    lista: secuencia(
      respuesta(listaHtml(PREVIOS)),
      respuesta(listaHtml(PREVIOS)),
      respuesta(listaHtml([...PREVIOS, item(517902, { status: 'pending' })])),
      respuesta(listaHtml([...PREVIOS, item(517902)])),
    ),
    export: encolado(),
    descarga: respuesta(CSV, 200, downloadUrl(517902)),
    portal: respuesta(RESPUESTA_PORTAL, 201),
    borrado: respuesta(listaHtml(PREVIOS), 200, LIST_URL, true),
    ...cambios,
  };
  return [
    [esListado, r.listado],
    [esLista, r.lista],
    [esExport, r.export],
    [esDescarga, r.descarga],
    [esPortal, r.portal],
    [esBorrado, r.borrado],
  ];
}

const sinEspera = () => vi.fn(async () => {});

// -----------------------------------------------------------------------------

describe('extractExportUrl', () => {
  it('saca la URL del boton Export del JSON del x-magento-init (barras escapadas)', () => {
    expect(extractExportUrl(LISTADO_HTML)).toBe(EXPORT_URL);
  });

  it('cae al HTML crudo si la URL va suelta o en un script que no es JSON', () => {
    const suelta = `<a href="${ADMIN}/mui/export/gridToCsv/key/zz9/">CSV</a>`;
    expect(extractExportUrl(suelta)).toBe(`${ADMIN}/mui/export/gridToCsv/key/zz9/`);
    const escapada = '<script>var cfg = {url: "https:\\/\\/shop.lg.com\\/obsadm\\/mui\\/export\\/gridToCsv\\/key\\/k1\\/"};</script>';
    expect(extractExportUrl(escapada)).toBe(`${ADMIN}/mui/export/gridToCsv/key/k1/`);
  });

  it('no confunde el export a Excel XML ni inventa una URL', () => {
    const soloXml = LISTADO_HTML.replace(/gridToCsv/g, 'gridToXmlX');
    expect(extractExportUrl(soloXml)).toBe('');
    expect(extractExportUrl('')).toBe('');
  });

  it('lee el form_key del admin', () => {
    expect(extractFormKey(LISTADO_HTML)).toBe('fk-123');
    expect(extractFormKey('<input name="form_key" type="hidden" value="k2">')).toBe('k2');
    expect(extractFormKey('<html></html>')).toBe('');
  });
});

describe('extractExportListUrl', () => {
  it('saca la URL de Export Files Listing del menu (escapada en JSON)', () => {
    expect(extractExportListUrl(LISTADO_HTML)).toBe(LIST_URL);
  });

  it('tambien suelta en un href, absoluta o relativa', () => {
    expect(extractExportListUrl(`<a href="${LIST_URL}" class="item">Export Files Listing</a>`)).toBe(LIST_URL);
    const relativa = '<a href="/obsadm/lg_order_export/export/index/key/aa11/">Export Files Listing</a>';
    expect(extractExportListUrl(relativa, ADMIN)).toBe(`${ADMIN}/lg_order_export/export/index/key/aa11/`);
  });

  it('prefiere la que trae la key de la sesion', () => {
    const html = `<a href="${ADMIN}/lg_order_export/export/index/">sin key</a>${LISTADO_HTML}`;
    expect(extractExportListUrl(html)).toBe(LIST_URL);
  });

  it('no confunde las URLs de descarga y borrado ni inventa una', () => {
    expect(extractExportListUrl(`<a href="${downloadUrl(1)}">x</a>`)).toBe('');
    expect(extractExportListUrl('')).toBe('');
  });
});

describe('buildExportUrl', () => {
  it('arma los parametros del boton Export real, en su orden', () => {
    const url = new URL(buildExportUrl(`${EXPORT_URL}?viejo=1`, { from: '2026-09-29', to: '2026-10-01', storeId: '123' }));
    expect(`${url.origin}${url.pathname}`).toBe(EXPORT_URL);
    expect([...url.searchParams.entries()]).toEqual([
      ['filters[placeholder]', 'true'],
      ['filters[store_id][]', '123'],
      ['filters[created_at][from]', '9/29/2026'],
      ['filters[created_at][to]', '10/01/2026'],
      ['search', ''],
      ['namespace', 'sales_order_grid'],
      ['selected', 'false'],
    ]);
    expect(url.searchParams.has('excluded')).toBe(false);
  });

  it('la tienda es obligatoria: vacia va la de Chile', () => {
    const url = new URL(buildExportUrl(EXPORT_URL, { from: '2026-10-01', to: '2026-10-01', storeId: ' 7 ' }));
    expect(url.searchParams.getAll('filters[store_id][]')).toEqual(['7']);
    const sin = new URL(buildExportUrl(EXPORT_URL, { from: '2026-10-01', to: '2026-10-01', storeId: '' }));
    expect(sin.searchParams.getAll('filters[store_id][]')).toEqual(['123']);
  });

  it('normaliza la base del admin', () => {
    expect(normalizarAdminBase('https://shop.lg.com/obsadm/', 'x')).toBe(ADMIN);
    expect(normalizarAdminBase('https://otro.com/admin', 'x')).toBe('x');
    expect(normalizarAdminBase('', 'x')).toBe('x');
  });
});

describe('isEncolado', () => {
  it('el mensaje "added to queue" alcanza', () => {
    expect(isEncolado({ redirected: true, url: LISTADO_REDIRIGIDO_URL }, ENCOLADO_HTML)).toBe(true);
    expect(isEncolado({}, ENCOLADO_HTML)).toBe(true);
  });

  it('la redireccion al listado sin mensaje de error tambien', () => {
    expect(isEncolado({ redirected: true, url: LISTADO_REDIRIGIDO_URL }, LISTADO_HTML)).toBe(true);
  });

  it('no: sin redireccion, con error del admin o con el login', () => {
    expect(isEncolado({ redirected: false, url: EXPORT_URL }, LISTADO_HTML)).toBe(false);
    const conError = LISTADO_HTML.replace('<body>', '<body><div data-ui-id="messages-message-error">Please select <b>Purchase Point</b>.</div>');
    expect(isEncolado({ redirected: true, url: LISTADO_REDIRIGIDO_URL }, conError)).toBe(false);
    expect(mensajeErrorAdmin(conError)).toBe('Please select Purchase Point .');
    expect(isEncolado({ redirected: true, url: LISTADO_REDIRIGIDO_URL }, LOGIN_HTML)).toBe(false);
  });
});

describe('lista de exports', () => {
  const html = listaHtml([
    item(517900),
    item(517901, { type: 'pto_v2' }),
    item(517903, { status: 'pending' }),
    item(517902, { status: 'SUCCESS' }),
  ]);

  it('parseExportItems lee el JSON escapado, ordena por id y des-escapa las URLs', () => {
    const items = parseExportItems(html);
    expect(items.map((i) => i.id)).toEqual([517900, 517901, 517902, 517903]);
    expect(items[2]).toEqual({
      id: 517902,
      type: 'order',
      status: 'success',
      file_path: 'order_eduardo.niquin_26_10_01_20_59_15_517902.csv',
      export_time: '2026-10-01 21:59:16',
      start_time: '2026-10-01 20:58:42',
      downloadUrl: downloadUrl(517902),
      deleteUrl: deleteUrl(517902),
    });
    expect(items[1].type).toBe('pto_v2');
  });

  it('no depende del orden de las otras claves y no repite un id', () => {
    const { id, ...resto } = item(1);
    const reordenado = { id, actions: resto.actions, status: 'success', type: 'order', file_path: 'a.csv' };
    const doble = `<script>${escapar([reordenado])}</script><script>${escapar([reordenado])}</script>`;
    expect(parseExportItems(doble)).toMatchObject([{ id: 1, type: 'order', status: 'success', downloadUrl: downloadUrl(1) }]);
  });

  it('tambien con las comillas escapadas (JSON dentro de un string)', () => {
    const doble = `<script>var x = "${escapar([item(9)]).replace(/"/g, '\\"')}";</script>`;
    expect(parseExportItems(doble).map((i) => i.id)).toEqual([9]);
  });

  it('una lista vacia o un HTML cualquiera da []', () => {
    expect(parseExportItems(listaHtml([]))).toEqual([]);
    expect(parseExportItems(LISTADO_HTML)).toEqual([]);
    expect(parseExportItems('')).toEqual([]);
  });

  it('maxIdDe y pickNuevo: el primer export de ordenes posterior a la foto', () => {
    const items = parseExportItems(html);
    expect(maxIdDe(items)).toBe(517903);
    expect(maxIdDe([])).toBe(0);
    expect(pickNuevo(items, 517900)?.id).toBe(517902); // ignora el pto_v2 y el viejo
    expect(pickNuevo(items, 517902)?.id).toBe(517903);
    expect(pickNuevo(items, 517903)).toBeNull();
    expect(pickNuevo(parseExportItems(listaHtml([item(5, { type: 'pto_v2' })])), 0)).toBeNull();
  });

  it('estadoDe: listo, fallo o pendiente', () => {
    expect(estadoDe({ status: 'success' })).toBe('listo');
    expect(estadoDe({ status: 'error' })).toBe('fallo');
    expect(estadoDe({ status: 'pending' })).toBe('pendiente');
    expect(estadoDe({ status: 'processing' })).toBe('pendiente');
  });
});

describe('isLoginPage', () => {
  it('reconoce el formulario de login del admin', () => {
    expect(isLoginPage(LOGIN_HTML)).toBe(true);
    expect(isLoginPage('<form><input name="login[username]"></form>')).toBe(true);
    expect(isLoginPage('{"ajaxExpired":1,"ajaxRedirect":"https://shop.lg.com/obsadm/admin/"}')).toBe(true);
  });

  it('no confunde el listado, la lista de exports ni un CSV', () => {
    expect(isLoginPage(LISTADO_HTML)).toBe(false);
    expect(isLoginPage(listaHtml(PREVIOS))).toBe(false);
    expect(isLoginPage(CSV)).toBe(false);
    expect(isLoginPage('')).toBe(false);
  });
});

describe('looksLikeOrdersCsv', () => {
  it('acepta la cabecera con ID, con o sin comillas, BOM o punto y coma', () => {
    expect(looksLikeOrdersCsv(CSV)).toBe(true);
    expect(looksLikeOrdersCsv('\uFEFFID;Status\r\n1;pending')).toBe(true);
    expect(looksLikeOrdersCsv('\uFEFF"Purchase Point" , "ID"\n')).toBe(true);
  });

  it('rechaza HTML, JSON y un CSV sin columna ID', () => {
    expect(looksLikeOrdersCsv(LISTADO_HTML)).toBe(false);
    expect(looksLikeOrdersCsv('<!doctype html><html>ID</html>')).toBe(false);
    expect(looksLikeOrdersCsv('{"ID":1}')).toBe(false);
    expect(looksLikeOrdersCsv('Order,Status\n1,x')).toBe(false);
    expect(looksLikeOrdersCsv('')).toBe(false);
  });

  it('cuenta filas sin contar los saltos de linea dentro de comillas', () => {
    expect(contarFilasCsv(CSV)).toBe(2);
    expect(contarFilasCsv('ID,Dir\n1,"Calle 1\nDepto 2"\n2,x')).toBe(2);
    expect(contarFilasCsv('ID,Status\n')).toBe(0);
    expect(contarFilasCsv('')).toBe(0);
  });
});

describe('rangoDeDias (hora de Chile, hasta manana por la zona de Londres del grid)', () => {
  it('cuenta los dias en Chile aunque en UTC ya sea manana', () => {
    // 1-oct 02:30 UTC = 30-sep 23:30 en Chile: hoy es el 30 y el rango llega al 1.
    expect(rangoDeDias(new Date('2026-10-01T02:30:00Z'), 2)).toEqual({ from: '2026-09-29', to: '2026-10-01' });
  });

  it('cruza el cambio de mes y 1 dia es hoy (mas manana, por Londres)', () => {
    expect(rangoDeDias(AHORA, 7)).toEqual({ from: '2026-09-25', to: '2026-10-02' });
    expect(rangoDeDias(AHORA, 1)).toEqual({ from: '2026-10-01', to: '2026-10-02' });
    expect(rangoDeDias(AHORA, 0)).toEqual({ from: '2026-10-01', to: '2026-10-02' });
  });

  it('el primer tick y uno de cada N son el repaso largo', () => {
    const c = config({ diasCortos: 2, diasLargos: 7, cadaNTicksLargo: 12 });
    expect(elegirRango(c, 1, AHORA).tipo).toBe('largo');
    expect(elegirRango(c, 2, AHORA)).toEqual({ tipo: 'corto', from: '2026-09-30', to: '2026-10-02' });
    expect(elegirRango(c, 13, AHORA)).toEqual({ tipo: 'largo', from: '2026-09-25', to: '2026-10-02' });
  });
});

// -----------------------------------------------------------------------------

describe('correrCiclo (export asincrono)', () => {
  const base = { config: config(), token: 'tok-1', ahora: AHORA, tickN: 2 };

  it('ok: listado -> lista -> encolar -> sondeo -> descarga -> portal 201 -> borrado', async () => {
    const fetchImpl = fetchFalso(rutasOk());
    const sleep = sinEspera();
    const r = await correrCiclo({ ...base, fetchImpl, sleep });

    expect(r.resultado).toBe('ok');
    expect(r.filas).toBe(2);
    expect(r.bytes).toBe(new TextEncoder().encode(CSV).length);
    expect(r.carga).toEqual(RESPUESTA_PORTAL.carga);
    expect(r.hasta).toBe('2026-10-01 09:00:00');
    expect(r.rango).toEqual({ tipo: 'corto', from: '2026-09-30', to: '2026-10-02' });
    expect(r.archivo).toEqual({
      id: 517902,
      nombre: 'order_eduardo.niquin_26_10_01_20_59_15_517902.csv',
      export_time: '2026-10-01 21:59:16',
      deleteUrl: deleteUrl(517902),
    });
    expect(r.borrado).toBe(true);
    expect(r.cache).toEqual({ exportUrl: EXPORT_URL, listUrl: LIST_URL, formKey: 'fk-123' });
    expect(r.storeIdUsado).toBe('123');
    expect(typeof r.ms).toBe('number');

    // Secuencia exacta de pedidos.
    const tipo = (url) => [
      [esListado, 'listado'], [esLista, 'lista'], [esExport, 'encolar'],
      [esDescarga, 'descarga'], [esPortal, 'portal'], [esBorrado, 'borrado'],
    ].find(([prueba]) => prueba(url))?.[1];
    expect(fetchImpl.llamadas.map((l) => tipo(l.url))).toEqual([
      'listado', 'lista', 'encolar', 'lista', 'lista', 'lista', 'descarga', 'portal', 'borrado',
    ]);
    // Primer sondeo a los 2 s y luego cada 2 s.
    expect(sleep.mock.calls).toEqual([[2000], [2000], [2000]]);

    const encolar = fetchImpl.llamadas.find((l) => esExport(l.url));
    expect(encolar.opciones.credentials).toBe('include');
    const params = new URL(encolar.url).searchParams;
    expect(params.get('filters[store_id][]')).toBe('123');
    expect(params.get('filters[created_at][from]')).toBe('9/30/2026');
    expect(params.get('selected')).toBe('false');

    const portal = fetchImpl.llamadas.find((l) => esPortal(l.url));
    expect(portal.opciones.method).toBe('POST');
    expect(portal.opciones.headers['X-Api-Token']).toBe('tok-1');
    expect(portal.opciones.headers['Content-Type']).toBe('text/csv');
    expect(portal.opciones.body).toBe(CSV);

    const borrado = fetchImpl.llamadas.find((l) => esBorrado(l.url));
    expect(borrado.url).toBe(deleteUrl(517902));
    expect(borrado.opciones.method).toBe('POST');
    expect(borrado.opciones.headers['Content-Type']).toMatch(/x-www-form-urlencoded/);
    expect(new URLSearchParams(borrado.opciones.body).get('form_key')).toBe('fk-123');
  });

  it('500 al encolar (p. ej. sin tienda): error legible, sin descarga ni portal', async () => {
    const fetchImpl = fetchFalso(rutasOk({
      export: respuesta('<html><body>There has been an error processing your request</body></html>', 500),
    }));
    const r = await correrCiclo({ ...base, fetchImpl, sleep: sinEspera() });
    expect(r).toMatchObject({ resultado: 'error', code: 'VEV_ENCOLAR_HTTP', status: 500 });
    expect(r.error).toMatch(/500/);
    expect(r.error).toMatch(/Store ID 123/);
    expect(fetchImpl.llamadas.some((l) => esDescarga(l.url) || esPortal(l.url) || esBorrado(l.url))).toBe(false);
  });

  it('el admin no encola (mensaje de error en el listado): error con el mensaje', async () => {
    const conError = LISTADO_HTML.replace('<body>', '<body><div data-ui-id="messages-message-error">Please select Purchase Point.</div>');
    const fetchImpl = fetchFalso(rutasOk({ export: respuesta(conError, 200, LISTADO_REDIRIGIDO_URL, true) }));
    const r = await correrCiclo({ ...base, fetchImpl, sleep: sinEspera() });
    expect(r).toMatchObject({ resultado: 'error', code: 'VEV_NO_ENCOLADO' });
    expect(r.error).toMatch(/Purchase Point/);
  });

  it('sesion caducada en el listado: no llama a nada mas', async () => {
    const fetchImpl = fetchFalso([[esListado, respuesta(LOGIN_HTML)]]);
    const r = await correrCiclo({ ...base, fetchImpl, sleep: sinEspera() });
    expect(r.resultado).toBe('sesion_caducada');
    expect(r.cache).toBeNull();
    expect(fetchImpl.llamadas).toHaveLength(1);
  });

  it('sesion caducada en la lista de exports', async () => {
    const fetchImpl = fetchFalso(rutasOk({ lista: respuesta(LOGIN_HTML) }));
    const r = await correrCiclo({ ...base, fetchImpl, sleep: sinEspera() });
    expect(r.resultado).toBe('sesion_caducada');
    expect(fetchImpl.llamadas.some((l) => esExport(l.url) || esPortal(l.url))).toBe(false);
  });

  it('sesion caducada mientras se espera el archivo', async () => {
    const fetchImpl = fetchFalso(rutasOk({ lista: secuencia(respuesta(listaHtml(PREVIOS)), respuesta(LOGIN_HTML)) }));
    const r = await correrCiclo({ ...base, fetchImpl, sleep: sinEspera() });
    expect(r.resultado).toBe('sesion_caducada');
    expect(fetchImpl.llamadas.some((l) => esPortal(l.url))).toBe(false);
  });

  it('el archivo no aparece: se agota la espera', async () => {
    const fetchImpl = fetchFalso(rutasOk({ lista: respuesta(listaHtml(PREVIOS)) }));
    const sleep = sinEspera();
    const r = await correrCiclo({
      ...base,
      config: config({ esperaArchivoMs: 2000, esperaArchivoMaxMs: 10000 }),
      fetchImpl,
      sleep,
    });
    expect(r).toMatchObject({ resultado: 'error', code: 'VEV_EXPORT_TIMEOUT' });
    expect(r.error).toMatch(/no aparecio en 10 s/);
    expect(sleep).toHaveBeenCalledTimes(5);
    expect(fetchImpl.llamadas.some((l) => esDescarga(l.url) || esPortal(l.url))).toBe(false);
  });

  it('la espera tambien corre con timers falsos (sleep por defecto)', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = fetchFalso(rutasOk({ lista: respuesta(listaHtml(PREVIOS)) }));
      const promesa = correrCiclo({ ...base, config: config({ esperaArchivoMs: 2000, esperaArchivoMaxMs: 10000 }), fetchImpl });
      await vi.advanceTimersByTimeAsync(12000);
      const r = await promesa;
      expect(r.code).toBe('VEV_EXPORT_TIMEOUT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('un archivo nuevo con status de error: error legible, sin descarga', async () => {
    const fetchImpl = fetchFalso(rutasOk({
      lista: secuencia(respuesta(listaHtml(PREVIOS)), respuesta(listaHtml([...PREVIOS, item(517902, { status: 'error' })]))),
    }));
    const r = await correrCiclo({ ...base, fetchImpl, sleep: sinEspera() });
    expect(r).toMatchObject({ resultado: 'error', code: 'VEV_EXPORT_FALLO' });
    expect(r.error).toMatch(/"error"/);
    expect(r.archivo).toMatchObject({ id: 517902 });
    expect(fetchImpl.llamadas.some((l) => esDescarga(l.url))).toBe(false);
  });

  it('un export nuevo de otro tipo (pto_v2) no se toma por el nuestro', async () => {
    const fetchImpl = fetchFalso(rutasOk({
      lista: secuencia(
        respuesta(listaHtml(PREVIOS)),
        respuesta(listaHtml([...PREVIOS, item(517902, { type: 'pto_v2' })])),
        respuesta(listaHtml([...PREVIOS, item(517902, { type: 'pto_v2' }), item(517903)])),
      ),
      descarga: respuesta(CSV),
    }));
    const r = await correrCiclo({ ...base, fetchImpl, sleep: sinEspera() });
    expect(r.resultado).toBe('ok');
    expect(r.archivo.id).toBe(517903);
  });

  it('portal 422: el ciclo falla pero el archivo igual se borra', async () => {
    const fetchImpl = fetchFalso(rutasOk({
      portal: respuesta({ error: 'csv_invalido', message: 'El CSV no trae la columna ID.' }, 422),
    }));
    const r = await correrCiclo({ ...base, fetchImpl, sleep: sinEspera() });
    expect(r).toMatchObject({ resultado: 'error', code: 'VEV_PORTAL_422', status: 422, borrado: true, filas: 2 });
    expect(r.error).toMatch(/columna ID/);
    expect(fetchImpl.llamadas.some((l) => esBorrado(l.url))).toBe(true);
  });

  it('un fallo al borrar no rompe el ciclo: se anota', async () => {
    const fetchImpl = fetchFalso(rutasOk({ borrado: respuesta('<html>error</html>', 500) }));
    const r = await correrCiclo({ ...base, fetchImpl, sleep: sinEspera() });
    expect(r.resultado).toBe('ok');
    expect(r.borrado).toBe(false);
    expect(r.errorBorrado).toMatch(/500/);

    const red = fetchFalso(rutasOk({ borrado: new TypeError('Failed to fetch') }));
    const r2 = await correrCiclo({ ...base, fetchImpl: red, sleep: sinEspera() });
    expect(r2).toMatchObject({ resultado: 'ok', borrado: false });
  });

  it('con borrarArchivo:false no se borra', async () => {
    const fetchImpl = fetchFalso(rutasOk());
    const r = await correrCiclo({ ...base, config: config({ borrarArchivo: false }), fetchImpl, sleep: sinEspera() });
    expect(r).toMatchObject({ resultado: 'ok', borrado: null });
    expect(fetchImpl.llamadas.some((l) => esBorrado(l.url))).toBe(false);
  });

  it('sin ordenes en el rango: no llama al portal, pero borra el archivo', async () => {
    const fetchImpl = fetchFalso(rutasOk({ descarga: respuesta('ID,"Purchase Point",Status\n') }));
    const r = await correrCiclo({ ...base, fetchImpl, sleep: sinEspera() });
    expect(r).toMatchObject({ resultado: 'ok', sinFilas: true, filas: 0, borrado: true });
    expect(fetchImpl.llamadas.some((l) => esPortal(l.url))).toBe(false);
  });

  it('una descarga que no es CSV da un error y deja el archivo', async () => {
    const fetchImpl = fetchFalso(rutasOk({ descarga: respuesta('<html><body>Dashboard</body></html>') }));
    const r = await correrCiclo({ ...base, fetchImpl, sleep: sinEspera() });
    expect(r).toMatchObject({ resultado: 'error', code: 'VEV_NO_ES_CSV' });
    expect(r.archivo).toMatchObject({ id: 517902 });
    expect(fetchImpl.llamadas.some((l) => esBorrado(l.url) || esPortal(l.url))).toBe(false);
  });

  it('con el cache vigente no vuelve a pedir el listado', async () => {
    const fetchImpl = fetchFalso(rutasOk());
    const cache = { exportUrl: EXPORT_URL, listUrl: LIST_URL, formKey: 'fk-123' };
    const r = await correrCiclo({ ...base, fetchImpl, cache, sleep: sinEspera() });
    expect(r.resultado).toBe('ok');
    expect(fetchImpl.llamadas.some((l) => esListado(l.url))).toBe(false);
  });

  it('un cache de otra sesion (la lista redirige al dashboard) se resuelve de nuevo', async () => {
    const vieja = `${ADMIN}/lg_order_export/export/index/key/vieja/`;
    const fetchImpl = fetchFalso([
      [(url) => url === vieja, respuesta('<html>Dashboard</html>', 200, `${ADMIN}/admin/dashboard/`, true)],
      ...rutasOk(),
    ]);
    const cache = { exportUrl: `${ADMIN}/mui/export/gridToCsv/key/vieja/`, listUrl: vieja, formKey: 'x' };
    const r = await correrCiclo({ ...base, fetchImpl, cache, sleep: sinEspera() });
    expect(r.resultado).toBe('ok');
    expect(r.cache).toEqual({ exportUrl: EXPORT_URL, listUrl: LIST_URL, formKey: 'fk-123' });
    expect(fetchImpl.llamadas.filter((l) => esListado(l.url))).toHaveLength(1);
  });

  it('un listado sin la URL de Export Files Listing da un error legible', async () => {
    const sinMenu = LISTADO_HTML.replace(/lg_order_export/g, 'otro_modulo');
    const fetchImpl = fetchFalso(rutasOk({ listado: respuesta(sinMenu) }));
    const r = await correrCiclo({ ...base, fetchImpl, sleep: sinEspera() });
    expect(r).toMatchObject({ resultado: 'error', code: 'VEV_SIN_URL_LISTA' });
  });

  it('excepcion de red en el admin y en el portal', async () => {
    const enAdmin = await correrCiclo({ ...base, fetchImpl: fetchFalso([[esListado, new TypeError('Failed to fetch')]]) });
    expect(enAdmin).toMatchObject({ resultado: 'error', code: 'VEV_RED' });
    expect(enAdmin.error).toMatch(/Failed to fetch/);

    const enPortal = await correrCiclo({
      ...base,
      fetchImpl: fetchFalso(rutasOk({ portal: new TypeError('Failed to fetch') })),
      sleep: sinEspera(),
    });
    expect(enPortal).toMatchObject({ resultado: 'error', code: 'VEV_RED', fase: 'portal', borrado: true });
    expect(enPortal.error).toMatch(/certificado/);
  });

  it.each([
    [401, { message: 'Unauthenticated.' }, 'VEV_PORTAL_401', /token/i],
    [503, { message: 'Token no configurado' }, 'VEV_PORTAL_503', /MAGENTO_PA_TOKEN/],
    [500, '<html>Server Error</html>', 'VEV_PORTAL_HTTP', /500/],
  ])('portal %i -> error legible', async (status, cuerpo, code, mensaje) => {
    const fetchImpl = fetchFalso(rutasOk({ portal: respuesta(cuerpo, status) }));
    const r = await correrCiclo({ ...base, fetchImpl, sleep: sinEspera() });
    expect(r).toMatchObject({ resultado: 'error', code, status });
    expect(r.error).toMatch(mensaje);
  });

  it('el portal puede ir por otro fetch (el SW cuando el CSV lo saco la pestana)', async () => {
    const rutas = rutasOk().filter(([prueba]) => prueba !== esPortal);
    const fetchImpl = fetchFalso(rutas);
    const fetchPortal = fetchFalso([[esPortal, respuesta(RESPUESTA_PORTAL, 201)]]);
    const r = await correrCiclo({ ...base, fetchImpl, fetchPortal, sleep: sinEspera() });
    expect(r.resultado).toBe('ok');
    expect(fetchPortal.llamadas).toHaveLength(1);
  });

  it('obtenerCsv devuelve el CSV y el archivo sin tocar el portal ni borrar', async () => {
    const fetchImpl = fetchFalso(rutasOk());
    const r = await obtenerCsv({ config: config(), fetchImpl, ahora: AHORA, tickN: 1, sleep: sinEspera() });
    expect(r).toMatchObject({ resultado: 'csv', csv: CSV, filas: 2, rango: { tipo: 'largo' }, archivo: { id: 517902 } });
    expect(fetchImpl.llamadas.some((l) => esPortal(l.url) || esBorrado(l.url))).toBe(false);
  });

  it('borrarArchivo sin form_key o sin enlace no lanza', async () => {
    const fetchImpl = fetchFalso([]);
    await expect(borrarArchivo({ archivo: { deleteUrl: deleteUrl(1) }, formKey: '', fetchImpl }))
      .resolves.toMatchObject({ borrado: false, error: expect.stringMatching(/form_key/) });
    await expect(borrarArchivo({ archivo: {}, formKey: 'k', fetchImpl }))
      .resolves.toMatchObject({ borrado: false });
    expect(fetchImpl.llamadas).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------

describe('estado e historial', () => {
  it('el historial va del mas nuevo al mas viejo y se recorta', () => {
    let lista = [];
    for (let i = 0; i < HISTORIAL_MAX + 10; i += 1) lista = pushHistorial(lista, { ts: i });
    expect(lista).toHaveLength(HISTORIAL_MAX);
    expect(lista[0].ts).toBe(HISTORIAL_MAX + 9);
    expect(lista.at(-1).ts).toBe(10);
    expect(pushHistorial(null, { ts: 1 })).toEqual([{ ts: 1 }]);
  });

  it('un ok limpia los fallos y guarda la carga y el archivo', () => {
    const previo = { ...ESTADO_INICIAL, fallosSeguidos: 4, sesionCaducada: true, error: 'x' };
    const e = aplicarResultado(previo, {
      resultado: 'ok',
      filas: 2,
      carga: RESPUESTA_PORTAL.carga,
      hasta: RESPUESTA_PORTAL.hasta,
      via: 'sw',
      archivo: { id: 9, nombre: 'order_x.csv', export_time: '2026-10-01 21:59:16', deleteUrl: deleteUrl(9) },
      borrado: true,
    }, 1000);
    expect(e).toMatchObject({
      ultimaCorrida: 1000, ultimoOk: 1000, filasEnviadas: 2, creadas: 1, actualizadas: 1,
      hasta: RESPUESTA_PORTAL.hasta, error: null, sesionCaducada: false, fallosSeguidos: 0, via: 'sw', enCurso: false,
      archivo: { id: 9, nombre: 'order_x.csv', export_time: '2026-10-01 21:59:16' },
      archivoBorrado: true,
    });
    // Las URLs (con la key de la sesion) no se guardan.
    expect(e.archivo).not.toHaveProperty('deleteUrl');
  });

  it('un fallo suma y la sesion caducada se marca', () => {
    const e1 = aplicarResultado(ESTADO_INICIAL, { resultado: 'error', error: 'boom' }, 1);
    expect(e1).toMatchObject({ fallosSeguidos: 1, error: 'boom', sesionCaducada: false, archivo: null });
    const e2 = aplicarResultado(e1, { resultado: 'sesion_caducada' }, 2);
    expect(e2.fallosSeguidos).toBe(2);
    expect(e2.sesionCaducada).toBe(true);
    expect(e2.error).toMatch(/inicia sesion/);
  });

  it('la entrada del historial no arrastra el CSV y anota el archivo', () => {
    const entrada = entradaHistorial({
      resultado: 'ok', csv: CSV, filas: 2, carga: RESPUESTA_PORTAL.carga,
      archivo: { id: 9, nombre: 'order_x.csv' }, borrado: false, errorBorrado: 'HTTP 500',
    }, 5);
    expect(entrada).not.toHaveProperty('csv');
    expect(entrada).toMatchObject({
      ts: 5, filas: 2, creadas: 1, cargaId: 77, error: null, archivo: 'order_x.csv', borrado: false, errorBorrado: 'HTTP 500',
    });
  });

  it('la config se normaliza a los limites y la tienda nunca queda vacia', () => {
    const c = normalizarConfig({
      intervaloMin: 0, diasCortos: 'x', diasLargos: 90, storeId: ' 7 ', esperaArchivoMaxMs: 5, esperaArchivoMs: 'y',
    });
    expect(c).toMatchObject({
      intervaloMin: 1, diasCortos: DEFAULTS.diasCortos, diasLargos: 28, storeId: '7', activo: false,
      esperaArchivoMaxMs: 10000, esperaArchivoMs: DEFAULTS.esperaArchivoMs, borrarArchivo: true,
    });
    expect(normalizarConfig({ storeId: '' }).storeId).toBe('123');
    expect(normalizarConfig({ borrarArchivo: false }).borrarArchivo).toBe(false);
    expect(normalizarConfig(null)).toEqual(normalizarConfig(DEFAULTS));
    expect(DEFAULTS).toMatchObject({ storeId: '123', borrarArchivo: true, esperaArchivoMs: 2000, esperaArchivoMaxMs: 120000 });
  });
});
