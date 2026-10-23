// "Stock" (apartado Magento): las piezas puras del modulo que avisa las alertas
// de stock de lg.com/cl que registra el portal OBS. Config, sondeo de alertas
// (primera vez, paginacion, filtro, sin repetir), "Revisar ahora", plan y
// textos de las notificaciones, resumen diario (portal atrasado), proximo
// disparo en hora de Chile (con cambio de horario), errores HTTP y de red, y la
// lista de productos (filtro, busqueda, CSV). Sin red real: fetch falso.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAlertas,
  getStock,
  leerAlertasDesde,
  postRevisar,
  urlsDe,
} from '../../src/features/magento/stock/api.js';
import { revisar, sinRepetir, sondear } from '../../src/features/magento/stock/ciclo.js';
import {
  avisoPortal,
  filtrarPorTipo,
  mensajeAlerta,
  notificacionResumen,
  planNotificaciones,
  textoConteo,
  conteoPorTipo,
  tituloAlerta,
} from '../../src/features/magento/stock/notificaciones.js';
import {
  agregarAlertas,
  aplicarError,
  aplicarSondeo,
  contarNoVistas,
  ESTADO_INICIAL,
  marcarVistas,
  normalizarConfig,
} from '../../src/features/magento/stock/state.js';
import {
  contarPorFiltro,
  filtrarProductos,
  nombreCsv,
  productosACsv,
} from '../../src/features/magento/stock/productos.js';
import { fechaHoraChile, proximoDisparo } from '../../src/features/magento/stock/tiempo.js';
import { API, DEFAULTS, NOTIF, TOKEN_DEFAULT } from '../../src/features/magento/stock/constants.js';
import { API as VEV_API } from '../../src/features/magento/ventas-en-vivo/constants.js';

const BASE = API.BASE_URL;
const TOKEN = 'tok-123';

/** fetch falso: `handler(url, opciones)` -> {status, body} (body objeto = JSON). Registra las llamadas. */
function crearFetch(handler) {
  const llamadas = [];
  const fetchImpl = vi.fn(async (url, opciones = {}) => {
    llamadas.push({ url, opciones });
    const r = await handler(url, opciones, llamadas.length);
    if (r instanceof Error) throw r;
    const status = r?.status ?? 200;
    const texto = typeof r?.body === 'string' ? r.body : JSON.stringify(r?.body ?? {});
    return { status, ok: status >= 200 && status < 300, text: async () => texto };
  });
  return { fetchImpl, llamadas };
}

function alerta(id, tipo = 'sin_stock', extra = {}) {
  return {
    id,
    revision_id: 7,
    tipo,
    sku: `SKU${id}`,
    modelo: `M${id}`,
    nombre: `Producto ${id}`,
    antes: 'en_stock',
    ahora: tipo === 'poco_stock' ? 'en_stock' : 'agotado',
    quedan: tipo === 'poco_stock' ? 2 : null,
    precio_final: 199990,
    url: `https://www.lg.com/cl/p/${id}`,
    creada_en: '2026-10-23T12:00:00Z',
    ...extra,
  };
}

const rango = (desde, hasta, tipo) => Array.from({ length: hasta - desde + 1 }, (_, i) => alerta(desde + i, tipo));

const CONFIG = normalizarConfig({});

afterEach(() => {
  vi.useRealTimers();
});

// -----------------------------------------------------------------------------
// Config y constantes
// -----------------------------------------------------------------------------

describe('normalizarConfig', () => {
  it('completa los valores por defecto', () => {
    const c = normalizarConfig(null);
    expect(c).toEqual({
      activo: false,
      intervaloMin: 15,
      notificar: { sin_stock: true, fuera_de_tienda: true, poco_stock: true },
      resumenActivo: true,
      horaResumen: '09:30',
      token: '',
      endpoint: '',
    });
    expect(DEFAULTS.intervaloMin).toBe(15);
  });

  it('acota el intervalo a 5-60 y redondea', () => {
    expect(normalizarConfig({ intervaloMin: 1 }).intervaloMin).toBe(5);
    expect(normalizarConfig({ intervaloMin: 600 }).intervaloMin).toBe(60);
    expect(normalizarConfig({ intervaloMin: '12.6' }).intervaloMin).toBe(13);
    expect(normalizarConfig({ intervaloMin: 'abc' }).intervaloMin).toBe(15);
  });

  it('notificar parcial: lo que no se dice queda en true', () => {
    expect(normalizarConfig({ notificar: { poco_stock: false } }).notificar)
      .toEqual({ sin_stock: true, fuera_de_tienda: true, poco_stock: false });
  });

  it('hora del resumen: valida y con ceros, o la por defecto', () => {
    expect(normalizarConfig({ horaResumen: '9:05' }).horaResumen).toBe('09:05');
    expect(normalizarConfig({ horaResumen: '25:00' }).horaResumen).toBe('09:30');
    expect(normalizarConfig({ horaResumen: 'manana' }).horaResumen).toBe('09:30');
    expect(normalizarConfig({ resumenActivo: false }).resumenActivo).toBe(false);
  });

  it('token y endpoint recortados; la base sale del mismo host que Ventas en vivo', () => {
    const c = normalizarConfig({ token: '  x ', endpoint: ' https://otro/api/magento/stock/ ' });
    expect(c.token).toBe('x');
    expect(urlsDe(c.endpoint)).toEqual({
      stock: 'https://otro/api/magento/stock',
      alertas: 'https://otro/api/magento/stock/alertas',
      revisar: 'https://otro/api/magento/stock/revisar',
    });
    expect(BASE).toBe(`${new URL(VEV_API.BASE_URL).origin}/api/magento/stock`);
    expect(urlsDe('').stock).toBe(BASE);
    expect(TOKEN_DEFAULT).toBeTruthy();
  });
});

// -----------------------------------------------------------------------------
// Sondeo de alertas
// -----------------------------------------------------------------------------

describe('sondear', () => {
  it('la primera vez (sin ultimoIdVisto) guarda ultimo_id y no notifica', async () => {
    const { fetchImpl, llamadas } = crearFetch(() => ({
      body: { alertas: [alerta(118), alerta(119, 'poco_stock'), alerta(120, 'fuera_de_tienda')], ultimo_id: 120, revision: { id: 9 } },
    }));
    const r = await sondear({ ultimoIdVisto: null, config: CONFIG, token: TOKEN, fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.primeraVez).toBe(true);
    expect(r.aNotificar).toEqual([]);
    expect(r.aGuardar.map((a) => a.id)).toEqual([118, 119, 120]);
    expect(r.ultimoIdVisto).toBe(120);
    expect(r.revision).toEqual({ id: 9 });
    const url = new URL(llamadas[0].url);
    expect(url.searchParams.has('desde_id')).toBe(false);
    expect(url.searchParams.get('limite')).toBe('50');
    expect(llamadas[0].opciones.headers[API.TOKEN_HEADER]).toBe(TOKEN);
  });

  it('la primera vez sin alertas en el portal deja ultimoIdVisto en 0', async () => {
    const { fetchImpl } = crearFetch(() => ({ body: { alertas: [], ultimo_id: 0, revision: null } }));
    const r = await sondear({ ultimoIdVisto: null, config: CONFIG, token: TOKEN, fetchImpl });
    expect(r.ultimoIdVisto).toBe(0);
  });

  it('pide desde_id y notifica lo nuevo', async () => {
    const { fetchImpl, llamadas } = crearFetch(() => ({
      body: { alertas: [alerta(101), alerta(102)], ultimo_id: 102, revision: null },
    }));
    const r = await sondear({ ultimoIdVisto: 100, config: CONFIG, token: TOKEN, fetchImpl });
    expect(new URL(llamadas[0].url).searchParams.get('desde_id')).toBe('100');
    expect(r.primeraVez).toBe(false);
    expect(r.aNotificar.map((a) => a.id)).toEqual([101, 102]);
    expect(r.ultimoIdVisto).toBe(102);
  });

  it('sin nada nuevo conserva el ultimoIdVisto', async () => {
    const { fetchImpl } = crearFetch(() => ({ body: { alertas: [], ultimo_id: 100 } }));
    const r = await sondear({ ultimoIdVisto: 100, config: CONFIG, token: TOKEN, fetchImpl });
    expect(r.aNotificar).toEqual([]);
    expect(r.ultimoIdVisto).toBe(100);
  });

  it('pagina de a 500 hasta alcanzar ultimo_id', async () => {
    const { fetchImpl, llamadas } = crearFetch((url) => {
      const desde = Number(new URL(url).searchParams.get('desde_id'));
      if (desde === 100) return { body: { alertas: rango(101, 600), ultimo_id: 750 } };
      if (desde === 600) return { body: { alertas: rango(601, 750), ultimo_id: 750 } };
      return { status: 500, body: 'no deberia pedirse' };
    });
    const r = await sondear({ ultimoIdVisto: 100, config: CONFIG, token: TOKEN, fetchImpl });
    expect(llamadas).toHaveLength(2);
    expect(new URL(llamadas[0].url).searchParams.get('limite')).toBe('500');
    expect(r.alertas).toHaveLength(650);
    expect(r.paginas).toBe(2);
    expect(r.completo).toBe(true);
    expect(r.ultimoIdVisto).toBe(750);
  });

  it('con el tope de paginas se corta y el ultimo id es el de la ultima alerta leida', async () => {
    const { fetchImpl } = crearFetch((url) => {
      const desde = Number(new URL(url).searchParams.get('desde_id'));
      return { body: { alertas: rango(desde + 1, desde + 2), ultimo_id: 1000 } };
    });
    const r = await leerAlertasDesde({ fetchImpl, token: TOKEN, desdeId: 0, limite: 2, maxPaginas: 3 });
    expect(r.ok).toBe(true);
    expect(r.completo).toBe(false);
    expect(r.alertas.map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.ultimoId).toBe(6);
  });

  it('descarta repetidas y las que no superan desde_id', async () => {
    const { fetchImpl } = crearFetch(() => ({ body: { alertas: [alerta(99), alerta(101), alerta(101), alerta(102)], ultimo_id: 102 } }));
    const r = await sondear({ ultimoIdVisto: 100, config: CONFIG, token: TOKEN, fetchImpl });
    expect(r.alertas.map((a) => a.id)).toEqual([101, 102]);
  });

  it('filtra por tipo segun la config', async () => {
    const { fetchImpl } = crearFetch(() => ({
      body: { alertas: [alerta(101, 'sin_stock'), alerta(102, 'poco_stock'), alerta(103, 'fuera_de_tienda')], ultimo_id: 103 },
    }));
    const config = normalizarConfig({ notificar: { poco_stock: false } });
    const r = await sondear({ ultimoIdVisto: 100, config, token: TOKEN, fetchImpl });
    expect(r.aNotificar.map((a) => a.tipo)).toEqual(['sin_stock', 'fuera_de_tienda']);
    // El ultimo id avanza igual: lo filtrado no se vuelve a pedir.
    expect(r.ultimoIdVisto).toBe(103);
    expect(filtrarPorTipo([alerta(1, 'poco_stock')], { poco_stock: false })).toEqual([]);
  });

  it('no notifica lo que ya esta guardado', async () => {
    const { fetchImpl } = crearFetch(() => ({ body: { alertas: [alerta(101), alerta(102)], ultimo_id: 102 } }));
    const r = await sondear({ ultimoIdVisto: 100, config: CONFIG, token: TOKEN, fetchImpl, guardadas: [{ id: 101 }] });
    expect(r.aNotificar.map((a) => a.id)).toEqual([102]);
    expect(sinRepetir([{ id: 1 }, { id: 2 }], [{ id: 2 }])).toEqual([{ id: 1 }]);
  });

  it('si el portal numera desde mas abajo reinicia sin notificar', async () => {
    const { fetchImpl } = crearFetch(() => ({ body: { alertas: [], ultimo_id: 12 } }));
    const r = await sondear({ ultimoIdVisto: 500, config: CONFIG, token: TOKEN, fetchImpl });
    expect(r.reinicio).toBe(true);
    expect(r.aNotificar).toEqual([]);
    expect(r.ultimoIdVisto).toBe(12);
  });

  it('un error del portal vuelve como resultado, sin lanzar', async () => {
    const { fetchImpl } = crearFetch(() => ({ status: 401, body: { message: 'Unauthenticated.' } }));
    const r = await sondear({ ultimoIdVisto: 100, config: CONFIG, token: TOKEN, fetchImpl });
    expect(r).toMatchObject({ ok: false, code: 'MST_401', status: 401 });
  });
});

// -----------------------------------------------------------------------------
// Revisar ahora
// -----------------------------------------------------------------------------

describe('revisar', () => {
  const revision = { id: 33, origen: 'api', estado: 'ok', alertas: 2 };

  it('POST y despues sondeo: notifica la union sin repetir y avanza el ultimo id', async () => {
    const { fetchImpl, llamadas } = crearFetch((url, opciones) => {
      if (opciones.method === 'POST') return { status: 201, body: { revision, alertas: [alerta(105), alerta(106)] } };
      return { body: { alertas: [alerta(103), alerta(104), alerta(105), alerta(106)], ultimo_id: 106 } };
    });
    const r = await revisar({ ultimoIdVisto: 102, config: CONFIG, token: TOKEN, fetchImpl, guardadas: [{ id: 103 }] });
    expect(llamadas[0].url).toBe(`${BASE}/revisar`);
    expect(llamadas[0].opciones.method).toBe('POST');
    expect(r.ok).toBe(true);
    expect(r.revision).toEqual(revision);
    expect(r.alertasRevision.map((a) => a.id)).toEqual([105, 106]);
    expect(r.aNotificar.map((a) => a.id)).toEqual([104, 105, 106]);
    expect(r.ultimoIdVisto).toBe(106);
  });

  it('si el sondeo posterior falla notifica las de la revision y no avanza el ultimo id', async () => {
    const { fetchImpl } = crearFetch((url, opciones) => {
      if (opciones.method === 'POST') return { status: 201, body: { revision, alertas: [alerta(105, 'fuera_de_tienda')] } };
      return new TypeError('Failed to fetch');
    });
    const r = await revisar({ ultimoIdVisto: 102, config: CONFIG, token: TOKEN, fetchImpl });
    expect(r.aNotificar.map((a) => a.id)).toEqual([105]);
    expect(r.ultimoIdVisto).toBe(102);
    expect(r.sondeo.ok).toBe(false);
  });

  it('sin ultimoIdVisto notifica lo de la revision y toma su id mas alto', async () => {
    const { fetchImpl, llamadas } = crearFetch(() => ({ status: 201, body: { revision, alertas: [alerta(7), alerta(9)] } }));
    const r = await revisar({ ultimoIdVisto: null, config: CONFIG, token: TOKEN, fetchImpl });
    expect(llamadas).toHaveLength(1);
    expect(r.aNotificar.map((a) => a.id)).toEqual([7, 9]);
    expect(r.ultimoIdVisto).toBe(9);
  });

  it('409 / 502 vuelven como error (el 502 con su revision)', async () => {
    const r409 = await revisar({
      ultimoIdVisto: 1,
      config: CONFIG,
      token: TOKEN,
      fetchImpl: crearFetch(() => ({ status: 409, body: { error: 'revision_en_curso', message: 'Ya hay una revision en curso.' } })).fetchImpl,
    });
    expect(r409).toMatchObject({ ok: false, code: 'MST_409', status: 409 });
    expect(r409.error).toContain('Ya hay una revision en curso');

    const fallida = { id: 34, estado: 'error', mensaje: 'timeout del GraphQL' };
    const r502 = await revisar({
      ultimoIdVisto: 1,
      config: CONFIG,
      token: TOKEN,
      fetchImpl: crearFetch(() => ({ status: 502, body: { error: 'tienda_no_responde', message: 'lg.com no respondio', revision: fallida } })).fetchImpl,
    });
    expect(r502).toMatchObject({ ok: false, code: 'MST_502', status: 502, revision: fallida });
    expect(r502.error).toContain('lg.com no respondio');
  });
});

// -----------------------------------------------------------------------------
// Errores HTTP y de red
// -----------------------------------------------------------------------------

describe('errores', () => {
  const casos = [
    [401, 'MST_401', 'token'],
    [409, 'MST_409', 'revisando'],
    [429, 'MST_429', '6 por minuto'],
    [502, 'MST_502', 'no respondio'],
    [503, 'MST_503', 'MAGENTO_PA_TOKEN'],
    [500, 'MST_HTTP', '500'],
  ];
  for (const [status, code, texto] of casos) {
    it(`${status} -> ${code}`, async () => {
      const { fetchImpl } = crearFetch(() => ({ status, body: { error: 'x' } }));
      const r = await postRevisar({ fetchImpl, token: TOKEN });
      expect(r.ok).toBe(false);
      expect(r.code).toBe(code);
      expect(r.status).toBe(status);
      expect(r.error).toContain(texto);
    });
  }

  it('error de red -> MST_RED con la pista del certificado', async () => {
    const { fetchImpl } = crearFetch(() => new TypeError('Failed to fetch'));
    const r = await getStock({ fetchImpl, token: TOKEN });
    expect(r.code).toBe('MST_RED');
    expect(r.error).toContain('certificado');
    expect(r.error).toContain(BASE);
  });

  it('200 sin JSON -> MST_JSON', async () => {
    const { fetchImpl } = crearFetch(() => ({ status: 200, body: '<html>login</html>' }));
    const r = await getStock({ fetchImpl, token: TOKEN });
    expect(r.code).toBe('MST_JSON');
  });

  it('sin token no pide nada', async () => {
    const { fetchImpl } = crearFetch(() => ({ body: {} }));
    const r = await getAlertas({ fetchImpl, token: '' });
    expect(r.code).toBe('MST_SIN_TOKEN');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('timeout del GET a los 30 s -> MST_TIMEOUT', async () => {
    vi.useFakeTimers();
    const fetchImpl = (url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const p = getStock({ fetchImpl, token: TOKEN });
    await vi.advanceTimersByTimeAsync(30000);
    const r = await p;
    expect(r.code).toBe('MST_TIMEOUT');
  });

  it('GET /stock normaliza la foto', async () => {
    const { fetchImpl } = crearFetch(() => ({
      body: { revision: { id: 1 }, ultima_ok: null, umbral: 2, resumen: { total: 3, en_stock: 2 }, productos: [{ sku: 'A' }] },
    }));
    const r = await getStock({ fetchImpl, token: TOKEN });
    expect(r.ok).toBe(true);
    expect(r.foto.resumen).toEqual({ total: 3, en_stock: 2, preventa: 0, agotado: 0, fuera: 0, poco_stock: 0 });
    expect(r.foto.umbral).toBe(2);
    expect(r.foto.productos).toEqual([{ sku: 'A' }]);
  });
});

// -----------------------------------------------------------------------------
// Notificaciones
// -----------------------------------------------------------------------------

describe('notificaciones', () => {
  it('textos por tipo', () => {
    expect(tituloAlerta(alerta(1, 'sin_stock'))).toBe('Sin stock en lg.com/cl');
    expect(tituloAlerta(alerta(1, 'fuera_de_tienda'))).toBe('Fuera de la tienda');
    expect(tituloAlerta(alerta(1, 'poco_stock'))).toBe('Poco stock: quedan 2');
    expect(tituloAlerta(alerta(1, 'poco_stock', { quedan: 1 }))).toBe('Poco stock: quedan 1');
    expect(mensajeAlerta(alerta(5))).toBe('Producto 5\nSKU SKU5');
    expect(mensajeAlerta({ sku: 'X1', nombre: '' , modelo: 'OLED55' })).toBe('OLED55\nSKU X1');
  });

  it('hasta 3 alertas: una notificacion por alerta, con su ficha', () => {
    const plan = planNotificaciones([alerta(1), alerta(2, 'poco_stock'), alerta(3, 'fuera_de_tienda')]);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ id: `${NOTIF.ALERTA}1`, alertaId: 1, url: 'https://www.lg.com/cl/p/1' });
    expect(plan[0].opciones).toMatchObject({ type: 'basic', title: 'Sin stock en lg.com/cl', message: 'Producto 1\nSKU SKU1' });
    expect(plan[0].opciones.contextMessage).toContain('199.990');
    expect(plan[1].opciones.title).toBe('Poco stock: quedan 2');
  });

  it('mas de 3: una sola agrupada con el conteo por tipo y una lista corta', () => {
    const lista = [...rango(1, 4, 'sin_stock'), alerta(5, 'fuera_de_tienda'), alerta(6, 'poco_stock'), alerta(7, 'poco_stock')];
    const plan = planNotificaciones(lista, { ahora: 1000 });
    expect(plan).toHaveLength(1);
    expect(plan[0].id).toBe(`${NOTIF.GRUPO}1000`);
    expect(plan[0].url).toBeNull();
    expect(plan[0].opciones.type).toBe('list');
    expect(plan[0].opciones.title).toBe('7 alertas de stock en lg.com/cl');
    expect(plan[0].opciones.message).toBe('4 sin stock, 1 fuera de la tienda, 2 poco stock');
    expect(plan[0].opciones.items).toHaveLength(5);
    expect(plan[0].opciones.items[0]).toEqual({ title: 'Sin stock', message: 'Producto 1 (SKU1)' });
    expect(plan[0].opciones.contextMessage).toContain('y 2 mas');
    expect(planNotificaciones([])).toEqual([]);
  });

  it('textoConteo omite los tipos sin alertas', () => {
    expect(textoConteo(conteoPorTipo([alerta(1, 'poco_stock')]))).toBe('1 poco stock');
  });
});

// -----------------------------------------------------------------------------
// Resumen diario y hora de Chile
// -----------------------------------------------------------------------------

describe('proximoDisparo (hora de Chile)', () => {
  it('hoy si todavia no pasa, si no manana', () => {
    // 23-10-2026 09:00 en Chile (-03).
    expect(proximoDisparo('09:30', Date.parse('2026-10-23T12:00:00Z'))).toBe(Date.parse('2026-10-23T12:30:00Z'));
    // Justo a la hora: el siguiente es manana.
    expect(proximoDisparo('09:30', Date.parse('2026-10-23T12:30:00Z'))).toBe(Date.parse('2026-10-24T12:30:00Z'));
    // 21:30 de Chile ya es el dia siguiente en UTC; el proximo 09:30 es el del 24 en Chile.
    expect(proximoDisparo('09:30', Date.parse('2026-10-24T00:30:00Z'))).toBe(Date.parse('2026-10-24T12:30:00Z'));
  });

  it('inicio del horario de verano (6-9-2026): el 09:30 pasa de -04 a -03', () => {
    // Sabado 5-9 11:00 en Chile (-04): el proximo es el domingo 6-9 09:30 (-03).
    expect(proximoDisparo('09:30', Date.parse('2026-09-05T15:00:00Z'))).toBe(Date.parse('2026-09-06T12:30:00Z'));
    // Antes del cambio el mismo 09:30 era a las 13:30 UTC.
    expect(proximoDisparo('09:30', Date.parse('2026-09-05T12:00:00Z'))).toBe(Date.parse('2026-09-05T13:30:00Z'));
    // 00:30 no existe el 6-9 (de 00:00 se salta a 01:00): cae a la 01:30.
    expect(proximoDisparo('00:30', Date.parse('2026-09-05T15:00:00Z'))).toBe(Date.parse('2026-09-06T04:30:00Z'));
  });

  it('fin del horario de verano (5-4-2026): el 09:30 pasa de -03 a -04', () => {
    expect(proximoDisparo('09:30', Date.parse('2026-04-04T15:00:00Z'))).toBe(Date.parse('2026-04-05T13:30:00Z'));
  });

  it('hora invalida -> null', () => {
    expect(proximoDisparo('9h', Date.now())).toBeNull();
  });

  it('fechaHoraChile muestra la hora de Chile, no la UTC', () => {
    expect(fechaHoraChile('2026-10-23T02:15:00Z')).toBe('22-10 23:15');
    expect(fechaHoraChile(null)).toBe('—');
  });
});

describe('resumen diario', () => {
  const ahora = Date.parse('2026-10-23T12:30:00Z');
  const foto = (ultimaOkIso, revision = { id: 2, estado: 'ok' }) => ({
    revision,
    ultima_ok: ultimaOkIso ? { id: 1, estado: 'ok', terminada_en: ultimaOkIso } : null,
    umbral: 2,
    resumen: { total: 420, en_stock: 300, preventa: 0, agotado: 60, fuera: 40, poco_stock: 12 },
    productos: [],
  });

  it('portal al dia: contadores y alertas de 24 h', () => {
    const n = notificacionResumen({
      foto: foto('2026-10-23T12:05:00Z'),
      alertas24h: [alerta(1), alerta(2, 'poco_stock')],
      ahora,
    });
    expect(n.atrasado).toBe(false);
    expect(n.opciones.title).toBe('Revision diaria de stock lg.com/cl');
    expect(n.opciones.message).toContain('En stock 300 · Agotados 60 · Poco stock 12 · Fuera 40');
    expect(n.opciones.message).toContain('Alertas 24 h: 2 (1 sin stock, 1 poco stock)');
    expect(n.opciones.contextMessage).toBe('Ultima revision ok: 23-10 09:05');
  });

  it('ultima ok con mas de 3 h: lo dice', () => {
    const n = notificacionResumen({ foto: foto('2026-10-23T06:00:00Z'), ahora });
    expect(n.atrasado).toBe(true);
    expect(n.opciones.title).toContain('atrasado');
    expect(n.opciones.message).toContain('El portal no revisa la tienda desde 23-10 03:00.');
    expect(n.opciones.message).toContain('Alertas 24 h: 0');
  });

  it('ultima revision con error: lo dice', () => {
    const aviso = avisoPortal(foto('2026-10-23T12:00:00Z', { id: 3, estado: 'error', mensaje: 'tienda caida' }), ahora);
    expect(aviso).toBe('La ultima revision del portal fallo: tienda caida');
    expect(avisoPortal(foto(null), ahora)).toContain('todavia no tiene una revision ok');
  });

  it('sin foto (el portal no respondio)', () => {
    const n = notificacionResumen({ foto: null, error: 'Fallo de red', ahora });
    expect(n.opciones.title).toContain('sin datos');
    expect(n.opciones.message).toContain('Fallo de red');
  });
});

// -----------------------------------------------------------------------------
// Reducers
// -----------------------------------------------------------------------------

describe('estado y alertas guardadas', () => {
  it('agregarAlertas: la mas nueva primero, sin repetir, con tope y marca de visto', () => {
    let lista = agregarAlertas([], [alerta(1), alerta(2)], { vistas: true, ahora: 5 });
    expect(lista.map((a) => [a.id, a.visto])).toEqual([[2, true], [1, true]]);
    lista = agregarAlertas(lista, [alerta(2), alerta(3)]);
    expect(lista.map((a) => [a.id, a.visto])).toEqual([[3, false], [2, true], [1, true]]);
    expect(contarNoVistas(lista)).toBe(1);
    expect(agregarAlertas([], rango(1, 10), { max: 4 }).map((a) => a.id)).toEqual([10, 9, 8, 7]);
  });

  it('marcarVistas: todas o solo algunas', () => {
    const lista = agregarAlertas([], [alerta(1), alerta(2), alerta(3)]);
    expect(contarNoVistas(marcarVistas(lista, [2]))).toBe(2);
    expect(contarNoVistas(marcarVistas(lista))).toBe(0);
  });

  it('aplicarSondeo / aplicarError', () => {
    const conError = aplicarError(ESTADO_INICIAL, 'sondeo', { error: 'x', code: 'MST_RED' }, 10);
    expect(conError).toMatchObject({ error: 'x', code: 'MST_RED', fase: 'sondeo', fallosSeguidos: 1, ultimoSondeo: 10 });
    const ok = aplicarSondeo(conError, { ultimoIdVisto: 50, aNotificar: [1, 2] }, 20);
    expect(ok).toMatchObject({ error: null, fallosSeguidos: 0, ultimoIdVisto: 50, ultimoSondeoOk: 20, notificadas: 2 });
  });
});

// -----------------------------------------------------------------------------
// Productos
// -----------------------------------------------------------------------------

describe('productos', () => {
  const productos = [
    { sku: 'OLED55C4PSA.AWH', modelo: 'OLED55C4PSA', nombre: 'Televisor LG OLED evo 55"', estado: 'en_stock', poco_stock: false, quedan: null, precio_final: 1299990 },
    { sku: 'WM22VV2S6R.ASSECL', modelo: 'WM22VV2S6R', nombre: 'Lavadora Inverter 22 kg', estado: 'en_stock', poco_stock: true, quedan: 2, precio_final: 799990 },
    { sku: 'S90TY.DCHLLLK', modelo: 'S90TY', nombre: 'Barra de sonido', estado: 'agotado', poco_stock: false, quedan: 0, precio_final: 499990 },
    { sku: 'GM-B509PSAM', modelo: 'GM-B509PSAM', nombre: 'Refrigerador Side by Side Lumière', estado: 'fuera', poco_stock: false, quedan: null, precio_final: null },
    { sku: 'XBOOM.PRE', modelo: 'XBOOM', nombre: 'Parlante XBOOM', estado: 'preventa', poco_stock: false, quedan: null, precio_final: 99990 },
  ];

  it('filtros por estado y poco stock', () => {
    expect(filtrarProductos(productos, { filtro: 'agotado' }).map((p) => p.modelo)).toEqual(['S90TY']);
    expect(filtrarProductos(productos, { filtro: 'poco_stock' }).map((p) => p.modelo)).toEqual(['WM22VV2S6R']);
    expect(filtrarProductos(productos, { filtro: 'en_stock' })).toHaveLength(2);
    expect(filtrarProductos(productos, { filtro: 'todos' })).toHaveLength(5);
    expect(contarPorFiltro(productos)).toEqual({ todos: 5, en_stock: 2, preventa: 1, agotado: 1, fuera: 1, poco_stock: 1 });
  });

  it('busqueda por nombre (sin tildes ni mayusculas), SKU y modelo; varias palabras = todas', () => {
    expect(filtrarProductos(productos, { texto: 'lumiere' }).map((p) => p.modelo)).toEqual(['GM-B509PSAM']);
    expect(filtrarProductos(productos, { texto: 'oled55c4' }).map((p) => p.modelo)).toEqual(['OLED55C4PSA']);
    expect(filtrarProductos(productos, { texto: 'dchlllk' })).toHaveLength(1);
    expect(filtrarProductos(productos, { texto: 'lavadora 22' })).toHaveLength(1);
    expect(filtrarProductos(productos, { texto: 'lavadora oled' })).toHaveLength(0);
    expect(filtrarProductos(productos, { texto: 'barra', filtro: 'en_stock' })).toHaveLength(0);
  });

  it('CSV: BOM, cabecera, comillas dobladas, formulas protegidas y separador', () => {
    const csv = productosACsv([
      { sku: 'A1', modelo: 'M', nombre: 'TV 55" "Pro"', estado: 'agotado', comprable: false, quedan: 0, poco_stock: false, precio_final: 1000, visto_en: '2026-10-23T02:15:00Z' },
      { sku: '=CMD()', nombre: 'Con, coma', estado: 'en_stock', comprable: true, poco_stock: true, quedan: 1 },
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lineas = csv.slice(1).split('\r\n');
    expect(lineas).toHaveLength(3);
    expect(lineas[0]).toBe('"SKU","Modelo","Nombre","Estado","Comprable","Quedan","Poco stock","Precio lista","Precio final","Descuento %","URL","Visto (hora Chile)","Ultimo cambio (hora Chile)"');
    expect(lineas[1]).toBe('"A1","M","TV 55"" ""Pro""","Agotado","no","0","no","","1000","","","2026-10-22 23:15",""');
    expect(lineas[2]).toContain('"\'=CMD()"');
    expect(lineas[2]).toContain('"Con, coma"');
    const puntoYComa = productosACsv([{ sku: 'A', nombre: 'x;y' }], { separador: ';' }).slice(1).split('\r\n');
    expect(puntoYComa[1].startsWith('"A";"";"x;y";')).toBe(true);
    expect(nombreCsv(Date.parse('2026-10-23T02:15:00Z'), 'poco_stock')).toBe('stock-lgcom-poco-stock-20261022-2315.csv');
  });
});
