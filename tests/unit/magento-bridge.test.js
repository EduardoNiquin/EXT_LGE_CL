// Via rapida para las tarifas regionales de Global Shipping Rules.
//
// 1) `askBridge` habla con un content script del mundo MAIN por postMessage. Es
//    una via OPCIONAL: si el bridge no esta (otra base de admin, Magento sin
//    uiRegistry) o contesta tarde, tiene que resolver "no se pudo" y dejar que
//    el recorrido por DOM siga; si en cambio se colgara esperando, cada rule
//    quedaria detenida hasta el timeout del detalle.
// 2) `pickPageSizeOption` elige cuantas filas pedir por pagina. Si Magento no
//    ofrece el tamano pedido, quedarse con el mayor disponible sigue siendo
//    mucho mejor que recorrer paginas de 20.

import { describe, expect, it } from 'vitest';
import { askBridge } from '../../src/features/magento/content/bridge-client.js';
import { pickPageSizeOption } from '../../src/features/magento/content/magento/grid.js';
import { BRIDGE } from '../../src/features/magento/constants.js';

/** Ventana de mentira: guarda los listeners y responde lo que diga `reply`. */
function fakeWindow(reply) {
  const listeners = new Set();
  return {
    listeners,
    sent: [],
    addEventListener(type, fn) {
      if (type === 'message') listeners.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.delete(fn);
    },
    postMessage(message) {
      this.sent.push(message);
      const answer = reply?.(message);
      if (!answer) return;
      queueMicrotask(() => Array.from(listeners).forEach((fn) => fn({ data: answer })));
    },
  };
}

const respondOk = (result) => (request) => ({
  source: BRIDGE.SOURCE,
  kind: 'response',
  id: request.id,
  ok: true,
  result,
});

describe('askBridge', () => {
  it('resuelve con el resultado del bridge', async () => {
    const target = fakeWindow(respondOk({ applied: true, via: 'paging' }));

    const answer = await askBridge(BRIDGE.OPS.EXPAND_REGIONAL, { size: 200 }, { target });

    expect(answer).toEqual({ ok: true, result: { applied: true, via: 'paging' } });
    expect(target.sent[0]).toMatchObject({
      source: BRIDGE.SOURCE,
      kind: 'request',
      op: BRIDGE.OPS.EXPAND_REGIONAL,
      payload: { size: 200 },
    });
    expect(target.listeners.size).toBe(0);
  });

  it('propaga el motivo cuando el bridge no pudo', async () => {
    const target = fakeWindow((request) => ({
      source: BRIDGE.SOURCE, kind: 'response', id: request.id, ok: false, error: 'sin uiRegistry',
    }));

    await expect(askBridge(BRIDGE.OPS.PROBE, {}, { target })).resolves.toEqual({
      ok: false,
      reason: 'sin uiRegistry',
    });
  });

  it('no se queda esperando si nadie responde', async () => {
    const target = fakeWindow(() => null);

    const answer = await askBridge(BRIDGE.OPS.PROBE, {}, { target, timeout: 20 });

    expect(answer.ok).toBe(false);
    expect(answer.reason).toMatch(/no respondio/);
    expect(target.listeners.size).toBe(0);
  });

  it('ignora respuestas de otra fuente o de otra peticion', async () => {
    const target = fakeWindow((request) => ({
      source: 'otra-extension', kind: 'response', id: request.id, ok: true, result: 'no es para nosotros',
    }));

    const answer = await askBridge(BRIDGE.OPS.PROBE, {}, { target, timeout: 20 });
    expect(answer.ok).toBe(false);

    const otroId = fakeWindow(() => ({
      source: BRIDGE.SOURCE, kind: 'response', id: 'otro-id', ok: true, result: 'tarde',
    }));
    await expect(askBridge(BRIDGE.OPS.PROBE, {}, { target: otroId, timeout: 20 }))
      .resolves.toMatchObject({ ok: false });
  });

  it('corta al cancelar el proceso', async () => {
    const controller = new AbortController();
    const target = fakeWindow(() => null);

    const pending = askBridge(BRIDGE.OPS.PROBE, {}, { target, signal: controller.signal, timeout: 5000 });
    controller.abort();

    await expect(pending).resolves.toEqual({ ok: false, aborted: true, reason: 'cancelado' });
    expect(target.listeners.size).toBe(0);
  });

  it('ni siquiera pregunta si el proceso ya estaba cancelado', async () => {
    const controller = new AbortController();
    controller.abort();
    const target = fakeWindow(respondOk({ applied: true }));

    await expect(askBridge(BRIDGE.OPS.PROBE, {}, { target, signal: controller.signal }))
      .resolves.toMatchObject({ aborted: true });
    expect(target.sent).toHaveLength(0);
  });
});

describe('pickPageSizeOption', () => {
  const options = [20, 30, 50, 100, 200].map((size) => ({ size, el: `boton-${size}` }));

  it('elige el tamano pedido cuando existe', () => {
    expect(pickPageSizeOption(options, 200)).toEqual({ size: 200, el: 'boton-200' });
  });

  it('cae en el mayor disponible si el pedido no esta', () => {
    const cortas = options.filter((option) => option.size <= 100);
    expect(pickPageSizeOption(cortas, 200)).toEqual({ size: 100, el: 'boton-100' });
  });

  it('devuelve null si el selector no ofrece tamanos', () => {
    expect(pickPageSizeOption([], 200)).toBeNull();
    expect(pickPageSizeOption(null, 200)).toBeNull();
    expect(pickPageSizeOption([{ el: 'sin-numero' }], 200)).toBeNull();
  });
});
