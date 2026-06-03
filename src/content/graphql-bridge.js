// Bridge GraphQL — corre en el mundo MAIN (ver content_scripts en el manifest).
//
// El content script aislado (src/content/index.js) tiene su PROPIO `fetch` y
// `XMLHttpRequest`, separados de los de la página, por lo que NO puede observar
// el tráfico de red que dispara el front de www.lg.com. Para captar el JSON que
// llega por GraphQL necesitamos parchear el `fetch`/XHR de la página, lo que solo
// es posible desde el mundo MAIN.
//
// Restricciones de este archivo:
//   - Corre en el contexto de la página: NO hay acceso a `chrome.*`.
//   - Solo se comunica con el content aislado vía `window.postMessage`.
//   - Debe ser a prueba de fallos: jamás romper ni alterar el comportamiento del
//     `fetch`/XHR original de la página (todo envuelto en try/catch).
//
// Estrategia: interceptar requests a `…/api/graphql`, parsear el body para sacar
// { query, operationName, variables }, y al resolver la respuesta clonar/leer el
// texto, parsear el JSON y reenviarlo por postMessage. El content aislado
// (mismo `window`) lo recibe y lo guarda.

(() => {
  const SOURCE = 'ext-lge-cl/graphql';
  const GRAPHQL_RE = /\/api\/graphql(\?|$)/i;

  // Guard de idempotencia: si por algún motivo el script se evalúa dos veces,
  // no queremos envolver el fetch repetidas veces.
  if (window.__extLgeClGraphqlBridge) return;
  window.__extLgeClGraphqlBridge = true;

  function isGraphqlUrl(url) {
    try {
      return typeof url === 'string' && GRAPHQL_RE.test(url);
    } catch {
      return false;
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

  function publish(payload) {
    try {
      window.postMessage({ source: SOURCE, ...payload }, '*');
    } catch {
      /* nunca propagar errores al flujo de la página */
    }
  }

  function handleCapture(url, requestBody, responseText) {
    try {
      const req = parseRequestBody(requestBody) || {};
      const response = responseText ? JSON.parse(responseText) : null;
      publish({
        operationName: deriveOperationName(req.query, req.operationName),
        variables: req.variables ?? null,
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
        const isGql = isGraphqlUrl(url);

        let requestBody = null;
        if (isGql) {
          try {
            if (init && typeof init.body === 'string') {
              requestBody = init.body;
            } else if (input instanceof Request) {
              // El body de un Request ya consumido no se puede releer acá sin
              // clonarlo; intentamos solo si vino por init.
              requestBody = null;
            }
          } catch {
            requestBody = null;
          }
        }

        const result = originalFetch.apply(this, arguments);
        if (!isGql) return result;

        return result.then((response) => {
          try {
            const clone = response.clone();
            clone.text().then((text) => handleCapture(url, requestBody, text)).catch(() => {});
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
          this.__extLgeClIsGql = isGraphqlUrl(url);
        } catch {
          /* no-op */
        }
        return originalOpen.apply(this, arguments);
      };

      XHR.prototype.send = function patchedSend(body) {
        try {
          if (this.__extLgeClIsGql) {
            const url = this.__extLgeClUrl;
            const reqBody = typeof body === 'string' ? body : null;
            this.addEventListener('load', function onLoad() {
              try {
                const text = this.responseType === '' || this.responseType === 'text'
                  ? this.responseText
                  : null;
                if (text != null) handleCapture(url, reqBody, text);
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
