# SellerCenter Falabella
Sitio **Salesforce (LWC)** — página de Soporte del Seller Center. Sub-secciones: **SoporteSeller — Detalle Orden** y **Buscar caso**. Completa automáticamente el acordeón "Detalle Orden" desde un CSV.
(Las **devoluciones** salieron de aquí a su propio apartado: ver *Feature: Devoluciones*.)

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
