# Magento · Stock
Conecta la extension con la **vigilancia de stock de lg.com/cl que ya hace el portal OBS** (repo `obs`): el portal revisa la tienda cada hora (stock, nombre y precio de cada SKU) y registra **alertas** cuando un producto pasa a sin stock, sale de la tienda (deshabilitado o retirado) o entra en poco stock. La extension:

1. **Avisa con notificaciones del sistema** (en Windows, las del centro de notificaciones; `chrome.notifications`) cuando el portal registra alertas nuevas.
2. Da una **revision diaria**: a una hora configurable (Chile) una notificacion con el resumen del estado.
3. Permite **Revisar ahora**: le pide al portal una revision al momento y notifica lo nuevo.
4. Muestra en el popup el estado del portal, las alertas recientes y la **lista de productos** (buscador, filtros, CSV).

**La fuente es solo el portal**: la extension no lee Magento ni el GraphQL de lg.com. Read-only (el unico POST es pedirle al portal una revision). Corre en el **service worker** con alarmas, como [Ventas en vivo](magento-ventas-en-vivo.md); no necesita content script ni pestana abierta.

```
src/features/magento/stock/
├── constants.js        STORAGE_KEYS, MESSAGES, ALARMS, NOTIF (prefijos de ids), TIPOS, ESTADOS, FILTROS, DEFAULTS, LIMITES, API, TOKEN_DEFAULT, timeouts, topes
├── tiempo.js           PURO: hora de Chile con Intl (partesEnZona, instanteDe, proximoDisparo, fechaHoraChile, selloArchivo)
├── api.js              PURO respecto a chrome.*: getStock, getAlertas, leerAlertasDesde (paginacion), postRevisar; errores MST_*; recibe `fetchImpl`
├── ciclo.js            PURO: sondear (primera vez / paginado / filtro / sin repetir / reinicio), revisar (POST + sondeo), armarResumen
├── notificaciones.js   PURO: textos (tituloAlerta, mensajeAlerta), planNotificaciones (<=3 una por alerta, >3 agrupada), avisoPortal, notificacionResumen
├── productos.js        PURO: filtrarProductos, contarPorFiltro, productosACsv, nombreCsv
├── state.js            config / estado / alertas / foto en storage + reducers puros (normalizarConfig, aplicarSondeo, aplicarError, aplicarConsulta, agregarAlertas, marcarVistas, contarNoVistas) + subscribe
├── background/index.js wireStockBackground(): mensajes, alarmas, clic de notificaciones, debug del SW
├── popup/section.js    la vista (+ `contador` para la tarjeta del modulo)
└── debug.js            __extLgeCl.magentoStock.*
src/shared/notifications/index.js   mostrarNotificacion, alClicNotificacion (un solo onClicked, despacho por prefijo), abrirPopup, abrirPestana, nivelDePermiso
```
Cableado: `magento/popup/view.js` (MODULES, `STK`, con `contador`), `magento/debug.js` y `src/background/service-worker.js` (`wireStockBackground()` junto a `wireVentasEnVivoBackground()`). **No** se toca `magento/content/index.js`: no hay content script. Permiso nuevo: `notifications` (justificado en `CLAUDE.md`).

## Que hace
- **Sondeo** (alarma `magento:stock:poll`, cada `intervaloMin`, 15 por defecto, 5-60): `GET /alertas?desde_id=<ultimoIdVisto>&limite=500`. Si llegan `limite` alertas y la ultima es menor que `ultimo_id`, pide la pagina siguiente (`desde_id` = la ultima leida) hasta alcanzarlo (tope 20 paginas; si se corta, `ultimoIdVisto` queda en la ultima leida y el sondeo siguiente sigue de ahi).
  - **La primera vez** (sin `ultimoIdVisto`) pide las ultimas 50, las guarda **como vistas** (para que la lista del popup no arranque vacia), guarda `ultimo_id` y **no notifica**: si no, al activar llegaria una avalancha de alertas viejas. **Activar (START) borra `ultimoIdVisto`**: tras un tiempo apagado tampoco se notifica lo acumulado.
  - Si el portal contesta un `ultimo_id` **menor** que `ultimoIdVisto` (base rehecha), se reinicia a ese id sin notificar.
- **Filtro por tipo** (`notificar: {sin_stock, fuera_de_tienda, poco_stock}`, todos `true`): se **guardan y notifican solo** las de los tipos marcados; las demas se saltan (el `ultimoIdVisto` avanza igual). Antes de notificar se descartan las que ya estan guardadas (por id): asi un *Revisar ahora* y el sondeo siguiente no avisan dos veces lo mismo.
- **Notificaciones**: hasta 3 alertas nuevas → una por alerta, `type:'basic'`: titulo *Sin stock en lg.com/cl* / *Fuera de la tienda* / *Poco stock: quedan N*; mensaje = nombre + `SKU ...`; contexto = antes → ahora y precio. Clic → abre la `url` de la alerta en una pestana nueva (solo `http(s)`) y la marca vista. Mas de 3 → **una sola agrupada** `type:'list'`: *N alertas de stock en lg.com/cl*, mensaje con el conteo por tipo (*4 sin stock, 1 fuera de la tienda, 2 poco stock*), las 5 primeras como items y *y N mas* en el contexto. Clic → `chrome.action.openPopup()` con try/catch (si el navegador no lo deja, no pasa nada). En Windows con notificaciones nativas la lista puede verse recortada (Chrome no muestra todos los items): el conteo va en el mensaje por eso.
- **Resumen diario** (alarma `magento:stock:resumen`, `horaResumen` 09:30 por defecto, hora de Chile, on/off): `GET /stock` + `GET /alertas?limite=500` filtradas a las ultimas 24 h (todos los tipos: es una foto del estado) → notificacion *Revision diaria de stock lg.com/cl* con *En stock · Agotados · Poco stock · Fuera* (y Preventa si hay) y *Alertas 24 h: N (detalle por tipo)*. Si la ultima revision del portal fue error, o `ultima_ok` tiene mas de 3 h (o no existe), el titulo dice *el portal esta atrasado* y el mensaje empieza con *El portal no revisa la tienda desde dd-mm HH:MM.* / *La ultima revision del portal fallo: ...*. Si el portal no responde: *Revision diaria de stock: sin datos* con el error. Tras el disparo se reprograma el del dia siguiente.
- **Revisar ahora** (REVISAR): `POST /revisar` (tarda ~20-40 s; timeout 120 s) y despues un sondeo desde `ultimoIdVisto`, para recoger tambien las alertas del cron que aun no se sondearon; se notifica la union (filtrada, sin repetir) y avanza `ultimoIdVisto`. Si ese sondeo falla, se notifican las de la revision y `ultimoIdVisto` **no** avanza (avanzar a las ids de la revision saltaria las del cron intermedias; el sondeo siguiente las trae y las ya notificadas no se repiten). Al final pide `GET /stock` para refrescar la foto. Sin `ultimoIdVisto` (modulo nunca activado) notifica lo de la revision y toma su id mas alto.
- **Badge: no se usa.** Ventas en vivo (`!`) y Registro de acciones (`REC`/`II`) ya se lo disputan; un tercero lo haria ilegible. La cuenta de alertas sin ver va en la **tarjeta del modulo** (menu de Magento) y dentro del popup.
- Sondeo y *Revisar ahora* van **en fila** en el SW (los dos leen y avanzan `ultimoIdVisto`), y ninguna operacion se solapa consigo misma. Las escrituras de estado/alertas tambien van en fila (`state.js`).

## Alarmas
- `magento:stock:poll` → `periodInMinutes: intervaloMin`. `magento:stock:resumen` → `when` = `proximoDisparo(horaResumen)` (one-shot, se reprograma en cada disparo).
- `proximoDisparo` interpreta la hora en Chile con `Intl` y calcula el desfase **para ese dia**: Chile pasa de -04 a -03 el primer domingo de septiembre a las 00:00 (6-9-2026) y vuelve el primer domingo de abril (5-4-2026). Una hora que no existe el dia del adelanto (00:00-00:59) cae una hora despues; en la hora repetida de abril toma la primera.
- **Reconciliacion** idempotente (`reconciliarAlarmas`) al cablear, en `onStartup`/`onInstalled` y en cada cambio de `magento:stock:config` (`storage.onChanged`): apagado → borra las dos; si el periodo es el mismo no reinicia el sondeo; el resumen solo se recrea si su `scheduledTime` difiere en mas de 1 min del proximo disparo. Si el navegador estuvo cerrado a la hora del resumen, ese dia se salta (no se manda tarde).
- Al levantar el SW se bajan las banderas `sondeando`/`consultando`/`revisando` (si el SW murio a mitad, quedaban prendidas).

## API consumida (portal OBS)
Base por defecto `https://147.93.176.66/api/magento/stock`: el **origen** sale de `API.BASE_URL` de Ventas en vivo (no se repite la IP) y la ruta se agrega. Config `endpoint` (vacio = la por defecto) es la base; de ahi salen `/alertas` y `/revisar`. Token: `config.token` o, vacio, el `API.TOKEN` de `e-promoters/constants.js` (importado, no copiado; `MAGENTO_PA_TOKEN` del portal), en la cabecera `X-Api-Token`. Fechas en ISO 8601 UTC; todo se muestra en hora de Chile (`America/Santiago`).
- `GET /api/magento/stock` → `{revision, ultima_ok, umbral, resumen:{total,en_stock,preventa,agotado,fuera,poco_stock}, productos:[{sku, modelo, nombre, estado:en_stock|preventa|agotado|fuera, comprable, quedan, poco_stock, precio_lista, precio_final, descuento_pct, url, imagen, visto_en, cambio_en}]}` (~420 filas, incluye las `fuera`). Timeout 30 s.
- `GET /api/magento/stock/alertas?desde_id=&limite=1..500` → `{alertas:[{id, revision_id, tipo:sin_stock|fuera_de_tienda|poco_stock, sku, modelo, nombre, antes, ahora, quedan, precio_final, url, creada_en}], ultimo_id, revision}`, orden de id ascendente; sin `desde_id` = las ultimas `limite`. Timeout 30 s.
- `POST /api/magento/stock/revisar` (sin cuerpo) → `201 {revision, alertas}`. Timeout 120 s.
- `Revision = {id, origen:cron|manual|api, estado:ok|error, linea_base, leidos, en_stock, preventa, agotados, fuera, poco_stock, alertas, duracion_ms, mensaje, empezada_en, terminada_en}`.

Errores (`ExtError` con `code`, mismo esquema que `VEV_*`): `MST_401` token malo · `MST_409` revision en curso · `MST_429` throttle (6 por minuto) · `MST_502` la tienda no respondio (trae la `revision` fallida) · `MST_503` el servidor no tiene el token · `MST_HTTP` otro status · `MST_JSON` 2xx sin JSON · `MST_TIMEOUT` · `MST_SIN_TOKEN` · `MST_RED` con la pista del certificado (el portal es una IP con certificado propio: abrir la URL una vez y aceptarlo, como en E-promoters / Ventas en vivo).

**Poco stock** = `quedan <= umbral`, y el umbral lo pone Magento (2): el GraphQL publico solo revela cantidades de 1 o 2. Por eso la UI **no** ofrece un umbral propio: muestra *quedan 1/2* y lo explica en una pista bajo los tipos.

## Estado (`chrome.storage.local`)
- `magento:stock:config` → `{activo, intervaloMin, notificar:{sin_stock, fuera_de_tienda, poco_stock}, resumenActivo, horaResumen:'HH:MM', token, endpoint}`. La escribe el popup (debounce 400 ms) y START/STOP.
- `magento:stock:estado` → `{activo, sondeando, consultando, revisando, ultimoIdVisto, ultimoSondeo, ultimoSondeoOk, ultimaConsulta, revision, ultimaRevisionManual:{ts, ok, alertas, notificadas|error}, ultimoResumen, proximoResumen, notificadas, error, code, status, fase:'sondeo'|'consulta'|'revision'|'resumen', fallosSeguidos}`.
- `magento:stock:alertas` → ultimas 200 alertas guardadas (filtradas por tipo), la mas nueva primero, con `visto` y `recibida_en`.
- `magento:stock:foto` → la ultima respuesta de `GET /stock` normalizada + `consultadaEn` (el popup pinta sin red).
- **Estado, alertas y foto los escribe solo el SW**; el popup pide cambios por mensaje (`MARCAR_VISTAS`...).

Mensajes popup → SW (`magento:stock:*`): `start` (con la config del form), `stop`, `consultar` (GET /stock), `revisar` (POST /revisar), `probar-notificacion`, `marcar-vistas` (`ids` opcional). Responden `{ok, ...}` / `{ok:false, error|reason}`.

## Popup
Interruptor **Activo** (START/STOP), *Consultar cada (minutos)*, *Resumen diario (hora Chile)* (`<input type="time">`) + casilla on/off, chips de **tipos a avisar**, pista del umbral de Magento, *Conexion* plegada (token password, URL del portal). La config se guarda sola. Botones **Revisar ahora** (muestra *Revisando...* mientras `estado.revisando`), **Actualizar** (GET /stock) y **Probar notificacion** (si no aparece, dice donde mirar en Windows). Al abrir, si no hay foto o tiene mas de 15 min, pide una consulta sin bloquear.
Estado: ultima consulta, ultima revision del portal (hora Chile · ok/con error · origen), ultima revision ok, contadores del resumen, ultimo sondeo, proximo resumen, ultimo *Revisar ahora*; avisos de error, de portal atrasado y el `mensaje` de la revision.
**Alertas recientes**: chip del tipo con color, nombre, SKU, antes → ahora (quedan N, precio), hora Chile y *Ver ficha*; las no vistas resaltadas; 20 a la vista y el resto plegado; boton **Marcar vistas**.
**Productos**: buscador (nombre/SKU/modelo, sin tildes ni mayusculas, varias palabras = todas), filtros *Todos / En stock / Preventa / Agotado / Poco stock / Fuera* con su conteo, tabla compacta (estado, producto + SKU con enlace a la ficha, quedan, precio final con `formatClp`) y **Exportar CSV** de lo filtrado (`requestDownload` de `shared/downloads`; BOM, todas las celdas entre comillas, `,`, formulas protegidas, fechas en hora de Chile; `stock-lgcom[-filtro]-YYYYMMDD-HHMM.csv`). Todo pasa por `escapeHtml` y solo se pintan enlaces `http(s)`.

## Debug `__extLgeCl.magentoStock.*`
En el content script / popup (via `magento/debug.js`) y en el **service worker** (Service Worker → Inspect), donde `consultar`/`revisar`/`notificarPrueba` corren directo y se suman `sondeo()` y `resumen()`.
- `estado()`, `config()`, `alertas()`, `foto()`.
- `consultar()` → GET /stock ahora. `revisar()` → POST /revisar + notificar. `notificarPrueba()` → notificacion de prueba (`{ok, id, permiso}`).
- `reset()` → borra estado, alertas y foto (no la config): el proximo sondeo vuelve a ser "primera vez".
- Solo SW: `sondeo()` (un GET /alertas ahora), `resumen()` (la notificacion del resumen ahora).

## Tests
`tests/unit/magento-stock.test.js` (50): normalizacion de config (limites, `notificar` parcial, hora), URLs a partir de la base; sondeo: primera vez sin notificar (sin `desde_id`, `limite=50`), sin alertas, `desde_id`, sin nuevas, paginacion 500+150 hasta `ultimo_id`, tope de paginas, duplicados, filtro por tipo, sin repetir lo guardado, reinicio, error; *Revisar ahora*: union POST + sondeo, sondeo fallido (no avanza), sin `ultimoIdVisto`, 409/502 (con revision); errores 401/409/429/502/503/500, red (pista del certificado), 2xx sin JSON, sin token, timeout de 30 s con `vi.useFakeTimers`, normalizacion de la foto; textos por tipo, <=3 individuales, >3 agrupada (lista, conteo, *y N mas*); `proximoDisparo` (hoy/manana, a la hora exacta, tarde en Chile = otro dia en UTC, **6-9-2026** y **5-4-2026**, hora inexistente), `fechaHoraChile`; resumen al dia / atrasado / revision con error / sin foto; reducers de alertas y estado; filtro, conteo y busqueda de productos; CSV (BOM, cabecera, comillas, coma, formula, `;`) y nombre del archivo.

## Pendientes
- **Probar contra el portal real** cuando la API este desplegada (`GET /stock`, `/alertas`, `POST /revisar`): ver que el certificado del portal ya este aceptado en el navegador, que `revisar` entre en 120 s y el peso de la foto (~420 filas).
- **Medir las notificaciones en Windows** (Edge y Chrome): que aparezcan con *No molestar* apagado, como se ven `contextMessage` y la `type:'list'`, y si `chrome.action.openPopup()` funciona desde el clic (Chrome 127+; si no, el clic de la agrupada no hace nada).
- Si el navegador estuvo cerrado a la hora del resumen, ese dia no se manda: si molesta, mandarlo al arrancar cuando `ultimoResumen` sea de otro dia.
