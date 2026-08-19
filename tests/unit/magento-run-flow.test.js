// Dos puntos del recorrido de Global Shipping Rules que fallan en silencio.
//
// 1) Casar la URL del detalle con la rule que se estaba leyendo. Magento pone el
//    `entity_id` en la URL, pero la columna "ID" del listado no siempre es ese
//    mismo numero: si no casan, el proceso rebota listado -> detalle -> listado
//    sin capturar nada y sin dar un error claro.
// 2) Saber si el pager llego al final. Magento marca "siguiente" deshabilitado
//    de varias formas segun si el control es <button> o <a>; mirar solo la
//    propiedad `disabled` deja el recorrido girando hasta el tope de paginas.
//
// No hay jsdom en el proyecto: los elementos del pager se replican con lo justo
// que consulta la funcion (`disabled`, atributos y clases).

import { describe, expect, it } from 'vitest';
import { findActiveRuleIndex } from '../../src/features/magento/content/flows/run.js';
import { isPagerDisabled } from '../../src/features/magento/content/magento/grid.js';
import { RULE_STATUS } from '../../src/features/magento/constants.js';

const EDIT = (id) => `https://shop.lg.com/obsadm/global_shippingrule/management/edit/entity_id/${id}/key/tok/`;

function rule(id, status, { editHref = EDIT(id) } = {}) {
  return { id: String(id), nameFe: `Rule ${id}`, editHref, status };
}

function pager(props = {}) {
  const attrs = props.attrs || {};
  const classes = props.classes || [];
  return {
    disabled: props.disabled,
    hasAttribute: (name) => name in attrs,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    classList: { contains: (name) => classes.includes(name) },
  };
}

describe('findActiveRuleIndex', () => {
  it('casa por el ID de la columna del listado', () => {
    const run = { items: [rule(10, RULE_STATUS.OK), rule(5799, RULE_STATUS.READING)] };
    expect(findActiveRuleIndex(run, '5799')).toBe(1);
  });

  it('casa por el entity_id del editHref cuando la columna ID trae otro numero', () => {
    const run = {
      items: [
        rule(10, RULE_STATUS.OK),
        { ...rule(5799, RULE_STATUS.READING), id: '42' },
      ],
    };
    expect(findActiveRuleIndex(run, '5799')).toBe(1);
  });

  it('ignora las rules que no estan en lectura', () => {
    const run = { items: [rule(5799, RULE_STATUS.OK), rule(10, RULE_STATUS.PENDING)] };
    expect(findActiveRuleIndex(run, '5799')).toBe(-1);
  });

  it('cae en la unica rule en lectura si ningun ID coincide', () => {
    const run = {
      items: [
        rule(10, RULE_STATUS.OK),
        { id: '', nameFe: 'Sin id', editHref: '/otro/camino', status: RULE_STATUS.READING },
      ],
    };
    expect(findActiveRuleIndex(run, '5799')).toBe(1);
  });

  it('no adivina si hay mas de una rule en lectura', () => {
    const run = {
      items: [
        { ...rule(1, RULE_STATUS.READING), id: '', editHref: '/a' },
        { ...rule(2, RULE_STATUS.READING), id: '', editHref: '/b' },
      ],
    };
    expect(findActiveRuleIndex(run, '5799')).toBe(-1);
  });

  it('tolera un run sin items', () => {
    expect(findActiveRuleIndex(null, '1')).toBe(-1);
    expect(findActiveRuleIndex({}, '1')).toBe(-1);
  });
});

describe('isPagerDisabled', () => {
  it('trata la ausencia del boton como final del listado', () => {
    expect(isPagerDisabled(null)).toBe(true);
  });

  it('reconoce las cuatro formas en que Magento lo marca', () => {
    expect(isPagerDisabled(pager({ disabled: true }))).toBe(true);
    expect(isPagerDisabled(pager({ attrs: { disabled: '' } }))).toBe(true);
    expect(isPagerDisabled(pager({ attrs: { 'aria-disabled': 'true' } }))).toBe(true);
    expect(isPagerDisabled(pager({ classes: ['disabled'] }))).toBe(true);
  });

  it('deja avanzar cuando el boton esta activo', () => {
    expect(isPagerDisabled(pager())).toBe(false);
    expect(isPagerDisabled(pager({ disabled: false, attrs: { 'aria-disabled': 'false' } }))).toBe(false);
  });
});
