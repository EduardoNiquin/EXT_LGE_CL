# E-promoters
Apartado para los e-promoters. **NO opera sobre una pestaña** (no tiene content script ni detector): es un procesador de datos puro que corre en el **service worker** y entrega un archivo. Sub-seccion actual: **Informe ordenes** (estructura tabbed lista para sumar mas).

## Informe ordenes
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
