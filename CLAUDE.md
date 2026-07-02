# EXT LGE CL
UTILIZA ESPAÑOL NEUTRAL, NADA DE ACENTOS.
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
│       ├── errors/index.js             ExtError + toMessage(err) + isAbortError(err,signal) + describeError()
│       ├── dev-mode/index.js           Flag "modo dev" persistente (key `dev-mode:enabled`, cross-context)
│       ├── diagnostics/index.js        Ring buffer de errores (key `diagnostics:errors`) + installGlobalErrorCapture()
│       ├── run-store/index.js          createRunStore (run persistido + updateRun coalescido) + createPersistedValue + wireAsync/ReloadTickLifecycle
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
- **Errores:** usar `toMessage(err)` (no `err?.message || String(err)`) e `isAbortError(err, signal)` (no `err instanceof WaitAbortedError || signal.aborted`) desde `shared/errors`. Todo `logger().error()` se registra automáticamente en el ring buffer de `shared/diagnostics` (visible en Ajustes → "Errores recientes").
- Assets se referencian desde el manifest como `assets/icons/iconN.png` (relativo a raíz, no a `src/`).
- **Nunca commitear** `keys/`, `*.pem`, `*.crx`, `build/`.

## Arquitectura de features
Cada feature en `src/features/<feature-id>/`:
```
constants.js   IDs de mensajes/puertos (prefijo `<feature-id>:`), selectores, enums
state.js       run persistido vía createRunStore (shared/run-store) + makeRun propio + persisted values
debug.js       comandos auto-registrados en window.__extLgeCl
content/       detector.js (+diagnose) · parser.js · index.js (listener one-shot + wire*Lifecycle) · drivers/ · flows/
popup/         view.js (sub-router) · utils.js · sections/ (una sub-vista por archivo)
```
**Wiring:**
- Registrar en `src/popup/features.js`: `{ id (kebab-case único), name, description, abbr (2-4 letras), keywords[], render }`.
- `src/content/index.js` importa e inicializa `init()` y `debug.js` de cada feature.
- **Estado de ejecución:** usar `createRunStore`/`createPersistedValue` (shared/run-store) en `state.js`; enganchar el ciclo de vida con `wireAsyncRunLifecycle` (SPA) o `wireReloadTickLifecycle` (Magento full-page).
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
Scopes: `colocar-tags`, `colocar-tags:product`, `colocar-tags:offer`, `colocar-tags:delivery-remove`, `colocar-tags:combobox`, `lead-times`, `cupones`, `orden-info`, `starkoms`, `lgcom`, `lgcom/popup`, `seller-center-falabella`, `e-promoters`, `pim`, `gato`, `content`, `service-worker`, `debug`, `popup`.

## Manejo de errores y Modo Dev (`shared/errors` · `shared/dev-mode` · `shared/diagnostics`)
- **`shared/errors`:** `ExtError` (base con `code`/`context`/`cause`), `toMessage(err)` (mensaje legible de cualquier throw), `isAbortError(err, signal)` (cancelación: WaitAbortedError/AbortError/signal.aborted), `describeError(err, meta)` (forma serializable con stack recortado).
- **`shared/dev-mode`:** flag global persistente (`dev-mode:enabled`, cache sync + `storage.onChanged` cross-context). `isDevMode()` sync, `setDevMode()`, `subscribeDevMode()`, `whenDevModeReady()`. Activo ⇒ el logger fuerza nivel `debug` en todos los contextos.
- **`shared/diagnostics`:** ring buffer de errores (cap 60) persistido en `diagnostics:errors` con coalescing de escritura. `recordError(err, {context,scope,extra})`, `getErrors()`, `clearErrors()`, `subscribeErrors()`, `installGlobalErrorCapture(context)` (engancha `window.onerror`/`unhandledrejection`, idempotente). **Todo `logger().error()` alimenta el buffer automáticamente** (busca el primer `Error` entre los args para preservar el stack).
- **Wiring:** `installGlobalErrorCapture()` se llama en content, popup y service-worker. La UI vive en **Ajustes** (toggle "Modo desarrollador" + tarjeta "Errores recientes" en vivo). Service worker usa logger + `install()` (debug API).

## Run store compartido (`shared/run-store`)
Factory que unifica la persistencia de estado de ejecución que cada feature con batch reimplementaba en su `state.js`.
- **`createRunStore({ key, logCap=400 })`** → `{ getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun }`.
  - **`updateRun` con coalescing de escrituras (velocidad):** encola los updaters y los drena en LOTES — cada lote hace UN `getRun` + UN `setRun` aplicando en orden FIFO todo lo acumulado mientras la IO anterior estaba en vuelo. Reduce de O(N) round-trips a storage a O(rondas de IO) durante las ráfagas de `onStep` fire-and-forget, y reduce los `storage.onChanged` (menos re-renders del popup). Correcto en multi-writer: cada lote re-lee storage, así ve la cancelación que el popup escribe. Resuelve con el estado tras su propio updater (misma semántica que la versión serializada anterior).
- **`createPersistedValue(key, fallback)`** → `{ get, set }` para last-config / draft / last-query sueltos.
- **`wireAsyncRunLifecycle({ subscribeToRun, tickIfActive, abortActiveRun?, reconcileOnInit?, topFrameOnly?, log })`** — patrón storage-driven async (Colocar TAGs, Starkoms, Seller Center): reconcile + subscribe(active?tick:abort) + tick inicial.
- **`wireReloadTickLifecycle({ runKey, tickIfActive, delay=300, log })`** — patrón tick-por-reload (Lead Times, Cupones): top frame, tick inicial con delay + tick en cada `storage.onChanged` del run.
- **Migrado:** los 6 `state.js` (colocar-tags, starkoms, seller-center, lead-times, cupones, orden-info) usan el factory; cada uno conserva su `makeRun` (forma específica). orden-info aliasa los nombres `search` (`getSearch=store.getRun`, etc.).

## Debug API (`window.__extLgeCl`)
Existe en content, popup y service worker. En DevTools cambiar "JavaScript context" al de la extensión (content scripts viven en isolated world).
Generales: `help()`, `features()`, `log.setLevel('debug'|'info'|'warn'|'error'|'silent')` (persiste en localStorage), `log.getLevel()`, `dev.on()`/`dev.off()`/`dev.status()`, `errors()` (console.table del buffer), `clearErrors()`, `<feature>.<comando>()`.
Sumar a una feature: crear `features/<feature>/debug.js` → `register('<feature>', {...})` (desde `shared/debug`) → side-effect import desde `content/index.js` y/o `popup/popup.js` → usar helper `cmd(fn, 'descripción')`.

## Popup navegación
`popup.js`: routing simple `renderHome()` ↔ `openFeature(feature)`. Back button en header en vistas de feature; título refleja la vista.

## Estado del proyecto
Scaffolding + CI completos. Pipeline release corporativo (.crx firmado + política + ZIP). Debug API modular + logger persistente. Manejo de errores centralizado (`shared/errors`) + Modo Dev + ring buffer de errores con captura global (`shared/diagnostics`, visible en Ajustes). Content multi-frame con resolución de carrera. Capa `shared/dom`. Driver GP1 L-* (modal/messagebox/combobox).
Features: **Colocar TAGs** (Lectura | Tag Delivery | Quitar Delivery | Tag Producto | Tag Oferta), **Lead Times** (Magento), **Cupones** (Quitar Regla de Cupón), **Información de Orden** (Magento), **Starkoms** (Verificar órdenes y stock), **LG.com** (Info de Producto), **SellerCenter Falabella** (SoporteSeller — Detalle Orden), **E-promoters** (Informe ordenes — CSV/API → filtrado → CSV), **PIM** (Creación de producto — verificar si un SKU existe en PIM/STG), **GATO** (tic-tac-toe multijugador secreto vía Firebase).
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

**Búsqueda (`flows/search.js`, storage-driven):** el popup escribe `STORAGE_KEYS.SEARCH={active,orderNumber,status}` y navega la pestaña al listado (`chrome.tabs.update`, base `/obsadm` derivada del tab o `DEFAULT_ADMIN_BASE`). En el listing el content: (1) **resetea TODOS los filtros activos** (`resetAllFilters`: si hay chips `.admin__data-grid-filters-current._show`, click `button[data-action="grid-filter-reset"]`) — cualquier filtro previo (otra orden, otra columna) hace fallar la búsqueda puntual, así que se parte de cero; (2) **aplica sólo los dos filtros requeridos** — Purchase Date `created_at[from]/[to]` con ventana de `DATE_WINDOW_DAYS` (29) días en formato jQuery UI `m/dd/yy`, y **selecciona activamente** el Purchase Point `Chile Default Store View` (`ensureStoreView`: si no hay crumb `.admin__action-multiselect-crumb`, ubica el multiselect por su label "Purchase Point", lo abre, tilda la opción y cierra con "Done"; el reset pudo haberlo deseleccionado), click `button[data-action="grid-filter-apply"]`; (3) setea `#fulltext` con el número y click `button[aria-label="Search"]`; (4) **reintenta localizar la fila** (`waitForRow`, polling ~18s respetando el mask de carga; el grid recarga async y a veces tras un `400` transitorio re-renderiza recién después → NO mirar una sola vez) por `tr.data-row` (celda con texto == número; fallback: fila que lo contenga) y abre la orden (anchor `a[href*="/sales/order/view/"]` — primario; fallback `clickEl` en la celda/fila). En `order-view` marca la búsqueda `done`. **Importante:** (a) las filas del grid son `tr.data-row` (NO `tr[data-role="row"]`); (b) la búsqueda puntual REQUIERE el rango de fecha (<= 1 mes) y el Purchase Point, y NINGÚN otro filtro — sin esto el grid da error; (c) `onListing` espera `waitForGridReady()` ANTES de tocar filtros/fulltext, porque Magento restaura la última búsqueda guardada y pisaría el número nuevo si se escribe demasiado pronto; (d) la detección de la fila se reintenta varias veces (Knockout carga lento / 400 transitorio). El grid es UI-component Knockout → date inputs vía `change` (KO datepicker).
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
Sitio público **www.lg.com** (a diferencia del resto, que opera sobre GP1/Magento admin). **Router de 2 niveles:** `popup/view.js` es el router de nivel superior con dos secciones (`SECTIONS`, persistido en `STORAGE_KEYS.SECTION`): **Información web** (`popup/sections/info-web.js`) y **Revisar Destacados** (`popup/sections/destacados/index.js`). Sección activa por defecto: Información web.

### Información web (PDP / PLP / PBP)
Sub-pantallas: **PDP**, **PLP**, **PBP**. `sections/info-web.js` es el sub-router: barra de tabs PDP/PLP/PBP + switch **Auto** (persistido). Cada pantalla (`SCREENS` en constants) agrupa sus operaciones y se renderiza con `popup/sections/screen.js` (genérico, parametrizado por la pantalla).

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

### Revisar Destacados (`popup/sections/destacados/`)
Vigila el recuadro de **destacados** (`.c-result-area__spotlight`, 3 productos puestos a mano) de las páginas de categoría: cada destacado debe tener **tag** y **stock**. Sub-router (`index.js`) con 2 tabs (`DESTACADOS_TABS`, persistido en `STORAGE_KEYS.DESTACADOS_TAB`): **Revisión** (`review.js`) y **Configuración** (`config.js`).
- **URLs en duro:** las categorías a revisar viven en `constants.js → DESTACADOS_URLS` (`[{label,url}]`), NO en un panel persistente (se perderían al reinstalar; ver Pedida.md). La tab Configuración las muestra read-only.
- **Detección por render real (CLAVE):** la página de categoría usa **AEM** y arma el spotlight con **JS en el cliente** → NO está en el HTML crudo (un `fetch` devuelve la página sin el recuadro). Por eso el **service worker** (`background/destacados.js`) abre las URLs en **pestañas de fondo** (`chrome.tabs.create/update`, `active:false`) y le pide al content que lea el **DOM ya renderizado**. Al final cierra las pestañas.
- **Pool en paralelo:** se revisan `DESTACADOS_POOL` (3) categorías a la vez. Cada "worker" tiene su pestaña y va tomando ítems de una cola compartida (`queue.next()`); reusa la pestaña navegándola (`tabs.update`) entre ítems. Mucho más rápido que una por una.
- **Lectura del DOM vivo (`content/destacados/check.js`):** `parseSpotlight(doc)` + `waitAndParse()` (espera a `.c-result-area__spotlight .spotlight-list li` con timeout `DESTACADOS_RENDER_TIMEOUT`, hace **scroll sweep** para disparar lazy/IntersectionObserver, y un settle `DESTACADOS_SETTLE_MS` para el stock/tags asíncronos). Por producto: `sku` (`.btn-copy[data-sku]`/`.c-product-item__sku`), `modelName` (`.neo-card--ufn h3`), **hasTag** = `.neo-tag--box` tiene spans, **hasStock** = control `[data-shop-stock-status]` == `IN_STOCK` (OUT_OF_STOCK o sin control ⇒ sin stock).
- **Mensajes:** `lgcom:run-destacados` (popup → SW, dispara la revisión, responde `{ok,run}`); `lgcom:parse-spotlight` `{expectPath}` (SW → content de la pestaña de fondo, responde `{ok,ready,hasSpotlight,products}`; `ready:false` si la pestaña aún no navegó a `expectPath` → el SW reintenta hasta `DESTACADOS_TAB_TIMEOUT`). `PRODUCT_ISSUE`: sin-tag/sin-stock. NO requiere tener lg.com abierto.
- **Estado de la corrida persistido (`STORAGE_KEYS.DESTACADOS_RUN`):** `{active,trigger,startedAt,finishedAt,total,doneCount,items:[{label,url,status,spotlightCount?,problemCount?,products?,error?}]}`. El SW lo escribe **en cada cambio** (`patchItem` → marca `checking` al empezar cada página y el resultado al terminar). `PAGE_STATUS` incluye los transitorios `pending`/`checking` además de los terminales ok/issues/no-spotlight/error. El popup (`review.js`) **solo refleja** ese estado: barra de progreso `doneCount/total`, badge por ítem (En cola / Revisando… / Todo bien / N con problemas / Sin destacados / Error) y, al terminar, chips resumen + sello "Última revisión". Lee de storage al montar y escucha `storage.onChanged` → el estado **sobrevive a cambiar de tab o cerrar el popup**.
- **Revisión automática de fondo (en el SW, `wireDestacadosBackground`):** config en `STORAGE_KEYS.DESTACADOS_AUTO` `{enabled,intervalMinutes}` (tab Configuración; `DESTACADOS_AUTO_DEFAULT`/MIN 5/MAX 1440 min). Usa **`chrome.alarms`** (permiso `alarms` en manifest; alarma `DESTACADOS_ALARM`, `periodInMinutes`). `reconcileAlarm()` crea/limpia la alarma según la config (escucha `storage.onChanged`). Corre aunque NO haya ninguna pestaña lg.com abierta (el SW abre la suya). Guard single-flight `running`.

**Debug `__extLgeCl.lgcom.`:** además de las de captura — `destacados()` (parsea el spotlight de la página ACTUAL al instante), `destacadosLive()` (espera el render y parsea), `runDestacados()` (dispara la revisión completa en el SW).
**Pendientes:** editor persistente de `DESTACADOS_URLS` pendiente; la revisión abre pestañas de fondo (visibles brevemente en la barra); si una categoría carga muy lento puede dar `error` por timeout; el stock/tags se leen del DOM renderizado (si AEM cambia la estructura hay que ajustar `DESTACADOS_SELECTORS`).

---

## Feature: SellerCenter Falabella
Sitio **Salesforce (LWC)** — página de Soporte del Seller Center. Sub-sección: **SoporteSeller — Detalle Orden** (estructura tabbed lista para más). Completa automáticamente el acordeón "Detalle Orden" desde un CSV.

**A diferencia de Magento (tick-por-reload):** el acordeón se llena sin recargas → usa el **patrón storage-driven + flujo async continuo** de starkoms (`run` en storage, el frame que detecta el form lo reclama y ejecuta con `AbortController`). LWC usa **synthetic shadow DOM** (nodos en el light DOM), así que `querySelector` global funciona. Content matchea `<all_urls>`; la detección es por DOM (no por host, que puede variar entre orgs).

```
src/features/seller-center-falabella/
├── constants.js   STORAGE_KEYS, MESSAGES, STATUS, STEPS, TEXTS, SELECTORS, COLUMNS, LOG_CAP
├── state.js       getRun/setRun/clearRun/updateRun(writeChain)/appendLog/makeRun/subscribeToRun + get/setDraft
├── debug.js
├── content/ detector.js · parser.js · index.js · flows/{accordion,run}.js
└── popup/   view.js (sub-router) · utils.js (parseCsv/buildDetalles/splitGuias) · run-ui.js · sections/soporte-seller.js
```

**Estado (`chrome.storage.local["seller-center-falabella:run"]`):** `{ active, claimed, startedAt, finishedAt, finishReason?, errorReason?, total, currentIndex, items:[{ ordernumber, guia, cantP, status, step?, reason? }], log:[...] (cap 400) }`. El popup arma `items` (un item por guía) y los escribe ya en el run (a diferencia de starkoms que los descubre).

**Detección (`detector.js`):** `isSupportSellerPage()` = componente `c-fc_lwc097_-support-center_-order-information` presente, o los 3 inputs por `name` (`ordernumber`/`nGuia`/`cantP`) + ≥1 sección. `getDetalleSections()` = `<lightning-accordion-section>` cuyo summary dice "Detalle Orden" y tiene input de orden, en orden de DOM (== índice).

**CSV (`popup/utils.js`):** `parseCsv` (comillas con escape `""`, saltos de línea citados, BOM, delimitador autodetectado `,`/`;`/tab). 3 columnas EN ORDEN: Número de orden, Nro Guia, Cantidad de Paquetes (1ª fila = encabezados). `buildDetalles` descarta encabezado, valida por fila (colecciona warnings, omite filas inválidas) y aplica la **regla de múltiples guías**: `splitGuias` separa el cell de Nro Guia por espacio/`\n`/`/`/`|` (NO `,`/`;` para no chocar con el delimitador) → un "Detalle Orden" por guía, manteniendo orden y cantP.

**Flujo del batch (`flows/run.js` + `flows/accordion.js`):** por cada item: `ensureSection(i)` (si falta, click "+" de la última sección y espera que aparezca) → `expandSection` (click al summary si `aria-expanded=false`) → `fillSection` (`setInputValue` en los 3 inputs + verify/retry). Si falla crear/expandir una sección, **corta** el loop (las siguientes fallarían igual) para que el usuario revise. **NUNCA toca el botón "-" (eliminar)**; sólo "+". **No guarda/envía nada**: sólo completa los campos; el usuario revisa y guarda manual. `reconcileOnInit` marca interrumpido si un reload mató un run reclamado; `claimWatchdog` (3.5s) → `not-detected` si ningún frame tiene el form.

**Selectores (`SELECTORS`):** `c-fc_lwc097_-support-center_-order-information` · `.seller-accordion` · `lightning-accordion-section` · `.slds-accordion__summary-content` (título) · `button.slds-accordion__summary-action` (expandir, `aria-expanded`) · `input[name="ordernumber"|"nGuia"|"cantP"]` · `button.slds-button_neutral` (los "+"/"-" se distinguen por su texto).

**UI popup (`sections/soporte-seller.js`):** toggle **Subir archivo CSV** / **Pegar texto** (con los nombres de columna explícitos), previsualización (primeras 4 filas + total de "Detalle Orden" a crear + warnings en `<details>`), Iniciar (muestra el conteo)/Detener/Limpiar, progreso en vivo + `<details>` 50 logs. Persiste borrador `{mode,text,fileName}` en `seller-center-falabella:draft`. Live vía `storage.onChanged`.
**Debug `__extLgeCl.sellerCenterFalabella.`:** `diagnose()`, `detected()`, `selectors()`, `sections()`, `count()`, `state()`, `draft()`, `fillOne({index?,ordernumber,guia,cantP})`, `stop()`, `reset()`, `tick()`.
**Pendientes:** no distingue múltiples tabs; sin reintento por item (corta al primer error de estructura); asume que el form arranca con 1 sección vacía.

---

## Feature: E-promoters
Apartado para los e-promoters. **NO opera sobre una pestaña** (no tiene content script ni detector): es un procesador de datos puro que corre en el **service worker** y entrega un archivo. Sub-seccion actual: **Informe ordenes** (estructura tabbed lista para sumar mas).

### Informe ordenes
Toma el informe de ordenes de Magento (desde la **API** o un **archivo CSV cargado**), filtra las ordenes a **recuperar**, quita canceladas duplicadas, recorta a las columnas que los e-promoters necesitan y **descarga el CSV automaticamente**. El peor caso de entrada ronda ~15-37 MB.
```
src/features/e-promoters/
├── constants.js   STORAGE_KEYS, MESSAGES, SOURCE, PHASE(+LABEL), FINISH_REASON, KEEP_STATUSES, CANCELLED_STATUSES, OUTPUT_COLUMNS, DEDUPE_KEYS, API, DATE_COLUMN
├── state.js       run store (createRunStore) + makeRun + getResult/setResult + getDraft/setDraft
├── debug.js       __extLgeCl.epromoters.* (registrado en el SW)
├── shared/        csv.js (parseCsvMatrix/parseCsvRecords/buildCsv) · report.js (pipeline puro processReport)
├── background/    informe.js (orquestador en el SW: fetch API / parse CSV → filtros → CSV → chrome.downloads)
└── popup/         view.js (sub-router) · utils.js (fechas, downloadText) · sections/informe-ordenes.js
```
**Procesamiento en segundo plano (clave):** todo corre en el **service worker** (no en el popup), asi la tarea sobrevive a cerrar el panel / cambiar de pestaña. El popup escribe el `run` arrancando via mensaje `e-promoters:informe:start` y SOLO refleja el estado via `storage.onChanged`. El SW publica `phase` (downloading/parsing/filtering/deduping/building/saving/done) + `stats` + log en cada paso → indicador "que esta haciendo" en vivo.

**Estado (`chrome.storage.local["e-promoters:informe:run"]`):** `{ active, startedAt, finishedAt, finishReason?:'done'|'cancelled'|'error', errorReason?, source:'api'|'csv', from, to, phase, stats?:{totalRows,afterDate,afterStatus,removedDuplicates,finalRows,byStatus}, result?:{filename,rows,bytes,ready}, log:[...] (cap 400) }`. El **CSV generado** va aparte en `e-promoters:informe:result` (`{filename,csv}`) para no inflar el run; el boton "Descargar de nuevo" lo lee y hace Blob+anchor en el popup (sin permisos). Config del form persiste en `e-promoters:informe:draft` (`{source,from,to}` — el texto del CSV NUNCA se persiste, puede pesar mucho).

**Pipeline (`shared/report.js#processReport`, puro/testeable):** (1) **filtro por fecha** sobre la columna `Local Time` ("YYYY-MM-DD HH:MM:SS", se compara solo la fecha, ambos extremos inclusive); (2) **filtro por estado** — conserva `KEEP_STATUSES` (payment_declined, transaction_expired, canceled, customer_canceled); (3) **dedupe de canceladas** — solo entre `CANCELLED_STATUSES` (canceled+customer_canceled), por `Customer Email`+`Bill-to Name` (normalizado), conserva la 1a ocurrencia; las no canceladas no se tocan; (4) **recorte** a `OUTPUT_COLUMNS` (14, en orden). Lookup de encabezados **tolerante** a mayusculas/espacios (`makeFieldGetter`), por eso el origen `Warehouse Code` mapea al header de salida `WareHouse Code`. Columnas de salida: Local Time, ID, Bill-to Name, Customer Email, User Phone (Shipping), SKU PRICE, SKU Without Prefix, Grand Total (Base), Coupon Code, Coupon Rule, Discount Amount, Status, Qty Ordered, WareHouse Code.

**API Magento (`background/informe.js`):** `GET https://147.93.176.66/api/magento/orders?from&to&format=json&limit=50000` con header `X-Api-Token` (mismas credenciales que el PowerQuery de Excel, hardcodeadas en `constants.js#API`). El server filtra por `order_date` (timestamp en OTRA zona horaria, ~5h de desfase), asi que se pide una ventana **mas ancha** (+-1 dia, `WINDOW_PAD_DAYS`) y el filtro **exacto por `Local Time`** lo hace el cliente. La API entrega JSON o CSV con las mismas keys; usamos JSON. Cancelacion via `AbortController` + mensaje `e-promoters:informe:cancel`.
**CSV cargado:** el popup lee el archivo a texto (`FileReader`) y lo manda al SW en el payload del mensaje; el SW lo parsea con `parseCsvRecords` (NO se guarda en storage por tamaño).

**Descarga:** el SW arma un `data:text/csv;base64,...` (BOM UTF-8 para Excel) y dispara `chrome.downloads.download` (permiso `downloads` agregado al manifest). Re-descarga desde el popup via Blob del CSV guardado en `:result`.

**UI popup (`sections/informe-ordenes.js`):** toggle origen **Desde la API** / **Subir CSV**, selector de rango `<input type="date">` Desde/Hasta (dia/mes/año, default ultimos 7 dias, max=hoy), `<details>` con los estados que se conservan, **Generar informe** / Cancelar / Limpiar. Progreso: titulo + spinner + fase actual, barra por fase, tarjeta de resultado (descargado + boton re-descargar / aviso "sin filas" / error), grilla de stats (leidas → en rango → por estado → duplicadas quitadas → finales) + desglose por estado, `<details>` 50 logs. Todo en vivo via `storage.onChanged`.
**Debug `__extLgeCl.epromoters.` (en el SW):** `run({from,to})` (desde API), `runCsv({text,from,to})`, `process({records,from,to})` (pipeline puro), `cancel()`, `state()`, `result()`, `reset()`.
**Pendientes/limitaciones:** el `fetch` a la API es a una **IP con cert propio** — si el navegador rechaza el certificado el fetch falla (las extensiones no pueden saltarse errores TLS); en ese caso usar la carga por CSV o aceptar el cert visitando la URL una vez. No distingue multiples corridas en paralelo (guard `running` en el SW); sin reintento de la API.

---

## Feature: GATO (tic-tac-toe secreto)
Easter egg multijugador. **Feature SOLO de popup** (sin content script ni detector): el matchmaking y la partida corren mientras el popup/sidepanel esta abierto, contra **Firebase Realtime Database** via su **API REST** (NO el SDK: el CSP `script-src 'self'` lo bloquearia e inflaria el bundle).

**Desbloqueo (en `src/popup/popup.js`):** tocar el toggle de tema **`UNLOCK_CLICKS` (10) veces seguidas** (clics dentro de `UNLOCK_WINDOW_MS`=1500ms entre si). Flag persistido en `localStorage["ext:gato-unlocked"]`. Al desbloquear: el "logo" (la `.header-accent-bar` del header) se convierte en un **gatito** (SVG Twemoji limpio, `catSvg()` en constants) con animacion `gato-pop`, y la feature aparece en el home. Las features con `secret:true` (en `features.js`) se filtran via `visibleFeatures()` hasta el desbloqueo.

```
src/features/gato/
├── constants.js   RTDB_BASE, STORAGE_KEYS, UNLOCK_*, PHASE (idle/searching/challenged/playing/finished/leaderboard/ai), GAME_STATUS, WINNER, ROLE, AI_ROLE/AI_NAME, WIN_LINES, TURN_MS, POLL/PRESENCE/SEARCHERS timings, LEADERBOARD_PATH, CAT_SVG_PATHS + catSvg()
├── game.js        Logica pura: board/findWinner/isFull/otherRole/rolesFromUids/pairId/roleForUid + normalizeName/nameKey (ranking) + aiPickMove (IA defensiva)
├── ai-game.js     Partida local contra la IA (sin Firebase, NO puntua): makeAiGame/humanMove/cpuMove/passHuman
├── net.js         Presencia + matchmaking por reto + ranking + jugadas contra Firebase (usa shared/rtdb)
├── state.js       run store (gato:run) + draft (gato:draft, nombre) + getUid() (localStorage)
├── debug.js       __extLgeCl.gato.* (registrado desde view.js, contexto popup)
├── shared/rtdb.js Cliente REST minimo: rget/rset/rupdate/rpush/rremove + rgetWithEtag/rsetIfMatch (concurrencia optimista)
└── popup/ view.js (router 1 seccion + side-effect import de debug.js) · sections/play.js (toda la maquina de estados/UI)
```

**Identidad:** `getUid()` genera un uid estable (base36, seguro como key Firebase) en `localStorage["ext:gato-uid"]`. Roles deterministas: **P1 = uid menor** (marca **ROJO** `✕`), **P2 = uid mayor** (marca **NEGRO** `○`).

**Maquina de estados (`PHASE`, persistida en `gato:run` para restaurar al reabrir):** `idle` (nombre + jugadores activos + **Buscar partida / Jugar contra la IA / Clasificaciones**) → `searching` (lista de rivales para retar) → `challenged` ("X te ha retado", forzado) → `playing` (tablero) → `finished` (Ganador/Empate); ademas `leaderboard` (ranking) y `ai` (partida local). El "puntero" (phase+gameId+role o la partida IA en `run.ai`) vive en storage; la **verdad de la partida multijugador vive en Firebase** y se sondea por **polling** (`POLL_MS`=1s, sin SDK ni SSE).

**Presencia (`net.js`):** heartbeat `presence/$uid={name,ts}` cada `PRESENCE_BEAT_MS`; "activo" = ts dentro de `PRESENCE_FRESH_MS` (30s). `countActivePlayers` excluye al propio uid. Sin `onDisconnect` (feature del SDK) → presencia best-effort por frescura de ts.

**Matchmaking POR RETO (reemplaza el emparejamiento aleatorio):** se escribe un ticket `matchmaking/$uid={uid,name,ts,gameId,challenge}`. Mientras buscas, `listSearchers` muestra a los demas con ticket fresco y sin partida; **retas** a uno (`challengePlayer`). El retado queda **obligado** (`pollTicket` ve su `gameId`+`challenge` → fase `challenged` → "X te ha retado" → tablero). **Concurrencia (clave):** para que dos retos simultaneos al mismo rival no se pisen, el reclamo del slot del rival y del propio es **atomico via ETags** (`rgetWithEtag` + `rsetIfMatch`, `if-match`): si el slot ya esta tomado → `busy`; si me retaron a mi a la vez → `already-matched` (con rollback del reclamo del rival). El `gameId` es simetrico (`pairId`), asi que un reto mutuo converge a la **misma** partida.

**Partida (`games/$gameId`, gameId = `pairId` = uids ordenados con `__`):** `{ players:{P1,P2:{uid,name}}, board[9], turn, status, winner, moveDeadline, rematch:{P1,P2}, leaver, score:{P1,P2}, startedAt }`. **gameId determinista por par** ⇒ el **marcador de victorias sobrevive** entre revanchas y reconexiones. **Quien parte se elige al azar**. `ensureGame` preserva `score` existente y no pisa una partida en curso.

**Reloj (`TURN_MS`=10s):** tick local cada 250ms muestra el restante de `moveDeadline`. **Solo el jugador en turno escribe** sus jugadas (`makeMove`) y, si se agota su tiempo, **pasa su propio turno** (`passTurn`, una vez por deadline). `makeMove` resuelve ganador (3 en raya, `findWinner`) o empate, suma al marcador de la partida y, si hay ganador, **incrementa el ranking global** (lo hace solo quien cierra la jugada → un unico incremento).

**Clasificaciones / ranking global (`leaderboard/$nameKey={name,wins}`):** persistente y visible para todos. La key es el **nombre normalizado** (`nameKey`: minusculas, sin acentos, sanitizado para Firebase) ⇒ **case-insensitive** ("Pedro08" == "pedro08"). El incremento usa el **server value atomico** `{".sv":{"increment":1}}` (sin transacciones, sin perder cuentas en finales simultaneos). La vista lista nombre + victorias, orden desc.

**Jugar contra la IA (`ai-game.js`, local, NO puntua):** partida sin Firebase persistida en `run.ai`. Humano = P1 (ROJO), IA = P2 (NEGRO), quien parte al azar, mismo reloj de 10s. **IA defensiva (`aiPickMove`):** NO juega para ganar sino para **evitar perder** — si el humano amenaza con cerrar un 3 en linea (dos suyas + la tercera libre), tapa esa casilla; si hay varias amenazas tapa una; si no hay amenazas juega **al azar**. Defensiva ante tablero lleno/invalido (devuelve -1). La jugada de la IA se agenda con `AI_THINK_MS` de pausa.

**Revancha/salida:** multijugador → "Volver a jugar" marca `rematch/$role`; cuando ambos aceptan, **el host (P1) reinicia** preservando el marcador. IA → reinicia al instante preservando el marcador local. "Salir" (`leaveGame`): MP marca `leaver` (best-effort, el rival ve "abandono") + saca el ticket; IA limpia `run.ai`; ambos vuelven a `idle`. Navegar fuera dispara teardown via `aliveAndAttached()` (el popup no llama unmount): limpia timers, presencia y, si estaba `searching`, el ticket.

**UI (`sections/play.js`):** idle con 3 botones; searching con lista de rivales + botones "Retar" (deshabilitados durante el reto) + mensajes inline; reto recibido; ranking; tablero compartido MP/IA (topbar rival+reloj, turno, tablero 3×3 `border-radius:12px`/`aspect-ratio:1`, marcador, resultado). CSS `.gato-*` y `.header-accent-bar--cat/--pop` en `popup.css`.
**Debug `__extLgeCl.gato.`:** `uid()`, `state()`, `active()`, `searchers()`, `leaderboard()`, `game(id)`, `leave()`, `reset()`.

**Reglas RTDB (agregar `leaderboard`):**
```json
{ "rules": {
  "presence":    { "$uid": { ".read": true, ".write": true } },
  "matchmaking": { ".read": true, ".write": true },
  "games":       { "$gameId": { ".read": true, ".write": true } },
  "leaderboard": { ".read": true, ".write": true }
} }
```
**Pendientes/limitaciones:** la partida MP solo avanza con el popup abierto (persiste el estado, no el juego de fondo); si el jugador en turno cierra el popup nadie pasa su turno; matchmaking por reto sin transacciones reales (mitigado con ETags); reglas RTDB abiertas (sin auth); colisiones raras de `nameKey` si dos nombres distintos normalizan igual.

---

## Feature: PIM
Pantalla de PIM (Marketing Info / Model Grid): buscador por SKU (`#productId` + botón SEARCH `#search_sales_model_code`) + grilla de resultados **TUI Grid** con pestañas **STG/PROD** (`#ModelGridTab`, `#stg-tab`/`#prod-tab`). Sub-sección: **Creación de producto** (estructura tabbed lista para más). **Read-only:** solo usa el buscador en **Staging (STG)**; NO toca PROD ni ningún botón de guardado.

**Objetivo:** verificar si uno o varios SKU **existen en PIM**. Por cada SKU: selecciona STG, escribe el SKU, click SEARCH, y espera a que la grilla resuelva → arroja `SKU/YES` (existe) o `SKU/NO` (no existe). Copiable + descargable como CSV.

**A diferencia de Magento (tick-por-reload):** la grilla busca sin recargar la página → usa el **patrón storage-driven + flujo async continuo** de starkoms/seller-center (`run` en storage, el frame que detecta el buscador lo reclama y ejecuta con `AbortController`). Content matchea `<all_urls>`; detección por DOM (no por host).
```
src/features/pim/
├── constants.js   STORAGE_KEYS, MESSAGES, STATUS, STEPS, EXISTS, SELECTORS, DEFAULTS, LOG_CAP
├── state.js       run store (createRunStore) + makeRun + draft
├── debug.js       __extLgeCl.pim.*
├── content/ detector.js · parser.js · index.js · flows/{search,run}.js
└── popup/   view.js (sub-router) · utils.js (parseSkus/buildCsv/buildCopyText/copyToClipboard/downloadText) · run-ui.js · sections/creacion-producto.js
```
**Estado (`chrome.storage.local["pim:run"]`):** `{ active, claimed, startedAt, finishedAt, finishReason?:'done'|'cancelled'|'error'|'not-detected', errorReason?, total, currentIndex, items:[{ sku, status:pending|running|ok|error, step?, found?:boolean, specAssign?:string|null, reason? }], log:[...] (cap 400) }`. El popup arma `items` desde el textarea (`parseSkus` dedupe + preserva orden) y los escribe en el run.

**Detección (`detector.js`):** `isPimPage()` = presencia de `#productId` + `#search_sales_model_code` + `#ModelGridTab`.

**Búsqueda por SKU (`flows/search.js`):** `ensureStgTab` (click `#stg-tab` nativo si no tiene clase `active`) → `setInputValue(#productId, sku)` → `#search_sales_model_code.click()` (nativo, botón legacy con `onclick`) → **`waitForSearchToStart`** (gate anti-stale, ver quirk) → `waitFor(resolveResult().result !== 'pending')` (timeout `DEFAULTS.searchTimeoutMs`=15s) → si `found`, **`readSpecAssignScrolled(sku)`** (ver quirk de virtualización). Devuelve `{ found, specAssign }`.

**Resolución del resultado (`parser.js#resolveResult`):** ámbito = pestaña `#stg` (fallback `document`). Devuelve `{ result }`. `'found'` si alguna fila `.tui-grid-rside-area ... tbody tr` tiene una celda `.tui-grid-cell-content` que matchea el SKU (== `Sales Model Code`, o `SKU (Product ID)` empieza por `SKU.`); `'not-found'` si la capa `.tui-grid-layer-state` está visible con texto "No data." y ninguna fila matchea; si no, `'pending'`. Matchear la fila por el SKU evita leer resultados de la búsqueda anterior (grillas stale). El **Spec Assign NO se lee acá** (su columna está virtualizada fuera del DOM).

**Quirks del grid (críticos):**
- **Gate anti-stale (`waitForSearchToStart` + `isGridLoading`):** tras click en SEARCH, el grid conserva el `.tui-grid-layer-state` "No data." del SKU **anterior** hasta que arranca el nuevo fetch. Sin gate, `resolveResult` del SKU nuevo lee ese "No data." viejo **al instante** → cascada de falsos **NO** (avanza rapidísimo). El gate espera (tope `DEFAULTS.searchSettleMs`=4s) a que el grid entre en **carga** (`isGridLoading`: capa visible con spinner `.tui-grid-layer-state-loading` o texto "loading") o a que ya aparezca la fila del SKU; recién entonces confía en el resultado. Si nunca se ve loading (respuesta instantánea), el tope deja seguir.
- **Spec Assign — virtualización de columnas (CLAVE):** TUI Grid **virtualiza columnas horizontalmente**: el `<tbody>` del rside sólo renderiza las columnas visibles en el viewport (las de la izquierda: Platform…Sub Category). La columna **"Spec Assign"** (`specAssignmentCode`, índice ~17, muy a la derecha) **NO existe en el DOM** hasta scrollear. Leerla directo da siempre `null` → "—" en todos. Fix (`readSpecAssignScrolled`): (1) capturar el `data-row-key` de la fila con las columnas del SKU aún visibles (`getRowKeyForSku`); (2) `scrollGridX(-1)` (setea `scrollLeft` de `.tui-grid-rside-area .tui-grid-body-area` al máximo + dispara `scroll` → TUI re-renderiza esas columnas); (3) `waitFor(readSpecByRowKey(rowKey))` hasta `specSettleMs`=2s (celda `td[data-column-name="specAssignmentCode"]` por row-key, en lside/rside); (4) `scrollGridX(0)` para volver a la izquierda (si no, el próximo SKU no matchea sus columnas base). Vacío tras el tope = producto sin Spec Assign real. **Nota:** tras scrollear a la derecha, las columnas del SKU se virtualizan fuera del DOM, por eso hay que identificar la fila por `data-row-key` (no por SKU) al leer el spec.

**Batch (`flows/run.js`):** espejo de seller-center pero **cada SKU es independiente** → un error de SKU se registra y se continúa con el siguiente (no corta el loop). `reconcileOnInit` marca interrumpido si un reload mató un run reclamado; `claimWatchdog` (3.5s) → `not-detected`.

**UI popup (`sections/creacion-producto.js`):** textarea de SKU (uno por línea o separados por coma/`;`/espacio), previsualización del conteo, Iniciar/Detener/Limpiar. Progreso en vivo (barra, badge YES/NO por SKU + línea "Spec Assign" por producto encontrado, `<details>` 50 logs) + al finalizar botones **Copiar resultados** (`SKU/YES/Assigned` por línea) y **Descargar CSV** (`SKU,Existe en PIM,Spec Assign`, con BOM UTF-8). Persiste borrador `{text}` en `pim:draft`. Live vía `storage.onChanged`.
**Debug `__extLgeCl.pim.`:** `diagnose()`, `detected()`, `selectors()`, `result(sku)` (found/not-found/pending), `specAssign(sku)` (lee "Spec Assign" — requiere columna renderizada, usar tras `scrollRight()`), `loading()`, `scrollRight()`/`scrollLeft()`, `check(sku)` (verifica 1 SKU end-to-end → true si existe), `state()`, `draft()`, `stop()`, `reset()`, `tick()`.
**Pendientes/limitaciones:** solo STG; no distingue múltiples tabs; si el grid tarda >15s el SKU queda ERROR (se continúa); el scope de la grilla asume la pestaña `#stg` (fallback `document`) — afinar en vivo si el DOM de PROD confunde.

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
