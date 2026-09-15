# SoloTodo
Backoffice de **SoloTodo** — página **Precios actuales** (`https://backoffice.solotodo.com/reports/current_prices`, SPA React, **Material UI**). Automatiza: clickear **Exportar** → abrir el formulario de export → llenar los campos de la categoría → click en **Generar** (el reporte llega por correo). Sub-sección: **Generar reporte** (estructura de sub-router lista para más).

**A diferencia de Magento (tick-por-reload):** el form se llena sin recargas → usa el **patrón storage-driven + flujo async continuo** de starkoms/seller-center (`run` en storage, el frame que detecta el form lo reclama y ejecuta con `AbortController`). Content matchea `<all_urls>`; **detección por URL + DOM**: `isSolotodoReportPage()` = `isCurrentPricesUrl()` (`HOST` + `REPORT_PATH`) **o** `hasExportForm()` (filename + label Categoría) **o** botón "Exportar" presente.
```
src/features/solotodo/
├── constants.js   HOST, REPORT_PATH/URL, STORAGE_KEYS, MESSAGES, STATUS, FINISH_REASON, LABELS, SELECTORS, STEP, CATEGORIES (presets), getCategory, DEFAULT_CATEGORY_ID
├── state.js       run store (createRunStore) + makeRun + buildSteps + draft
├── debug.js       __extLgeCl.solotodo.*
├── content/ detector.js · parser.js · mui.js (helpers MUI) · flows/{fill,run}.js · index.js
└── popup/   view.js (sub-router) · run-ui.js · utils.js (buildFilename/todayStamp) · sections/reporte.js
```
**Estado (`chrome.storage.local["solotodo:run"]`):** `{ active, claimed, startedAt, finishedAt, finishReason?:'done'|'cancelled'|'error'|'not-detected', errorReason?, config:{ categoryId, categoryLabel, category, currency, stores[], countries[], filename, dryRun }, total, currentIndex, items:[{ key, label, status, detail?, reason? }], log:[...] (cap 400) }`. Los `items` son los **pasos** (export, categoria, moneda, tiendas, paises, filename, generar), armados por `buildSteps(config)`; dan la barra de progreso.

**Presets por categoría (`CATEGORIES` en constants):** cada preset define qué se elige en cada campo. Hoy solo **TV** (`id:'tv'`, label "Televisores"): category "Televisores", currency "Chilean peso", 40 tiendas (orden fijo), países ["Chile"], `filenamePrefix:'TV-SOLOTODO'`. El nombre de archivo se arma en el popup con la fecha de hoy: `buildFilename(prefix)` → `TV-SOLOTODO-YYYY-MM-DD`. **Escalable:** sumar otra categoría = otra entrada en `CATEGORIES`.

**Helpers MUI (`content/mui.js`) — ids dinámicos (`_R_xxx_`), matching por label/estructura:**
- **React controlled inputs:** asignar `input.value=x` NO dispara el onChange de React. `setReactInputValue` usa el **setter nativo** del prototype (`HTMLInputElement.prototype.value`) + despacha `input` event (igual patrón que seller-center/accordion.js).
- `findLabel(text)` / `findAutocompleteByLabel(text)`: ubican el campo por el TEXTO del `<label>` MUI; resuelven el input por el `for`/id del label (fallback: input dentro del mismo `.MuiFormControl-root`).
- `selectAutocompleteOption(input, optionText)`: enfoca/abre, escribe para filtrar, espera el **listbox** (teletransportado al `<body>` en `.MuiAutocomplete-popper`; se ubica por `input aria-controls` con fallback `ul[role="listbox"]`), y **clickea la `<li role="option">` que matchea EXACTO** (fallback: case-insensitive exacto, luego contains). El **match exacto es clave** para no confundir "Falabella"/"Falabella Marketplace", "Lider"/"Lider Marketplace", "Paris"/"Paris Marketplace", "Ripley"/"Ripley Marketplace", "Mercado Libre"/"Mercado Libre LG", "Tecno Mas"/"Tecno Master". `ComboboxOptionNotFound` → error con muestra de opciones.
- `findGenerarButton()`: `button[type="submit"]`/`button.MuiButton-root` cuyo texto == "Generar". `findExportButton()`: `button`/`a[role=button]`/`.MuiButtonBase-root` cuyo texto == "Exportar". `hasExportForm()`: filename input + label Categoría presentes.

**Llenado (`flows/fill.js`):** `openExportForm` (si el form no está visible, clickea "Exportar" y espera a que monten los campos —tope 10s—; si ya está, no hace nada), `selectSingle` (Categoría/Moneda; si ya tiene el valor deseado, no toca), `selectMultiple` (Tiendas/Países; una opción por vez, `onProgress(done,total,name)` para el detalle en vivo, cierra el popper al terminar con Escape), `fillFilename` (input de texto React + `change`/`blur`), `clickGenerar`.

**Runner (`flows/run.js`):** espejo de seller-center. `runStep(key,config)` despacha por `STEP`. El primer paso **export** abre el form; el paso **generar** respeta `dryRun` (modo simulación: llena todo pero NO clickea Generar). Un paso caído **corta** el loop (el form quedaría a medias). `reconcileOnInit` marca interrumpido si un reload mató un run reclamado; `claimWatchdog` (3.5s) → `not-detected` si ningún frame tiene la página/form.

**UI popup (`sections/reporte.js`):** `<select>` de categoría (solo TV por ahora), resumen de lo que se seleccionará (con el filename calculado), toggle **Modo simulación**, Iniciar/Detener/Limpiar, progreso por paso + `<details>` 50 logs. Persiste borrador `{categoryId,dryRun}` en `solotodo:draft`. Live vía `storage.onChanged`.
**Debug `__extLgeCl.solotodo.`:** `diagnose()`, `detected()`, `selectors()`, `labels()`, `categories()`, `form()` (estado actual del form), `openExportForm()`, `selectSingle({label,value})`, `selectMultiple({label,values})`, `fillFilename({value})`, `clickGenerar()`, `runCategory({categoryId?,dryRun=true})` (llenado completo end-to-end sin run store), `state()`, `draft()`, `stop()`, `reset()`, `tick()`.
**Pendientes/limitaciones:** solo la categoría TV; no distingue múltiples tabs; sin reintento por paso (corta al primer error); las opciones de los Autocomplete se asumen presentes (si SoloTodo cambia nombres de tiendas, el match exacto fallará y se reporta con muestra); tras Generar no se verifica el envío (queda a cargo del correo).
