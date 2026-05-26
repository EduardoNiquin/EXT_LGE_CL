# EXT LGE CL

Extensión de navegador para **Chrome y Edge** (ambos Chromium, Manifest V3). Objetivos: modular, escalable, segura.

## Stack

- **Bundler:** Vite 8 + `vite-plugin-web-extension` (descubre entry points desde el manifest automáticamente). Modo dev usa `vite build --watch` (no `vite dev`) porque el CSP estricto bloquea el HMR server de Vite.
- **Tests:** Vitest 4 (`--passWithNoTests` habilitado hasta que haya tests reales)
- **Lint:** ESLint 10 (flat config, `eslint.config.js`)
- **Packaging:** `web-ext` 10 (genera ZIPs para las stores) + script propio para instalación corporativa por política
- **Node:** 22 LTS (CI corre con v22)
- **Módulos:** ESM (`"type": "module"` en `package.json`)

## Estructura

```
EXT_LGE_CL/
├── .github/workflows/ci.yml      CI: lint + test + build chrome/edge
├── assets/icons/                 Íconos PNG 16/32/48/128 (faltan, son placeholders)
├── manifests/
│   ├── manifest.base.json        MV3 compartido — paths apuntan a src/ y assets/
│   ├── manifest.chrome.json      Override Chrome
│   └── manifest.edge.json        Override Edge
├── scripts/
│   ├── pack-extension.mjs        Empaqueta dist/edge → .crx (firma + inyecta "key")
│   ├── generate-policy.mjs       Genera update.xml + .reg de política local
│   ├── build-installer.mjs       Arma el ZIP autocontenido para distribuir
│   ├── install.ps1               Instalador local (auto-elevación, importa .reg)
│   ├── build.js                  Placeholder (Vite lo reemplaza)
│   └── package.js                Genera ZIPs post-build para las stores
├── src/
│   ├── background/service-worker.js   Service worker MV3 (no persistent bg)
│   ├── content/index.js               Content script — installa debug API + init de features
│   ├── popup/                         UI del action button
│   ├── options/                       Página de configuración
│   ├── features/                      Una carpeta por feature (ver "Arquitectura de features")
│   │   └── colocar-tags/
│   └── shared/                        Código reutilizable entre contextos
│       ├── api/                       Clientes HTTP externos
│       ├── debug/index.js             Registry de window.__extLgeCl
│       ├── messaging/messaging.js     Wrapper de chrome.runtime messages
│       ├── storage/storage.js         Wrapper de chrome.storage.local
│       └── utils/
│           └── logger.js              Logger con niveles configurables
├── tests/{unit,e2e}/
├── keys/                         .pem para firmar el .crx (gitignored)
├── build/                        Artefactos de release (gitignored)
├── EXTENSION_INSTALL.md          Instrucciones de instalación corporativa
├── eslint.config.js              Flat config + globals browser/webextensions
├── vite.config.js                Hace merge de manifests según --mode
└── package.json
```

## Comandos

### Desarrollo y build

```bash
npm run dev              # build --watch para Chrome (rebuild auto, sin HMR)
npm run dev:edge         # build --watch para Edge
npm run build            # Build para ambos browsers → dist/{chrome,edge}/
npm run build:chrome     # Solo Chrome
npm run build:edge       # Solo Edge
npm run build:ext        # Alias: build Edge para release
npm run package:chrome   # ZIP para Chrome Web Store
npm run package:edge     # ZIP para Edge Add-ons
npm run lint
npm test
```

### Release / instalación corporativa

```bash
npm run pack:ext         # dist/edge → .crx firmado + extension-id.txt
npm run policy:gen       # build/update.xml + install-policy.reg + uninstall-policy.reg
npm run release:ext      # build:ext + pack:ext + policy:gen
npm run installer:build  # release:ext + arma build/EXT_LGE_CL-installer-<version>.zip
npm run install:ext      # importa build/install-policy.reg (PC del dev, con elevación)
npm run uninstall:ext    # revierte
```

Ver `EXTENSION_INSTALL.md` para el flujo completo y por qué existe.

## Convenciones

- **Permisos:** mínimos posibles. Agregar a `manifests/manifest.base.json` → `permissions` / `host_permissions` solo cuando se necesite.
- **CSP estricto:** `script-src 'self'; object-src 'self'`. Sin `eval`, sin inline scripts. Todos los HTML tienen `<meta http-equiv="Content-Security-Policy">`.
- **Comunicación entre contextos:** usar `src/shared/messaging/` (no llamar `chrome.runtime.sendMessage` directo desde features).
- **Storage:** usar `src/shared/storage/` (no llamar `chrome.storage` directo).
- **Logging:** usar `src/shared/utils/logger.js` (no `console.log` directo). El logger respeta el nivel global persistente.
- **Manifests:** modificar `manifest.base.json` para cambios comunes; los overrides solo para diferencias reales Chrome/Edge.
- **Cross-browser:** Chrome y Edge comparten 99% del código. Si algo no funciona en Edge, documentarlo aquí.

## Arquitectura de features

Cada feature vive en `src/features/<feature-id>/` con esta estructura:

```
src/features/<feature-id>/
├── constants.js              IDs de mensajes/puertos, selectores, enums del dominio
├── debug.js                  Comandos de debug — auto-registra en window.__extLgeCl
├── content/                  Lógica que corre en la página objetivo
│   ├── detector.js           Confirma que estamos en la pantalla correcta + diagnose()
│   ├── parser.js             Extrae datos del DOM
│   ├── index.js              Init: listener de mensajes one-shot + onConnect de ports
│   ├── gp1/                  Driver del UI específico de GP1 (widgets L-*)
│   │   ├── modal.js          Lifecycle del modal #dialog2
│   │   ├── messagebox.js     YES/NO/OK por texto + waitForMessagebox
│   │   └── combobox.js       selectComboboxOption(input, button, listbox, label)
│   └── flows/                Orquestación de pasos del dominio
│       ├── search-product.js sku → Search → fila exacta → Edit → modal abierto
│       └── delivery-tag.js   Aplica Tag de Delivery dentro del modal + STG + PROD
└── popup/
    ├── view.js               Sub-router del feature (tabs entre secciones)
    ├── utils.js              Helpers comunes (escapeHtml, etc.)
    └── sections/             Una sub-vista por archivo
        ├── reader.js         Lectura de pantalla (filtros + grid)
        ├── delivery-tag.js   Form + port + progreso + persistencia
        └── product-tag.js    Placeholder
```

**Capa shared/dom** — primitivas DOM genéricas reutilizables por cualquier feature:

```
src/shared/dom/
├── wait.js                   waitFor / waitForElement / waitForGone / sleep + WaitTimeoutError + WaitAbortedError
└── events.js                 setInputValue / setSelectValue / setChecked / clickEl / findByText
```

Todas las esperas aceptan `AbortSignal` para cancelar.

**Wiring:**
- Cada feature se registra en `src/popup/features.js` (objeto + import del `render`).
- El content script global (`src/content/index.js`) importa e inicializa el `init()` de cada feature y el `debug.js`.
- Comunicación popup ↔ content vía `chrome.tabs.sendMessage` (helper en `src/shared/messaging/messaging.js`).
- Cada feature define sus tipos de mensaje en `constants.js` con prefijo `<feature-id>:` para evitar colisiones.

**Registro de feature en `src/popup/features.js`:**
```js
{
  id: 'mi-feature',       // kebab-case, único
  name: 'Nombre visible',
  description: 'Una línea descriptiva',
  abbr: 'ABR',            // 2-4 letras para el badge
  keywords: ['alias', 'búsqueda'],
  render: renderMiFeature, // función importada del view.js del feature
}
```

**Multi-frame:** el content script corre con `all_frames: true`. El handler de cada feature
debe diferenciar entre top y iframe (ver patrón en `colocar-tags/content/index.js`):
si el frame detecta la pantalla, responde sincrónicamente; si no, espera unos ms y responde
con un diagnóstico, dándole prioridad a otros frames que sí detecten.

## Debug API (`window.__extLgeCl`)

Existe tanto en el contexto del content script como del popup. En DevTools hay
que cambiar el "JavaScript context" al de la extensión (`EXT LGE CL`) para
acceder a ella — los content scripts viven en un isolated world.

Comandos generales:
- `__extLgeCl.help()` — lista todos los comandos registrados.
- `__extLgeCl.features()` — lista features con debug API registrada.
- `__extLgeCl.log.setLevel('debug'|'info'|'warn'|'error'|'silent')` — persiste en localStorage.
- `__extLgeCl.log.getLevel()`.
- `__extLgeCl.<feature>.<comando>()` — comandos específicos de cada feature.

**Para sumar comandos a una feature nueva:**
1. Crear `src/features/<feature>/debug.js`.
2. Llamar `register('<feature>', { ... })` (import desde `shared/debug/index.js`).
3. Importar ese archivo (side-effect import) desde `src/content/index.js` y/o `src/popup/popup.js`.
4. Usar el helper `cmd(fn, 'descripción')` para que aparezcan documentados en `help()`.

## Popup navegación

- `popup.js` maneja routing simple: `renderHome()` ↔ `openFeature(feature)`.
- Back button en el header aparece cuando estás en una vista de feature.
- El título del header refleja la vista actual.

## Estado del proyecto

- ✅ Scaffolding completo con CI funcionando (lint + test + build chrome/edge)
- ✅ ESLint 10 flat config con globals browser/webextensions
- ✅ GitHub Actions con Node 22 y actions v5
- ✅ Popup UI: header, buscador con highlight, lista de features escalable
- ✅ Navegación entre home y vistas de feature (back button)
- ✅ **Pipeline de release corporativo:** `.crx` firmado + política local + ZIP autocontenido para distribución (`scripts/build-installer.mjs`)
- ✅ **Debug API modular** (`window.__extLgeCl`) con registro por feature y logger con niveles persistentes
- ✅ **Content script multi-frame** (`all_frames: true`) con resolución de carrera entre frames
- ✅ Feature "Colocar TAGs" — etapa 1: detector + parser + diagnose + vista de filtros/grid
- ✅ Feature "Colocar TAGs" — etapa 2 (Tag de Delivery): flow end-to-end con streaming por port, persistencia de config, progreso por SKU, cancelación
- ✅ Capa `shared/dom` con primitivas reutilizables (`waitFor`, `setInputValue`, `clickEl`, `setChecked`, etc.)
- ✅ Driver del UI L-* de GP1 (`modal`, `messagebox`, `combobox`) aislado del flow
- ✅ Sub-router de secciones dentro del popup (Lectura | Tag Delivery | Tag Producto)
- ✅ **Feature "Lead Times":** automatización end-to-end del flujo Magento Manage Address Level 2 con state machine multi-página, persistido en `chrome.storage.local`, popup con múltiples regiones + progreso live + stop de emergencia
- ✅ Feature "Colocar TAGs" — Tag de Producto: flow end-to-end con 1 ó 2 tags por SKU (3 selectores encadenados + type + schedule por tag), streaming por port, cancelación y persistencia
- ⏳ Pendiente: tests en `tests/unit/*.test.js`

## Comunicación popup ↔ content

- **One-shot:** `chrome.tabs.sendMessage` con `MESSAGES.<NAME>` (ej. `colocar-tags:get-page-data`). Respuesta única, sin streaming.
- **Streaming con cancelación:** `chrome.tabs.connect(tabId, { name: PORTS.<NAME> })`. Protocolo:
  - Popup → content: `{ type: 'start', config }` o `{ type: 'cancel' }`.
  - Content → popup: `{ type: 'progress', sku, index, total, status, step, detail?, reason? }`, `{ type: 'done' }`, `{ type: 'cancelled' }`, `{ type: 'error', reason }`.
  - Cierre del port desde el popup aborta el loop en el content (via `AbortController` + `port.onDisconnect`).

Sólo el frame que detecta la pantalla acepta el `onConnect`. Los demás frames (con `all_frames: true`) ignoran silenciosamente.

## Feature: Colocar TAGs (estado actual — etapa 2)

Pantalla objetivo: **Marketing Info Mapping** dentro de GP1 (SPA).

**Detección (`detector.js`):**
- `isMarketingInfoMappingPage()` — booleano. Verifica `#aform`, `#LblockSearch`, `#tabView`, `#divGrid_stg`.
- `diagnose()` — devuelve `{ detected, missing, selectors, url, title, isTopFrame, iframes, iframeCount }`. Es lo que consume el panel de diagnóstico del popup y el comando `__extLgeCl.colocarTags.diagnose()`.

**Parser (`parser.js`):**
- `parseSearchForm()`: extrae 11 campos del formulario (site B2C/B2B, super/category/sub, salesModel, modelName, productId, modelStatus, modelType, promotionId, publish).
- `parseGrid()`: detecta tab activa (STG/PROD), lee `tbody tr.L-grid-row`, extrae por fila: rowId (de la clase `L-grid-row-rXXXX`), rowIndex (col `num`), `editIndex` (de `onclick="fncModelPopup(N)"`), isSelected, salesModel, modelName, productId, pimSku, super/category/sub, modelStatus, modelType, publish.
- Contadores: `#mSelectCount`, `#mStgListCount`, `#mProdListCount`.

**Convención de búsqueda:** preferir Sales Model con sufijo (ej: `24U421A-B.AWHQ`) sobre Model Name puro — es más preciso.

**Estados de Model:** ACTIVE / INACTIVE / DISCONTINUED. El que interesa para los tags es ACTIVE.

**Mensaje único:** `colocar-tags:get-page-data` → responde `{ ok, data?, reason?, diag? }`. Cuando falla la detección incluye el diagnóstico completo que el popup renderiza en un `<details>` desplegable.

**Tag de Delivery — flujo (etapa 2):**

1. Popup recolecta: `skus[]`, `tagLabel` (default "Despacho Gratis RM"), `beginDay/Time`, `endDay/Time`, `skipProd` (default true).
2. Popup abre port `colocar-tags:delivery-run` y envía `start` con la config. Persiste config en `chrome.storage.local`.
3. Content (en el frame que detecta MIM) itera SKUs:
   - `searchProductBySku(sku)`: setea `#productId`, click `#btnSearch-button`, espera fila cuya celda `.L-grid-col-salesModel` matchee exactamente, click su botón `.L-grid-button` (`fncModelPopup(N)`), espera modal `#dialog2`.
   - `applyDeliveryTag(...)`: marca `#deliveryTagChk`, selecciona el tag via `cb2-button`/`cb2-listbox`, marca `#deliveryTagUseFlag`, setea `#deliveryTagUserType=ALL`, setea las 4 inputs de fecha/hora, click `formSubmit()`, confirma YES, ack OK. Si no skipProd → `formSubmitProd()` + confirm + ack.
4. Cada paso emite `progress` por el port. El popup actualiza la lista con icono y `step`.
5. Errores: el SKU queda en estado `error` con `reason` y el loop continúa con el siguiente.

**Texto de messageboxes usado para distinguir confirm vs success:**
- Confirm STG/PROD: "all selected rows of information"
- Success STG: "successfully saved to STG"
- Success PROD: "successfully saved to PROD"

**Tag de Producto — flujo (etapa 3):**

1. Popup recolecta: `skus[]`, `tags[]` (1 ó 2 tags), cada uno con `{ category, group, tag, type, beginDay, beginTime, endDay, endTime }`, más `skipProd` global. Persiste config en `chrome.storage.local`.
2. Popup abre port `colocar-tags:product-run` con `START + config`.
3. Content (frame que detecta MIM) itera SKUs:
   - `searchProductBySku(sku)` — idéntico al flujo Delivery.
   - `applyProductTags({ tags, skipProd, userType: 'ALL' })`:
     - Para cada tag (orden 1 → 2):
       1. Marcar `#productTag<N>Chk`.
       2. `select#productTagCategory<N>` ← `category` (Product/Promotion).
       3. Combobox `#productTagGroup<N>` ← `group` (depende de category, esperamos a que se populen los `<li>`).
       4. Combobox `#productTag<N>` ← `tag` (depende de group).
       5. `select#productTag<N>Type` ← `type` (gradient/solid/line).
       6. Marcar `#productTag<N>UseFlag`.
       7. `select#useType<N>` ← `ALL` (el id `#productTag<N>UserType` está duplicado en un hidden, hay que tomar el visible).
       8. Setear `#productTag<N>BeginDay/BeginTime/EndDay/EndTime`.
     - Click `SAVE TO STG` → confirm YES → ack OK.
     - Si `!skipProd`: SAVE PROD + confirm + ack. Magento cierra el modal solo tras el último OK.
4. Mismo protocolo de progreso por SKU que delivery; los pasos del flujo de cada tag llevan `detail.tagIndex` para que el popup pinte "Tag 1 — Setteando Type" / "Tag 2 — …".

**Particularidad del combobox de Product Tag:** los `<ul role="listbox">` de los combos comparten IDs (`cb1-listbox`, `cb2-listbox`) — HTML técnicamente inválido pero existente. Por eso `selectComboboxByInput` (en `gp1/combobox.js`) resuelve el botón y el listbox desde el input usando `input.closest('.combobox.combobox-list')` en vez de querySelector por id. Además espera a que el listbox tenga `<li>` antes de buscar la opción, porque los combos están encadenados (group depende de category, tag depende de group) y el populate es asíncrono.

**Tags dinámicos en GP1 — no se hardcodean.** Las opciones de `productTagGroup<N>` y `productTag<N>` (también el listbox de delivery `cb2-listbox`) las populates el backend de GP1 por SKU. Pueden cambiar producto a producto y no hay forma de validar contra una lista cerrada del lado de la extension. El driver `commitComboboxSelection` intenta match exacto + case-insensitive como fallback y lanza `ComboboxOptionNotFoundError` (en `gp1/combobox.js`) con muestra de las opciones disponibles si no encuentra. El handler central (`runSkuBatch` en `content/index.js`) atrapa esa excepción y reporta el SKU como ERROR claro al popup en vez de cascadear timeouts.

**Pre-flight modal entre SKUs.** Antes de cada `searchProductBySku`, `ensureCleanModalState()` drena messageboxes residuales (intenta OK/YES/NO en orden, hasta 4 veces) y cierra el modal #dialog2 si quedó abierto desde un SKU anterior con error. Si tras eso el modal sigue abierto, el SKU se marca ERROR con `step: 'pre-modal-open'` y se continúa con el siguiente. Esto evita la cascada típica de "el primer SKU falla → todos los siguientes fallan porque el modal residual cubre el form".

**Watchdog en el popup.** `attachPortWatchdog` (en `popup/utils.js`) dispara en 12s si el port no recibió ningún mensaje del content script. Cubre el caso donde la pestaña activa no es GP1 o no está en MIM — el handleConnect del content script ignora silenciosamente y sin el watchdog el popup quedaría spinneando indefinidamente.

**Validación de fechas centralizada.** `content/validators.js#validateDateTimeRange` chequea formato (YYYY-MM-DD / HH:MM) **y semántica** (beginDay ≤ endDay; si mismo día, beginTime ≤ endTime). Lo usan tanto el flow de Delivery como el de Product Tag — antes había dos validaciones distintas.

**Limitaciones reportadas por el usuario:**
- Si un producto ya tiene 2 tags y se manda 1 nuevo, el 2° se sobrescribe (queda sólo el 1° nuevo). Comportamiento del sistema, no del flow.
- Si se mandan 2 tags, se aplican en orden (1 → 2). El flow ya cumple esto.

**Reorganización del handler `content/index.js`:** ambos puertos (`DELIVERY_RUN` y `PRODUCT_RUN`) comparten el mismo loop `runSkuBatch`, parametrizado vía `PORT_RUNNERS[port.name].runPerSku`. Esto evita duplicar manejo de SkuNotFoundError, WaitAbortedError y reporting de progress.

**Comandos debug expuestos** (todos bajo `__extLgeCl.colocarTags.`):
- `diagnose()` — diagnóstico completo del frame.
- `check()` — `{selector: bool}` por cada selector contra el DOM actual.
- `find(key)` — `document.querySelector(SELECTORS[key])`.
- `iframes()` — lista de iframes con id/name/src.
- `frameInfo()` — `{ url, title, isTopFrame }`.
- `parse()` — corre el parser y devuelve el resultado.
- `selectors()` — copia del mapa de selectores.

Pendiente etapa 2: documentar el flujo de cómo se aplican los tags (el usuario lo va a explicar).

## Feature: Lead Times (Magento)

Pantalla objetivo: **Manage Address Level 2** dentro de Magento admin (`/regional_management/level2/...`). Es un CRUD admin tradicional (no SPA), así que el flujo cruza **navegaciones full-page** entre el listing y la pantalla `Edit Address Level 2`.

**Estructura:**
```
src/features/lead-times/
├── constants.js              SELECTORS, STORAGE_KEYS, COMUNA_STATUS, REGION_STATUS, PAGE_TYPE, EDIT_URL_RE, TEXTS, DEFAULTS
├── state.js                  get/set/clear/update del run + appendLog (chrome.storage.local)
├── debug.js                  Comandos __extLgeCl.leadTimes.*
├── content/
│   ├── detector.js           detectPage() → { type: 'listing'|'edit'|'other', editId? } + diagnose()
│   ├── parser.js             parseListingRows() / getActiveFilters() / getRecordsFound() / getTotalPages()
│   ├── index.js              init() — tick inicial + listener de storage.onChanged
│   ├── magento/              Drivers del admin grid + edit page
│   │   ├── filters.js        openFilters / setRegionFilter / applyFilters / clearAllFilters
│   │   ├── grid.js           waitForGridReady / collectComunasOnCurrentPage / collectAllComunas (paginación)
│   │   └── edit-page.js      openDeliveryCollapsible / setLeadTimes / clickSave / leaveEditPage
│   └── flows/
│       └── run.js            tickIfActive() — state machine; onListing / onEdit / advanceRegion / finalize
└── popup/
    ├── view.js               Sub-router (preparado para más secciones; hoy: una sola)
    ├── utils.js              escapeHtml / formatTime
    └── sections/
        └── runner.js         Form de regiones + start/stop + progreso live + log
```

**Modelo de estado (`chrome.storage.local["lead-times:run"]`):**
```ts
{
  active: boolean,
  startedAt, finishedAt, finishReason?,
  currentRegionIndex: number,
  queue: [{
    regionName, minDays, maxDays,
    status: REGION_STATUS,
    error?, totalComunas?, currentComunaIndex?,
    comunas?: [{
      id, code, name, regionName, currentMin, currentMax, editHref,
      status: COMUNA_STATUS, error?, previousMin?, previousMax?, savedAt?,
    }],
  }],
  log: [{ ts, level, message }], // cap 400
}
```

**Detección de página** (`content/detector.js`):
- `EDIT_URL_RE` matchea `/regional_management/level2/edit/id/<N>/` → `type: 'edit'`, `editId: N`.
- `h1.page-title === 'Manage Address Level 2'` → `type: 'listing'`.
- Cualquier otra → `type: 'other'` (ignorada).

**State machine** (`flows/run.js`):
- `tickIfActive()` se invoca en `init` (tras 300ms para dejar montar el grid) y en cada `chrome.storage.onChanged` del key del run. Sólo top frame; guard de reentrancia con `running` flag.
- **onListing:**
  1. Si alguna comuna quedó en RUNNING (acabamos de volver del edit tras un save) → marcarla OK.
  2. Si la región actual no tiene comunas recolectadas → openFilters, setRegionFilter, applyFilters, collectAllComunas (recorre todas las páginas vía `.action-next`). Al guardar las comunas, las que ya tienen los lead times deseados (`currentMin === minDays && currentMax === maxDays`) se marcan **SKIPPED** con `skipReason: 'already-set'` en lugar de PENDING — no se entra a su Edit.
  3. Si todas las comunas están terminadas → `advanceRegion()`.
  4. Si hay una pendiente → marcarla RUNNING, `window.location.href = editHref`.
- **onEdit:**
  1. Verifica que el `editId` de la URL coincide con la comuna RUNNING.
  2. `openDeliveryCollapsible` (click si `data-state-collapsible="closed"`).
  3. `setLeadTimes({ minDays, maxDays })` con `setInputValue` en `input[name="delivery_leadtime_min/max"]`.
  4. `clickSave` — Magento navega solo de vuelta al listing. **No** marcamos OK acá; lo hace el próximo tick al detectar listing (así sabemos que Magento efectivamente navegó).
  5. En caso de error: marcar ERROR + `leaveEditPage` (limpia `window.onbeforeunload` y click en `#back` para esquivar el confirm "Changes have been made").

**Comunicación popup ↔ content:** únicamente vía `chrome.storage.local` + `chrome.storage.onChanged`. **No** se usan `runtime.sendMessage` ni ports, porque los page reloads de Magento los cerrarían. El popup escribe el run para arrancar; el content suscribe sus cambios; ambos refrescan al ver el storage cambiar.

**Stop de emergencia:** popup setea `run.active = false` + `finishReason = 'cancelled'`. Cualquier tick en vuelo termina su paso actual y el siguiente tick no entra (guard en `tickIfActive`). Una nav ya disparada no se cancela — la comuna en curso terminará como OK o ERROR según resultado real.

**Quirk del botón Filters tras editar:** una vez que en una sesión se entra a un Edit y se vuelve al listing, el botón "Filters" del data grid de Magento queda en un estado donde a veces no abre el panel. La única forma conocida de destrabarlo es **recargar la página**. Por eso `advanceRegion()` hace `window.location.reload()` al saltar de una región a la siguiente: el storage del run persiste, y el próximo tick (post reload) abre el panel limpio y aplica el filtro de la nueva región.

**Sincronización tras Apply Filters:** el chip `.admin__data-grid-filters-current._show` aparece casi inmediatamente al clickear "Apply Filters", pero las filas del grid pueden seguir mostrando datos viejos por cientos de ms mientras Magento recarga. Si recolectamos en esa ventana, leemos filas sin filtrar. `applyFilters()` ahora toma snapshot del primer `editId` y del contador de "records found" antes del click y espera a que **uno de los dos cambie** (o que la lista se vacíe) antes de devolver.

**Red de seguridad anti-corrupción:** después de `collectAllComunas()`, el flow valida que **todas** las comunas leídas tengan `regionName` que contenga (normalizado, sin acentos, lowercase) el nombre de la región filtrada. Si una sola no matchea, se aborta la región con `REGION_STATUS.ERROR` y se loguea con muestra de los nombres detectados — preferimos saltarnos una región antes que pisar lead times de otra. Esta es la última barrera contra grids stale o filtros mal aplicados.

**Selectores Magento clave** (`constants.SELECTORS`):
- `button[data-action="grid-filter-expand"]` → abre panel.
- `.admin__data-grid-filters-wrap._show` → panel abierto.
- `input[name="region_name"]` → filtro Address Level 1.
- `button[data-action="grid-filter-apply"]` → Apply Filters.
- `.admin__data-grid-filters-current._show` → señal de que el filtro fue registrado.
- `tbody tr.data-row` + `.data-grid-actions-cell a[data-action="item-edit"]` → links de Edit (href tiene id+key).
- `.admin__data-grid-pager .action-next` → siguiente página (disabled cuando es la última).
- `[data-index="delivery"] .fieldset-wrapper-title[data-state-collapsible="open|closed"]` → header del colapsable.
- `input[name="delivery_leadtime_min|max"]` → inputs.
- `#save` / `#back` → botones del page-main-actions.

**MUY IMPORTANTE:** la acción "Delete" del row NUNCA se toca. El driver sólo conoce `#save`, `#back` y `a[data-action="item-edit"]`. La opción "delete" del menú de acciones no se busca por nadie en el código.

**Comandos debug** (todos bajo `__extLgeCl.leadTimes.`):
- `diagnose()`, `page()`, `selectors()`, `check()`, `parseRows()`, `filters()`, `records()`.
- `state()` — devuelve el run persistido.
- `stop()` — marca el run como inactivo (no aborta un tick en vuelo).
- `reset()` — borra todo el storage del run.
- `tick()` — fuerza un tick del state machine en este frame.

**UI del popup:** tabla de regiones (regionName / min / max / ✕) con botón "Agregar región", `Iniciar` / `Detener`, barra de progreso global, lista de regiones con stats por región, `<details>` con los últimos 50 logs. Se suscribe a `storage.onChanged` para refresco live aunque el popup quede abierto durante el run.

**Pendientes / no resueltos:**
- Si hay múltiples tabs de Magento abiertas, el run no distingue. Hoy se asume una sola.
- No hay reintento automático si una comuna falla; queda ERROR y se sigue con la próxima.
- No se guarda historial de runs (sólo el último + el último config para autocomplete del form).

## Distribución a otras PC corporativas

`npm run installer:build` genera `build/EXT_LGE_CL-installer-<version>.zip` (~22 KB) autocontenido:

```
extension-<version>.crx        binario firmado
Install.cmd / Uninstall.cmd    entrypoints doble-click
install.ps1                    auto-eleva, copia a C:\ProgramData\EXT_LGE_CL,
                               genera update.xml con paths locales reales,
                               aplica claves de política, reinicia Edge y
                               abre edge://extensions + edge://policy para verificar
README.txt
```

El destinatario no necesita Node, ni npm, ni VS Code, ni internet. Solo Windows + Edge + admin local.

**Flujo de update:** subir `version` en `manifests/manifest.base.json` → `npm run installer:build` → enviar el nuevo ZIP → el usuario corre `Install.cmd` de nuevo (o Edge lo detecta solo si las rutas no cambian).

## Decisiones tomadas

- **Vite sobre Webpack:** simpler config, HMR mejor, builds más rápidos con Rolldown (Vite 8).
- **Manifest V3 solo:** Chrome elimina MV2 en junio 2026 (Chrome 139). No vale la pena soportar MV2.
- **Manifests separados Chrome/Edge:** aunque comparten todo hoy, las stores requieren IDs distintos.
- **ESM en todo:** Vite, Node 22 y MV3 service workers lo soportan nativamente.
- **Force-install vía política local en lugar de Web Store:** el entorno corporativo bloquea DLP, drag&drop de `.crx` y carga manual (`CRX_REQUIRED_PROOF_MISSING`). La política local en `HKLM\SOFTWARE\Policies\Microsoft\Edge` es la única vía.
- **`.pem` generado localmente, ID estable:** el ID se deriva del SHA-256 del SPKI de la clave pública. Inyectamos `key` en el manifest para que el ID sea estable también en modo "unpacked" durante desarrollo.
- **`all_frames: true`:** GP1 carga módulos en iframes; sin esto el content script solo correría en el top frame.
- **Logger configurable vía localStorage:** así sobrevive a reloads y el usuario puede subir verbosidad sin reinstalar.

## Notas para la IA

- Antes de agregar un permiso al manifest, justificar por qué es necesario.
- Si una feature necesita usar `chrome.*` API directamente, considerar primero si debería ir en `src/shared/`.
- Los assets en `assets/` se referencian desde el manifest como `assets/icons/iconN.png` (relativos a la raíz del proyecto, no a `src/`).
- El build genera `dist/chrome/manifest.json` y `dist/edge/manifest.json` desde el merge de `manifests/manifest.base.json` + el override correspondiente (lógica en `vite.config.js`).
- **Nunca commitear** `keys/`, `*.pem`, `*.crx`, ni nada de `build/`. Está en `.gitignore` pero hay que recordarlo.
- **Logger antes que `console.log`:** si vas a agregar trazas, usar `logger('scope')` para que respeten el nivel global.
- **Debug API antes que helpers ad-hoc:** si una feature necesita un comando de inspección, registrarlo en su `debug.js` en lugar de pegarlo en `window` a mano.
