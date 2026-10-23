# Crear Promo-Id

Pantalla: **GP1 > PROMOTION > Promotion Management** (`/admin/promotionManage/cudPromotionManageForm.lg`, menu `MN09010100`). Solo abre dentro de la red de LG: afuera GP1 responde **403 Forbidden** y hay que conectar la VPN de la extension. Login: usuario + clave + **codigo por correo** (vale 20 min).

Una corrida = **una promo** con su lista de SKUs, hasta **SAVE TO STG**. No hay paso de "verificar" (pedido del usuario, 2026-10-16): se aprieta **Crear** y la corrida busca los SKUs en el catalogo, **crea la promo con los que existen** y reporta los que no (no existe / ambiguo / repetido). El **SAVE TO PROD lo hace la persona** (decision del usuario, 2026-10-16): al terminar, la promo queda marcada en el listado STG para que solo apriete el boton.

Flujo grabado con Registro de acciones (`example/registro_1 (1) (1).md`, 2026-10-16): NEW → Title → NEW (modelos) → Category → SEARCH → marcar filas → SELECT → Main Model → SAVE TO STG → YES → OK → marcar la fila `PM########` → SAVE TO PROD → YES → OK.

## Archivos
- `parse-input.js` (puro): `parseSkuText` (uno por linea, coma/;/tab, ignora `#` y encabezado), `parseSkuMatrix` (columna SKU/Sales Model/Model/Product ID o la primera), `csvToMatrix`.
- `resolve.js` (puro): `resolveSkus(skus, catalogRows, {categoryMode})` → `{ models, notFound, ambiguous, repeated, rowCount }`; `itemsFromResolution` (estado por SKU en el orden pegado); `pickMainModels(models, mainSkus)` (Main Model opcional por SKU; si no dan 1 o 3, cae a los 3 primeros y avisa); `validateConfig` (lo validable antes de tocar GP1).
- `trace.js`: **registro tecnico**. Popup y content escriben cada uno en su key (`crear-promo-id:trace:popup|content`, cap 400, escrituras agrupadas) y el popup los mezcla por hora en el panel "Registro tecnico" (Copiar / Descargar .txt con encabezado de version, navegador, pestana y corrida). Traza: deteccion de la pantalla, clicks, cada op del bridge con ms, resolucion de SKUs, textos de los messagebox, errores con fase.
- `content/catalog.js`: catalogo cacheado 10 min por frame.
- `content/bridge.js` (**mundo MAIN**, `all_frames`, solo `/admin/promotionManage/*`): ops `state`, `catalog`, `list`, `add-models`, `set-main`, `set-dates`, `mark-stg-row`. No guarda nada.
- `content/flows/run.js` (aislado): la corrida. Clicks y messagebox con los helpers GP1 de `colocar-tags/content/gp1/messagebox.js`.
- `content/index.js`: mensajes one-shot `PING` / `START` (`RESOLVE` queda solo para depurar) (el content responde al toque y sigue solo; avance por `chrome.storage`, key `crear-promo-id:run`).
- `popup/view.js`: formulario + SKUs (pegar o CSV/Excel via `shared/ui/file-intake.js`) + Main Model opcional + progreso por fase y por SKU + registro tecnico.

## La pantalla por dentro (RUI)
- Todo es **RUI** (`Rui.data.LDataSet`, `Rui.ui.grid.LGridPanel`, `Rui.ui.LDialog`). Los botones son `#<id>-button`; los ids `L-gen*` cambian en cada carga (no usarlos).
- Lecturas: `POST /common/rui/retrieveDataList.lgajax` con `queryStr` + `dataSetId` + `schema` (`save`=STG, `publ`=PROD). Responde `[{metaData, records}]`.
  - Super categorias: `Products.retrieveModelCategoryList` (`categoryLevelNo=1`, `typeCode=B2C`) → 7 en CL.
  - Modelos de una categoria: `promotionManage.retrieveCategoryModelList` (`queryCategoryCode=<super>`, schema `publ`). Sin filtro de modelo trae todo: **catalogo B2C completo = 1.026 filas en ~5 s** (7 peticiones en paralelo).
  - Listado: `promotionManage.cudPromotionManageList` (`schFromDate/schToDate/schTitle`), mas nuevo primero.
  - Detalle de una promo: `cudPromotionManageInfo`, `cudPromotionManageCategoryInfo` (modelos), `cudPromotionCategoryMapList`.
- Guardado STG: `cudPromotionManage.lgajax` (lo arma la pagina con `LDataSetManager`); publicar: `cudPromotionManagePublish.lgajax` (no se usa).
- **La carga por Excel de modelos esta apagada para CL** (`promotionModelUploadUseFlag = "N"`): por eso se va por el popup de modelos.

## Quirks
- **Un modelo = varias filas.** El catalogo trae una fila por ruta de categoria (RNC5 sale en 7). Las promos reales llevan todas (PM00039928: 151 filas, 69 modelos) → modo por defecto **"Todas sus categorias"**; opcion "Solo la primera".
- **Main Model: 1 o 3 filas** con `mainModelFlag = Y` (LGEIS-154; con 2 rechaza "at least 1 and maximim 3 main model"). Se marca Y solo en la **primera fila** de cada modelo elegido (la pagina cuenta filas, no modelos). Por defecto los 3 primeros de la lista (o 1 si hay menos de 3).
- **`m2CategoryModelDataSet` es local a un closure.** El bridge engancha `LDataSet.prototype.clearData` y lo captura cuando `cudModelPopup` lo limpia al abrir el popup "Model". Se cargan las filas con `newRecord()` + `set()` (no `loadData`, que rompe con este formato), se marcan con `setMark` y se aprieta `#modelSelectBtn-button`: corre el codigo de la pagina (Order, OBS Price=Y, Review=Y, lista de categorias). Por partes de 40 filas.
- `mPromotionDataSet`, `stgDataSet`, `mPromotionStartDate`/`mPromotionEndDate` (LDateBox) **si** son globales. Title/Tag/Body Copy se llenan por DOM (`input[name=mTitle]`, etc.): la pagina los lee con `LDom.getValues('mform')`. Radios (Display Date `mDisplayDateUseFlag`, Review `mReviewUseFlag`, Hidden `mHiddenFlag`) con click nativo.
- **Iframe fantasma:** la pantalla trae un iframe oculto "Text Resize Monitor" con la **misma URL**. `isPromotionPage()` exige ademas `#newBtn-button`; sin eso ese frame respondia `START` y corria una segunda corrida en paralelo que pisaba el resultado. Y como RUI arma el boton despues de `document_idle`, el listener se engancha por URL y se decide por boton al recibir cada mensaje.
- Messagebox: confirm "Do you want to save?" (YES/NO); exito "The operation was successful."; error "The operation was failed."; validaciones como alert con OK. Selector `.L-overlay.messagebox` (mismo que MIM).
- Tras el OK la pagina recarga el listado con las fechas del buscador; el Promo-Id se busca aparte (`list` por titulo y fechas, ids que no estaban antes del guardado) y despues se filtra el buscador por ese id y se marca la fila (`stgDataSet.setMark`).

## Estado de la corrida
`phase`: resolving → opening → filling → models → main → saving → finding → done. Latido `heartbeatAt` cada 3 s; el popup da la corrida por perdida a los 20 s sin latido. El frame dueno guarda `crear-promo-id:owner` en `sessionStorage`: si la pestana se recarga a mitad, `reconcileOnInit` la marca `interrupted` (y avisa si fue durante el guardado). Cancelar sirve hasta antes del YES; despues el guardado ya va.

**Simulacion** (casilla del popup): hace todo y en "Do you want to save?" responde **NO**; el formulario queda abierto para revisarlo. Medido 2026-10-16: 5 modelos / 29 filas / 3 Main Model en ~15 s, GP1 acepto todo.

## Problemas vistos en uso real (2026-10-16)
- **"Iniciar no hace nada"**: tras instalar/actualizar la extension, la pestana de GP1 abierta queda con el content viejo (desconectado) y no responde. Antes el boton quedaba deshabilitado sin explicar. Ahora el boton nunca se deshabilita en silencio: valida, busca la pantalla y, si no responde, dice que recargue y ofrece **Recargar pestana** (espera hasta 45 s a que GP1 cargue por la VPN). Se quito el `window.confirm` del popup.
- **Pegar una columna de Excel no pegaba**: Excel pone en el portapapeles el texto **y una imagen PNG** de las celdas; la zona de archivos (`shared/ui/file-intake.js`, listener de `paste` en el documento) tomaba la imagen y anulaba el pegado. Ahora solo intercepta archivos que calcen con su `accept` (`aceptaArchivo`) y, si el foco esta en un campo de texto con texto en el portapapeles, gana el texto.

## Probar
`npm run browser` + VPN de la extension (`vpn:conectar`, ver memoria de Informacion de Orden) + login con codigo por correo. Abrir la URL de la pantalla directa (funciona sin `main.lg`). Debug: `__extLgeCl.crearPromoId.{diagnose, bridge, catalog, resolve(texto), list(desde, hasta, titulo), state, reset}`.

## Pendiente
- Guardado real en STG + deteccion del Promo-Id + marcado en el listado: **sin probar todavia contra GP1** (todo lo anterior al YES si; simulacion desde el popup real con 20 SKUs QNED/LX/MRGB + 1 inexistente: 20/21, 33 filas, ~20 s).
- Solo B2C. Sin Campaign Info por modelo, imagen, OBS Group ni Spotlight.
- Agregar SKUs a una promo existente (hoy solo crea).
