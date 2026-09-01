// Puente con el mundo MAIN del admin de Magento (ver content_scripts del manifest).
//
// Por que existe: la grilla de tarifas regionales de una Global Shipping Rule se
// pagina contra el servidor. Recorrerla a clicks cuesta una peticion AJAX + un
// re-render por pagina y por rule, y es lo unico caro que queda dentro de cada
// detalle. Magento arma esa grilla con un UI component (Knockout) registrado en
// `uiRegistry`: desde la pagina se le puede pedir directamente que traiga TODAS
// las filas de una sola vez, en vez de simular al usuario apretando "siguiente".
//
// El content script aislado no ve `window.require` ni el registry de la pagina
// (vive en otro mundo), y el CSP de Magento bloquea inyectar un <script> inline,
// asi que la unica via es un content script `world: "MAIN"`, igual que el bridge
// de GraphQL de lg.com.
//
// Restricciones de este archivo:
//   - Corre en el contexto de la pagina: NO hay `chrome.*` ni imports.
//   - Solo habla por `window.postMessage`.
//   - Es de solo lectura salvo por el tamano de pagina de la grilla regional, y
//     jamas debe romper la pagina: todo va en try/catch y ante la duda responde
//     que no pudo, para que el recorrido por DOM siga funcionando como antes.

(() => {
  const SOURCE = 'ext-lge-cl/magento-bridge';
  const MAX_COMPONENTS = 200;
  // Columnas tipicas de la grilla regional: sirven para reconocerla entre todos
  // los data sources que el admin registra en la misma pantalla.
  const REGIONAL_HINT_RE = /address|region|comuna|delivery|fee|carrier|shipping/i;

  if (window.__extLgeClMagentoBridge) return;
  window.__extLgeClMagentoBridge = true;

  function safe(fn, fallback = null) {
    try {
      const value = fn();
      return value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  }

  /** Lee un observable de Knockout (o el valor pelado si no lo es). */
  function readValue(value) {
    if (typeof value === 'function') return safe(() => value(), null);
    return value ?? null;
  }

  function toNumber(value) {
    const parsed = Number(readValue(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function registryOf() {
    const req = window.require || window.requirejs;
    if (typeof req !== 'function') return null;
    return safe(() => req('uiRegistry'), null);
  }

  /**
   * Todos los componentes registrados. La forma interna del registry cambio de
   * nombre entre versiones de Magento, asi que se prueban las conocidas y, como
   * ultimo recurso, el propio `filter` con una consulta vacia.
   */
  function componentsOf(registry) {
    if (!registry) return [];
    const buckets = [
      safe(() => registry.storage.data),
      safe(() => registry.storage._data),
      safe(() => registry.data),
      safe(() => registry._data),
    ];
    for (const bucket of buckets) {
      if (!bucket || typeof bucket !== 'object') continue;
      const list = Object.values(bucket).filter((item) => item && typeof item === 'object' && item.name);
      if (list.length) return list;
    }
    const filtered = safe(() => registry.filter({}), null);
    return Array.isArray(filtered) ? filtered.filter(Boolean) : [];
  }

  function itemsOf(component) {
    const items = safe(() => component.data.items, null);
    return Array.isArray(items) ? items : null;
  }

  function endpointOf(component) {
    return String(
      safe(() => component.storage().requestConfig.url)
      || safe(() => component.update_url)
      || safe(() => component.updateUrl)
      || '',
    );
  }

  function describe(component) {
    const items = itemsOf(component);
    return {
      name: String(safe(() => component.name) || ''),
      component: String(safe(() => component.component) || ''),
      itemCount: items ? items.length : null,
      totalRecords: toNumber(safe(() => component.data.totalRecords)) ?? toNumber(component.totalRecords),
      pageSize: toNumber(component.pageSize),
      hasRows: typeof component.rows === 'function',
      hasReload: typeof component.reload === 'function',
      endpoint: endpointOf(component),
    };
  }

  /** Raiz del namespace del UI component ("ns.ns.listing_top.paging" -> "ns"). */
  function namespaceOf(name) {
    return String(name || '').split('.')[0];
  }

  /**
   * Puntua que tan probable es que un data source sea el de la grilla regional.
   * Se prefiere el que ya esta paginado (totalRecords > filas cargadas): es
   * justo el que obliga a recorrer paginas.
   */
  function scoreProvider(component) {
    const items = itemsOf(component);
    if (!items) return -1;
    const name = String(safe(() => component.name) || '').toLowerCase();
    let score = 0;
    if (/regional/.test(name)) score += 3;
    if (/shipping|delivery/.test(name)) score += 1;

    const keys = items.length ? Object.keys(items[0] || {}) : [];
    const hits = keys.filter((key) => REGIONAL_HINT_RE.test(key)).length;
    if (hits >= 2) score += 2;
    else if (hits === 1) score += 1;

    const total = toNumber(safe(() => component.data.totalRecords));
    if (total !== null && total > items.length) score += 2;
    return score;
  }

  function findRegionalProvider(components) {
    let best = null;
    let bestScore = 0;
    for (const component of components) {
      const score = scoreProvider(component);
      if (score > bestScore) {
        best = component;
        bestScore = score;
      }
    }
    return best;
  }

  /** El paginador del mismo namespace: es quien conoce el tamano de pagina. */
  function findPaging(components, provider) {
    const ns = namespaceOf(safe(() => provider.name));
    if (!ns) return null;
    return components.find((component) => {
      const name = String(safe(() => component.name) || '');
      if (namespaceOf(name) !== ns) return false;
      if (typeof component.pageSize !== 'function') return false;
      return /paging/i.test(name) || /paging/i.test(String(safe(() => component.component) || ''));
    }) || null;
  }

  /**
   * Sube el tamano de pagina de la grilla regional para que traiga todas las
   * tarifas en una sola peticion. NO guarda nada: el tamano de pagina es estado
   * de la vista del listado, no del formulario.
   */
  function expandRegional(payload) {
    const size = Math.max(1, Number(payload && payload.size) || 200);
    const registry = registryOf();
    if (!registry) return { applied: false, reason: 'la pagina no expone uiRegistry' };

    const components = componentsOf(registry);
    if (!components.length) return { applied: false, reason: 'el registry no devolvio componentes' };

    const provider = findRegionalProvider(components);
    if (!provider) return { applied: false, reason: 'no se encontro el data source de las tarifas regionales' };

    const info = describe(provider);
    const loaded = info.itemCount || 0;
    if (info.totalRecords !== null && info.totalRecords <= loaded) {
      return { applied: false, reason: 'ya estaban todas las tarifas cargadas', ...info, loaded };
    }

    const paging = findPaging(components, provider);
    if (paging && toNumber(paging.pageSize) !== size) {
      const done = safe(() => { paging.pageSize(size); return true; }, false);
      if (done) {
        return {
          applied: true,
          via: 'paging',
          size,
          loaded,
          provider: info.name,
          paging: String(safe(() => paging.name) || ''),
          totalRecords: info.totalRecords,
          endpoint: info.endpoint,
        };
      }
    }

    // Sin paginador utilizable, se le pide al propio data source. Es la via de
    // respaldo porque le toca los params directamente.
    const done = safe(() => {
      const params = provider.params || {};
      provider.params = { ...params, paging: { ...(params.paging || {}), pageSize: size, current: 1 } };
      provider.reload();
      return true;
    }, false);
    if (!done) return { applied: false, reason: 'no se pudo pedir mas filas al data source', ...info, loaded };

    return {
      applied: true,
      via: 'provider',
      size,
      loaded,
      provider: info.name,
      paging: null,
      totalRecords: info.totalRecords,
      endpoint: info.endpoint,
    };
  }

  /**
   * Radiografia del registry. Es la "inspeccion de DevTools" hecha comando: dice
   * si los datos estan en la pagina, con que nombre y contra que endpoint los
   * pide Magento (lo que hace falta para decidir si conviene pedirlos directo).
   */
  function probe() {
    const registry = registryOf();
    const components = componentsOf(registry);
    const providers = components.filter((component) => itemsOf(component));
    const regional = findRegionalProvider(components);
    return {
      hasRequire: typeof (window.require || window.requirejs) === 'function',
      hasRegistry: Boolean(registry),
      componentCount: components.length,
      providers: providers.slice(0, MAX_COMPONENTS).map(describe),
      regional: regional ? { ...describe(regional), score: scoreProvider(regional) } : null,
      paging: regional ? String(safe(() => findPaging(components, regional).name) || '') : '',
    };
  }

  const OPS = {
    probe,
    'expand-regional': expandRegional,
  };

  function respond(id, ok, payload) {
    const message = { source: SOURCE, kind: 'response', id, ok };
    if (ok) message.result = payload;
    else message.error = payload;
    window.postMessage(message, '*');
  }

  window.addEventListener('message', (event) => {
    try {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== SOURCE || data.kind !== 'request' || !data.id) return;

      const handler = OPS[data.op];
      if (!handler) {
        respond(data.id, false, `operacion desconocida: ${data.op}`);
        return;
      }
      let result;
      try {
        result = handler(data.payload || {});
      } catch (err) {
        respond(data.id, false, String((err && err.message) || err));
        return;
      }
      // Se serializa aca para que un valor no clonable (un observable suelto)
      // falle en el bridge y no reviente el postMessage del navegador.
      respond(data.id, true, JSON.parse(JSON.stringify(result === undefined ? null : result)));
    } catch {
      // Jamas propagar un error nuestro al listener de la pagina.
    }
  });
})();
