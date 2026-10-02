# Magento · Ventas en vivo
Cada pocos minutos pide al admin de Magento el **export CSV estandar del grid de ordenes** (el mismo boton *Export → CSV* que se usa a mano), filtrado por fecha de creacion, y lo **manda tal cual al portal OBS**. Con eso el panel **En vivo** de Ventas del portal muestra las ordenes de lg.com/cl casi al momento. Read-only contra las ordenes; lo unico que escribe en Magento es el borrado (opcional) del archivo de export que el mismo ciclo genero.

En esta instancia (Adobe Commerce 2.4.5-p16) **el export es asincrono**: el GET a `gridToCsv` solo lo encola y el archivo aparece segundos despues en *Export Files Listing* (modulo propio de LG, `lg_order_export`). Medido contra el admin real el 01-10-2026; detalle abajo.

```
src/features/magento/ventas-en-vivo/
├── constants.js      STORAGE_KEYS, MESSAGES, ALARM, DEFAULTS, LIMITES, API, TOKEN_DEFAULT, EXPORT_URL_RE, EXPORT_LIST_URL_RE, ENCOLADO_RE, timeouts, HISTORIAL_MAX, MAX_FALLOS_BADGE
├── state.js          config / estado / historial en storage + reducers puros (normalizarConfig, aplicarResultado, entradaHistorial, pushHistorial) + subscribe
├── export-url.js     PURO: extractExportUrl, extractExportListUrl, buildExportUrl, isEncolado, mensajeErrorAdmin, extractFormKey, isLoginPage, looksLikeOrdersCsv, contarFilasCsv, rangoDeDias (hora de Chile)
├── export-list.js    PURO: parseExportItems (archivos de Export Files Listing), maxIdDe, pickNuevo, estadoDe
├── ciclo.js          PURO respecto a chrome.*: obtenerCsv (mitad Magento) + enviarAlPortal (mitad portal) + borrarArchivo = correrCiclo; la red entra por `fetchImpl` y la pausa por `sleep`
├── background/index.js  wireVentasEnVivoBackground(): mensajes START/STOP/TICK_NOW, alarma, tick(), fallback por pestana (TICK + BORRAR), badge
├── content/index.js  initVentasEnVivo(): en una pestana del admin atiende TICK (saca el CSV con el fetch de la pagina) y BORRAR (borra el archivo)
├── popup/section.js  interruptor, config, estado en vivo, Enviar ahora, historial
└── debug.js          __extLgeCl.magentoVentasEnVivo.* (content y service worker)
```
Cableado: `magento/popup/view.js` (MODULES, `VEV`), `magento/debug.js`, `magento/content/index.js` y `src/background/service-worker.js`.

## Que manda y cada cuanto
- **Alarma** `magento:ventas-en-vivo:tick` cada `intervaloMin` (5 por defecto, 1-60). Al activar se corre un tick en el acto.
- **Rango**: cada tick cubre `diasCortos` dias contados en Chile (2: hoy y ayer) **y el `to` del filtro es manana**: el filtro `created_at` del grid se interpreta en la zona de Magento, que es Europe/London (medido el 01-10-2026), asi que una orden de las 20:30 de Chile ya es del dia siguiente para Magento y con `to = hoy` quedaba fuera hasta el otro dia. Por lo mismo, `Local Time` y `Purchase Date` del CSV vienen en hora de Londres; es el portal quien las convierte a Chile al ingerir. El **primer** tick tras activar y uno de cada `cadaNTicksLargo` (12 → una vez por hora con 5 min) es un **repaso** de `diasLargos` dias (7), para recoger cambios de estado de ordenes mas viejas. Las fechas se calculan en **hora de Chile** (`America/Santiago`, con `Intl`; nunca `toISOString()`, que a las 21:00 de Chile ya es el dia siguiente). Tope 28 dias (el grid de LG rechaza rangos de mas de un mes).
- **CSV vacio** (solo cabecera, sin ordenes en el rango): no se manda (el portal contestaria 422) y cuenta como ok "sin ordenes"; el archivo del admin igual se borra.
- Los ticks no se solapan (si la alarma llega con uno en vuelo, se reusa ese).

## El export (asincrono, medido el 01-10-2026)
`obtenerCsv` hace estos pasos con el `fetch` que le pasen (`credentials:'include'`):

1. **Resolver** — `GET <adminBase>/sales/order/index/`. De ese mismo HTML salen las tres cosas, y se guardan juntas **en memoria del SW** (`cache = {exportUrl, listUrl, formKey}`; se pierde cuando el SW se duerme y se vuelve a resolver):
   - **URL del export**: config del boton Export del ui component, dentro de un `<script type="text/x-magento-init">`: `export_button` → `config.options.cvs.url` = `https://shop.lg.com/obsadm/mui/export/gridToCsv/key/<K>/` (barras escapadas `\/`). `extractExportUrl` recorre los JSON de esos scripts (reusa `magentoInitPayloads` de `informacion_de_orden/grid-parse.js`) y, si no, busca en el HTML crudo des-escapado.
   - **URL de Export Files Listing**: esta en el **menu lateral** de cualquier pagina del admin: `lg_order_export\/export\/index\/key\/<hex>\/` escapada dentro de JSON, o suelta en un `href`. `extractExportListUrl` des-escapa `\/`, prefiere la que trae `/key/` y completa un href relativo con el origen del admin.
   - **form_key** (`window.FORM_KEY`), para el borrado.
2. **Foto de la lista** — `GET` de Export Files Listing y `maxId` = el mayor `id` presente (0 si no hay).
3. **Encolar** — `GET gridToCsv/key/<K>/?filters[placeholder]=true&filters[store_id][]=123&filters[created_at][from]=10/01/2026&filters[created_at][to]=10/01/2026&search=&namespace=sales_order_grid&selected=false` (`buildExportUrl`: los parametros y el orden del boton real; fechas en el formato del datepicker del grid, `M/DD/YYYY`, con `toGridDate` de Informacion de Orden). La respuesta es un **302 al listado de ordenes** (`/sales/order/index/key/<K2>/`, ~430 KB) con el mensaje de exito *"Message is added to queue, wait to get your file soon"*: con `redirect:'follow'` queda `res.redirected === true` y `res.url` en `/sales/order/index/`. `isEncolado` acepta el texto, o la redireccion al listado sin un mensaje de error del admin (`data-ui-id="messages-message-error"`, que se usa para el error legible).
   - **`filters[store_id][]` es obligatorio**: sin el, el servidor contesta **500** (HTML *"There has been an error processing your request"*). Por eso el default es `STORE_ID` (`'123'`, Chile Default Store View) y una config con Store ID vacio (las viejas) se normaliza a 123. Un 500 da `VEV_ENCOLAR_HTTP` con el Store ID usado en el mensaje. No hay reintento con otra tienda (con el default el 500 no ocurre; si alguien configura una tienda invalida, el mensaje lo dice).
4. **Esperar el archivo** — lo procesa una cola del servidor en 1-2 s. Se sondea la lista: primer sondeo a los `esperaArchivoMs` (2000), luego cada 2000 ms, con tope `esperaArchivoMaxMs` (120000). Nuestro archivo es el **primer item con `id > maxId` y `type === 'order'`** (`pickNuevo`; hay otros tipos, p. ej. `pto_v2`, que se ignoran). Con `status === 'success'` se sigue; con un status de fallo (`error`, `failed`, `canceled`...) → `VEV_EXPORT_FALLO`; `pending`/`processing` → se sigue esperando; agotado el tope → `VEV_EXPORT_TIMEOUT` (*"el export no aparecio en N s"*).
5. **Descargar** — `GET` de `actions.view.href` → 200, `application/octet-stream`, `content-disposition: attachment; filename="order_...csv"`, cuerpo = el CSV de **125 columnas, sin BOM**, cabecera `ID,"Purchase Point","Bill-to Name",...` (~2,3 s). Los campos entrecomillados pueden traer saltos de linea: las filas se cuentan con `contarFilasCsv` (respeta comillas), no por lineas. Se valida con `looksLikeOrdersCsv`; si no es CSV el archivo **queda** en el admin para revisarlo.
6. **Borrar** (si `borrarArchivo`, default `true`) — `actions.delete.href` es **POST** (`"post":true`) con `form_key=<FORM_KEY>` en `application/x-www-form-urlencoded`. Solo se borra el archivo que este ciclo identifico como suyo, **despues del POST al portal, salga como salga** (el siguiente tick exporta de nuevo, no hace falta guardarlo para reintentar). Un fallo al borrar **no** hace fallar el ciclo: queda en `borrado:false` + `errorBorrado` (historial y popup).

### Lista de exports (`export-list.js`)
Los archivos vienen embebidos en el HTML de Export Files Listing como JSON escapado (data provider de un UI grid), un objeto por archivo:
```
{"id":"517903","type":"order","status":"success","file_path":"order_eduardo.niquin_26_10_01_20_59_15_1790888355.9335.csv","user_id":"7524","notified":"1","id_link":"1790888322.02","export_time":"2026-10-01 21:59:16","start_time":"2026-10-01 20:58:42","actions":{"view":{"href":"https:\/\/shop.lg.com\/obsadm\/lg_order_export\/export_file\/download\/id\/517903\/key\/bfe5...\/","label":"Download"},"delete":{"href":"https:\/\/shop.lg.com\/obsadm\/lg_order_export\/export_file\/delete\/id\/517903\/key\/fe02...\/","label":"Delete","confirm":{...},"post":true}}}
```
`parseExportItems` des-escapa `\/`, ubica cada `{"id":"<n>",`, recorta el objeto contando llaves (respetando strings) y lo parsea con `JSON.parse`, asi no depende del orden de las demas claves; deduplica por id y, si no encuentra nada y las comillas tambien vienen escapadas (`\"`), reintenta des-escapandolas. Devuelve `{id:number, type, status (minusculas), file_path, export_time, start_time, downloadUrl, deleteUrl}` ordenados por id. `status` va en minusculas; los `id` son enteros crecientes; la lista es la del usuario de la sesion (14 archivos el dia de la medicion, una sola pagina).

### Cache vencida
Si la lista de la cache no termina en `lg_order_export/export/index` (una key de otra sesion redirige al dashboard) o el encolado no se confirma con URLs de cache, se resuelve de nuevo **una vez** y se repite desde la foto de la lista. Login en cualquier paso (listado, lista, encolado, sondeo, descarga) → `sesion_caducada`.

### Tiempos
Timeouts por pedido: listado 30 s, lista 30 s, encolar 60 s, descarga 120 s, borrado 30 s, portal 120 s. En el SW la pausa entre sondeos (`swSleep`) toca `chrome.runtime.getPlatformInfo()` al despertar: eso reinicia el contador de inactividad del service worker (Chrome 110+), asi no se duerme a mitad de la espera.

## Que hace el portal con ello
`POST https://147.93.176.66/api/magento/detalle-ordenes/import` con `X-Api-Token: <token>`, `Content-Type: text/csv` y el CSV como cuerpo. Vive en el repo **`obs`** (subsistema DetalleOrdenes): ingesta el CSV igual que el que se sube en *Configuracion → Ordenes* y alimenta `detalle_ordenes*` (canal obs), que es de donde lee el panel En vivo. Respuestas:
- **201** `{ok, carga:{id, estado, filas_leidas, creadas, actualizadas, omitidas, duracion_ms}, hasta}` → ok; `hasta` = la orden mas nueva que tiene el portal ("Datos del portal hasta" en el popup).
- **401** token malo · **422** `{error, message}` (CSV vacio o sin columna `ID`) · **503** el servidor no tiene el token configurado. Cada uno con su mensaje y code (`VEV_PORTAL_401/422/503`, `VEV_PORTAL_HTTP`).
- Error de red → `VEV_RED` con la pista del certificado: el portal es una IP con certificado propio; si el navegador lo rechaza, abrir la URL una vez y aceptarlo (mismo caso que E-promoters).

Token: por defecto el `API.TOKEN` de `e-promoters/constants.js` (importado, no copiado; es el `MAGENTO_PA_TOKEN` del portal), sobreescribible en el popup.

## Sesion caducada y fallback por pestana
El tick corre en el **service worker** con su propio `fetch` (`credentials:'include'`). Si ve el login (la sesion caduco, o porque el fetch del SW no lleva la cookie: **sin medir**), busca pestanas del admin (`chrome.tabs.query({url:['*://*/*obsadm*']})` filtradas por `ADMIN_BASE_RE`; no hace falta el permiso `tabs`, alcanza `<all_urls>`), la activa / la mas reciente primero, y les manda `TICK` (`frameId:0`; se espera `PESTANA_TIMEOUT_MS` (240 s) + `esperaArchivoMaxMs`). El content script de esa pestana corre **solo la mitad Magento** (`obtenerCsv`, con el fetch de la pagina y la base del admin de esa pestana) y devuelve el CSV, el archivo y su cache (con el `form_key`); el **POST al portal lo hace igual el SW** (`terminarEnvio`), porque desde el content script el fetch sale con el origen de la pagina y el portal no responde CORS. Despues del POST el SW manda **`BORRAR`** a esa misma pestana (`{archivo, formKey}`) y el content script corre `borrarArchivo` (POST same-origin: funciona). Decision: **el borrado es de la mitad Magento**, lo corre quien tiene la sesion del admin (el SW en `correrCiclo`; la pestana a pedido del SW), siempre despues del POST al portal. Si ninguna pestana responde o todas ven el login: `sesion_caducada`, con aviso en el popup ("abre el admin e inicia sesion").

**Badge**: `!` rojo con la sesion caducada o tras `MAX_FALLOS_BADGE` (3) fallos seguidos; se limpia con el siguiente ok o al apagar. Solo se limpia si el badge es el propio (`!`): Registro de acciones usa el mismo badge (`REC`/`II`) y al terminar su grabacion lo deja vacio, aunque el `!` vuelve en el siguiente tick fallido.

## Estado (`chrome.storage.local`)
- `magento:ventas-en-vivo:config` → `{activo, intervaloMin, diasCortos, diasLargos, cadaNTicksLargo, storeId, borrarArchivo, esperaArchivoMs, esperaArchivoMaxMs, adminBase, token, endpoint}` (`token`/`endpoint` vacios = los por defecto; `storeId` vacio = `123`; `esperaArchivoMs` 500-30000, `esperaArchivoMaxMs` 10000-600000). El SW escucha sus cambios y recrea la alarma (idempotente: si el periodo no cambio no la reinicia). Tambien la reconcilia al arrancar (`onStartup`/`onInstalled` y al cablear), porque las alarmas pueden no sobrevivir a un reinicio del navegador.
- `magento:ventas-en-vivo:estado` → `{activo, enCurso, ultimaCorrida, ultimoOk, resultado, filasEnviadas, creadas, actualizadas, omitidas, hasta, rango, error, sesionCaducada, fallosSeguidos, via:'sw'|'tab', tickN, archivo:{id, nombre, export_time}, archivoBorrado}`. **Solo lo escribe el SW.** Del archivo no se guardan las URLs (llevan la key de la sesion).
- `magento:ventas-en-vivo:historial` → ultimas 50 corridas (la mas nueva primero), sin el CSV ni el `form_key`; con `archivo` (nombre), `borrado` y `errorBorrado`.

## Popup
Interruptor **Activo** (manda START/STOP al SW, que guarda `activo` y crea/borra la alarma), intervalo, dias por envio, dias del repaso y cada cuantos envios; **Store ID** (visible, 123 por defecto), **espera del archivo** (en segundos; se guarda en ms) y la casilla **"Borrar el archivo del admin tras enviarlo"**; en *Conexion*: token (password), URL del portal y base del admin. La config se guarda sola al editar (debounce 400 ms). Estado en vivo por `storage.onChanged`: ultima corrida, ultimo ok, rango, filas / creadas / actualizadas / omitidas, "datos del portal hasta", **ultimo archivo** (nombre + borrado / no se pudo borrar), fallos seguidos y el aviso de error o de sesion caducada. En el historial, un ok cuyo archivo no se pudo borrar sale como aviso. **Enviar ahora** (TICK_NOW) y el historial (10 a la vista, el resto plegado).

## Debug `__extLgeCl.magentoVentasEnVivo.*`
Existe en el content script (pestana del admin) y en el **service worker** (Service Worker → Inspect).
- `estado()`, `config()`, `historial()`.
- `tick()` → en el SW corre el ciclo directo; en otros contextos lo pide al SW (TICK_NOW). Devuelve el resultado (sin el CSV).
- `probe(adminBase?)` → GET del listado **con el fetch de ese contexto**: `{status, urlFinal, bytes, login, exportUrl, listUrl, formKey}`. Corrido en el SW responde la duda abierta (si su fetch lleva la cookie del admin): `login:false` y `exportUrl` con valor = si.
- `exportUrl(adminBase?)` → solo la URL (o null).
- `exportSeco({rango:'corto'|'largo'})` → encola el export, espera el archivo y lo baja con el fetch de ese contexto **sin mandarlo al portal**: filas, bytes, rango, `archivo`, cabecera; si `borrarArchivo`, ademas lo borra (`borrado`).
- `reset()` → borra estado e historial (no la config).

**Probar**: abrir el admin y loguearse; en el SW `__extLgeCl.magentoVentasEnVivo.probe()` y `exportSeco()`; luego `tick()` y ver el `estado()` / el popup; en el portal, la carga en *Configuracion → Ordenes* y el panel En vivo.

## Tests
`tests/unit/magento-ventas-en-vivo.test.js`: extraccion de la URL del export (JSON escapado del x-magento-init y URL suelta) y de la de Export Files Listing (escapada, href absoluto y relativo, preferencia por la que trae key), consulta exacta (orden de parametros, `selected=false`, tienda obligatoria), `isEncolado` (texto, redireccion, error del admin, login), `parseExportItems` sobre fixtures sinteticas con el JSON escapado (varios items, uno `pto_v2`, uno `pending`, claves desordenadas, duplicados, comillas escapadas), `maxIdDe`/`pickNuevo`/`estadoDe`, login, CSV (BOM, `;`, HTML, saltos de linea entre comillas), rango en hora de Chile, y `correrCiclo` con un fetch falso que simula la secuencia completa (listado → lista → encolar redirigido → lista sin archivo → pendiente → listo → descarga → portal 201 → borrado) mas: 500 al encolar, encolado rechazado con mensaje, login en listado / lista / sondeo, tope de espera (con `sleep` inyectado y con `vi.useFakeTimers`), archivo con status de error, export nuevo de otro tipo, portal 401/422/503/500 (con 422 igual se borra), fallo al borrar (HTTP y red), `borrarArchivo:false`, CSV vacio, descarga que no es CSV, cache vigente y vencida, sin URL de la lista, error de red, fetch del portal aparte; y los reducers del estado.

## Pendientes
- **Medir si el `fetch` del service worker lleva la cookie del admin** (`probe()` en el SW). Si no la lleva, todo ira por la pestana: funciona, pero entonces si hace falta tener una pestana del admin abierta.
- Medir el export de 7 dias (repaso): cuanto tarda la cola en dejar el archivo y su peso por la VPN/tunel (tope de espera 120 s; descarga 120 s).
- Si el usuario exporta a mano a la vez que un tick, `pickNuevo` toma el primer export de ordenes posterior a la foto, que podria ser el manual (mismo grid, otro filtro). Con el intervalo de 5 min es improbable; si molesta, distinguir por `start_time`.
