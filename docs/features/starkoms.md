# Starkoms
Sitio **app.starkoms.com** (sistema logístico/despacho, **SPA Vuetify con hash routing**). Sub-sección: **Verificar órdenes y stock** (estructura tabbed lista para más).

**A diferencia de Magento (Lead Times/Cupones):** la SPA navega por hash (`#/...`) **sin recargar** → el flujo async sobrevive entre rutas. Por eso usa el **patrón de Colocar TAGs** (storage-driven con flujo async continuo + `AbortController`), NO el tick-por-reload de Cupones/Lead Times.

```
src/features/starkoms/
├── constants.js   HOST, STORAGE_KEYS, ROUTES (+builders), ROUTE_RE, PAGE_TYPE, STATUS, STEPS, TEXTS, SELECTORS, DEFAULTS, MESSAGES, LOG_CAP
├── state.js       getRun/setRun/clearRun/updateRun(writeChain)/appendLog/makeRun/subscribeToRun + get/setLastConfig
├── debug.js
├── content/ detector.js · parser.js · index.js · vuetify/{select,toast,dialog,datatable,buttons}.js · flows/{navigate,orders,stock,order-state,run}.js
└── popup/   view.js (sección única) · utils.js · run-ui.js · sections/verify.js
```

**Estado (`chrome.storage.local["starkoms:run"]`):** `{ active, claimed, startedAt, finishedAt, finishReason?, errorReason?, config:{bodega,stockValue,verifyExistence,dryRun,limit}, total, currentIndex, items:[{ orderNumber, reference, status, step?, detail?, reason?, products:[{sku,action,stock?,reason?}] }], log:[...] (cap 400) }`.

**Detección (`detector.js`):** host `app.starkoms.com` + `location.hash` contra `ROUTE_RE` (más específicas primero): STOCK_EDIT → INVENTORY_PRODUCT → INVENTORY_LIST → PRODUCTS → ORDER_DETAIL → ORDERS_LIST. `detectPage()` extrae `sku`/`bodegaId`/`orderNumber` del hash.

**Rutas:** `#/ordenes`, `#/ordenes/<#orden>`, `#/productos`, `#/inventario/stock/productos`, `#/inventario/stock/productos/<SKU>`, `#/inventario/stock/productos/<SKU>/<bodegaId>`. `navigate.js#gotoRoute(hash,{ready})` setea `location.hash` y espera el DOM destino.

**Flujo del batch (`flows/run.js`, espejo de colocar-tags/runner.js):** el popup escribe el run; el top frame de Starkoms lo **reclama** (`claimed`) y ejecuta todo como un flujo async continuo. Por orden On Hold (Fuera de Stock): (1) `openOrder` → leer productos; (2) por producto, `checkStock` (click botón SKU → toast Bodega/Stock); (3) sin stock → opcional `verifyExists` (`#/productos`) → `remediateStock`; (4) `setOrderState` → "Cambiar estado" → diálogo "Estado del pedido"="Ingresado" → "Guardar" → FAB de persistir. **Si un producto no existe** → orden NOT_FOUND (no cambia estado; crear a mano). `reconcileOnInit` marca interrumpido si un F5 mató un run reclamado. `claimWatchdog` (3s): pestaña no-Starkoms → `not-detected`. Cancelación: popup `active=false` → `abortActiveRun()`.

**`remediateStock` (clave):** el deep-link directo a `#/inventario/stock/productos/<SKU>` **NO carga las bodegas** (SPA: el route param no dispara el fetch). Hay que replicar el flujo manual con **clicks reales**: (1) ir al **listado** `#/inventario/stock/productos` y **buscar** el SKU (input + botón "Buscar"); (2) click en el ojo de Acciones del producto (`a[href$="/<SKU>"]`, sin bodegaId) → página del producto (ahí sí cargan las bodegas); (3) click en el ojo de la bodega (`.../<SKU>/<bodegaId>`) → form "Actualizar Stock"; (4) setear Cantidad (`input[type=number]`) + asegurar "Bodega TO" + "Guardar". La bodega se ubica por nombre (fallback: única fila). Las páginas con buscador (`#/productos`, listado de inventario) y el detalle de orden (`#/ordenes/<n>`) **sí** cargan por deep-link; las sub-páginas producto-específicas NO.

**Helpers Vuetify (ids dinámicos → matching por estructura/texto):**
- `select.js`: `findSelectByLabel` (label interno o span hermano) + `selectOption` (abre slot, menú teleportado por `aria-owns="list-XXXX"` con fallback `.menuable__content__active`, elige `.v-list-item` por texto). `SelectOptionNotFoundError` con muestra.
- `toast.js`: `waitToast`/`parseToast` (filas `table tbody tr` → {bodega,stock}) / `stockForBodega` (null = sin stock) / `dismissToast` ("Ok").
- `dialog.js`: `waitDialog`/`waitDialogClosed`/`dialogButton(text)` sobre `.v-dialog--active .v-card__actions`.
- `datatable.js`: `headerIndexMap` (por `aria-label` o texto del th) + `rowCells` (maneja quirk `<td><td>…</td></td>` con `:scope > td`).
- `buttons.js`: `findButtonByText` (por `.v-btn__content`) + `findFabSave` (`v-btn--fab` con `mdi-content-save`).

**Quirks Starkoms:**
- **Grilla de órdenes:** columnas `["", # de orden, Referencia, Email, Origen, Courier, Tracking, Fecha, Estado, Acciones]`. Estado = texto del `<button>` (las On Hold Fuera de Stock usan `btn-dark`). El `# de orden` (no la Referencia) es el que va en `#/ordenes/<n>`.
- **Bodega fija configurable** (default "Bodega LG Store OBS"); el `bodegaId` se descubre en runtime del href del ojo de Acciones (`.../<SKU>/<id>`), no se hardcodea. Se ubica la fila por nombre (`rowText.includes(bodega)`).
- **Doble guardado al cambiar estado:** diálogo "Guardar" + FAB rosa (`mdi-content-save`), según `Pedida.md`.
- **Modo simulación (dryRun):** navega y lee pero NO clickea los "Guardar"/FAB; default OFF, recomendado para la 1ª prueba. + campo "límite de órdenes".

**Debug `__extLgeCl.starkoms.`:** `diagnose()`, `page()`, `selectors()`, `parseOrders()`, `products()`, `warehouses(sku)`, `checkStock(bodega?)`, `verifyExists(sku)`, `remediate({sku,bodega?,value?,dryRun=true})`, `changeState({orderNumber,dryRun=true})`, `runOne({orderNumber,...,dryRun=true})` (1 orden end-to-end), `state()`, `config()`, `stop()`, `reset()`, `tick()`.
**UI popup:** form (bodega, stock, límite, toggles "verificar existencia" + "modo simulación"), Iniciar/Detener/Limpiar, progreso + lista de órdenes + `<details>` 50 logs. Live vía `storage.onChanged`. Persiste config en `starkoms:last-config`.
**Pendientes:** selectores Vuetify a afinar en vivo (menú del v-select, form de stock, secuencia de guardado); no distingue múltiples tabs; sin reintento.
