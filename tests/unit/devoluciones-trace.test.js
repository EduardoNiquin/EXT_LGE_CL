// Traza de diagnostico del apartado Devoluciones.
//
// Lo que importa fijar: que NO grabe nada sin Modo Dev (si no, cada gestion
// escribiria cientos de entradas en storage a espaldas del usuario) y que lo
// que grabe lleve el contexto suficiente para localizar el problema — de que
// parte del flujo viene y en que frame.

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** chrome.storage.local minimo, suficiente para los stores de la extension. */
function instalarChromeFalso() {
  const guardado = {};
  const oyentes = [];

  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({ ...guardado })),
        set: vi.fn(async (obj) => {
          Object.assign(guardado, obj);
          const cambios = Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [k, { newValue: v }]),
          );
          oyentes.forEach((l) => l(cambios, 'local'));
        }),
      },
      onChanged: { addListener: (l) => oyentes.push(l) },
    },
  };
}

/** Deja que resuelvan las promesas de carga de los stores. */
const asentar = () => new Promise((r) => setTimeout(r, 5));

let dev;
let trace;

beforeEach(async () => {
  vi.resetModules();
  instalarChromeFalso();

  // Sin `window`: el store deduce que corre en el service worker.
  globalThis.window = undefined;

  dev = await import('../../src/shared/dev-mode/index.js');
  trace = await import('../../src/features/devoluciones/trace.js');

  await asentar();
});

describe('traza', () => {
  it('no graba nada con el Modo Dev apagado', async () => {
    trace.traza('buscar', 'algo paso', { orden: '123' });
    await asentar();

    expect(trace.getTrazas()).toHaveLength(0);
  });

  it('graba con el Modo Dev encendido, con contexto y ambito', async () => {
    await dev.setDevMode(true);
    trace.fijarContextoDeTraza(trace.CONTEXTOS.CONTENT);

    trace.trazaInfo('buscar', 'Empieza la busqueda de la orden', { orden: '3243349573' });
    await asentar();

    const [entrada] = trace.getTrazas();

    expect(entrada).toMatchObject({
      nivel: 'info',
      contexto: 'content',
      ambito: 'buscar',
      evento: 'Empieza la busqueda de la orden',
      datos: { orden: '3243349573' },
    });
    expect(entrada.ts).toBeGreaterThan(0);
  });

  it('distingue los niveles', async () => {
    await dev.setDevMode(true);

    trace.traza('a', 'depuracion');
    trace.trazaInfo('a', 'informativa');
    trace.trazaAviso('a', 'aviso');
    trace.trazaError('a', 'fallo');
    await asentar();

    expect(trace.getTrazas().map((t) => t.nivel)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('deja de grabar al apagar el Modo Dev', async () => {
    await dev.setDevMode(true);
    trace.traza('a', 'con dev');
    await asentar();

    await dev.setDevMode(false);
    trace.traza('a', 'sin dev');
    await asentar();

    expect(trace.getTrazas().map((t) => t.evento)).toEqual(['con dev']);
  });

  it('limpiarTrazas vacia el registro', async () => {
    await dev.setDevMode(true);
    trace.traza('a', 'una');
    await asentar();

    trace.limpiarTrazas();
    await asentar();

    expect(trace.getTrazas()).toHaveLength(0);
  });

  it('no crece sin limite', async () => {
    await dev.setDevMode(true);

    for (let i = 0; i < trace.TRACE_CAP + 25; i++) trace.traza('a', `entrada ${i}`);
    await asentar();

    const trazas = trace.getTrazas();

    expect(trazas).toHaveLength(trace.TRACE_CAP);
    // Se conservan las mas nuevas, que son las que explican el fallo.
    expect(trazas.at(-1).evento).toBe(`entrada ${trace.TRACE_CAP + 24}`);
  });

  it('no pierde las trazas emitidas antes de saber si el Modo Dev esta activo', async () => {
    // El flag se lee de storage: al arrancar un contexto aun no se sabe. Las
    // trazas de arranque — las que dicen que frames despertaron — se emiten
    // justo en ese hueco, y son las mas valiosas para depurar.
    vi.resetModules();
    instalarChromeFalso();
    await globalThis.chrome.storage.local.set({ 'dev-mode:enabled': true });

    const fresco = await import('../../src/features/devoluciones/trace.js');
    fresco.trazaInfo('despachador', 'Content script activo en esta pantalla', { esTop: true });

    await asentar();

    expect(fresco.getTrazas().map((t) => t.evento)).toContain('Content script activo en esta pantalla');
  });

  it('avisa a los suscriptores para que la pestana se refresque sola', async () => {
    await dev.setDevMode(true);

    const visto = [];
    const desuscribir = trace.subscribeTrazas((t) => visto.push(t.length));

    trace.traza('a', 'una');
    await asentar();

    expect(visto.at(-1)).toBe(1);
    desuscribir();
  });
});
