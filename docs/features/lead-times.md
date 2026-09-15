# Lead Times (Magento)
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
