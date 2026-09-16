// @vitest-environment happy-dom
//
// La sonda y el armado de la configuracion de proxy.
//
// La sonda tiene un caso que costo encontrar y que no da ningun sintoma
// evidente: con la contrasena mal, el proxy responde 407 y Chrome entrega ese
// 407 como una RESPUESTA normal, no como un error de red. Una sonda que solo
// mire "¿resolvio el fetch?" lo da por bueno, deja el proxy puesto y el
// navegador se queda sin internet diciendo "Conectado". De ahi este archivo.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const SONDA = 'https://www.lg.com/favicon.ico';

/** chrome.storage.local en memoria, que es lo unico que toca este modulo. */
function fakeChrome() {
  const store = new Map();
  return {
    storage: {
      local: {
        get: async (keys) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (store.has(k)) out[k] = store.get(k);
          return out;
        },
        set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
        remove: async (k) => { store.delete(k); },
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
    runtime: { getManifest: () => ({ version: 'test' }) },
  };
}

/** Importa el modulo de cero, para que su estado interno no se herede. */
async function cargar() {
  vi.resetModules();
  globalThis.chrome = fakeChrome();
  return import('../../src/features/vpn/background/conexion.js');
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('sondear', () => {
  it('da por bueno que el destino conteste, sea cual sea el codigo', async () => {
    const { sondear } = await cargar();
    for (const status of [200, 204, 304, 404, 500]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
      expect(await sondear(), `status ${status}`).toBe(true);
    }
  });

  it('NO da por bueno un 407: lo manda el proxy, no el destino', async () => {
    const { sondear } = await cargar();
    // Response() no admite construir un 407 con body, asi que se simula.
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 407 })));
    expect(await sondear()).toBe(false);
  });

  it('una vez visto el 407, deja de dar por buenas las siguientes', async () => {
    const { sondear } = await cargar();

    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 407 })));
    expect(await sondear()).toBe(false);

    // El proxy podria contestar cualquier otra cosa despues; mientras la
    // credencial siga siendo la mala, esto no esta conectado.
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 })));
    expect(await sondear()).toBe(false);
  });

  it('falla si la peticion no llega', async () => {
    const { sondear } = await cargar();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch'); }));
    expect(await sondear()).toBe(false);
  });

  it('pide el favicon de un dominio de LG, que casa con el PAC de los dos modos', async () => {
    const { sondear } = await cargar();
    const espia = vi.fn(async () => ({ status: 200 }));
    vi.stubGlobal('fetch', espia);
    await sondear();
    expect(espia.mock.calls[0][0]).toBe(SONDA);
  });
});

describe('configDeProxy', () => {
  const listas = { dominios: ['lg.com'], redes: ['136.166.0.0/16'] };

  it('modo "todo" por el servidor: HTTPS al dominio, con el loopback exento', async () => {
    const { configDeProxy } = await cargar();
    const cfg = configDeProxy({
      origen: 'servidor', modo: 'todo', servidor: 'vpn.midominio.com:443', ...listas,
    });
    expect(cfg.mode).toBe('fixed_servers');
    expect(cfg.rules.singleProxy).toEqual({ scheme: 'https', host: 'vpn.midominio.com', port: 443 });
    expect(cfg.rules.bypassList).toContain('127.0.0.1');
    expect(cfg.rules.bypassList).toContain('<local>');
  });

  it('el puerto del servidor es opcional y cae en el 443', async () => {
    const { configDeProxy } = await cargar();
    const cfg = configDeProxy({
      origen: 'servidor', modo: 'todo', servidor: 'vpn.midominio.com', ...listas,
    });
    expect(cfg.rules.singleProxy.port).toBe(443);
  });

  it('modo "todo" en local: SOCKS5 al loopback', async () => {
    const { configDeProxy } = await cargar();
    const cfg = configDeProxy({
      origen: 'local', modo: 'todo', socks: '127.0.0.1:1080', ...listas,
    });
    expect(cfg.rules.singleProxy).toEqual({ scheme: 'socks5', host: '127.0.0.1', port: 1080 });
  });

  it('modo "solo LG": PAC obligatorio con la directiva del origen', async () => {
    const { configDeProxy } = await cargar();

    const remoto = configDeProxy({
      origen: 'servidor', modo: 'lg', servidor: 'vpn.midominio.com:8443', ...listas,
    });
    expect(remoto.mode).toBe('pac_script');
    // mandatory: si el PAC no se puede evaluar hay que fallar, no salir
    // directo creyendo que se va por el tunel.
    expect(remoto.pacScript.mandatory).toBe(true);
    expect(remoto.pacScript.data).toContain('HTTPS vpn.midominio.com:8443');

    const local = configDeProxy({
      origen: 'local', modo: 'lg', socks: '127.0.0.1:1080', ...listas,
    });
    expect(local.pacScript.data).toContain('SOCKS5 127.0.0.1:1080');
  });
});
