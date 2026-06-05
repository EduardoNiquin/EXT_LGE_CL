# EXT LGE CL

Extensión Chrome + Edge (Chromium, Manifest V3). Modular, escalable, segura.

## Stack
- **Bundler:** Vite 8 + `vite-plugin-web-extension` (entry points desde el manifest). Dev usa `vite build --watch`, NO `vite dev` (el CSP estricto bloquea el HMR server).
- **Tests:** Vitest 4 (`--passWithNoTests`). **Lint:** ESLint 10 (flat config, `eslint.config.js`).
- **Packaging:** `web-ext` 10 (ZIPs para stores) + scripts propios para instalación corporativa por política.
- **Node:** 22 LTS. **Módulos:** ESM (`"type": "module"`).

## Estructura
```
EXT_LGE_CL/
├── .github/workflows/ci.yml      CI: lint + test + build chrome/edge
├── assets/icons/                 PNG 16/32/48/128 (placeholders)
├── manifests/                    manifest.base.json (MV3 compartido) + .chrome/.edge (overrides)
├── scripts/                      pack-extension / generate-policy / build-installer / install.ps1 / build.js / package.js
├── src/
│   ├── background/service-worker.js   Service worker MV3
│   ├── content/index.js               Content global: debug API + init de features + runSkuBatch
│   ├── popup/                          UI action button (popup.js routing, features.js registro)
│   ├── options/                        Configuración
│   ├── features/<feature-id>/          Una carpeta por feature (ver "Arquitectura de features")
│   └── shared/                         Reutilizable: api/ debug/ messaging/ storage/ utils/logger.js
│       ├── dom/                        wait.js (waitFor/waitForElement/waitForGone/sleep + WaitTimeoutError/WaitAbortedError)
│       │                               events.js (setInputValue/setSelectValue/setChecked/clickEl/findByText)
│       └── log-config/index.js         Cache de scopes habilitados (key `log-config:scopes`)
├── tests/{unit,e2e}/   keys/ (.pem, gitignored)   build/ (gitignored)
├── eslint.config.js  vite.config.js (merge de manifests por --mode)  package.json
└── EXTENSION_INSTALL.md
```
Todas las esperas de `shared/dom` aceptan `AbortSignal`.

## Comandos
```bash
# Dev/build
npm run dev / dev:edge        # build --watch (sin HMR)
npm run build                # ambos → dist/{chrome,edge}/
npm run build:chrome / :edge / :ext   # :ext = build Edge para release
npm run package:chrome / :edge        # ZIPs para stores
npm run lint / npm test
# Release corporativo
npm run version:bump         # +0.1 (X.Y) con rollover en 9: 0.3→0.4→…→0.9→1.0. Sync manifest.base.json + package.json (--set=x.y)
npm run pack:ext             # dist/edge → .crx firmado + extension-id.txt
npm run policy:gen           # build/update.xml + install/uninstall-policy.reg
npm run release:ext          # version:bump + build:ext + pack:ext + policy:gen (bump único, fuente: manifest.base.json)
npm run installer:build      # release:ext + ZIP build/EXT_LGE_CL-installer-<version>.zip
npm run install:ext / uninstall:ext   # importa/revierte .reg (con elevación)
```

## Convenciones
- **Permisos mínimos:** agregar a `manifest.base.json` solo cuando se necesite; justificar.
- **CSP estricto:** `script-src 'self'; object-src 'self'`. Sin eval ni inline scripts. Todo HTML lleva `<meta http-equiv="Content-Security-Policy">`.
- **No llamar `chrome.*` directo desde features:** usar `shared/messaging`, `shared/storage`, `shared/utils/logger`. Si una feature necesita `chrome.*`, evaluar moverlo a `shared/`.
- **Manifests:** cambios comunes en `manifest.base.json`; overrides solo para diferencias reales Chrome/Edge.
- **Logger antes que `console.log`** (respeta nivel global + scope). **Debug API antes que helpers ad-hoc.**
- Assets se referencian desde el manifest como `assets/icons/iconN.png` (relativo a raíz, no a `src/`).
- **Nunca commitear** `keys/`, `*.pem`, `*.crx`, `build/`.

## Arquitectura de features
Cada feature en `src/features/<feature-id>/`:
```
constants.js   IDs de mensajes/puertos (prefijo `<feature-id>:`), selectores, enums
debug.js       comandos auto-registrados en window.__extLgeCl
content/       detector.js (+diagnose) · parser.js · index.js (listener one-shot + onConnect) · drivers/ · flows/
popup/         view.js (sub-router) · utils.js · sections/ (una sub-vista por archivo)
```
**Wiring:**
- Registrar en `src/popup/features.js`: `{ id (kebab-case único), name, description, abbr (2-4 letras), keywords[], render }`.
- `src/content/index.js` importa e inicializa `init()` y `debug.js` de cada feature.
- Comunicación popup↔content vía `chrome.tabs.sendMessage` (helper `shared/messaging/messaging.js`).
- **Multi-frame** (`all_frames: true`): el handler debe diferenciar top vs iframe. Si el frame detecta la pantalla responde sincrónico; si no, espera unos ms y responde con diagnóstico, dando prioridad a otros frames (patrón en `colocar-tags/content/index.js`).

## Comunicación popup ↔ content (features SPA: Colocar TAGs)
- **One-shot:** `chrome.tabs.sendMessage` con `MESSAGES.<NAME>`. Respuesta única.
- **Streaming con cancelación:** `chrome.tabs.connect(tabId, { name: PORTS.<NAME> })`.
  - Popup→content: `{ type:'start', config }` | `{ type:'cancel' }`.
  - Content→popup: `progress {sku,index,total,status,step,detail?,reason?}` | `done` | `cancelled` | `error {reason}`.
  - Cerrar el port aborta el loop (`AbortController` + `port.onDisconnect`).
- Solo el frame que detecta la pantalla acepta `onConnect`; los demás ignoran.
- **Features Magento (Lead Times, Cupones):** comunicación SOLO vía `chrome.storage.local` + `storage.onChanged` (los page reloads cerrarían ports).

## Logs por scope (`Ajustes`)
`logger('foo')` registra el scope `foo`, que aparece en la UI de Ajustes (`features/ajustes`) con toggle individual + "Habilitar/Deshabilitar todos". `log-config/index.js` cachea en memoria y persiste en `chrome.storage.local` (`log-config:scopes`, cross-context vía `storage.onChanged`). `logger.js` chequea `isScopeEnabled(scope)` antes de emitir. Default: todos habilitados.
Scopes: `colocar-tags`, `colocar-tags:product`, `colocar-tags:offer`, `colocar-tags:delivery-remove`, `colocar-tags:combobox`, `lead-times`, `cupones`, `orden-info`, `starkoms`, `lgcom`, `lgcom/popup`, `content`, `debug`, `popup`.

## Debug API (`window.__extLgeCl`)
Existe en content y popup. En DevTools cambiar "JavaScript context" al de la extensión (content scripts viven en isolated world).
Generales: `help()`, `features()`, `log.setLevel('debug'|'info'|'warn'|'error'|'silent')` (persiste en localStorage), `log.getLevel()`, `<feature>.<comando>()`.
Sumar a una feature: crear `features/<feature>/debug.js` → `register('<feature>', {...})` (desde `shared/debug`) → side-effect import desde `content/index.js` y/o `popup/popup.js` → usar helper `cmd(fn, 'descripción')`.

## Popup navegación
`popup.js`: routing simple `renderHome()` ↔ `openFeature(feature)`. Back button en header en vistas de feature; título refleja la vista.

## Estado del proyecto
Scaffolding + CI completos. Pipeline release corporativo (.crx firmado + política + ZIP). Debug API modular + logger persistente. Content multi-frame con resolución de carrera. Capa `shared/dom`. Driver GP1 L-* (modal/messagebox/combobox).
Features: **Colocar TAGs** (Lectura | Tag Delivery | Quitar Delivery | Tag Producto | Tag Oferta), **Lead Times** (Magento), **Cupones** (Quitar Regla de Cupón), **Información de Orden** (Magento), **Starkoms** (Verificar órdenes y stock), **LG.com** (Info de Producto).
⏳ Pendiente: tests en `tests/unit/*.test.js`.

---

## Feature: Colocar TAGs
Pantalla: **Marketing Info Mapping (MIM)** en GP1 (SPA), modal `#dialog2`.

**Detección (`detector.js`):** `isMarketingInfoMappingPage()` verifica `#aform`, `#LblockSearch`, `#tabView`, `#divGrid_stg`. `diagnose()` → `{ detected, missing, selectors, url, title, isTopFrame, iframes, iframeCount }`.

**Parser (`parser.js`):** `parseSearchForm()` (11 campos: site B2C/B2B, super/category/sub, salesModel, modelName, productId, modelStatus, modelType, promotionId, publish). `parseGrid()` detecta tab activa (STG/PROD), lee `tbody tr.L-grid-row`, extrae por fila rowId (clase `L-grid-row-rXXXX`), rowIndex, editIndex (de `onclick="fncModelPopup(N)"`), isSelected, salesModel, modelName, productId, pimSku, super/cat/sub, status, type, publish. Contadores `#mSelectCount`/`#mStgListCount`/`#mProdListCount`.

**Convenciones:** preferir Sales Model con sufijo (ej `24U421A-B.AWHQ`) sobre Model Name. Estados Model: ACTIVE/INACTIVE/DISCONTINUED (interesa ACTIVE).

**`searchProductBySku(sku)`** (común a todos los flows): setea `#productId`, click `#btnSearch-button`, espera fila cuya `.L-grid-col-salesModel` matchee exacto, click su `.L-grid-button` (`fncModelPopup(N)`), espera modal `#dialog2`.

**Mensaje único** `colocar-tags:get-page-data` → `{ ok, data?, reason?, diag? }` (incluye diagnóstico que el popup renderiza en `<details>` si falla).

**Texto messageboxes:** confirm STG/PROD = "all selected rows of information"; success = "successfully saved to STG"/"...to PROD".

### Tag de Delivery — port `colocar-tags:delivery-run`
Popup: `skus[]`, `tagLabel` (default "Despacho Gratis RM"), `beginDay/Time`, `endDay/Time`, `skipProd` (default true). Por SKU: `applyDeliveryTag` marca `#deliveryTagChk`, selecciona tag vía `cb2-button`/`cb2-listbox`, marca `#deliveryTagUseFlag`, `#deliveryTagUserType=ALL`, setea 4 inputs fecha/hora, `formSubmit()` → confirm YES → ack OK. Si `!skipProd`: `formSubmitProd()` + confirm + ack.

### Quitar Tag de Delivery — port `colocar-tags:delivery-remove-run`
Inverso: desactiva. Popup solo `skus[]` + `skipProd`. Por SKU: marca `#deliveryTagChk` (dirty trigger/inclusión), **desmarca** `#deliveryTagUseFlag`, SAVE STG → YES → OK, opcional PROD. NO toca combobox ni fechas. Runner `DELIVERY_REMOVE_RUN`.

### Tag de Producto — port `colocar-tags:product-run`
Popup: `skus[]`, `tags[]` (1-2, cada uno `{category, group, tag, type, beginDay, beginTime, endDay, endTime}`) + `skipProd`. `applyProductTags` en fases:
- **F1 — llenar por fila (1→2) SIN marcar row chk:** `select#productTagCategory<N>` (Product/Promotion) → combobox `#productTagGroup<N>` → combobox `#productTag<N>` → `select#productTag<N>Type` (gradient/solid/line) → `select#useType<N>=ALL` (tomar el visible, el `#productTag<N>UserType` está duplicado en hidden) → `setDateRange` en `#productTag<N>BeginDay/BeginTime/EndDay/EndTime` → marca `#productTag<N>UseFlag`.
- **F2 — re-setear `productTag<N>Type` (1→2):** el handler `productTagCategory2.on('change')` pisa `productTag1Type`; reaplicar el type pedido.
- **F3 — marcar `#productTag<N>Chk` (1→2) con `sleep(150)` entre cada uno:** el row chk es el "commit" que indica fila con data nueva.
- **F4 — dirtyTriggerTag2** (ver quirk). Luego SAVE STG → confirm YES → OK. Si `!skipProd`: SAVE PROD + confirm + ack (GP1 cierra el modal tras el último OK).
Pasos llevan `detail.tagIndex`.

### Tag de Oferta — port `colocar-tags:offer-run`
Pantalla: tabla **"Additional Disclaimer Text"** en el modal MIM. **4 filas fijas** por índice (1=Gift, 2=Discount, 3=Coupon, 4=Truck); el índice determina el tipo, no se parsea texto. DOM por fila N (prefijo `obsAdditionalDisclaimerText`, ver `OFFER_SELECTORS`): `...${N}Chk` (row chk/dirty trigger), `...${N}Flag` (Use), `...${N}Msg` (Description), `...${N}StartDate`/`...${N}EndDate` (datepickers `datePick`, **solo fecha YYYY-MM-DD, sin hora**).
Popup: `skus[]` + ofertas activadas `{index,label,use,description,startDate,endDate}` + `skipProd`. Persiste estado de las 4 ofertas (`colocar-tags:offer:last-config`). `applyOfferTags` por índice: marca row chk (siempre) → Use → Description → `setDateOnlyRange` (variante solo-fecha de `gp1/daterange.js`, mismo sentinel). SAVE STG → YES → OK (con retry "No changes"), opcional PROD. Pasos llevan `detail.offerIndex`/`detail.offerLabel`.
**Validación (`validateOffers`):** si `use` marcado, exige Description+Start+End. Si desmarcado, opcionales. Fechas vía `validateDateRange` (solo fecha, start≤end).

### Quirks GP1 (críticos)
- **Dirty trigger — Producto (`#productTag2Chk`):** marcar solo `#productTag1Chk` + llenar fila 1 NO basta para `formSubmit()` ("No changes were made."). Tocar `#productTag2Chk` (aunque fila 2 vacía) SÍ lo destraba. **Workaround `dirtyTriggerTag2` (F4):** marcar `#productTag2Chk` y **dejarlo marcado** (si ya estaba, OFF→ON; un toggle que vuelve al estado original NO sirve — GP1 compara vs snapshot inicial). GP1 ignora filas con Chk marcado sin tag value → benigno.
- **Dirty trigger — Oferta (idéntico):** marcar el row chk de la fila con data no basta. **Workaround `dirtyTriggerOffers`** (vía `performSave`/`dirtyNudge`, `maxRetries=2`): (1) re-marca OFF→ON el row chk de cada oferta aplicada (inclusión); (2) marca el row chk de una fila **spare** vacía/inactiva (`findSafeSpareRow`) y lo deja marcado (trigger); (3) fallback OFF→ON sobre las aplicadas si no hay spare. Cubre STG y PROD.
- **"No changes were made." + retry (defense in depth):** `performSave` race-detecta el outcome: confirm box → YES→OK; "No changes" → click OK, espera 300ms, **reintenta save una vez**; si persiste → throw. Antes del save: row chk al final (F3), `setChecked` usa `el.click()` nativo (no `dispatchEvent`), `performSave` hace `activeElement.blur()`.
- **Type pisado por handler cat2:** `cat1='Promotion'+cat2='Product'|'Promotion'` → `productTagCategory2.on('change')` (líneas 11691-11713 de Pedida.md) fuerza `productTag1Type`. Por eso F2 reaplica el type al final.
- **Crash benigno al abrir modal sin tags previos:** `offerRetrieveModelBasicInfo.js` hace `tagArray[''][''].forEach` (sin null-check para `category1=''`/`group1=''`) → TypeError. Benigno: los handlers `.on('change')` ya quedaron registrados y el flow re-cascadea los populates.
- **Combobox Product Tag IDs duplicados:** los `<ul role="listbox">` comparten ids (`cb1-listbox`, `cb2-listbox`). `selectComboboxByInput` (`gp1/combobox.js`) resuelve botón y listbox vía `input.closest('.combobox.combobox-list')`, no por id, y espera a que el listbox tenga `<li>` (combos encadenados, populate async).
- **Tags dinámicos, NO hardcodear:** opciones de `productTagGroup<N>`/`productTag<N>`/`cb2-listbox` las puebla el backend por SKU. `commitComboboxSelection` intenta match exacto + case-insensitive y lanza `ComboboxOptionNotFoundError` con muestra. `runSkuBatch` lo atrapa y reporta SKU como ERROR.
- **`keyup` sintético:** `setInputValue` despacha `keyup` como `KeyboardEvent` con `key='Unidentified'` (no printable). Con `Event` genérico, `event.key=undefined` y `ComboboxAutocomplete.onComboboxKeyUp`→`isPrintableCharacter` crashea (`event.key.length`). Síntoma: `#productTagNType` a medio poblar y "No changes were made.".
- **Datepicker orden de rangos (`setDateRange`):** GP1 valida "From≤To" en vivo; si el nuevo `beginDay` es posterior al `endDay` viejo, rebota. `gp1/daterange.js` empuja primero `endDay/endTime` a sentinel `2099-12-31 23:30`, luego setea begin, luego end real. Usado por Delivery y Product.
- **Pre-flight modal:** antes de cada `searchProductBySku`, `ensureCleanModalState()` drena messageboxes (OK/YES/NO hasta 4 veces) y cierra `#dialog2` residual. Si sigue abierto → SKU ERROR `step:'pre-modal-open'` y continúa. Evita la cascada de fallos.
- **Watchdog popup:** `attachPortWatchdog` (`popup/utils.js`) dispara a 12s si el port no recibió mensajes (cubre pestaña no-GP1 / no-MIM).
- **Validación fechas centralizada:** `content/validators.js#validateDateTimeRange` (formato YYYY-MM-DD/HH:MM + semántica begin≤end). Usado por Delivery y Product.
- **Limitaciones (usuario):** si un producto ya tiene 2 tags y se manda 1, el 2° se sobrescribe (del sistema). 2 tags se aplican en orden 1→2.

**Reorg `content/index.js`:** los 4 ports (`DELIVERY_RUN`, `DELIVERY_REMOVE_RUN`, `PRODUCT_RUN`, `OFFER_RUN`) comparten `runSkuBatch`, parametrizado vía `PORT_RUNNERS[port.name].runPerSku` (evita duplicar manejo de SkuNotFoundError/WaitAbortedError/progress).

**Debug `__extLgeCl.colocarTags.`:** `diagnose()`, `check()`, `find(key)`, `iframes()`, `frameInfo()`, `parse()`, `selectors()`, `checkProductTagRow(i)`, `snapshotProductTags()` (console.table de ambas filas — útil para "No changes"), `checkOfferRow(i)`, `snapshotOfferTags()`, `runOffer({sku,offers,skipProd?})`.

---

## Feature: Lead Times (Magento)
Pantalla: **Manage Address Level 2** (`/regional_management/level2/...`). CRUD admin (no SPA): navegaciones full-page entre listing y `Edit Address Level 2`.
```
src/features/lead-times/
├── constants.js   SELECTORS, STORAGE_KEYS, COMUNA_STATUS, REGION_STATUS, PAGE_TYPE, EDIT_URL_RE, TEXTS, DEFAULTS
├── state.js       get/set/clear/update + appendLog (chrome.storage.local)
├── debug.js
├── content/ detector.js · parser.js · index.js · magento/{filters,grid,edit-page}.js · flows/run.js
└── popup/   view.js · utils.js · sections/runner.js
```
**Estado (`chrome.storage.local["lead-times:run"]`):** `{ active, startedAt, finishedAt, finishReason?, currentRegionIndex, queue:[{ regionName, minDays, maxDays, status, error?, totalComunas?, currentComunaIndex?, comunas?:[{ id, code, name, regionName, currentMin, currentMax, editHref, status, error?, previousMin?, previousMax?, savedAt? }] }], log:[{ts,level,message}] (cap 400) }`.

**Detección:** `EDIT_URL_RE` → `edit`+editId; `h1.page-title==='Manage Address Level 2'` → `listing`; resto `other`.

**State machine (`flows/run.js`):** `tickIfActive()` en init (300ms tras montar grid) y en cada `storage.onChanged` del key. Solo top frame; guard `running`.
- **onListing:** (1) comuna en RUNNING (volvimos del edit) → OK. (2) región sin comunas → openFilters/setRegionFilter/applyFilters/collectAllComunas (pagina vía `.action-next`); comunas que ya tienen los lead times deseados → **SKIPPED** (`skipReason:'already-set'`). (3) todas terminadas → `advanceRegion()`. (4) pendiente → RUNNING + `location.href=editHref`.
- **onEdit:** verifica editId == comuna RUNNING; `openDeliveryCollapsible`; `setLeadTimes` (`input[name="delivery_leadtime_min/max"]`); `clickSave` (Magento navega solo; OK lo marca el próximo tick en listing). Error → ERROR + `leaveEditPage` (limpia `onbeforeunload` + click `#back`).

**Quirks:**
- **Botón Filters tras editar:** tras entrar a un Edit y volver, a veces no abre. `advanceRegion()` hace `location.reload()` al saltar de región (el storage persiste; el próximo tick abre limpio).
- **Sync tras Apply Filters:** el chip `._show` aparece ~inmediato pero las filas pueden quedar viejas cientos de ms. `applyFilters()` snapshotea primer `editId` + "records found" y espera a que **uno cambie** (o lista vacía).
- **Red anti-corrupción:** tras `collectAllComunas()`, valida que TODAS las comunas tengan `regionName` (normalizado sin acentos/lowercase) que contenga la región filtrada. Una sola que no matchee → aborta región con ERROR. Última barrera contra grids stale.
- **Stop:** popup `active=false`+`finishReason='cancelled'`. Tick en vuelo termina su paso; el siguiente no entra. Una nav ya disparada no se cancela.

**Selectores (`SELECTORS`):** `button[data-action="grid-filter-expand"]` (abre panel) · `.admin__data-grid-filters-wrap._show` (abierto) · `input[name="region_name"]` · `button[data-action="grid-filter-apply"]` · `.admin__data-grid-filters-current._show` · `tbody tr.data-row` + `.data-grid-actions-cell a[data-action="item-edit"]` · `.admin__data-grid-pager .action-next` · `[data-index="delivery"] .fieldset-wrapper-title[data-state-collapsible]` · `input[name="delivery_leadtime_min|max"]` · `#save`/`#back`.
**MUY IMPORTANTE:** "Delete" NUNCA se toca. Solo `#save`, `#back`, `a[data-action="item-edit"]`.

**Debug `__extLgeCl.leadTimes.`:** `diagnose()`, `page()`, `selectors()`, `check()`, `parseRows()`, `filters()`, `records()`, `state()`, `stop()`, `reset()`, `tick()`.
**UI popup:** tabla regiones (name/min/max/✕) + "Agregar región", Iniciar/Detener, progreso global, stats por región, `<details>` con últimos 50 logs. Live vía `storage.onChanged`.
**Pendientes:** no distingue múltiples tabs Magento; sin reintento (comuna falla → ERROR y sigue); sin historial de runs.

---

## Feature: Cupones (Magento)
Pantalla: **Cart Price Rules** (`/obsadm/sales_rule/promo_quote/index/...`) + edit (`.../edit/id/<N>/...`). Navegaciones full-page como lead-times.
Sub-secciones: **Quitar Regla de Cupón** — elimina TODAS las condiciones del bloque "Actions" y guarda (único sub-flujo; estructura tabbed lista para más).
```
src/features/cupones/
├── constants.js   SELECTORS, STORAGE_KEYS, ITEM_STATUS, SEARCH_BY, PAGE_TYPE, EDIT_URL_RE, LISTING_URL_RE
├── state.js  debug.js
├── content/ detector.js · parser.js · index.js · magento/{filters,edit-page}.js · flows/run.js
└── popup/   view.js · utils.js (parseQueries: split por líneas/comas/;) · sections/remove-rule.js
```
**Estado (`chrome.storage.local["cupones:run"]`):** `{ active, startedAt, finishedAt, finishReason?, searchBy:'id'|'rule', currentItemIndex, items:[{ query, status:pending|searching|editing|ok|error|not-found, matchedRuleId?, matchedName?, editHref?, removedConditions?, savedAt?, error? }], log:[...] (cap 400) }`.

**Detección:** `EDIT_URL_RE=/\/sales_rule\/promo_quote\/edit\/id\/(\d+)/i` → edit; `h1.page-title==='Cart Price Rules'` o URL listing+grid → listing; resto other.

**State machine (`flows/run.js`):** `tickIfActive()` en init (300ms) y en `storage.onChanged`. Solo top frame; guard `running`.
- **onListing:** (1) item EDITING (volvimos con save OK) → OK. (2) sin PENDING → `finalize('done')`. (3) siguiente PENDING → SEARCHING. (4) `waitForGridReady`→`clearFilters`→`applyFilter({searchBy,value})`. (5) `findMatchingRow`: `id` match exacto numérico (fallback: única fila); `rule` match exacto nombre case-insensitive (fallback: única fila); nada → NOT_FOUND. (6) match → guarda `matchedRuleId/Name/editHref`, EDITING, `location.href=editHref`.
- **onEdit:** busca item EDITING con `matchedRuleId===editId`; `openActionsCollapsible()`; `removeAllConditions()` (loop: click primer `a.rule-param-remove` hasta vaciar, max 50); `clickSave()` (blur + `#save`; OK lo marca el próximo tick). Error → ERROR + `leaveEditPage()`.

**Quirks grid legacy Magento:**
- **Usar botones reales Search/Reset:** `button[data-action="grid-filter-apply"]` (`doFilter()`) y `button[data-action="grid-filter-reset"]` (`resetFilter()`); onclick inline llaman a `promo_quote_gridJsObject`. Robusto.
- **NO Enter sintético:** handlers prototype.js verifican `event.keyCode==13` pero `KeyboardEvent` deja keyCode en 0; handler bound al form no al input. Síntoma: value escrito pero grid no recarga → NOT_FOUND.
- **NO inyectar `<script>`:** CSP de Magento bloquea inline. El click nativo en botón existente lo sortea.
- **Click = `el.click()` nativo, NO `dispatchEvent`:** para botones legacy con `onclick=function(){}`, `.click()` activa el handler igual que click real; `dispatchEvent` falla silencioso.
- **AJAX vs nav full-page:** en modo nav (`setLocation` con filtro base64 en URL) el reload corta el tick dejando item en SEARCHING. `onListing` retoma `SEARCHING && !matchedRuleId`; si `isFilterAppliedFor()` (inputs ya muestran el query) → salta clear/apply y va directo a `findMatchingRow`.
- `applyFilter()`/`clearFilters()` esperan refresh detectando cambio de snapshot `{count, firstRuleId}` (el grid legacy no tiene chip de filtro).

**Búsqueda (`SEARCH_BY`):** `id` → `#promo_quote_grid_filter_rule_id` (numérico exacto); `rule` → `#promo_quote_grid_filter_name` (Magento es contains, código exige exacto case-insensitive o fallback única fila). **No mezclar** en un batch (radio + validación; si `id` y entrada no-numérica → abort con alert).

**Eliminar condiciones:** árbol en `div[data-index="actions"] .rule-tree`; cada condición es `<li>` con `<a class="rule-param-remove">`. La condición fija ("If ALL...") y el "+" NO tienen `.rule-param-remove`. **Activación:** `target.click()` nativo (dispatchEvent corre el listener inconsistente). **Detección:** retener ref al `<li>` y esperar a que salga del DOM (`!document.body.contains(targetLi)`) — más confiable que contar (re-render); fallback: conteo baja vs snapshot. Anidación: `a.rule-param-remove` matchea cualquier profundidad.

**Selectores (`SELECTORS`):** `h1.page-title` · `#promo_quote_grid_table` · `#promo_quote_grid_filter_rule_id`/`_name` · `button[data-action="grid-filter-apply"]` (Search) · `button[data-action="grid-filter-reset"]` (Reset) · `#promo_quote_grid_table tbody tr[data-role="row"]` · `td[data-column="rule_id"]`/`name` · `td[data-column="action"] a` (Edit) · `div[data-index="actions"]` · `div[data-index="actions"] .rule-tree a.rule-param-remove` · `#save`/`#back`.
**MUY IMPORTANTE:** `#delete` y `#save_and_continue` NUNCA se tocan. Solo `#save`, `#back`, `rule-param-remove`.

**Debug `__extLgeCl.cupones.`:** `diagnose()`, `page()`, `selectors()`, `check()`, `parseRows()`, `filters()`, `rows()`, `state()`, `stop()`, `reset()`, `tick()`.
**UI popup:** radio `ID | Rule` + textarea cupones (línea/coma/;), Iniciar/Detener/Limpiar, progreso, lista de items + nombre real, `<details>` 50 logs. Live vía `storage.onChanged`. Persiste `{searchBy, rawQueries}`.
**Pendientes:** no distingue múltiples tabs; sin reintento; sin historial; timeout si grid tarda >15s.

---

## Feature: Información de Orden (Magento)
Pantalla: detalle de una orden en el admin de Magento (`/sales/order/view/order_id/<N>`). **Read-only**: lee el DOM y lo muestra ordenado en el popup; decodifica el motivo de pagos aprobados/rechazados (Transbank/Webpay y MercadoPago).
```
src/features/orden-info/
├── constants.js   STORAGE_KEYS, SEARCH_STATUS, PAGE_TYPE, MESSAGES, SELECTORS, URLs/REs, diccionarios de errores (TRANSBANK_RESPONSE_CODES/_VCI/_PAYMENT_TYPE/_STATUS, MERCADOPAGO_STATUS/_STATUS_DETAIL)
├── state.js       get/set/clear/updateSearch + get/setLastQuery (chrome.storage.local)
├── debug.js
├── content/ detector.js · parser.js · index.js (handler GET_ORDER_DATA + tick) · flows/search.js
└── popup/   view.js (sección única) · utils.js · sections/order-info.js
```
**Detección (`detector.js`):** `order-view` (URL `/sales/order/view/order_id/N` o presencia de `.order-information-table`), `listing` (título `Orders` o URL `/sales/order/(index|grid)` + `#fulltext`), `other`.

**Display (mensaje one-shot `orden-info:get-order-data`):** el popup hace polling de la pestaña activa **+ botón Actualizar** (`#oi-refresh`, re-lee al instante si el usuario ya tiene la orden abierta); el content devuelve `{ ok, data:{ orderNumber, status, alerts[], groups[] } }`. `parser.js` arma grupos: Resumen (order-information-table + título), Cliente (order-account-information-table), Full In House (`.custom-section` `<p>`), Totales (`.order-subtotal-table`), **Información de pago** (`.order-payment-method` → `.order-payment-method-title` + `.data-table`, fuente fiable de MercadoPago), un grupo **Pago N** por nota de transacción decodificada, e Historial de notas. La UI reusa el render de grupos de LG.com (`.lg-group/.lg-field`, buscador, copiar campo/grupo/todo) + **alertas** (`.oi-alert--error/success/warning`) con el motivo del pago.

**Decodificación de transacciones (`parser.js`):** parsea cada `.note-list-comment` (pares `<strong>Label</strong>: valor<br>` o JSON), detecta la pasarela y traduce con los diccionarios de `constants.js`:
- **Transbank/Webpay:** `Código de respuesta` (0=aprobado, negativos=rechazos), `VCI` (autenticación 3DS), `Estado` (AUTHORIZED/FAILED/…), `Tipo de pago` (VD/VN/VC/SI/S2/NC/VP), `Código de autorización`. Aprobado si rc==0 / estado AUTHORIZED|CAPTURED; rechazado si rc!=0 / FAILED|NULLIFIED.
- **MercadoPago:** `status` + `status_detail` (`cc_rejected_*`, `pending_*`, `accredited`). Aprobado/rechazado/pendiente según ambos.
Notas sin pasarela (JSON de estado, "esperando pago") van al grupo Historial.

**Búsqueda (`flows/search.js`, storage-driven):** el popup escribe `STORAGE_KEYS.SEARCH={active,orderNumber,status}` y navega la pestaña al listado (`chrome.tabs.update`, base `/obsadm` derivada del tab o `DEFAULT_ADMIN_BASE`). En el listing el content: (1) **aplica filtros requeridos** — Purchase Date `created_at[from]/[to]` con ventana de `DATE_WINDOW_DAYS` (29) días en formato jQuery UI `m/dd/yy`, verifica el Purchase Point `Chile Default Store View` (multiselect `.admin__action-multiselect-crumb`, normalmente ya seleccionado; sólo warn si falta), click `button[data-action="grid-filter-apply"]`; (2) setea `#fulltext` con el número y click `button[aria-label="Search"]`; (3) espera el grid, ubica la fila (`tr.data-row`; celda con texto == número; fallback: fila que lo contenga) y abre la orden (anchor `td.data-grid-actions-cell a[href*="/sales/order/view/"]` — primario; fallback `clickEl` en la celda). En `order-view` marca la búsqueda `done`. **Importante:** (a) las filas del grid son `tr.data-row` (NO `tr[data-role="row"]`); (b) la búsqueda puntual REQUIERE el rango de fecha (<= 1 mes) y el Purchase Point — sin ellos el grid da error; (c) `onListing` espera `waitForGridReady()` ANTES de escribir el fulltext, porque Magento restaura la última búsqueda guardada y pisaría el número nuevo si se escribe demasiado pronto. El grid es UI-component Knockout → date inputs vía `change` (KO datepicker), store sólo verificado.
**Debug `__extLgeCl.ordenInfo.`:** `diagnose()`, `page()`, `selectors()`, `check()`, `parse()`, `search()`, `reset()`, `tick()`.
**Pendientes:** click de fila del grid KO sin verificar en vivo (fallback razonable); no distingue múltiples tabs; diccionarios de errores ampliables.

---

## Feature: Starkoms
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

---

## Feature: LG.com
Sitio público **www.lg.com** (a diferencia del resto, que opera sobre GP1/Magento admin). Sub-pantallas: **PDP**, **PLP**, **PBP**. `popup/view.js` es el router: barra de tabs PDP/PLP/PBP + switch **Auto** (persistido). Cada pantalla (`SCREENS` en constants) agrupa sus operaciones y se renderiza con `popup/sections/screen.js` (genérico, parametrizado por la pantalla).

**Switch "Auto" (auto-seguir pantalla):** cuando está on, la pantalla mostrada sigue a la pantalla en que está el usuario — detecta la pantalla "dueña" de la captura más reciente vía `screenForCapture(capture)` y reacciona a cambios de pestaña/ventana (`chrome.tabs.onActivated/onUpdated` + `windows.onFocusChanged`) + un timer cada 1.5s (cubre navegación same-tab). Off: queda en la pantalla elegida manualmente. Persistido en `STORAGE_KEYS.SCREEN` + `AUTO_FOLLOW`.

**Distinguir PBP de PLP (`screenForCapture`):** PDP=`getPbpProduct`, PLP=`retrieveProductList` (por operación). PBP y PLP **comparten** `getProductsBySku` (capturado como `products`); la PBP pide **1 SKU** y la PLP **varios** → se desambigua por el largo de `variables.skuList` (==1 ⇒ PBP, >1 ⇒ PLP). El caso >1 cubre la **landing promocional** (PLP especial desde AEM con promotion id) que dispara un `getProductsBySku` con `operationName` explícito y varios SKUs. Las `variables` de los GET GraphQL las parsea el bridge desde el query string (no hay body).

**Captura de red (reto central):** el JSON viaja por el `fetch`/XHR de **la página** (mundo MAIN); el content aislado no lo ve. Solución MV3 sin violar CSP: un **content script en `world:"MAIN"`** (`src/content/graphql-bridge.js`, `run_at:document_start`, `https://www.lg.com/*`, top frame) que parchea `window.fetch` + `XMLHttpRequest.prototype.open/send`, lee la respuesta y la reenvía por `window.postMessage({ source:'ext-lge-cl/graphql', operationName, variables, response, url, ts })`. Captura **GraphQL** (`/api/graphql`) y **REST proxy LG** (`/ncms/.../proxy/<name>`, p. ej. `retrieveProductList` de la PLP — nombre = último segmento del path). **Autocontenido, sin `chrome.*` ni imports de `shared/`, todo en try/catch** (jamás romper la web). Guard de idempotencia `window.__extLgeClGraphqlBridge`.

**Recepción/almacenamiento:** `lgcom/content/index.js` (isolated, solo top frame + host lg.com) escucha `window 'message'` (valida `event.source===window` + `source` + `GRAPHQL_URL_RE`) y guarda en `capture-store.js` (Map en memoria `operationName → últimas N capturas`, `CAPTURE_CAP=5`, **volátil**, sin storage — datos grandes/efímeros, modelo SPA). One-shot al popup: `MESSAGES.GET_CAPTURES` → `{ ok, captures:[{operationName,ts,url,variables,count}] }`; `MESSAGES.GET_OPERATION {operationName}` → `{ ok, operationName, ts, url, variables, response }`.

**Operaciones (`OPERATIONS` en constants):** detección genérica por `operationName`. El bridge **deriva el nombre** en dos pasos: (1) del texto del query (`query Nombre` o primer campo de la selección anónima, p. ej. `{getAddressLevel1{...}}`); (2) **fallback por respuesta** — si sigue `unknown` (típico de `fetch(new Request(...))` donde no se lee el body), usa el primer key de `response.data` (= campo raíz: `getPbpProduct`, `products`, …). Mapeadas hoy: `getPbpProduct` (PDP), `getAddressLevel1` (regiones), `getAddressLevel2` (comunas), `products` (variantes; el `getProductsBySku` anónimo de PDP/PBP/PLP cae acá vía data-key), `getProductsBySku` (cuando llega con `operationName` explícito — landing promocional: lista de SKUs que la conforman, sumada a la pantalla PLP), `retrieveProductList` (catálogo PLP, REST). En la PDP `getPbpProduct` llega varias veces (simple y rica con `delivery_coverage`/`coupon_discount`/`main_package_product`/`install`/`global_shipping_rules`); el extractor tolera todas. Operaciones sin extractor → **JSON crudo**.

**Extractores (`content/extractors/`):** `index.js` = dispatcher `EXTRACTORS[operationName]` + `extract()`/`hasExtractor()`. Funciones puras `(response)→grupos|null` reusables en content y popup.
- `pbp-product.js`: orden por importancia — **primero producto**, **envío al final**: Identificación, Precios, Cuotas, Totales, Componentes del bundle (PtoV2), Garantía, Paquetes, Suscripción, Pre-orden, Marketing, Instalación, luego Despacho (+cobertura) y Reglas de envío (`global_shipping_rules`). **Fallback `readSegments(total_segments)`** para sku/precio/descuento cuando `product` viene casi vacío (package rules, PtoV2). Maneja `product.items[]` (componentes de bundle PtoV2).
- `address-level1.js` / `address-level2.js`: grupo "Regiones (N)" / "Comunas (N)" name→id.
- `products.js` (`products`/`getProductsBySku` anónimo, usado por PLP y PBP): un grupo por item con sku, stock, precios, MSRP, cuotas, cheaper_price, suscripción (fairown), pre-orden y componentes si es BundleProduct.
- `products-by-sku.js` (`getProductsBySku` explícito — landing): si la respuesta trae data rica delega en `products.js`; si solo trae SKUs (la landing), un único grupo "Productos de la landing (N)" con cada SKU copiable.
- `retrieve-product-list.js`: un grupo por modelo de la PLP (encabezado por lista) priorizando TAGS — productTag1/2 con tipo/categoría/usuarios/vigencia, delivery tag, MSRP, estado, rating, URL.
Todos formatean CLP/%/sí-no, omiten campos/grupos vacíos, defensivos ante nulls.

**UI (`popup/sections/product-info.js`):** **auto-captura por polling** (cada 700ms, ~14s): la página dispara el GraphQL un instante tras cargar; en vez de obligar a tocar Actualizar, re-renderiza solo cuando llega una captura más nueva (compara `ts`), preservando el texto del filtro. Estados: "Esperando datos…" (lg.com sin captura aún), vacío (no lg.com / agotado). Botón **Actualizar (↻) arriba** en la toolbar (no al fondo) + indicador "auto" mientras poll. Selector de operación si hay varias. Grupos en `<details>` con buscador en vivo (`data-search`), copiar por campo / por grupo / Copiar todo / JSON. Clipboard con fallback `execCommand`. CSS `.lg-*` en `popup.css`.
**Controles UI persistidos (`STORAGE_KEYS`):** **Auto** (`auto-follow`, en `view.js`, ver arriba) + **pantalla activa** (`screen`). **Tamaño de texto** A−/A+ (`font-scale`, índice en `FONT_SIZES`) en la toolbar de cada pantalla, aplicado por la CSS var `--lg-fs` en `.lg-view`. Ícono de copiar agrandado (16px). La pantalla hace su propio polling de auto-captura (700ms, ~14s) y filtra las capturas a las operaciones de esa pantalla; selector interno si hay más de una.

**Debug `__extLgeCl.lgcom.`:** `diagnose()` (host/bridge/operaciones), `captures()`, `operation(name)`, `raw(name)`, `pbp()` (grupos de la última PDP), `extract(name)` (grupos de cualquier operación con extractor), `clear()`.
**Sumar una operación:** crear `content/extractors/<op>.js` (función pura → grupos), registrarla en `extractors/index.js` y agregar metadata en `OPERATIONS` (constants). El popup la muestra sola.
**Pendientes:** sin persistencia entre reloads; no distingue múltiples tabs lg.com.

---

## Distribución a otras PC corporativas
`npm run installer:build` → `build/EXT_LGE_CL-installer-<version>.zip` (~22 KB) autocontenido: `extension-<version>.crx` (firmado) + `Install.cmd`/`Uninstall.cmd` + `install.ps1` (auto-eleva, copia a `C:\ProgramData\EXT_LGE_CL`, genera update.xml con paths reales, aplica política, reinicia Edge, abre `edge://extensions` + `edge://policy`) + `README.txt`. El destinatario solo necesita Windows + Edge + admin local.
**Update:** subir `version` en `manifest.base.json` → `installer:build` → enviar ZIP → correr `Install.cmd` de nuevo.

## Decisiones tomadas
- **Vite sobre Webpack:** config simple, mejor HMR, builds rápidos (Rolldown/Vite 8).
- **MV3 solo:** Chrome elimina MV2 en jun 2026 (Chrome 139).
- **Manifests separados Chrome/Edge:** las stores requieren IDs distintos.
- **ESM en todo:** soportado nativo por Vite/Node 22/MV3.
- **Force-install vía política local (no Web Store):** el entorno corporativo bloquea DLP/drag&drop de `.crx`/carga manual (`CRX_REQUIRED_PROOF_MISSING`). Política en `HKLM\SOFTWARE\Policies\Microsoft\Edge` es la única vía.
- **`.pem` local, ID estable:** el ID deriva del SHA-256 del SPKI de la pública. Inyectamos `key` en el manifest para ID estable también en "unpacked".
- **`all_frames: true`:** GP1 carga módulos en iframes.
- **Logger vía localStorage:** sobrevive reloads.
- **Content script `world:"MAIN"` para captar GraphQL (LG.com):** única forma de observar el `fetch`/XHR de la página sin inyectar inline scripts (bloqueado por CSP). El bridge solo `postMessage` (sin `chrome.*`). Requiere Chromium 111+ (Edge moderno OK).
