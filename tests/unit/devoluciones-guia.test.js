// Numero de guia de despacho escrito a mano.
//
// El folio es obligatorio en el ticket y sin el va "0", asi que esta llamada es
// la que evita que alguien tenga que corregirlo despues a mano. Lo que se prueba
// aqui es el contrato con el servidor: que se manda lo tecleado TAL CUAL (la
// limpieza de "N° 123.456" la hace el servidor), que el campo vacio borra el
// dato, y que un 422 llega como error legible en vez de romper el panel.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { setGuia } from '../../src/features/devoluciones/falabella/api.js';
import { TOKEN_HEADER } from '../../src/features/devoluciones/falabella/constants.js';

const BASE = 'https://servidor/api/devoluciones-seller';

function respuesta(status, cuerpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  };
}

function fingirFetch(status, cuerpo) {
  const fetchMock = vi.fn(async () => respuesta(status, cuerpo));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('setGuia', () => {
  it('manda el numero tal cual lo escribio el usuario, con el token', async () => {
    const fetchMock = fingirFetch(200, { id: 42, numero_guia: '123456', numero_guia_origen: 'MANUAL' });

    const res = await setGuia(BASE, 'tok-123', 42, 'N° 123.456');

    expect(res.ok).toBe(true);
    expect(res.data.numero_guia).toBe('123456');
    expect(res.data.numero_guia_origen).toBe('MANUAL');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/orders/42/guia`);
    expect(init.method).toBe('POST');
    expect(init.headers[TOKEN_HEADER]).toBe('tok-123');
    expect(init.headers['Content-Type']).toBe('application/json');

    // Sin limpiar en el cliente: la regla de que forma tiene un folio es del
    // servidor, y a lo que escribe una persona no se le discute.
    expect(JSON.parse(init.body)).toEqual({ numero_guia: 'N° 123.456' });
  });

  it('el campo vacio borra el folio (no manda null ni undefined)', async () => {
    const fetchMock = fingirFetch(200, { id: 42, numero_guia: null, numero_guia_origen: null });

    await setGuia(BASE, 'tok-123', 42, '');
    await setGuia(BASE, 'tok-123', 42, null);

    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(init.body)).toEqual({ numero_guia: '' });
    }
  });

  it('un 422 llega como error legible y no como excepcion', async () => {
    fingirFetch(422, { message: 'El numero de guia solo puede tener digitos (por ejemplo: 123456).' });

    const res = await setGuia(BASE, 'tok-123', 42, 'no la encontre');

    expect(res.ok).toBe(false);
    expect(res.status).toBe(422);
    expect(res.error).toContain('solo puede tener digitos');
  });

  it('sin red devuelve status 0 en vez de reventar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch'); }));

    const res = await setGuia(BASE, 'tok-123', 42, '123456');

    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error).toBeTruthy();
  });
});
