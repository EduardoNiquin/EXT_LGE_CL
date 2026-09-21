// @vitest-environment happy-dom
//
// La zona de carga de archivos compartida (shared/ui/file-intake.js). Lo que se
// cuida aca es el pegado, que es la via que sobrevive a la politica de DLP
// corporativa: si deja de funcionar, dentro de la red de LG no hay forma de
// cargar el Excel ni los adjuntos de Facturas.
//
// Los tres detalles que importan: solo se intercepta el pegado cuando trae
// archivos (pegar texto tiene que seguir funcionando), el listener cuelga del
// documento (recien abierto el popup el foco no esta en la zona) y se
// desengancha solo cuando la sub-vista se reemplaza, que es lo que hace el
// router del popup al cambiar de pestana.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archivosDelPortapapeles, extensionDe, fileIntakeHtml, wireFileIntake } from '../../src/shared/ui/file-intake.js';

const ZONA = { id: 'z', titulo: 'Pega aqui', nota: 'Copialo en el Explorador' };

function montar(opts = ZONA) {
  document.body.innerHTML = `<div id="host">${fileIntakeHtml(opts)}</div>`;
  return document.querySelector('#host');
}

/** Un `paste` como el del navegador: el clipboardData lo pone el propio evento. */
function pegar(archivos) {
  const evento = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(evento, 'clipboardData', { value: { files: archivos, items: [] } });
  document.dispatchEvent(evento);
  return evento;
}

const excel = (nombre = 'master.xlsx') => new File(['x'], nombre);

beforeEach(() => { document.body.innerHTML = ''; });

describe('fileIntakeHtml', () => {
  it('escapa lo que le pasan (el nombre del archivo o la nota no inyectan HTML)', () => {
    const host = montar({ ...ZONA, titulo: '<img src=x onerror=1>', boton: 'Subir' });
    expect(host.querySelector('#z img')).toBeNull();
    expect(host.querySelector('.fi-zone__titulo').textContent).toContain('<img src=x onerror=1>');
  });

  it('el selector queda oculto y con el accept/multiple pedidos', () => {
    const host = montar({ ...ZONA, accept: '.xlsx', multiple: true });
    const input = host.querySelector('#z input[type="file"]');
    expect(input.hidden).toBe(true);
    expect(input.getAttribute('accept')).toBe('.xlsx');
    expect(input.multiple).toBe(true);
  });
});

describe('archivosDelPortapapeles', () => {
  it('toma los archivos del portapapeles', () => {
    expect(archivosDelPortapapeles({ files: [excel()] })).toHaveLength(1);
  });

  it('cae a los items cuando no hay files (asi los expone parte de los navegadores)', () => {
    const file = excel('detalle.pdf');
    const data = { files: [], items: [{ kind: 'string' }, { kind: 'file', getAsFile: () => file }] };
    expect(archivosDelPortapapeles(data)).toEqual([file]);
  });

  it('sin portapapeles o sin archivos devuelve vacio', () => {
    expect(archivosDelPortapapeles(null)).toEqual([]);
    expect(archivosDelPortapapeles({ files: [], items: [{ kind: 'string' }] })).toEqual([]);
  });
});

describe('extensionDe', () => {
  it('normaliza a minusculas y sin punto', () => {
    expect(extensionDe({ name: 'Invoice Master File.XLSX' })).toBe('xlsx');
    expect(extensionDe({ name: 'sin-extension' })).toBe('');
    expect(extensionDe(null)).toBe('');
  });
});

describe('wireFileIntake', () => {
  it('pegar archivos los entrega y corta el evento (el pegado no llega a la pagina)', () => {
    const onArchivos = vi.fn();
    const host = montar();
    wireFileIntake(host, { id: 'z', onArchivos });

    const file = excel();
    const evento = pegar([file]);

    expect(onArchivos).toHaveBeenCalledWith([file], 'pegado');
    expect(evento.defaultPrevented).toBe(true);
  });

  it('funciona con el foco fuera de la zona: el listener es del documento', () => {
    const onArchivos = vi.fn();
    const host = montar();
    host.insertAdjacentHTML('beforeend', '<input id="otro">');
    host.querySelector('#otro').focus();
    wireFileIntake(host, { id: 'z', onArchivos });

    pegar([excel()]);
    expect(onArchivos).toHaveBeenCalledTimes(1);
  });

  it('pegar texto se deja pasar tal cual', () => {
    const onArchivos = vi.fn();
    const host = montar();
    wireFileIntake(host, { id: 'z', onArchivos });

    const evento = pegar([]);

    expect(onArchivos).not.toHaveBeenCalled();
    expect(evento.defaultPrevented).toBe(false);
  });

  it('soltar archivos encima tambien los entrega', () => {
    const onArchivos = vi.fn();
    const host = montar();
    wireFileIntake(host, { id: 'z', onArchivos });

    const file = excel();
    const evento = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(evento, 'dataTransfer', { value: { files: [file] } });
    host.querySelector('#z').dispatchEvent(evento);

    expect(onArchivos).toHaveBeenCalledWith([file], 'arrastre');
  });

  it('deja de escuchar cuando la sub-vista se reemplaza (el router del popup)', () => {
    const onArchivos = vi.fn();
    const host = montar();
    wireFileIntake(host, { id: 'z', onArchivos });

    host.innerHTML = '<p>otra pestana</p>';
    pegar([excel()]);

    expect(onArchivos).not.toHaveBeenCalled();
  });

  it('dispose() desengancha el pegado', () => {
    const onArchivos = vi.fn();
    const host = montar();
    const dispose = wireFileIntake(host, { id: 'z', onArchivos });

    dispose();
    pegar([excel()]);

    expect(onArchivos).not.toHaveBeenCalled();
  });

  it('sin zona en el DOM no explota', () => {
    document.body.innerHTML = '<div id="host"></div>';
    expect(() => wireFileIntake(document.querySelector('#host'), { id: 'z', onArchivos: vi.fn() })()).not.toThrow();
  });
});
