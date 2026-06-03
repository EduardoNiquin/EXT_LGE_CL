// Bridge de red — corre en el mundo MAIN (ver content_scripts en el manifest).
//
// El content script aislado (src/content/index.js) tiene su PROPIO `fetch` y
// `XMLHttpRequest`, separados de los de la página, por lo que NO puede observar
// el tráfico de red que dispara el front de www.lg.com. Para captar el JSON que
// llega por GraphQL/REST necesitamos parchear el `fetch`/XHR de la página, lo que
// solo es posible desde el mundo MAIN.
//
// Restricciones de este archivo:
//   - Corre en el contexto de la página: NO hay acceso a `chrome.*`.
//   - Solo se comunica con el content aislado vía `window.postMessage`.
//   - Debe ser a prueba de fallos: jamás romper ni alterar el comportamiento del
//     `fetch`/XHR original de la página (todo envuelto en try/catch).
//
// Endpoints captados:
//   - GraphQL: `…/api/graphql` (PDP/PLP). Nombre desde operationName/query/data.
//   - REST proxy LG: `…/ncms/.../proxy/<name>` (PLP: retrieveProductList).
//     El nombre se toma del último segmento del path.

(() => {
  const SOURCE = 'ext-lge-cl/graphql';
  const GRAPHQL_RE = /\/api\/graphql(\?|$)/i;
  const PROXY_RE = /\/ncms\/[^?]*\/proxy\/([A-Za-z0-9_]+)/i;

  // Guard de idempotencia: si por algún motivo el script se evalúa dos veces,
  // no queremos envolver el fetch repetidas veces.
  if (window.__extLgeClGraphqlBridge) return;
  window.__extLgeClGraphqlBridge = true;

  // Devuelve la "coincidencia" de captura para una URL, o null si no nos interesa.
  function matchCapture(url) {
    try {
      if (typeof url !== 'string') return null;
      if (GRAPHQL_RE.test(url)) return { kind: 'graphql' };
      const m = url.match(PROXY_RE);
      if (m) return { kind: 'rest', name: m[1] };
      return null;
    } catch {
      return null;
    }
  }

  function urlFromFetchArgs(input) {
    try {
      if (typeof input === 'string') return input;
      if (input instanceof Request) return input.url;
      if (input && typeof input.url === 'string') return input.url;
      return String(input ?? '');
    } catch {
      return '';
    }
  }

  function parseRequestBody(body) {
    try {
      if (typeof body !== 'string') return null;
      const json = JSON.parse(body);
      // GraphQL puede venir como objeto o como array de operaciones (batch).
      if (Array.isArray(json)) return json[0] || null;
      return json;
    } catch {
      return null;
    }
  }

  // Algunas operaciones llegan sin `operationName` (queries anónimas, p. ej.
  // `{getAddressLevel1{...}}`). Lo derivamos del texto del query para poder
  // identificarlas igual.
  function deriveOperationName(query, explicit) {
    if (explicit) return explicit;
    if (typeof query !== 'string') return 'unknown';
    const named = query.match(/\b(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/);
    if (named) return named[1];
    const anon = query.match(/\{\s*([A-Za-z_]\w*)/);
    if (anon) return anon[1];
    return 'unknown';
  }

  // GraphQL por GET trae query/operationName/variables en el query string
  // (no hay body). Parseamos `variables` para poder clasificar la captura
  // (p. ej. PBP = getProductsBySku con un solo SKU).
  function parseUrlVariables(url) {
    try {
      const qs = typeof url === 'string' ? url.split('?')[1] : '';
      if (!qs) return null;
      const params = new URLSearchParams(qs);
      const v = params.get('variables');
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  }

  function publish(payload) {
    try {
      window.postMessage({ source: SOURCE, ...payload }, '*');
    } catch {
      /* nunca propagar errores al flujo de la página */
    }
  }

  function handleCapture(url, requestBody, responseText, match) {
    try {
      const req = parseRequestBody(requestBody) || {};
      const response = responseText ? JSON.parse(responseText) : null;

      let operationName;
      if (match.kind === 'rest') {
        // REST proxy: el nombre es el último segmento del path.
        operationName = match.name || 'unknown';
      } else {
        operationName = deriveOperationName(req.query, req.operationName);
        // Fallback: cuando no pudimos leer el request (p. ej. fetch(new Request)),
        // el operationName se infiere del primer key de `data` en la respuesta
        // (= campo raíz de la operación: getPbpProduct, products…).
        if (operationName === 'unknown' && response?.data && typeof response.data === 'object') {
          const keys = Object.keys(response.data);
          if (keys.length) operationName = keys[0];
        }
      }

      let variables = req.variables ?? (match.kind === 'rest' ? req : null);
      // GET GraphQL: las variables viven en el query string, no en el body.
      if (variables == null && match.kind === 'graphql') variables = parseUrlVariables(url);

      publish({
        operationName,
        variables,
        response,
        url,
        ts: Date.now(),
      });
    } catch {
      /* JSON inválido o parcial: lo ignoramos */
    }
  }

  // ---------- fetch ----------
  try {
    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = function patchedFetch(input, init) {
        const url = urlFromFetchArgs(input);
        const match = matchCapture(url);

        let requestBody = null;
        if (match) {
          try {
            if (init && typeof init.body === 'string') requestBody = init.body;
          } catch {
            requestBody = null;
          }
        }

        const result = originalFetch.apply(this, arguments);
        if (!match) return result;

        return result.then((response) => {
          try {
            const clone = response.clone();
            clone.text().then((text) => handleCapture(url, requestBody, text, match)).catch(() => {});
          } catch {
            /* clone falló: no afecta a la página */
          }
          return response;
        });
      };
    }
  } catch {
    /* si no podemos parchear fetch, seguimos: XHR puede cubrir el caso */
  }

  // ---------- XMLHttpRequest ----------
  try {
    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;

      XHR.prototype.open = function patchedOpen(method, url) {
        try {
          this.__extLgeClUrl = url;
          this.__extLgeClMatch = matchCapture(url);
        } catch {
          /* no-op */
        }
        return originalOpen.apply(this, arguments);
      };

      XHR.prototype.send = function patchedSend(body) {
        try {
          const match = this.__extLgeClMatch;
          if (match) {
            const url = this.__extLgeClUrl;
            const reqBody = typeof body === 'string' ? body : null;
            this.addEventListener('load', function onLoad() {
              try {
                const text = this.responseType === '' || this.responseType === 'text'
                  ? this.responseText
                  : null;
                if (text != null) handleCapture(url, reqBody, text, match);
              } catch {
                /* no-op */
              }
            });
          }
        } catch {
          /* no-op */
        }
        return originalSend.apply(this, arguments);
      };
    }
  } catch {
    /* no-op */
  }
})();
