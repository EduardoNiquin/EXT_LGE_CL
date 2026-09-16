// @vitest-environment happy-dom
//
// El motor de la captura, de punta a punta: el grid dice que ordenes hay y cual
// es el enlace de cada una, y despues se entra a la ficha de todas con un pool
// en paralelo.
//
// Es la parte con mas riesgo del modulo (varios workers escribiendo el mismo
// resultado), asi que se ejercita con `chrome` y `fetch` de mentira: que el
// orden de las ordenes NO dependa de cual ficha conteste antes, que una ficha
// caida no tire el recorrido, y que una orden que el grid no devuelve salga
// marcada en vez de desaparecer.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const RUN_KEY = 'magento:informacion-de-orden:run';
const RESULT_KEY = 'magento:informacion-de-orden:result';
const GRID_URL = 'https://shop.lg.com/obsadm/mui/index/render/key/abc123/';

let store;

/** chrome.storage.local en memoria, con el onChanged que usa el run store. */
function fakeChrome() {
  store = new Map();
  const listeners = [];
  return {
    storage: {
      local: {
        get: async (keys) => {
          const list = keys === null || keys === undefined
            ? [...store.keys()]
            : (Array.isArray(keys) ? keys : [keys]);
          const out = {};
          for (const key of list) if (store.has(key)) out[key] = store.get(key);
          return out;
        },
        set: async (obj) => {
          const changes = {};
          for (const [key, value] of Object.entries(obj)) {
            changes[key] = { oldValue: store.get(key), newValue: value };
            store.set(key, value);
          }
          listeners.forEach((fn) => fn(changes, 'local'));
        },
        remove: async (key) => { store.delete(key); },
      },
      onChanged: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => {
          const index = listeners.indexOf(fn);
          if (index >= 0) listeners.splice(index, 1);
        },
      },
    },
  };
}

/** Respuesta del grid: HTML con el JSON embebido, como la de verdad. */
function gridResponse(items, totalRecords) {
  const payload = { '*': { Magento_Ui: { ds: { update_url: GRID_URL, data: { items, totalRecords } } } } };
  return {
    ok: true,
    status: 200,
    text: async () => `<script type="text/x-magento-init">${JSON.stringify(payload)}</script>`,
  };
}

const order = (n) => ({
  increment_id: String(n),
  entity_id: `e${n}`,
  payment_method: 'transbank_webpay',
  actions: { view: { href: `https://shop.lg.com/obsadm/sales/order/view/order_id/e${n}/key/k/` } },
});

/** La ficha de una orden, con el log del ERP en su pestana AJAX. */
function detailResponse(n) {
  return {
    ok: true,
    status: 200,
    text: async () => `
      <div class="order-information">
        <div class="admin__page-section-item-title"><span class="title">Order # ${n}</span></div>
        <table class="order-information-table">
          <tr><th>Order Status</th><td>Processing</td></tr>
          <tr><th>Placed from IP</th><td>200.0.0.${n}</td></tr>
        </table>
      </div>
      <div class="order-addresses"><div class="admin__page-section-item">
        <div class="admin__page-section-item-title"><span class="title">Billing Address</span></div>
        <address>Cliente ${n}<br>Calle ${n}</address>
      </div></div>
      <a href="/obsadm/sales/order/gerpExportLog/key/kk/order_id/e${n}/form_key/ff/">ERP log</a>`,
  };
}

const logResponse = () => ({
  ok: true,
  status: 200,
  text: async () => '<table><thead><tr><th>Status</th></tr></thead><tbody><tr><td>success</td></tr></tbody></table>',
});

const isDetail = (url) => String(url).includes('/sales/order/view/');
const isLog = (url) => String(url).includes('ExportLog');
const orderOf = (url) => String(url).match(/order_id\/e(\d+)/)?.[1] || '';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function loadRun() {
  vi.resetModules();
  return import('../../src/features/magento/informacion_de_orden/content/flows/run.js');
}

function seedRun(config) {
  store.set(RUN_KEY, {
    active: true,
    claimed: false,
    phase: 'starting',
    startedAt: Date.now(),
    config,
    total: 0,
    doneCount: 0,
    okCount: 0,
    notFoundCount: 0,
    errorCount: 0,
    log: [],
  });
}

const records = () => store.get(RESULT_KEY)?.records || [];
const currentRun = () => store.get(RUN_KEY);

/** Config con todas las secciones salvo las que se pisen. */
const rangeConfig = (extra = {}) => ({
  from: '2026-09-01',
  to: '2026-09-15',
  mode: 'range',
  concurrency: 4,
  sections: { info: true, payment: true, history: true, logs: false },
  ...extra,
});

beforeEach(() => {
  globalThis.chrome = fakeChrome();
  globalThis.location = { href: 'https://shop.lg.com/obsadm/sales/order/index/' };
  globalThis.window = globalThis;
  // La key del grid se resuelve del documento actual: sin esto iria a la red.
  document.documentElement.innerHTML = `<head></head><body><script type="text/x-magento-init">${
    JSON.stringify({ a: { update_url: GRID_URL } })
  }</script></body>`;
});

describe('captura por rango', () => {
  it('entra a la ficha de cada orden y conserva el orden aunque contesten desordenadas', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (!isDetail(url)) return gridResponse([1, 2, 3, 4, 5].map(order), 5);
      const n = orderOf(url);
      // La ficha de la 2 tarda mas que las demas: si el orden dependiera de la
      // llegada, las ordenes saldrian mezcladas en el CSV.
      if (n === '2') await sleep(30);
      return detailResponse(n);
    });

    seedRun(rangeConfig());
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    const run = currentRun();
    expect(run.active).toBe(false);
    expect(run.finishReason).toBe('done');
    expect(run.totalRecords).toBe(5);
    expect(run.total).toBe(5);
    expect(run.okCount).toBe(5);

    const captured = records();
    expect(captured.map((record) => record.incrementId)).toEqual(['1', '2', '3', '4', '5']);
    // Y lo capturado es lo de la FICHA, no lo del listado.
    expect(captured[0].detail['Orden - Placed from IP']).toBe('200.0.0.1');
    expect(captured[0].detail['Direccion - Billing Address']).toBe('Cliente 1 / Calle 1');
    expect(captured[0].extra[0]).toContain('/sales/order/view/order_id/e1/');
  });

  it('divide un rango largo y junta las ordenes de todos los bloques', async () => {
    const windows = [];
    globalThis.fetch = vi.fn(async (url) => {
      if (isDetail(url)) return detailResponse(orderOf(url));
      const params = new URL(url).searchParams;
      windows.push({
        from: params.get('filters[created_at][from]'),
        to: params.get('filters[created_at][to]'),
      });
      return gridResponse([order(windows.length)], 1);
    });

    seedRun(rangeConfig({ from: '2026-06-01', to: '2026-09-09' }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(windows).toEqual([
      { from: '8/12/2026', to: '9/09/2026' },
      { from: '7/14/2026', to: '8/11/2026' },
      { from: '6/15/2026', to: '7/13/2026' },
      { from: '6/01/2026', to: '6/14/2026' },
    ]);
    expect(currentRun().totalRecords).toBe(4);
    expect(records().map((record) => record.incrementId)).toEqual(['1', '2', '3', '4']);
  });

  it('los bloques se consultan en paralelo, no en fila india', async () => {
    let live = 0;
    let peak = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (isDetail(url)) return detailResponse(orderOf(url));
      live += 1;
      peak = Math.max(peak, live);
      await sleep(8);
      live -= 1;
      return gridResponse([], 0);
    });

    // 100 dias = 4 bloques: con el pool de 4 salen las cuatro consultas juntas.
    seedRun(rangeConfig({ from: '2026-06-01', to: '2026-09-09', concurrency: 4 }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(peak).toBe(4);
    expect(currentRun().finishReason).toBe('done');
  });

  it('no repite una orden que aparece en dos bloques o paginas', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (isDetail(url)) return detailResponse(orderOf(url));
      // El listado se reordena mientras se pagina: la 1 vuelve a salir.
      const page = Number(new URL(url).searchParams.get('paging[current]'));
      return gridResponse(page === 1 ? [order(1), order(2)] : [order(1), order(3)], 400);
    });

    seedRun(rangeConfig({ concurrency: 2 }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(records().map((record) => record.incrementId)).toEqual(['1', '2', '3']);
    expect(currentRun().okCount).toBe(3);
  });

  it('no pide paginas cuyas ordenes pasarian del tope de la corrida', async () => {
    let gridCalls = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (isDetail(url)) return detailResponse(orderOf(url));
      gridCalls += 1;
      return gridResponse([], 6000);
    });

    seedRun(rangeConfig({ concurrency: 8 }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    // 5000 ordenes / 200 por pagina = 25 paginas, no las 30 del total.
    expect(gridCalls).toBe(25);
    expect(currentRun().log.some((entry) => entry.message.includes('primeras 5000'))).toBe(true);
  });

  it('pagina el listado antes de entrar a las fichas', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (isDetail(url)) return detailResponse(orderOf(url));
      const page = Number(new URL(url).searchParams.get('paging[current]'));
      const from = (page - 1) * 200;
      return gridResponse(
        Array.from({ length: page === 2 ? 2 : 200 }, (_, i) => order(from + i + 1)),
        202,
      );
    });

    seedRun(rangeConfig({ concurrency: 8 }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(currentRun().total).toBe(202);
    expect(records()).toHaveLength(202);
    expect(records().at(-1).incrementId).toBe('202');
  });

  it('respeta el tope de consultas simultaneas', async () => {
    let live = 0;
    let peak = 0;
    globalThis.fetch = vi.fn(async (url) => {
      live += 1;
      peak = Math.max(peak, live);
      await sleep(8);
      live -= 1;
      if (!isDetail(url)) return gridResponse([1, 2, 3, 4, 5, 6].map(order), 6);
      return detailResponse(orderOf(url));
    });

    seedRun(rangeConfig({ concurrency: 2 }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(peak).toBeLessThanOrEqual(2);
    expect(currentRun().okCount).toBe(6);
  });

  it('permite mas de 8 consultas simultaneas', async () => {
    let live = 0;
    let peak = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (!isDetail(url)) return gridResponse(Array.from({ length: 12 }, (_, i) => order(i + 1)), 12);
      live += 1;
      peak = Math.max(peak, live);
      await sleep(8);
      live -= 1;
      return detailResponse(orderOf(url));
    });

    seedRun(rangeConfig({ concurrency: 12 }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(peak).toBe(12);
    expect(currentRun().okCount).toBe(12);
  });

  it('una ficha caida no tira el recorrido: esa orden sale marcada', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (!isDetail(url)) return gridResponse([1, 2, 3].map(order), 3);
      if (orderOf(url) === '2') return { ok: false, status: 500, text: async () => '' };
      return detailResponse(orderOf(url));
    });

    seedRun(rangeConfig({ concurrency: 1 }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    const run = currentRun();
    expect(run.finishReason).toBe('done');
    expect(run.okCount).toBe(2);
    expect(run.errorCount).toBe(1);
    const captured = records();
    expect(captured).toHaveLength(3);
    expect(captured[1].status).toBe('error');
    expect(captured[1].error).toContain('500');
    // Aunque la ficha fallara, la orden conserva lo que el grid sabia de ella.
    expect(captured[1].incrementId).toBe('2');
    expect(run.log.some((entry) => entry.message.includes('Orden 2'))).toBe(true);
  });

  it('una ficha vacia (sesion caida) se reporta, no se emite en blanco', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (!isDetail(url)) return gridResponse([order(1)], 1);
      return { ok: true, status: 200, text: async () => '<html><body><h1>Access Denied</h1></body></html>' };
    });

    seedRun(rangeConfig());
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(currentRun().errorCount).toBe(1);
    expect(records()[0].error).toContain('sesion');
  });

  it('una pagina del listado caida no tira la corrida', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (isDetail(url)) return detailResponse(orderOf(url));
      const page = Number(new URL(url).searchParams.get('paging[current]'));
      if (page === 2) return { ok: false, status: 500, text: async () => '' };
      return gridResponse([order(page)], 600);
    });

    seedRun(rangeConfig({ concurrency: 1 }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    const run = currentRun();
    expect(run.finishReason).toBe('done');
    expect(records()).toHaveLength(2);
    expect(run.log.some((entry) => entry.message.includes('Pagina 2 del listado'))).toBe(true);
  });

  it('un rango vacio termina sin error', async () => {
    globalThis.fetch = vi.fn(async () => gridResponse([], 0));
    seedRun(rangeConfig());
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    const run = currentRun();
    expect(run.finishReason).toBe('done');
    expect(run.totalRecords).toBe(0);
    expect(run.log.some((entry) => entry.message.includes('No hay ordenes'))).toBe(true);
  });

  it('el ORDER_FILTER_ERROR (HTTP 200) se reporta como lo que es', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'ORDER_FILTER_ERROR Date range cannot exceed 1 month. Please adjust your filters.',
    }));

    seedRun(rangeConfig({ from: '2026-06-01' }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    const run = currentRun();
    expect(run.finishReason).toBe('error');
    expect(run.error).toContain('28 dias');
  });
});

describe('las pestanas que Magento carga aparte', () => {
  it('el log del ERP solo se pide si la seccion esta activa', async () => {
    const pedidas = [];
    globalThis.fetch = vi.fn(async (url) => {
      pedidas.push(String(url));
      if (isLog(url)) return logResponse();
      if (isDetail(url)) return detailResponse(orderOf(url));
      return gridResponse([order(1)], 1);
    });

    seedRun(rangeConfig({ sections: { info: true, payment: true, history: true, logs: false } }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();
    expect(pedidas.some(isLog)).toBe(false);

    // Y con la seccion activa, se pide y sus campos entran en el registro.
    pedidas.length = 0;
    store.delete(RESULT_KEY);
    seedRun(rangeConfig({ sections: { info: true, payment: true, history: true, logs: true } }));
    const again = await loadRun();
    await again.tickIfActive();

    expect(pedidas.some(isLog)).toBe(true);
    expect(records()[0].detail['ERP - Status']).toBe('success');
  });

  it('si el log no se puede traer, la orden igual se captura', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (isLog(url)) return { ok: false, status: 403, text: async () => '' };
      if (isDetail(url)) return detailResponse(orderOf(url));
      return gridResponse([order(1)], 1);
    });

    seedRun(rangeConfig({ sections: { info: true, payment: true, history: true, logs: true } }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(currentRun().okCount).toBe(1);
    expect(records()[0].detail['ERP - Error']).toContain('403');
  });
});

describe('captura por lista', () => {
  it('casa exacto, entra a la ficha y marca la que el grid no devuelve', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (isDetail(url)) return detailResponse(orderOf(url));
      const wanted = new URL(url).searchParams.get('filters[increment_id]');
      // El filtro de Magento es "contiene": devuelve tambien una parecida.
      if (wanted === '999') return gridResponse([order('9990')], 1);
      return gridResponse([order(wanted), order(`${wanted}0`)], 2);
    });

    seedRun(rangeConfig({ mode: 'list', concurrency: 3, orderNumbers: ['111', '999', '222'] }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    const run = currentRun();
    expect(run.finishReason).toBe('done');
    expect(run.okCount).toBe(2);
    expect(run.notFoundCount).toBe(1);

    const captured = records();
    expect(captured.map((record) => record.incrementId)).toEqual(['111', '999', '222']);
    expect(captured[1].status).toBe('not-found');
    expect(captured[0].detail['Orden - Placed from IP']).toBe('200.0.0.111');
  });

  it('busca cada orden por bloques cuando el rango es largo', async () => {
    const windows = [];
    globalThis.fetch = vi.fn(async (url) => {
      if (isDetail(url)) return detailResponse(orderOf(url));
      const params = new URL(url).searchParams;
      windows.push(params.get('filters[created_at][from]'));
      return windows.length === 4 ? gridResponse([order('111')], 1) : gridResponse([], 0);
    });

    seedRun(rangeConfig({
      from: '2026-06-01',
      to: '2026-09-09',
      mode: 'list',
      orderNumbers: ['111'],
    }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(windows).toEqual(['8/12/2026', '7/14/2026', '6/15/2026', '6/01/2026']);
    expect(currentRun().okCount).toBe(1);
    expect(records()[0].incrementId).toBe('111');
  });
});

describe('ciclo de vida', () => {
  it('no trabaja si la pestana no es el admin', async () => {
    globalThis.location = { href: 'https://www.google.com/' };
    globalThis.fetch = vi.fn();
    seedRun(rangeConfig());
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(currentRun().claimed).toBe(false);
  });

  it('un run ya reclamado no se ejecuta dos veces', async () => {
    globalThis.fetch = vi.fn(async () => gridResponse([order(1)], 1));
    seedRun(rangeConfig());
    currentRun().claimed = true;
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('cancelar deja la corrida como detenida, no como terminada', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      await sleep(20);
      if (!isDetail(url)) return gridResponse(Array.from({ length: 20 }, (_, i) => order(i + 1)), 20);
      return detailResponse(orderOf(url));
    });

    seedRun(rangeConfig({ concurrency: 2 }));
    const { abortActiveRun, tickIfActive } = await loadRun();
    const pending = tickIfActive();
    await sleep(450); // el reclamo tarda CLAIM_SETTLE_MS en confirmarse; despues ya capturo algo
    abortActiveRun();
    await pending;

    const run = currentRun();
    expect(run.active).toBe(false);
    expect(run.finishReason).toBe('cancelled');
    // Lo capturado hasta el corte se conserva.
    expect(records().length).toBeGreaterThan(0);
  });

  it('un reload a media captura se reporta y conserva lo guardado', async () => {
    seedRun(rangeConfig());
    currentRun().claimed = true;
    const { reconcileOnInit } = await loadRun();
    await reconcileOnInit();

    const run = currentRun();
    expect(run.active).toBe(false);
    expect(run.finishReason).toBe('error');
    expect(run.error).toContain('recargo');
  });

  it('otra pestana que arranca NO mata una corrida con latido fresco; si el latido se apaga, si', async () => {
    vi.useFakeTimers();
    try {
      seedRun(rangeConfig());
      currentRun().claimed = 'pestana-viva';
      currentRun().heartbeatAt = Date.now();
      const { reconcileOnInit } = await loadRun();
      await reconcileOnInit();
      expect(currentRun().active).toBe(true);

      // La otra pestana sigue latiendo: al volver a mirar, tampoco se toca.
      await vi.advanceTimersByTimeAsync(15000);
      currentRun().heartbeatAt = Date.now();
      await vi.advanceTimersByTimeAsync(6000);
      expect(currentRun().active).toBe(true);

      // Ahora era ESTA pestana la que se recargo: el latido no se renueva mas.
      const again = await loadRun();
      await again.reconcileOnInit();
      expect(currentRun().active).toBe(true);
      await vi.advanceTimersByTimeAsync(21000);
      expect(currentRun().active).toBe(false);
      expect(currentRun().error).toContain('recargo');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('donde se va el tiempo', () => {
  /** Ficha con las DOS pestanas AJAX. */
  const detailWithBothLogs = (n) => ({
    ok: true,
    status: 200,
    text: async () => `${await detailResponse(n).text()}
      <a href="/obsadm/sales/order/osmsExportLog/key/kk/order_id/e${n}/form_key/ff/">OSMS log</a>`,
  });

  it('pide los logs ERP y OSMS a la vez, no uno despues del otro', async () => {
    let liveLogs = 0;
    let peakLogs = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (isLog(url)) {
        liveLogs += 1;
        peakLogs = Math.max(peakLogs, liveLogs);
        await sleep(15);
        liveLogs -= 1;
        return logResponse();
      }
      if (isDetail(url)) return detailWithBothLogs(orderOf(url));
      return gridResponse([order(1)], 1);
    });

    seedRun(rangeConfig({ concurrency: 1, sections: { info: true, payment: true, history: true, logs: true } }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(peakLogs).toBe(2);
    const record = records()[0];
    expect(record.detail['ERP - Status']).toBe('success');
    expect(record.detail['OSMS - Status']).toBe('success');
    expect(currentRun().stats.requests).toBe(3);
  });

  it('reintenta una vez ante un fallo transitorio y no ante uno definitivo', async () => {
    const attempts = {};
    globalThis.fetch = vi.fn(async (url) => {
      if (!isDetail(url)) return gridResponse([order(1), order(2), order(3)], 3);
      const n = orderOf(url);
      attempts[n] = (attempts[n] || 0) + 1;
      if (n === '1' && attempts[n] === 1) return { ok: false, status: 503, text: async () => '' };
      if (n === '2' && attempts[n] === 1) throw new TypeError('Failed to fetch');
      if (n === '3') return { ok: false, status: 403, text: async () => '' };
      return detailResponse(n);
    });

    seedRun(rangeConfig({ concurrency: 3 }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(attempts).toEqual({ 1: 2, 2: 2, 3: 1 });
    const run = currentRun();
    expect(run.okCount).toBe(2);
    expect(run.errorCount).toBe(1);
    expect(run.stats.retries).toBe(2);
    expect(records()[2].error).toContain('403');
  }, 15000);

  it('mide cada ficha y deja el resumen en el registro', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (!isDetail(url)) return gridResponse([order(1), order(2)], 2);
      return detailResponse(orderOf(url));
    });

    seedRun(rangeConfig({ concurrency: 2 }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    const run = currentRun();
    expect(run.fetchStartedAt).toBeGreaterThan(0);
    expect(run.stats.count).toBe(2);
    expect(run.stats.requests).toBe(2);
    expect(run.stats.bytes).toBeGreaterThan(0);
    // Los tiempos no se cuelan en el registro de la orden.
    expect(records()[0].timing).toBeUndefined();
    const summary = run.log.find((entry) => entry.message.includes('fichas/min'));
    expect(summary).toBeTruthy();
    expect(summary.message.startsWith('2 ficha(s) en ')).toBe(true);
  });

  it('el volcado del resultado se espacia a medida que crece', async () => {
    const { flushIntervalFor } = await loadRun();
    expect(flushIntervalFor(0)).toBe(1500);
    expect(flushIntervalFor(500)).toBe(3000);
    expect(flushIntervalFor(100000)).toBe(15000);
  });
});

describe('los logs que ya vienen en la ficha', () => {
  /** Ficha real: los dos bloques embebidos y los enlaces ABSOLUTOS a las pestanas. */
  const detailWithEmbeddedLogs = (n) => ({
    ok: true,
    status: 200,
    text: async () => `${await detailResponse(n).text()}
      <a href="https://shop.lg.com/obsadm/sales/order/gerpExportLog/key/kk/order_id/e${n}/form_key/ff/">ERP</a>
      <a href="https://shop.lg.com/obsadm/sales/order/osmsExportLog/key/kk/order_id/e${n}/form_key/ff/">OSMS</a>
      <section class="gerp-export-log"><table><thead><tr><th>Status</th></tr></thead><tbody><tr><td>embebido</td></tr></tbody></table></section>
      <section class="osms-export-log">No Data Found</section>`,
  });

  it('no pide las pestanas si sus bloques ya estan en la ficha', async () => {
    const pedidas = [];
    globalThis.fetch = vi.fn(async (url) => {
      pedidas.push(String(url));
      if (isLog(url)) return logResponse();
      if (isDetail(url)) return detailWithEmbeddedLogs(orderOf(url));
      return gridResponse([order(1)], 1);
    });

    seedRun(rangeConfig({ concurrency: 1, sections: { info: true, payment: true, history: true, logs: true } }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    expect(pedidas.some(isLog)).toBe(false);
    expect(records()[0].detail['ERP - Status']).toBe('embebido');
    expect(currentRun().stats.requests).toBe(1);
  });

  it('si falta un bloque pide SOLO ese, con la URL absoluta tal cual (conserva /obsadm)', async () => {
    const pedidas = [];
    globalThis.fetch = vi.fn(async (url) => {
      pedidas.push(String(url));
      if (isLog(url)) return logResponse();
      if (isDetail(url)) {
        return {
          ok: true,
          status: 200,
          text: async () => `${await detailResponse(orderOf(url)).text()}
            <a href="https://shop.lg.com/obsadm/sales/order/osmsExportLog/key/kk/order_id/e1/form_key/ff/">OSMS</a>
            <section class="gerp-export-log"><table><tr><th>Status</th><td>embebido</td></tr></table></section>`,
        };
      }
      return gridResponse([order(1)], 1);
    });

    seedRun(rangeConfig({ concurrency: 1, sections: { info: true, payment: true, history: true, logs: true } }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    const logs = pedidas.filter(isLog);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toBe('https://shop.lg.com/obsadm/sales/order/osmsExportLog/key/kk/order_id/e1/form_key/ff/');
    expect(records()[0].detail['OSMS - Status']).toBe('success');
  });

  it('una ruta relativa sin /obsadm se cuelga de la base del admin, no del origen', async () => {
    const pedidas = [];
    globalThis.fetch = vi.fn(async (url) => {
      pedidas.push(String(url));
      if (isLog(url)) return logResponse();
      if (isDetail(url)) {
        return {
          ok: true,
          status: 200,
          text: async () => `${await detailResponse(orderOf(url)).text()}
            <a href="/sales/order/osmsExportLog/key/kk/order_id/e1/form_key/ff/">OSMS</a>`,
        };
      }
      return gridResponse([order(1)], 1);
    });

    seedRun(rangeConfig({ concurrency: 1, sections: { info: true, payment: true, history: true, logs: true } }));
    const { tickIfActive } = await loadRun();
    await tickIfActive();

    const logs = pedidas.filter(isLog);
    expect(logs.some((u) => u.includes('/obsadm/sales/order/osmsExportLog/'))).toBe(true);
    expect(logs.some((u) => u.startsWith('https://shop.lg.com/sales/'))).toBe(false);
  });
});

describe('dos pestanas del admin a la vez', () => {
  /** Dos instancias del modulo = dos content scripts con el mismo storage. */
  async function loadTwo() {
    vi.resetModules();
    const a = await import('../../src/features/magento/informacion_de_orden/content/flows/run.js');
    vi.resetModules();
    const b = await import('../../src/features/magento/informacion_de_orden/content/flows/run.js');
    return [a, b];
  }

  it('solo una captura: la otra ve el token ajeno y se retira', async () => {
    const detalles = [];
    globalThis.fetch = vi.fn(async (url) => {
      if (!isDetail(url)) return gridResponse([1, 2, 3].map(order), 3);
      detalles.push(orderOf(url));
      await sleep(5);
      return detailResponse(orderOf(url));
    });

    seedRun(rangeConfig({ concurrency: 2 }));
    const [a, b] = await loadTwo();
    // Como el ciclo de vida real: cada cambio del run le llega a los dos frames.
    // Sin esto no se reproduce el fallo medido (el token del otro llegaba antes
    // de confirmar el propio y los DOS soltaban).
    const wire = (mod) => chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[RUN_KEY]?.newValue?.active) mod.tickIfActive(changes[RUN_KEY].newValue);
    });
    wire(a);
    wire(b);
    await Promise.all([a.tickIfActive(), b.tickIfActive()]);

    const run = currentRun();
    expect(run.finishReason).toBe('done');
    expect(run.okCount).toBe(3);
    expect(detalles).toHaveLength(3);
    expect(records()).toHaveLength(3);
    expect(run.heartbeatAt).toBeGreaterThan(0);
    expect(run.claimedFrom).toContain('shop.lg.com/obsadm');
    expect(run.log.some((entry) => entry.message.startsWith('Corriendo desde '))).toBe(true);
  });

  it('si el otro frame reclama a mitad de camino, este cede sin marcar cancelado', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (!isDetail(url)) return gridResponse(Array.from({ length: 12 }, (_, i) => order(i + 1)), 12);
      await sleep(15);
      return detailResponse(orderOf(url));
    });

    seedRun(rangeConfig({ concurrency: 1 }));
    const [a, b] = await loadTwo();
    const running = a.tickIfActive();
    await sleep(400); // ya reclamo y esta capturando
    expect(currentRun().claimed).toBeTruthy();

    // Otro frame pisa el reclamo (llega por storage.onChanged con el run nuevo).
    const ajeno = { ...currentRun(), claimed: 'otro-frame' };
    store.set(RUN_KEY, ajeno);
    await a.tickIfActive(ajeno);
    await running;

    // El run sigue activo y con el token ajeno: a no lo finalizo ni lo cancelo.
    expect(currentRun().active).toBe(true);
    expect(currentRun().claimed).toBe('otro-frame');
    expect(currentRun().finishReason).toBeFalsy();
    // Y b no arranca sobre un run ya reclamado.
    await b.tickIfActive();
    expect(currentRun().claimed).toBe('otro-frame');
  });
});
