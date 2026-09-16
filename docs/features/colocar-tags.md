# Colocar TAGs
Pantalla: **Marketing Info Mapping (MIM)** en GP1 (SPA), modal `#dialog2`.

**Detección (`detector.js`):** `isMarketingInfoMappingPage()` verifica `#aform`, `#LblockSearch`, `#tabView`, `#divGrid_stg`. `diagnose()` → `{ detected, missing, selectors, url, title, isTopFrame, iframes, iframeCount }`.

**Parser (`parser.js`):** `parseSearchForm()` (11 campos: site B2C/B2B, super/category/sub, salesModel, modelName, productId, modelStatus, modelType, promotionId, publish). `parseGrid()` detecta tab activa (STG/PROD), lee `tbody tr.L-grid-row`, extrae por fila rowId (clase `L-grid-row-rXXXX`), rowIndex, editIndex (de `onclick="fncModelPopup(N)"`), isSelected, salesModel, modelName, productId, pimSku, super/cat/sub, status, type, publish. Contadores `#mSelectCount`/`#mStgListCount`/`#mProdListCount`.

**Convenciones:** preferir Sales Model con sufijo (ej `24U421A-B.AWHQ`) sobre Model Name. Estados Model: ACTIVE/INACTIVE/DISCONTINUED (interesa ACTIVE).

**`searchProductBySku(sku)`** (común a todos los flows): setea `#productId`, click `#btnSearch-button`, espera fila cuya `.L-grid-col-salesModel` matchee exacto, click su `.L-grid-button` (`fncModelPopup(N)`), espera modal `#dialog2`.

**Mensaje único** `colocar-tags:get-page-data` → `{ ok, data?, reason?, diag? }` (incluye diagnóstico que el popup renderiza en `<details>` si falla).

**Texto messageboxes:** confirm STG/PROD = "all selected rows of information"; success = "successfully saved to STG"/"...to PROD".

## Tag de Delivery — port `colocar-tags:delivery-run`
Popup: `skus[]`, `tagLabel` (default "Despacho Gratis RM"), `beginDay/Time`, `endDay/Time`, `skipProd` (default true). Por SKU: `applyDeliveryTag` marca `#deliveryTagChk`, selecciona tag vía `selectComboboxByInput(#deliveryTag)` (los ids `cb2-*` están duplicados), marca `#deliveryTagUseFlag`, `#deliveryTagUserType=ALL`, setea 4 inputs fecha/hora, `formSubmit()` → confirm YES → ack OK. Si `!skipProd`: `formSubmitProd()` + confirm + ack.

## Quitar Tag de Delivery — port `colocar-tags:delivery-remove-run`
Inverso: desactiva. Popup solo `skus[]` + `skipProd`. Por SKU: marca `#deliveryTagChk` (dirty trigger/inclusión), **desmarca** `#deliveryTagUseFlag`, SAVE STG → YES → OK, opcional PROD. NO toca combobox ni fechas. Runner `DELIVERY_REMOVE_RUN`.

## Tag de Producto — port `colocar-tags:product-run`
Popup: `skus[]`, `tags[]` (1-2, cada uno `{category, group, tag, type, beginDay, beginTime, endDay, endTime}`) + `skipProd`. `applyProductTags` en fases:
- **F1 — llenar por fila (1→2) SIN marcar row chk:** `select#productTagCategory<N>` (Product/Promotion) → combobox `#productTagGroup<N>` → combobox `#productTag<N>` → `select#productTag<N>Type` (gradient/solid/line) → `select#useType<N>=ALL` (tomar el visible, el `#productTag<N>UserType` está duplicado en hidden) → `setDateRange` en `#productTag<N>BeginDay/BeginTime/EndDay/EndTime` → marca `#productTag<N>UseFlag`.
- **F2 — re-setear `productTag<N>Type` (1→2):** el handler `productTagCategory2.on('change')` pisa `productTag1Type`; reaplicar el type pedido.
- **F3 — marcar `#productTag<N>Chk` (1→2) con `sleep(150)` entre cada uno:** el row chk es el "commit" que indica fila con data nueva.
- **F4 — dirtyTriggerTag2** (ver quirk). Luego SAVE STG → confirm YES → OK. Si `!skipProd`: SAVE PROD + confirm + ack (GP1 cierra el modal tras el último OK).
Pasos llevan `detail.tagIndex`.

## Tag de Oferta — port `colocar-tags:offer-run`
Pantalla: tabla **"Additional Disclaimer Text"** en el modal MIM. **4 filas fijas** por índice (1=Gift, 2=Discount, 3=Coupon, 4=Truck); el índice determina el tipo, no se parsea texto. DOM por fila N (prefijo `obsAdditionalDisclaimerText`, ver `OFFER_SELECTORS`): `...${N}Chk` (row chk/dirty trigger), `...${N}Flag` (Use), `...${N}Msg` (Description), `...${N}StartDate`/`...${N}EndDate` (datepickers `datePick`, **solo fecha YYYY-MM-DD, sin hora**).
Popup: `skus[]` + ofertas activadas `{index,label,use,description,startDate,endDate}` + `skipProd`. Persiste estado de las 4 ofertas (`colocar-tags:offer:last-config`). `applyOfferTags` por índice: marca row chk (siempre) → Use → Description → `setDateOnlyRange` (variante solo-fecha de `gp1/daterange.js`, mismo sentinel). SAVE STG → YES → OK (con retry "No changes"), opcional PROD. Pasos llevan `detail.offerIndex`/`detail.offerLabel`.
**Validación (`validateOffers`):** si `use` marcado, exige Description+Start+End. Si desmarcado, opcionales. Fechas vía `validateDateRange` (solo fecha, start≤end).

## Quirks GP1 (críticos)
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
