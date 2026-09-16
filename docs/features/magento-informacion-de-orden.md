# Magento · Información de Orden

Entra a la **ficha de cada orden** (`/sales/order/view/order_id/<entity_id>`) y deja lo que hay ahí
en un **CSV, una fila por orden**, con el número de orden como primera columna. **Read-only.**

"Entrar" es pedir **por `fetch` el mismo enlace que abre el operador** y leer su HTML con
`DOMParser`. Es el mismo origen y la misma sesión que la pestaña, así que el servidor devuelve
exactamente la página que se vería; la diferencia es que **no ocupa la pestaña** y permite pedir
varias ordenes a la vez (campo numerico sin tope; 4 por defecto).

> No confundir con la feature **Información de Orden** (`orden-info`), que muestra **una** orden en
> el popup leyendo la ficha que ya está abierta. Esta recorre **muchas** y entrega un archivo.

**Referencia:** `src/features/magento/informacion_de_orden/docs/intrucciones.md` — el endpoint del
grid, la estructura de la ficha sección por sección y los cuatro métodos de pago, medidos contra el
admin real (2026-09-14). Ignorar su §1 en lo que toca al túnel de red: la extensión corre dentro del
navegador del usuario.

```
src/features/magento/informacion_de_orden/
├── constants.js     MODULE_ID, STORAGE_KEYS, SOURCE_MODE, RUN_PHASE, ORDER_STATUS, FINISH_REASON,
│                    FILTER_ERROR_PREFIX, MAX_RANGE_DAYS(28), STORE_ID(123), PAGE_SIZE(200),
│                    CONCURRENCY_{MIN,DEFAULT}(1/4) + clampConcurrency(), DETAIL_SECTION(+CHOICES,
│                    DEFAULT_SECTIONS, expandSections), DETAIL_SELECTORS, TAB_URL_RE, SECTION_LABEL,
│                    GRID_COLUMNS, PAYMENT_COLUMNS, ITEM_COLUMNS, META_COLUMNS
├── grid-request.js  puro: toGridDate · buildGridParams · buildGridUrl · rangeDays · splitDateRange
├── grid-parse.js    puro: isFilterError · filterErrorMessage · extractGridData · extractUpdateUrl
│                          · stripHtml · moneyValue · parseJsonField
├── detail-parse.js  puro (sobre un Document): parseOrderDetail · parseLogFragment · parseNotesFragment
├── payment.js       puro: normalizePayment(item del grid) → modelo único de pago
├── parse-input.js   puro: parseOrderNumbers(text) → { numbers, warnings }
├── csv.js           buildRecord · makeMissingRecord · buildMatrix · matrixToCsv
├── state.js         run store + makeRun + draft + resultado aparte (get/set/subscribe)
├── debug.js         __extLgeCl.magentoInformacionDeOrden.*
├── content/ detector.js · endpoint.js · client.js (grid) · order-page.js (ficha) · index.js · flows/run.js
└── popup/   section.js
```

## Las dos fases

1. **Descubrir** — el grid dice qué órdenes hay en el rango (o resuelve las que pidió el usuario) y,
   sobre todo, da el **enlace** de cada una: es lo único que no se puede deducir, porque la URL lleva
   el `entity_id` interno y la key de la sesión. Sale de `actions.view.href` del propio grid.
2. **Capturar** — se entra a la ficha de cada orden con un pool en paralelo y se lee lo que hay ahí.

## Estado

**`chrome.storage.local["magento:informacion-de-orden:run"]`** — solo progreso:
`{ active, claimed, phase, startedAt, finishedAt, finishReason?, error?, config:{from,to,mode,
orderNumbers[],concurrency,sections{}}, endpoint, totalRecords, total, doneCount, okCount,
notFoundCount, errorCount, log:[...] (cap 400) }`.

**`…:result`** — los registros: `{ generatedAt, records:[{ incrementId, entityId, viewHref, status,
error, fixed:[...], extra:[...], detail:{"<sección> - <etiqueta>": valor}, items:{}, history:{} }] }`.
**`…:draft`** — el formulario.

**Por qué el resultado va aparte:** cientos de órdenes con sus campos no entran en un run que además
se reescribe en cada avance (criterio de e-promoters).

## Patrón

**Storage-driven async continuo** (el de `pim`/`starkoms`), **no** tick-por-reload: como no navega,
el flujo vive entero en un documento. `wireAsyncRunLifecycle({ topFrameOnly: true })`; el top frame
del admin **reclama** el run (`claimed`) y lo ejecuta; `claimWatchdog` (3,5 s) termina con
`not-detected` si la pestaña no es el admin. Cancelar ⇒ `active:false` ⇒ `abortActiveRun()` ⇒ el
`AbortController` corta entre peticiones.

## Qué se lee de la ficha (`detail-parse.js`)

Cuatro casillas en el popup, todas activas por defecto (`DETAIL_SECTION_CHOICES`):

| Casilla | Qué trae |
|---|---|
| Orden, cuenta y direcciones | `order-information-table` + `order-account-information-table` + las **direcciones completas** de facturación y envío |
| Pago, envío y totales | `.order-payment-method` (título + sus tablas), `.order-shipping-method` y `.order-totals` |
| Historial y transacciones | `.note-list-item` con su fecha y estado, y las notas de Transbank/MercadoPago **decodificadas** |
| Logs ERP / OSMS y facturación | `.gerp-export-log`, `.osms-export-log` y `Full In House Information`. Suman una petición extra por orden |

Los **ítems** (`table.edit-order-table`) van siempre: son el cuerpo de la orden.

**La decodificación de las notas reutiliza `buscar-orden/transactions.js`** (`buildTransaction`,
puro y ya probado) en vez de duplicar 130 líneas de parseo de notas de pasarela.

## Quirks (críticos)

- **Las filas de la ficha CAMBIAN entre órdenes** (doc §5): la de marketplace no trae `Placed from
  IP`, el nombre de la zona horaria cambia (`Order Date (America/Santiago)` vs `(Europe/London)`), y
  el bloque de pago no tiene un conjunto fijo de campos. Por eso **nada se lee por posición ni se da
  por presente**: se recorren los pares `<th>`/`<td>` tal como estén y cada uno se emite con su
  etiqueta, que se vuelve una **columna dinámica `"<sección> - <etiqueta>"`** en el CSV.
- **Con `marketplace_payment` el bloque de pago NO tiene tabla**, solo el título: un parser que
  espere filas devuelve vacío. El título se emite igual, o la orden quedaría sin ninguna señal de
  cómo se pagó.
- **Los ítems son un `<tbody>` por producto** y dentro varias `<tr>` (la primera lleva los datos, las
  siguientes son subfilas de cantidades). Casi ninguna celda tiene clase propia, así que las columnas
  se mapean leyendo los `<th>` del `thead` y casando **por posición dentro de cada tbody**.
- **El texto de `Discount` incluye el nombre de la promoción**, que varía por orden: la etiqueta se
  emite tal cual y nunca se compara por igualdad.
- **La ficha sin sesión devuelve el login con HTTP 200**, no un 401: si no aparece ni el número de
  orden ni un solo campo, se falla con "puede haber caducado la sesión" en vez de emitir una fila
  vacía.
- **ERP y OSMS Export Log se cargan por AJAX con su propia key y form_key** (doc §5.5): la URL se
  **busca dentro del HTML de la ficha** (`TAB_URL_RE`), no se arma a mano. Si ya vinieron embebidos
  no se pide nada. Un log que no se puede traer **no invalida la orden**: se anota el motivo en su
  propia columna (`ERP - Error`) y se sigue.
- **`ORDER_FILTER_ERROR` llega con HTTP 200 y `Content-Type: text/html`** (doc §4.4): se detecta por
  el **contenido**, nunca por el status, y se traduce a los tres casos reales (falta el rango, falta
  el Purchase Point, el rango supera 1 mes).
- **Los tres filtros del grid son obligatorios**: rango de `created_at`, `store_id` (Purchase Point)
  y que no pase de un mes. Van siempre, aunque se busque una sola orden. El tope seguro son **28
  dias** (29 paso, 60 fallo). Los rangos mayores se dividen desde la fecha mas reciente en ventanas
  sin superposicion y se juntan antes de capturar las fichas. En modo lista, cada numero se busca por
  esas ventanas hasta encontrar una coincidencia exacta.
- **La key de las URLs caduca y cambia por sesión.** `resolveGridEndpoint()` la resuelve en runtime:
  del documento actual si la pestaña está en el listado, si no con un `fetch` al listado. Se descartó
  pedírsela al bridge del mundo MAIN: no aporta sobre parsear el HTML, que además funciona fuera del
  listado.
- **El filtro `increment_id` de Magento es "contiene":** en modo lista la fila se **casa exacto**
  localmente. Lo que no aparece sale en el CSV como `No encontrada`, no se descarta en silencio.
- **Una ficha caída no tira el recorrido:** esa orden sale con lo que el grid ya sabía de ella y con
  el motivo del fallo en su fila. Lo mismo con una página del listado.
- **El resultado se vuelca a storage cada ~1,5 s y al terminar**, no en cada orden: escribir miles de
  filas por orden sería carísimo, y no volcar nunca perdería todo si se cierra la pestaña. Una
  corrida detenida a medias conserva lo capturado.
- **Un reload mata el flujo async:** `reconcileOnInit` marca el run interrumpido y avisa que se
  conserva lo que alcanzó a guardarse.

## CSV

Columnas fijas (del grid, para identificar y por el detalle de pago que la ficha no muestra):
`Orden`, `Order ID`, fechas, estado, canal/marketplace, store, total y moneda, más el **pago
normalizado** desde `additional_information` (pasarela, id de transacción, código de autorización,
marca, últimos 4, cuotas, tipo, estado, monto, comisión, neto, 3DS) — clasificado **por
`payment_method`**, nunca por `payment_method_type`, que miente (Webpay dice `BankTransfer` siendo
tarjeta). Con `account_money` de MercadoPago, `card` llega como **array vacío**: `asObject()` lo
descarta en vez de reventar.

Después, `URL` y `Estado (ficha)`, **todas las columnas dinámicas de la ficha**, el resumen de ítems
(`Items`, `Item - SKU`, `Item - Cantidad`… concatenados con ` | `), `Notas` y `Historial`, y al final
`Estado captura` y `Error`.

El encabezado es la **unión estable** de lo que apareció en todas las órdenes, así que dos órdenes
con campos distintos no se corren de columna. `matrixToCsv`: BOM UTF-8, `\r\n`, todo entrecomillado y
`protectFormula` (`'` delante de `=`, `+`, `@`, `-texto`).

**Datos personales:** la ficha trae el cliente **sin enmascarar** (nombre y correo completos,
dirección con número, teléfono) — a diferencia de las columnas del grid. El popup lo avisa; trata el
archivo como dato sensible.

## UI popup

Rango Desde/Hasta con aviso de la division automatica en ventanas · radio **Todo el rango / Solo estas ordenes**
(textarea + **Subir CSV**, ambos por el mismo parser) · **Consultas simultaneas** sin tope (4 por defecto) · las cuatro
casillas de secciones con su explicación · Iniciar/Detener/Limpiar · progreso en vivo · tabla de
resultados con **la misma matriz que el CSV** (primeras 150 filas) · Copiar/Descargar CSV ·
`<details>` con el registro. Estilos `.io-*` en `popup.css`.

## Debug `__extLgeCl.magentoInformacionDeOrden.`

`diagnose()` · `endpoint()` · `resetEndpoint()` · `probe({from,to})` (cuántas órdenes hay) ·
**`link(orden,{from,to})`** (resuelve el enlace) · **`detail(url|entityId)`** (lee una ficha) ·
**`parseCurrent()`** (parsea la ficha abierta en esta pestaña, sin red) · **`order(orden,{from,to})`**
(enlace + ficha + la fila que saldría en el CSV) · `csv()` · `result()` · `state()` · `draft()` ·
`stop()` · `reset()` · `tick()`.

## Tests

Tres archivos, 68 casos. Los dos que tocan DOM usan **happy-dom** (`@vitest-environment happy-dom`),
agregado al proyecto para esto.

- `magento-informacion-de-orden.test.js` — lo puro: fecha y filtros obligatorios del grid, los tres
  `ORDER_FILTER_ERROR`, extracción del JSON y del `update_url`, `stripHtml`/`moneyValue`,
  `normalizePayment` × 6 (Webpay VN y SI, MP pasarela, MP `account_money` con `card: []`, MP
  incrustado, marketplace, método desconocido), `parseOrderNumbers` y `clampConcurrency`.
- `magento-informacion-de-orden-ficha.test.js` — el parser de la ficha sobre HTML real: las dos
  tablas de cabecera por etiqueta, direcciones completas, pago y envío, totales con el nombre de la
  promoción, ítems por `tbody`, historial con la nota decodificada, Full In House y log del ERP,
  secciones apagadas, **la ficha de marketplace sin IP ni tabla de pago**, un HTML que no es una
  ficha, y el CSV (columnas dinámicas, resumen de ítems, dos órdenes con campos distintos que no se
  corren, una ficha fallida que sale marcada).
- `magento-informacion-de-orden-run.test.js` — el motor con `chrome` y `fetch` de mentira: **el orden
  no depende de cual ficha conteste antes**, la paginacion del listado, rangos largos en ambos modos,
  concurrencia mayor a 8, una
  ficha caída, una ficha vacía por sesión caída, una página del listado caída, rango vacío,
  `ORDER_FILTER_ERROR`, los logs AJAX solo si la sección está activa (y que un log inaccesible no
  invalide la orden), el modo lista con su `not-found`, y el ciclo de vida (fuera del admin, ya
  reclamado, cancelar, reconcile).

## Pendientes / limitaciones

- **Una petición por orden** (dos si se piden los logs): un rango ancho son miles. El pool ayuda,
  pero conviene acotar el rango.
- El rango es obligatorio; cada consulta cubre hasta 28 dias y los rangos mayores se segmentan. Se
  mantiene el tope de `MAX_ORDERS` (5000) fichas por corrida.
- No se ejecuta el JS de la página: lo que la ficha arme en el cliente fuera de las pestañas AJAX
  contempladas no se ve.
- Requiere sesión de admin iniciada y una pestaña en el admin; si se cierra a media corrida se
  conserva lo del último volcado.
- Solo el store view de Chile (`STORE_ID = 123`).
- No distingue múltiples pestañas de Magento (el flag `claimed` evita que dos frames corran a la vez)
  ni impide correrlo junto a otro módulo del apartado; sin reintento por orden.
