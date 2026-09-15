# Cupones (Magento)
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
