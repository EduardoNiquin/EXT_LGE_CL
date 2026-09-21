# Magento · Información de Orden

Entra a la **ficha de cada orden** (`/sales/order/view/order_id/<entity_id>`) y deja lo que hay ahí
en un **CSV, una fila por orden**, con el número de orden como primera columna. **Read-only.**

**No hay tope de órdenes:** si el rango tiene 47.000, se capturan las 47.000. El resultado sale **en
varios CSV** (uno cada `partSize` órdenes, 500 por defecto), con un botón para **bajarlos todos
unidos** en un solo archivo y una casilla para que **cada archivo se baje solo al cerrarse**. No es
una comodidad: un rango amplio en una sola tanda se caía por memoria (ver "El resultado en partes").

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
│                    CONCURRENCY_{MIN,DEFAULT,WARN}(1/6/10) + clampConcurrency(),
│                    PART_SIZE_{MIN,DEFAULT,MAX}(50/500/5000) + clampPartSize(), MAX_ORDERS/MAX_PAGES
│                    (frenos de emergencia), LONG_RUN_WARN_ORDERS, ORDERS_PER_MINUTE, DOWNLOAD_FOLDER,
│                    CSV_MIME, runStamp(), partFileName(), DETAIL_SECTION(+CHOICES,
│                    DEFAULT_SECTIONS, expandSections), DETAIL_SELECTORS, TAB_URL_RE, SECTION_LABEL,
│                    GRID_COLUMNS, PAYMENT_COLUMNS, ITEM_COLUMNS, META_COLUMNS, ESSENTIAL_COLUMNS,
│                    MONEY_SECTIONS, DATE_FIELD_PREFIXES, MONEY_ITEM_COLUMNS, LABELED_ITEM_COLUMNS
├── grid-request.js  puro: toGridDate · buildGridParams · buildGridUrl · rangeDays · splitDateRange
├── grid-parse.js    puro: isFilterError · filterErrorMessage · extractGridData · extractUpdateUrl
│                          · stripHtml · moneyValue · parseJsonField · slimGridItem
├── detail-parse.js  puro (sobre un Document): parseOrderDetail · parseLogFragment · parseNotesFragment
├── format.js        puro: normalizeMoney · moneyNumber · normalizeDateTime · splitLabeled ·
│                          parseComment · parseJsonText · scalarCell · listCell
├── payment.js       puro: normalizePayment(item del grid) → modelo único de pago
├── parse-input.js   puro: parseOrderNumbers(text) → { numbers, warnings }
├── csv.js           buildRecord · makeMissingRecord · buildMatrix · matrixToCsv(+Text) ·
│                  recordColumnKeys · mergeColumns (union de columnas de la corrida)
├── stats.js         puro: emptyStats · addTiming · summarizeRun · describeSummary · formatDuration · formatMs
├── state.js         run store + makeRun + draft + resultado en partes (indice + parte + clear)
├── debug.js         __extLgeCl.magentoInformacionDeOrden.*
├── content/ detector.js · endpoint.js · client.js (grid) · order-page.js (ficha) · index.js · flows/run.js
└── popup/   section.js
```

La descarga desde el content script va por **`shared/downloads/`** (`requestDownload` + el
`wireDownloadsBackground()` que el service worker registra).

## Las dos fases

1. **Descubrir** — el grid dice qué órdenes hay en el rango (o resuelve las que pidió el usuario) y,
   sobre todo, da el **enlace** de cada una: es lo único que no se puede deducir, porque la URL lleva
   el `entity_id` interno y la key de la sesión. Sale de `actions.view.href` del propio grid.
   De cada fila se guarda solo lo que el CSV usa (**`slimGridItem`**): sin tope de órdenes el
   descubrimiento junta decenas de miles de filas en memoria antes de pedir la primera ficha, y la
   fila completa del grid (~40 columnas más el HTML de sus acciones) son cientos de MB por nada.
2. **Capturar** — se entra a la ficha de cada orden con un pool en paralelo y se lee lo que hay ahí.

**El rango se parte en bloques** (`splitDateRange`: ventanas de hasta 29 dias de calendario, desde
la fecha mas reciente y sin superposicion), asi que pedir 100 dias es legitimo: son cuatro consultas
que se juntan antes de capturar. El descubrimiento va en dos pasadas contra **el mismo pool**
(`runPool`): primero la pagina 1 de cada bloque —que ademas dice cuantas ordenes hay— y despues
todas las paginas que faltan de todos los bloques juntas, para que un rango de un año no se pida
bloque por bloque en fila india.

## Estado

**`chrome.storage.local["magento:informacion-de-orden:run"]`** — solo progreso:
`{ active, claimed, phase, startedAt, finishedAt, finishReason?, error?, config:{from,to,mode,
orderNumbers[],concurrency,partSize,autoDownload,allColumns,sections{}}, endpoint, totalRecords,
total, doneCount, okCount, notFoundCount, errorCount, fetchStartedAt, stats:{count,requests,retries,
bytes,ttfbMs,downloadMs,parseMs,logsMs}, parts, savedRecords, stamp, log:[...] (cap 400) }`.
`partSize`/`autoDownload`/`allColumns` se fijan al iniciar (el perfil de columnas de los archivos que
se bajan solos hay que decidirlo antes de correr); `parts`/`savedRecords`/`stamp` se escriben al
terminar. `fetchStartedAt` marca desde cuando se entran fichas
(el ritmo no cuenta el descubrimiento) y `stats` acumula el `timing` de cada ficha (`stats.js`).

**`…:result`** — el **índice** del resultado, sin registros:
`{ version:2, generatedAt, partSize, total, columns:[...], parts:[{ index, key, count, first, last }] }`.
`columns` es la unión de columnas dinámicas de toda la corrida: el encabezado común de todas las
partes.

**`…:result:part:<n>`** — los registros de una parte: `{ records:[{ incrementId, entityId, viewHref,
status, error, fixed:[...], extra:[...], detail:{"<sección> - <etiqueta>": valor}, itemRows:[],
notes:[] }] }`.

**`…:draft`** — el formulario (incluye `partSize`).

**Por qué el resultado va aparte del run:** cientos de órdenes con sus campos no entran en un run que
además se reescribe en cada avance (criterio de e-promoters). **Por qué va además en partes:** abajo.

Un resultado guardado por la versión anterior (todos los registros dentro de `…:result`) se sigue
leyendo: `normalizeResultIndex` lo presenta como una parte única que vive en la clave del índice.

## Patrón

**Storage-driven async continuo** (el de `pim`/`starkoms`), **no** tick-por-reload: como no navega,
el flujo vive entero en un documento. `wireAsyncRunLifecycle({ topFrameOnly: true })`; el top frame
del admin **reclama** el run (`claimed`) y lo ejecuta; `claimWatchdog` (3,5 s) termina con
`not-detected` si la pestaña no es el admin. Cancelar ⇒ `active:false` ⇒ `abortActiveRun()` ⇒ el
`AbortController` corta entre peticiones.

**El reclamo es con token, no con `true`** (medido 16-09-2026: con dos pestañas del admin abiertas
las dos leian `claimed:false` a la vez, las dos capturaban las 182 ordenes en paralelo y la que
terminaba primero dejaba a la otra "cancelada"). Cada frame escribe **su token** en `claimed`,
espera `CLAIM_SETTLE_MS` (250 ms), relee y solo sigue si el token sigue siendo el suyo. Si durante
la corrida llega por `storage.onChanged` un run con otro token (`wireAsyncRunLifecycle` ahora pasa
el run a `tickIfActive`), el frame **suelta sin finalizar** (`released`): el que escribio ultimo es
el que corre y el que finaliza. **`activeToken` se fija recien al confirmar**: mientras se espera, el
token del otro frame llega por `storage.onChanged` y no debe hacer soltar (la primera version
soltaba ahi, los DOS cedian y el run quedaba reclamado sin nadie corriendo).

**Latido (`heartbeatAt`, cada `HEARTBEAT_MS` = 5 s):** un content script que arranca (otra pestaña
del admin que navega, o la misma recargada) no puede dar por interrumpido un run solo porque este
reclamado: `reconcileOnInit` solo finaliza si el latido lleva mas de `HEARTBEAT_STALE_MS` (20 s)
sin renovarse, y si estaba fresco vuelve a mirar pasado ese plazo (por si la que recargo era la
dueña). Medido 16-09-2026: navegar una segunda pestaña del admin cortaba la corrida de la primera
con "La pagina se recargo a mitad de la captura". El run guarda `claimedFrom` (la URL de la pestaña
que corre) y lo dice en el registro ("Corriendo desde ..."): **esa pestaña no se navega ni se
cierra** hasta que termine; cualquier otra del admin se puede usar con libertad.

## Donde se va el tiempo (medido el 16-09-2026 contra el admin real, por la VPN)

La corrida es **una ficha por orden**. Cada ficha es la pagina completa del admin y sale por el
tunel de la VPN. Lo que se midio con `benchmark()` y Resource Timing, y que conviene no
re-descubrir:

| Hecho | Numero | Consecuencia |
|---|---|---|
| La ficha pesa **606 KB y viaja SIN comprimir** (`encodedBodySize == decodedBodySize`; tampoco el grid, 433 KB) | 254 KB son el menu del admin antes de `<main>`, 349 KB el contenido, 2 KB despues | No hay nada que cortar por streaming ni con `Range` (el servidor lo ignora: 200 entero) ni con `isAjax=true` (mismo tamano). `Accept-Encoding` lo manda el navegador y el servidor elige identidad |
| El servidor tarda **~4,3 s** en armar una ficha sola | Con 12 a la vez, la espera tope fue 7,2 s | Atiende **en paralelo** (no serializa la sesion), va por **HTTP/2** (sin tope de 6 conexiones) |
| **El tunel satura en ~320 KB/s** | 6 carriles: 330 KB/s; 12 carriles: 313 KB/s, con descargas de hasta 15 s | El techo es **~32 fichas/min** con fichas de 600 KB, se pongan los carriles que se pongan. Entre 4 y 8 rinde lo mismo; por encima solo se alargan las descargas y se acercan al timeout (por eso `DETAIL_TIMEOUT_MS` = 90 s y `CONCURRENCY_WARN` = 10) |
| **Los logs ERP y OSMS vienen embebidos en la ficha** (`.gerp-export-log` con el log completo, `.osms-export-log` con "No Data Found") | Antes se pedian igual: 2 peticiones y ~280 KB mas por orden, y encima a una URL sin `/obsadm` (404 de 141 KB cada una) | Ya no se piden salvo que el contenedor falte (`logsEmbedded`), y la URL se toma absoluta tal como viene |
| La API REST con la sesion del admin | `401 The consumer isn't authorized` (contexto invitado) | Cerrada, como se esperaba por el path de la cookie |

**Corrida real de referencia (14-09-2026, 182 ordenes, 6 carriles, las cuatro casillas):** 3 min
39 s, **49,8 fichas/min**, espera 5,8 s y descarga 1,2 s por ficha, 570 KB por ficha, una peticion
por orden, 0 errores, 0 reintentos, 89 columnas dinamicas; con cuatro pestañas del admin abiertas
y una navegada a mitad de camino. Antes de estos cambios la misma corrida hacia 3 peticiones y
~850 KB por orden (los dos logs iban a un 404 de 141 KB) y no traia ningun campo ERP.

**Lectura:** el limite lo ponen los bytes por el tunel, no el servidor ni esta maquina (parseo
~7 ms por ficha). Lo unico que acelera mas es **bajar bytes por orden** o traer los datos por
otra via (ver Pendientes).

Tres sintomas y como distinguirlos con lo que mide el motor:

| Sintoma | Causa | Que hacer |
|---|---|---|
| Subir "Consultas simultaneas" no cambia las fichas/min y la **espera** crece escalonada | Magento atiende las peticiones de una misma sesion **de a una** | Dejar 2-3 carriles, pedir menos |
| La **descarga** por ficha se estira con los carriles y los KB/s del lote no suben | Ancho de banda del tunel (**el caso real de LG**) | Entre 4 y 8 carriles; el costo es por byte |
| Espera y descarga cortas pero fichas/min bajas | CPU de esta maquina (parseo) o volcado del resultado | Ya se recorta el HTML al `<main>`, el resultado se vuelca por partes y el volcado se espacia solo; revisar `parseMs` |

**Lo que mide el motor** (`order-page.js` → `detail.timing` → `run.stats`): por ficha, `ttfbMs` (desde
que se pide hasta que llega la cabecera: cola del navegador + tunel + lo que tarda el servidor en
armar la pagina), `downloadMs` (bajar el cuerpo), `parseMs`, `logsMs` (las dos pestanas, en
paralelo), `bytes`, `requests` y `retries`. El popup muestra en vivo **fichas/min, la espera y
descarga medias, KB por ficha y cuanto falta**; al terminar queda una linea de resumen en el
registro. Comparar dos corridas con distinta concurrencia es la prueba mas simple: si el ritmo no
cambia, el servidor serializa.

**`benchmark({lanes})`** (debug) es la prueba controlada: pide una ficha sola y despues `lanes` a la
vez, y compara las esperas. Escalonadas (1x, 2x, 3x la base) ⇒ serializa. Ademas devuelve el
Resource Timing del navegador (cola, servidor, descarga, si vino comprimido).

**`restProbe(entityId)`** (debug) comprueba si `/rest/V1/orders/<id>` acepta la sesion del admin.
Respondio 401 el 16-09-2026 (contexto invitado): la cookie del admin va con path `/obsadm` y no
viaja a `/rest/`. Si alguna vez respondiera 200 con JSON, la captura entera podria pasar a REST
(la orden completa en JSON, hasta 200 por consulta).

**Lo que ya se hizo para no gastar de mas:** los logs se leen **de la ficha** y solo se pide una
pestana si su bloque falta (y entonces las que falten, a la vez); el HTML se **recorta a
`<main id="anchor-content">`** antes del DOMParser (fuera queda el menu del admin y sus scripts;
sin marcador se parsea entero); un fallo **transitorio se reintenta una vez** (red, timeout, 5xx,
429; nunca 401/403/404 ni ficha vacia) para no perder la orden por un corte del tunel; el
**volcado del resultado se espacia a medida que crece** (cada volcado reescribe todo: con
intervalo fijo una corrida larga gastaba mas en serializar que en pedir); y el popup **repinta la
tabla como mucho cada 2 s** y, con el perfil corto, matriza solo las filas que muestra.

## Qué se lee de la ficha (`detail-parse.js`)

Cuatro casillas en el popup, todas activas por defecto (`DETAIL_SECTION_CHOICES`):

| Casilla | Qué trae |
|---|---|
| Orden, cuenta y direcciones | `order-information-table` + `order-account-information-table` + las **direcciones completas** de facturación y envío |
| Pago, envío y totales | `.order-payment-method` (título + sus tablas), `.order-shipping-method` y `.order-totals` |
| Historial y transacciones | `.note-list-item` con su fecha y estado, y las notas de Transbank/MercadoPago **decodificadas** |
| Logs ERP / OSMS y facturación | `.gerp-export-log`, `.osms-export-log` y `Full In House Information`. Vienen en la misma ficha; solo se pide una pestaña aparte si su bloque falta |

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
- **El elemento del título del pago ENVUELVE a la tabla de campos** en varias fichas: leerlo entero
  daba `Pago - Metodo` = `"Webpay – … Payment Type Code: VN Transaction Status: …"`, duplicando lo
  que ya sale en su propia columna. Se le sacan las `<table>` antes de leer el texto.
- **El bloque de envío no siempre es una tabla.** Cuando no lo es hay que leer el bloque entero y ahí
  se colaba el rótulo de la sección (`"Shipping & Handling Information Shipping $15.990"`): se
  prefiere `.admin__page-section-item-content` y, si no está, se descarta el título. La etiqueta se
  unifica a `Metodo de envio` (`SHIPPING_LABEL`) vengan los datos en tabla o como texto suelto, para
  que la columna sea siempre la misma.
- **La ficha sin sesión devuelve el login con HTTP 200**, no un 401: si no aparece ni el número de
  orden ni un solo campo, se falla con "puede haber caducado la sesión" en vez de emitir una fila
  vacía.
- **ERP y OSMS Export Log vienen embebidos en la ficha** (`.gerp-export-log` / `.osms-export-log`,
  dentro de `<main>`; medido 16-09-2026). `parseOrderDetail` los lee de ahi y reporta
  `logsEmbedded`; **solo si un contenedor falta** se pide su pestana AJAX (doc §5.5), con la URL
  **tomada del HTML tal como viene** (`TAB_URL_RE` captura el enlace absoluto). Ojo: capturar solo
  desde `/sales/` y resolverlo contra la ficha con `new URL` **perdia el `/obsadm`** y daba un 404
  de 141 KB por pestana y por orden; `absolute()` cuelga una ruta relativa de la base del admin.
  Un log que no se puede traer **no invalida la orden**: se anota el motivo en su propia columna
  (`ERP - Error`) y se sigue.
- **El log del ERP NO es una tabla** (medido 16-09-2026; la primera version lo esperaba en tabla y
  no sacaba nada): es `<h3>ERP Export Log #N</h3>` y pares `<label class="title">X: </label><span>`,
  con el JSON enviado al ERP dentro de un `<textarea>`. `labeledPairs` casa cada label con el
  elemento que le sigue (`ERP - Log`, `ERP - Action Type`, `ERP - Status`, `ERP - Created At`,
  `ERP - Request Body`...). Con mas de un `.gerp-export-log-item` (varios envios) las etiquetas del
  segundo en adelante llevan sufijo ` (2)`. El OSMS sin datos (`<h3>No Data Found</h3>`) sale como
  `OSMS - Log = No Data Found`, para que se vea que se miro. Si el bloque trae tablas se leen
  primero, como antes.
- **Una peticion caida por algo transitorio se reintenta una vez** (`DETAIL_RETRY_ATTEMPTS`, pausa
  `DETAIL_RETRY_DELAY_MS`): fallo de red (`TypeError` de `fetch`), timeout propio
  (`IO_DETAIL_TIMEOUT`, distinto de la cancelacion del usuario), 5xx o 429. Un 401/403/404 o una
  ficha vacia suben a la primera: reintentar no los cambia. Los reintentos se cuentan en `stats`.
- **El HTML de la ficha se recorta a `<main id="anchor-content">`** (`mainContentOf`, `MAIN_CONTENT_RE`)
  antes del DOMParser: el menu del admin y los scripts son buena parte del documento y no traen
  nada de la orden. Si el marcador no aparece se parsea entero, para no perder nada por un recorte
  fallido. Las URLs de las pestanas AJAX se buscan en el HTML **completo**, no en el recorte.
- **`ORDER_FILTER_ERROR` llega con HTTP 200 y `Content-Type: text/html`** (doc §4.4): se detecta por
  el **contenido**, nunca por el status, y se traduce a los tres casos reales (falta el rango, falta
  el Purchase Point, el rango supera 1 mes).
- **Los tres filtros del grid son obligatorios**: rango de `created_at`, `store_id` (Purchase Point)
  y que no pase de un mes. Van siempre, aunque se busque una sola orden. El tope seguro es
  `MAX_RANGE_DAYS = 28` de **diferencia**, o sea **29 dias de calendario** (29 paso, 60 fallo). Los
  rangos mayores se dividen desde la fecha mas reciente en ventanas sin superposicion y se juntan
  antes de capturar las fichas; el popup ya no bloquea el inicio, solo avisa en cuantos bloques va a
  quedar. En modo lista, cada numero se busca por esas ventanas **hasta la primera coincidencia
  exacta**: una orden que aparece en el primer bloque no se busca en los demas.
- **Un bloque no es una corrida aparte:** si falla la pagina 1 de cualquiera de ellos (sesion
  caducada, filtros rechazados) el error sube y corta todo, porque el problema no es de ese bloque.
  Las paginas 2..N si toleran caerse: se avisa cual y se sigue con el resto.
- **Las ordenes repetidas se descartan por `entity_id`** (`collectTargets`): los bloques no se
  superponen, pero el listado se reordena si entran ordenes mientras se pagina, y sin eso la misma
  orden saldria dos veces en el CSV.
- **El tope de la corrida se aplica ANTES de pedir las paginas** (`pendingPages`): con 6000 ordenes
  en el rango se piden las 25 paginas que cubren las primeras 5000, no las 30 del total.
- **La key de las URLs caduca y cambia por sesión.** `resolveGridEndpoint()` la resuelve en runtime:
  del documento actual si la pestaña está en el listado, si no con un `fetch` al listado. Se descartó
  pedírsela al bridge del mundo MAIN: no aporta sobre parsear el HTML, que además funciona fuera del
  listado.
- **El filtro `increment_id` de Magento es "contiene":** en modo lista la fila se **casa exacto**
  localmente. Lo que no aparece sale en el CSV como `No encontrada`, no se descarta en silencio.
- **Una ficha caída no tira el recorrido:** esa orden sale con lo que el grid ya sabía de ella y con
  el motivo del fallo en su fila. Lo mismo con una página del listado.
- **El resultado se vuelca a storage cada tanto y al terminar**, no en cada orden: escribir miles de
  filas por orden sería carísimo, y no volcar nunca perdería todo si se cierra la pestaña. Como cada
  volcado reescribe **todo** el resultado, el intervalo **crece con lo ya guardado**
  (`flushIntervalFor`: 1,5 s + 3 ms por registro, tope 15 s). Una corrida detenida a medias
  conserva lo capturado hasta el ultimo volcado.
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
(`Items`, `Item - SKU`, `Item - Cantidad`…), `Notas` y `Historial`, y al final `Estado captura` y
`Error`.

El encabezado es la **unión estable** de lo que apareció en todas las órdenes, así que dos órdenes
con campos distintos no se corren de columna. `matrixToCsv`: BOM UTF-8, `\r\n`, todo entrecomillado y
`protectFormula` (`'` delante de `=`, `+`, `@`, `-texto`).

### Dos perfiles de columnas

`buildMatrix(records, { allColumns })`. Esa unión son ~130 columnas y para el uso diario se miran
unas 40, así que **por defecto salen solo las de `ESSENTIAL_COLUMNS`**, en ese orden y **siempre las
mismas** aunque la corrida no las traiga todas (una columna sin dato sale vacía, no desaparece): el
archivo tiene la misma forma corrida a corrida y se puede pegar en una plantilla. `Estado captura` y
`Error` van al final en los dos perfiles, para que una orden fallida no quede vacía sin explicación.

Con `allColumns: true` sale la unión completa, como antes — el interruptor **Todas las columnas** del
popup. **No cambia lo capturado:** la captura siempre lee todo lo que las casillas de secciones
pidan, el perfil solo decide qué se pinta y qué se exporta, así que se puede cambiar de opinión
después de correr, sin volver a capturar.

### El resultado en partes (varios CSV)

**El problema:** un volcado reescribe **entero** lo que abarca (`chrome.storage` no sabe de
"agregar"). Con todo el resultado en una sola clave, el costo de cada volcado crece con la corrida
—serializar miles de registros con sus ~130 campos y el historial en JSON— y el popup después lo leía
completo para matrizarlo. Con un rango amplio eso termina cayendo por memoria, que es el síntoma que
originó este cambio.

**La solución:** los registros se cortan en **partes de `partSize` órdenes** (campo *Órdenes por
archivo*, 500 por defecto, entre 50 y 5000). Cada parte es su propia clave y **cada parte es un
archivo CSV**.

- En memoria queda solo la **parte abierta** (la ventana `[partStart, partStart+partSize)`), más las
  fichas en vuelo. `pending` está indexado por el número de orden dentro de la corrida, así que el
  orden del listado no depende de cuál ficha contestó antes.
- Como el pool reparte los índices **en orden**, cuando la ventana está completa ya no puede
  llegarle nada más: la parte se escribe una última vez, se anota en el índice y **se suelta de
  memoria**. Una parte cerrada no se vuelve a escribir.
- Los volcados van **de a uno** (`flush` los encola). Cada carril llama a `flush` al terminar su
  ficha, y dos volcados simultáneos veían la misma ventana abierta con `partStart` sin avanzar: la
  escribían dos veces y cada uno la anotaba como una parte nueva (se vio en los tests: 7 partes de 50
  para 120 órdenes).
- El intervalo entre volcados sigue creciendo con lo que la parte ya tiene escrito
  (`flushIntervalFor`), pero ahora el tope lo pone `partSize`.

**Al exportar** (`popup/section.js`): *Descargar N archivos* recorre las partes y baja una por una
—nunca hay más de una parte en memoria—; *Descargar todo unido* arma un solo archivo con el
encabezado una vez y las filas de cada parte, juntando los pedazos **como partes de un `Blob`** en
vez de concatenar un string gigante. Se baja con `chrome.downloads` (`downloadBlob` en
`magento/popup/utils.js`): bajar varios archivos con clics sintetizados en un `<a>` dispara el aviso
de "descargas múltiples" del navegador y puede perder alguno.

**Por eso la unión de columnas se acumula durante la captura** (`recordColumnKeys` + `mergeColumns`,
guardada en el índice) y no se recalcula al exportar: si cada archivo se armara con la unión de sus
propias filas, dos partes con campos distintos saldrían con encabezados distintos y no se podrían
unir. Con el perfil corto el encabezado ya es fijo (`ESSENTIAL_COLUMNS`), así que no hace falta.

### La copia de respaldo (bajar cada parte al cerrarla)

Casilla **Bajar cada archivo al cerrarlo**. Con 47.000 órdenes la corrida son ~20 h en una sola
pestaña: esperar hasta el final para bajar algo es apostar a que nada la interrumpa. Con la casilla
marcada, cada parte que se cierra se guarda como
`Descargas/magento-ordenes/<sello de la corrida>/parte-001.csv` — numerado con ceros adelante, así el
orden alfabético del explorador es el de captura (`partFileName`). La última parte, a medio llenar,
se baja al terminar (o al cancelar).

**Va por el service worker** (`shared/downloads/`): un content script **no ve `chrome.downloads`**, y
en el service worker **no existe `URL.createObjectURL`** (no está en `ServiceWorkerGlobalScope`), así
que el texto viaja en el mensaje y el SW arma una **data URL en base64** — el mismo camino que ya
usaban `registro-acciones` y `e-promoters`. Medido el 20-09-2026 en Edge: un texto de **6,29 MB (data
URL de 8 MB) se bajó completo**, así que una parte de 500 órdenes entra con holgura. El SW **espera a
que el archivo esté escrito** (`downloads.onChanged` → `complete`) antes de contestar: disparar
decenas de descargas sin esperar puede dejar archivos a medias, que es lo último que debe hacer una
copia de respaldo. Una descarga fallida **no corta la corrida**: queda en el registro y los datos
siguen en la extensión.

**El sello de la corrida es derivado de `startedAt`** (`runStamp`), no aleatorio: el content script y
el popup llegan al mismo nombre sin coordinarse. Los archivos automáticos llevan **las columnas
conocidas al cerrar cada parte**; si una orden posterior trae una columna nueva, los ya bajados no la
tienen (el "Descargar todo unido" del final sí sale homogéneo, porque ahí la unión ya es la de toda
la corrida). Una exportación manual usa su propio sello, así que nunca pisa los archivos automáticos.

**La vista previa sale de la primera parte**, no de todo el resultado: leer y matrizar miles de
registros para mostrar 150 filas era la otra mitad del problema de memoria. *Copiar CSV* sí arma todo
en un string (es lo que el portapapeles necesita), así que a partir de 2000 filas pregunta antes.

### Formato de los valores

La ficha escribe para que la lea una persona, no una planilla. `format.js` (puro, sin DOM) lo
traduce, y **lo que no matchea vuelve tal cual: nunca se pierde el dato**.

- **Importes → número plano.** `"$555.980"` → `555980`. El punto es ambiguo (en CLP es separador de
  miles, la ficha también emite en-US `"$588,565.00"`), así que se decide **por la forma del
  número**, nunca por el locale: con los dos separadores manda el último; con uno solo, repetido o
  con exactamente 3 dígitos detrás es de miles, si no es decimal. Alcanza a toda la sección
  `Totales` (`MONEY_SECTIONS`) y a `Item - Precio` / `Item - Total` (`MONEY_ITEM_COLUMNS`). Esto
  además **evita que Excel los reinterprete**: abría `"$555.980"` y lo guardaba como `$555,98`.
- **Fechas largas → `YYYY-MM-DD HH:mm:ss`.** `"Sep 10, 2026, 07:40:08 PM"` → `2026-09-10 19:40:08`:
  ordenable como texto y sin que Excel adivine el formato. Se aplica a `Orden - Order Date*`
  (`DATE_FIELD_PREFIXES`, por prefijo porque la etiqueta lleva la zona horaria) y a las fechas del
  historial.
- **Lo que trae varios datos → JSON, no separadores.** Así se puede volver a leer sin adivinar dónde
  corta cada valor:
  - `Historial`: array de `{fecha, estado, comentario}`, la nota más nueva primero. El comentario se
    abre a objeto si **ya es JSON** (`{"on_delivery":"complete"}`) o si es una nota de pasarela con
    `Etiqueta: valor` por línea. El tope (`HISTORY_MAX_CHARS`, 8000) **descarta las notas más viejas
    y anota `{omitidas:N}`** — cortar el texto dejaría un JSON inválido.
  - `Item - *` con **más de un producto**: array JSON con **una posición por ítem**, los faltantes
    como `null`. Antes se concatenaba con ` | ` filtrando los vacíos, así que con dos ítems y un solo
    tracking no se sabía de cuál era. Con un solo ítem la celda va pelada.
  - `Item - Envio` (Global Shipping Info) viene aplanado en una línea
    (`Rule Name: X Expected delivery date: N/A ...`) y se abre a objeto con `splitLabeled`, que corta
    por **etiquetas conocidas** (`LABELED_ITEM_COLUMNS`) y no con un regex genérico: los valores
    llevan espacios y mayúsculas (`Envío Normal RM + Pack OMO`) y un regex parte donde no debe.

**Datos personales:** la ficha trae el cliente **sin enmascarar** (nombre y correo completos,
dirección con número, teléfono) — a diferencia de las columnas del grid. El popup lo avisa; trata el
archivo como dato sensible.

## UI popup

Rango Desde/Hasta con aviso de la division automatica en ventanas · radio **Todo el rango / Solo estas ordenes**
(textarea + **Subir CSV**, ambos por el mismo parser) · **Consultas simultaneas**: campo numerico
**sin tope**, 6 por defecto, que se normaliza al salir del campo (vacio o 0 dejarian el pool sin
carriles) y avisa a partir de `CONCURRENCY_WARN` (10) sin bloquear · **Ordenes por archivo**
(`partSize`, 500 por defecto, entre 50 y 5000: en cuantos CSV queda el resultado y cuanto se
reescribe de una sola vez) · casilla **Bajar cada archivo al cerrarlo** (copia de respaldo; el aviso
de arriba dice el ritmo y cuanto tardaria una corrida de 47.000 ordenes) · las cuatro
casillas de secciones con su explicación · Iniciar/Detener/Limpiar · progreso en vivo (contadores y,
debajo, **fichas/min, espera y descarga medias, KB por ficha, reintentos y cuanto falta**) · tabla de
resultados con **la misma matriz que el CSV** (primeras 150 filas, leidas de la PRIMERA parte; se
repinta como mucho cada 2 s) · casilla **Todas las columnas**
(perfil de columnas; se guarda en el borrador y repinta la tabla en el acto) · **Copiar CSV** /
**Descargar N archivos** (uno por parte) / **Descargar todo unido** (aparece solo si hay mas de una
parte) · `<details>` con el registro. Estilos `.io-*` en `popup.css`.

## Debug `__extLgeCl.magentoInformacionDeOrden.`

`diagnose()` · `endpoint()` · `resetEndpoint()` · `probe({from,to})` (cuántas órdenes hay, bloque por bloque si el rango es largo) ·
**`link(orden,{from,to})`** (resuelve el enlace) · **`detail(url|entityId)`** (lee una ficha) ·
**`parseCurrent()`** (parsea la ficha abierta en esta pestaña, sin red) · **`order(orden,{from,to})`**
(enlace + ficha + la fila que saldría en el CSV) · **`benchmark({lanes:4}|{href,lanes})`** (una ficha
sola y N a la vez, con veredicto: ¿el servidor serializa?) · **`restProbe(entityId)`** (¿acepta
`/rest/V1/orders/<id>` la sesion del admin?) · `csv(parte)` / `csv(parte, true)` (matriz de UNA
parte, perfil corto / completo) · `result()` (el indice: partes, total y columnas) · `part(n)`
(los registros de una parte) · `state()` · `draft()` ·
`stop()` · `reset()` · `tick()`.

## Tests

Cuatro archivos, 129 casos. Los dos que tocan DOM usan **happy-dom** (`@vitest-environment happy-dom`),
agregado al proyecto para esto.

- `magento-informacion-de-orden.test.js` — lo puro: fecha y filtros obligatorios del grid, los tres
  `ORDER_FILTER_ERROR`, extracción del JSON y del `update_url`, `stripHtml`/`moneyValue`,
  `normalizePayment` × 6 (Webpay VN y SI, MP pasarela, MP `account_money` con `card: []`, MP
  incrustado, marketplace, método desconocido), `parseOrderNumbers`, `clampConcurrency`,
  `clampPartSize`, **los nombres de archivo** (`runStamp` sin caracteres de ruta y `partFileName` con
  ceros adelante, comprobando que ordenar como texto no desordena las partes), **`slimGridItem`**
  (deja las claves del CSV, tira el ruido, no inventa claves ausentes) y
  `stats.js` (acumulacion inmutable, resumen con ritmo/ETA/promedios, formato de duraciones).
- `magento-informacion-de-orden-ficha.test.js` — el parser de la ficha sobre HTML real: las dos
  tablas de cabecera por etiqueta, direcciones completas, pago y envío, totales con el nombre de la
  promoción, ítems por `tbody`, historial con la nota decodificada, Full In House y log del ERP,
  secciones apagadas, **la ficha de marketplace sin IP ni tabla de pago**, un HTML que no es una
  ficha, el recorte a `<main id="anchor-content">` (y que sin marcador vuelva entero), **el log del ERP
  con el markup real** (labels + textarea, dos envios con sufijo, OSMS "No Data Found", `logsEmbedded`),
  y el CSV en sus dos perfiles (columnas dinámicas, ítems en JSON alineado, historial en
  JSON, dos órdenes con campos distintos que no se corren, una ficha fallida que sale marcada, y que
  el perfil corto emita `ESSENTIAL_COLUMNS` completo aunque falten datos), y **el CSV en partes**
  (que la unión acumulada orden por orden sea la misma que la del CSV armado de una vez, que las
  partes compartan encabezado y unidas den exactamente el archivo completo, y que **sin** la unión
  cada parte saldría con sus propias columnas), y que **una fila del grid recortada
  (`slimGridItem`) da exactamente el mismo registro que la completa**, pago incluido.
- `magento-informacion-de-orden-format.test.js` — `format.js`: la ambigüedad del punto en los
  importes (miles vs decimal, los dos separadores, el signo), las 12 de AM/PM en las fechas,
  `splitLabeled` con valores que llevan espacios, y los tres tipos de comentario del historial.
- `magento-informacion-de-orden-run.test.js` — el motor con `chrome` y `fetch` de mentira: **el orden
  no depende de cual ficha conteste antes**, la paginacion del listado, rangos largos en ambos modos
  (con las ventanas exactas que se piden), **los bloques consultados en paralelo**, **la orden
  repetida que no se duplica**, **las paginas que no se piden por el tope de la corrida**,
  concurrencia mayor a 8 y el tope de carriles respetado, una
  ficha caída, una ficha vacía por sesión caída, una página del listado caída, rango vacío,
  `ORDER_FILTER_ERROR`, los logs AJAX solo si la sección está activa (y que un log inaccesible no
  invalide la orden), **los dos logs pedidos a la vez cuando faltan, ninguno cuando vienen embebidos,
  y la URL absoluta conservada (con `/obsadm`)**, **el reintento** (503 y `TypeError` se
  reintentan una vez, 403 no), **los tiempos por ficha y la linea de resumen** en el registro (sin
  colarse en el registro de la orden), el espaciado del volcado, **el corte en partes** (los cortes
  exactos y cada parte en su clave, la unión de columnas en el índice, que una parte cerrada no se
  vuelva a escribir, el conteo de archivos en el registro y la parte abierta volcada al cancelar),
  **la copia de respaldo** (una descarga por parte cerrada, numerada y en la carpeta de la corrida,
  con el CSV de esa parte; que una descarga fallida no corte la corrida ni pierda datos; y que sin la
  casilla no se pida ninguna), **que el rango no se recorte** (las 30 páginas de 6000 órdenes, con el
  aviso de duración en vez del viejo "primeras 5000"),
  el modo lista con su `not-found`,
  el ciclo de vida (fuera del admin, ya reclamado, cancelar, reconcile) y **dos pestañas a la vez**
  (dos instancias del modulo sobre el mismo storage: solo una captura; y si otro token pisa el
  reclamo a mitad de camino, el frame cede sin marcar el run como cancelado).

## Pendientes / limitaciones

- **Una petición de ~600 KB por orden y un tunel de ~320 KB/s**: el techo es ~32 fichas/min
  (un mes de ~5000 ordenes, unas 2,5 h; 47.000 ordenes, unas 20 h **con la pestaña abierta todo ese
  tiempo** — para eso está la copia de respaldo por archivo). Ni mas carriles ni el servidor lo cambian. Lo unico que
  lo cambiaria es traer los datos por otra via: la REST esta cerrada a la sesion (401), la
  exportacion CSV del grid (doc §4.9) trae las columnas del grid (enmascaradas, sin items ni
  historial), y queda por evaluar el API del VPS (`/api/magento/orders`, ya usado desde otro
  proyecto) si sus campos cubren lo que se necesita de la ficha.
- **Ya no hay tope de órdenes por corrida.** `MAX_ORDERS` (200.000) y `MAX_PAGES` (1000 por bloque)
  son frenos de emergencia para que un filtro que devuelve cualquier cosa no dispare una corrida
  infinita, no topes de uso: pasado `LONG_RUN_WARN_ORDERS` (2000) el registro avisa cuánto va a
  tardar en vez de recortar. Lo que sí sigue en pie es que **la corrida vive en una pestaña**: son
  horas sin cerrarla ni navegarla.
- **Unir las partes arma el archivo completo en el navegador**: es el único paso cuyo costo es el
  tamaño total. Si un resultado enorme no se deja unir, se bajan las partes por separado (el
  encabezado es el mismo en todas, así que se pegan sin retocar).
- El rango es obligatorio; cada consulta cubre hasta 29 dias de calendario y los mayores se
  segmentan solos.
- **En modo lista cada numero se busca bloque por bloque**: con un rango de un año y 100 ordenes eso
  puede ser mas de 1000 consultas al grid. Si se sabe la fecha, conviene acotar el rango.
- No se ejecuta el JS de la página: lo que la ficha arme en el cliente fuera de las pestañas AJAX
  contempladas no se ve.
- Requiere sesión de admin iniciada y una pestaña en el admin; si se cierra a media corrida se
  conserva lo del último volcado (como mucho se pierde `RESULT_FLUSH_MAX_MS` de captura, nunca una
  parte ya cerrada).
- Solo el store view de Chile (`STORE_ID = 123`).
- Con varias pestañas del admin abiertas corre en **una sola** (reclamo con token; ver "Patrón"),
  pero no impide correrlo junto a otro módulo del apartado. El reintento por orden es de un solo
  intento extra.
