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
│       ├── delivery-tag.js   Aplica Tag de Delivery dentro del modal + STG + PROD
│       ├── product-tag.js    Aplica 1-2 Product Tags dentro del modal + STG + PROD
│       └── offer-tag.js      Aplica 1-4 Tags de Oferta dentro del modal + STG + PROD
└── popup/
    ├── view.js               Sub-router del feature (tabs entre secciones)
    ├── utils.js              Helpers comunes (escapeHtml, etc.)
    └── sections/             Una sub-vista por archivo
        ├── reader.js         Lectura de pantalla (filtros + grid)
        ├── delivery-tag.js   Form + port + progreso + persistencia
        ├── product-tag.js    Form (1-2 tags) + port + progreso + persistencia
        └── offer-tag.js      Form (4 ofertas) + port + progreso + persistencia
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

## Logs por scope (`Ajustes`)

El logger soporta habilitar/deshabilitar logs por scope (módulo). Cada vez que un archivo hace `logger('foo')`, el scope `foo` queda registrado y aparece en la UI de Ajustes (`features/ajustes`).

**Cómo funciona:**
- `src/shared/log-config/index.js` mantiene la cache de scopes habilitados en memoria y la persiste en `chrome.storage.local` con la key `log-config:scopes`. Cross-context vía `chrome.storage.onChanged`.
- `src/shared/utils/logger.js` chequea `isScopeEnabled(scope)` antes de emitir cada log. Si el scope está apagado, no se imprime nada (independiente del nivel global).
- Default: todos los scopes habilitados. El usuario los apaga uno a uno (o todos) desde la UI.
- `Ajustes` lista todos los scopes registrados + un fallback hardcoded para que aparezcan aunque no se hayan invocado todavía. Toggle individual + botones "Habilitar/Deshabilitar todos".

**Scopes actuales:**
- `colocar-tags` — handler central del feature (content script).
- `colocar-tags:product` — flow de Tag de Producto (logs MUY detallados: snapshot por fase, estado de cada checkbox, comboboxes, etc.).
- `colocar-tags:offer` — flow de Tag de Oferta (snapshot de las 4 filas pre-fill/pre-save, estado de row chk / use / fechas por oferta).
- `colocar-tags:combobox` — driver del combobox L-* (selección de tag/group/category).
- `lead-times` — flow Magento (state machine, parsers, filtros).
- `cupones` — feature Cupones (content + popup + state machine, ver "Feature: Cupones").
- `content` — content script genérico.
- `debug` — instalación de la API de debug en `window.__extLgeCl`.
- `popup` — popup root.

Cualquier feature nueva puede crear su propio scope con `logger('mi-scope')` y aparecerá automáticamente en Ajustes.

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
- ✅ Sub-router de secciones dentro del popup (Lectura | Tag Delivery | Tag Producto | Tag Oferta)
- ✅ **Feature "Lead Times":** automatización end-to-end del flujo Magento Manage Address Level 2 con state machine multi-página, persistido en `chrome.storage.local`, popup con múltiples regiones + progreso live + stop de emergencia
- ✅ Feature "Colocar TAGs" — Tag de Producto: flow end-to-end con 1 ó 2 tags por SKU (3 selectores encadenados + type + schedule por tag), streaming por port, cancelación y persistencia
- ✅ Feature "Colocar TAGs" — Tag de Oferta: flow end-to-end con 1 a 4 ofertas por SKU (Gift/Discount/Coupon/Truck → row chk + use + descripción + rango de fechas), streaming por port, cancelación y persistencia
- ✅ **Feature "Cupones"** — sección "Quitar Regla de Cupón": batch por ID o por Rule sobre Cart Price Rules (Magento legacy admin), state machine multi-página, popup con textarea + radio + progreso live + stop
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
   - `applyProductTags({ tags, skipProd, userType: 'ALL' })` ejecuta en 3 FASES:
     - **FASE 1 — llenar campos por fila (orden 1 → 2), SIN marcar el row chk:**
       1. `select#productTagCategory<N>` ← `category` (Product/Promotion).
       2. Combobox `#productTagGroup<N>` ← `group` (depende de category, esperamos a que se populen los `<li>`).
       3. Combobox `#productTag<N>` ← `tag` (depende de group).
       4. `select#productTag<N>Type` ← `type` (gradient/solid/line).
       5. `select#useType<N>` ← `ALL` (el id `#productTag<N>UserType` está duplicado en un hidden, hay que tomar el visible).
       6. Setear `#productTag<N>BeginDay/BeginTime/EndDay/EndTime` via `setDateRange`.
       7. Marcar `#productTag<N>UseFlag`.
     - **FASE 2 — re-setear `productTag<N>Type` (1 → 2)**: el handler `productTagCategory2.on('change')` pisa `productTag1Type` según combinación cat1/cat2. Tras llenar ambas filas, reaplicamos el `type` que pidió el usuario.
     - **FASE 3 — marcar `#productTag<N>Chk` (1 → 2), con `sleep(150)` entre cada uno**: el row chk es lo que le indica a GP1 "esta fila tiene data nueva, inclúyela en el save". Marcarlo al final actúa como el "commit" explícito.
     - Click `SAVE TO STG` → confirm YES → ack OK.
     - Si `!skipProd`: SAVE PROD + confirm + ack. GP1 cierra el modal solo tras el último OK.
4. Mismo protocolo de progreso por SKU que delivery; los pasos del flujo de cada tag llevan `detail.tagIndex` para que el popup pinte "Tag 1 — Setteando Type" / "Tag 2 — …".

**Quirk crítico — dirty trigger via `#productTag2Chk` (descubierto manualmente por el usuario):** GP1 tiene un bug en su dirty-tracking: marcar `#productTag1Chk` (y llenar todos los campos de la fila 1) NO le alcanza a `formSubmit()` para detectar cambios — sigue saliendo "No changes were made.". Pero si se toca `#productTag2Chk` (incluso aunque la fila 2 esté vacía), GP1 SÍ reconoce los cambios y guarda la fila 1. Mismo síntoma se observó: cerrar el modal y reabrirlo "destraba" el dirty-tracking porque GP1 re-considera los datos como recién cargados.

**Workaround implementado** (`flows/product-tag.js → dirtyTriggerTag2`, FASE 4 del orquestador): después de marcar los `#productTagNChk` y antes del save, **marcamos `#productTag2Chk` y lo dejamos marcado**. Si ya estaba marcado por tener 2 tags, hacemos OFF→ON para que el último change event tenga la transición unchecked→checked que GP1 detecta. **Importante**: un toggle que vuelva al estado original NO funciona — GP1 compara estado actual vs snapshot inicial; si vuelve a unchecked, no detecta cambios. Por eso lo dejamos marcado. GP1 ignora silenciosamente las filas con `productTag2Chk` marcado pero sin tag value, así que dejarlo marcado con campos vacíos es seguro (confirmado por el usuario manualmente).

**Quirk crítico — "No changes were made." con retry automático (defense in depth):** GP1 reporta "No changes were made." al primer `formSubmit()` aunque los campos estén llenos correctamente. Comprobado por el usuario: si se cierra ese popup a mano y se vuelve a clickear "SAVE TO STG" SIN tocar nada, el save funciona. Sospechamos que el dirty-tracking de GP1 depende del orden o trust de eventos sintéticos que no logramos satisfacer al 100% con `dispatchEvent`. **Solución pragmática**: `performSave` (en `flows/product-tag.js`) race-detecta el outcome del save:
  - Si aparece el confirm box ("all selected rows of information") → flujo normal YES → OK.
  - Si aparece "No changes were made." → click OK, espera 300 ms, **reintenta el save una vez**. Emula exactamente la acción manual del usuario que destraba el bug.
  - Si tras el retry persiste → throw con mensaje claro.

**Otros mitigantes que se aplican antes de cada save:**
1. El row chk (`#productTag<N>Chk`) se marca AL FINAL, en FASE 3 (ver flujo arriba). Si se marca antes de los campos, GP1 toma snapshot del estado vacío y el dirty-tracking falla más seguido.
2. `setChecked` (`src/shared/dom/events.js`) usa `el.click()` nativo en vez de `dispatchEvent(MouseEvent('click'))` para que los eventos `click → input → change` se disparen en el orden real del navegador y el state del checkbox se toggle vía el motor del browser (no manualmente). Es lo más cercano a un click real sin tener `isTrusted: true`.
3. `performSave` hace `document.activeElement.blur()` antes de clickear SAVE para forzar el commit perezoso de datepickers/inputs que aún tienen focus.

**Quirk — Type pisado por handler de cat2:** Si la combinación es `cat1='Promotion' + cat2='Product'` (o `cat2='Promotion'`), `productTagCategory2.on('change')` (líneas 11691-11713 de Pedida.md) fuerza `productTag1Type` a un valor concreto y pisa lo que hayamos seteado al llenar la fila 1. Por eso la FASE 2 re-aplica los Type al final, después de que ambas categorías estén comprometidas.

**Quirk — crash benigno de GP1 al abrir modal sin tags previos:** El init de `offerRetrieveModelBasicInfo.js` hace `tagArray[category1][group1].forEach(...)` sin null-check. Para SKUs sin tags previos, `category1=''` y `group1=''` → `tagArray[''][''].forEach` → `TypeError: Cannot read properties of undefined (reading '')`. Es un bug de GP1, no nuestro. Es **benigno**: los handlers `.on('change')` ya quedaron registrados antes del crash, y nuestro flow re-cascadea los populates al setear category/group, así que el modal funciona igual.

**Particularidad del combobox de Product Tag:** los `<ul role="listbox">` de los combos comparten IDs (`cb1-listbox`, `cb2-listbox`) — HTML técnicamente inválido pero existente. Por eso `selectComboboxByInput` (en `gp1/combobox.js`) resuelve el botón y el listbox desde el input usando `input.closest('.combobox.combobox-list')` en vez de querySelector por id. Además espera a que el listbox tenga `<li>` antes de buscar la opción, porque los combos están encadenados (group depende de category, tag depende de group) y el populate es asíncrono.

**Tags dinámicos en GP1 — no se hardcodean.** Las opciones de `productTagGroup<N>` y `productTag<N>` (también el listbox de delivery `cb2-listbox`) las populates el backend de GP1 por SKU. Pueden cambiar producto a producto y no hay forma de validar contra una lista cerrada del lado de la extension. El driver `commitComboboxSelection` intenta match exacto + case-insensitive como fallback y lanza `ComboboxOptionNotFoundError` (en `gp1/combobox.js`) con muestra de las opciones disponibles si no encuentra. El handler central (`runSkuBatch` en `content/index.js`) atrapa esa excepción y reporta el SKU como ERROR claro al popup en vez de cascadear timeouts.

**Pre-flight modal entre SKUs.** Antes de cada `searchProductBySku`, `ensureCleanModalState()` drena messageboxes residuales (intenta OK/YES/NO en orden, hasta 4 veces) y cierra el modal #dialog2 si quedó abierto desde un SKU anterior con error. Si tras eso el modal sigue abierto, el SKU se marca ERROR con `step: 'pre-modal-open'` y se continúa con el siguiente. Esto evita la cascada típica de "el primer SKU falla → todos los siguientes fallan porque el modal residual cubre el form".

**Watchdog en el popup.** `attachPortWatchdog` (en `popup/utils.js`) dispara en 12s si el port no recibió ningún mensaje del content script. Cubre el caso donde la pestaña activa no es GP1 o no está en MIM — el handleConnect del content script ignora silenciosamente y sin el watchdog el popup quedaría spinneando indefinidamente.

**Validación de fechas centralizada.** `content/validators.js#validateDateTimeRange` chequea formato (YYYY-MM-DD / HH:MM) **y semántica** (beginDay ≤ endDay; si mismo día, beginTime ≤ endTime). Lo usan tanto el flow de Delivery como el de Product Tag — antes había dos validaciones distintas.

**Quirk del `keyup` sintético en comboboxes GP1:** `setInputValue` (`src/shared/dom/events.js`) tiene que despachar el `keyup` como `KeyboardEvent` con `key` definido (usamos `'Unidentified'`). Si se despacha como `Event` genérico, `event.key` es `undefined` y el handler de GP1 `ComboboxAutocomplete.onComboboxKeyUp` → `isPrintableCharacter` crashea haciendo `event.key.length`. Síntoma observado: el `<select id="productTagNType">` queda a medio popular (solo `Line` + `pointer-events:none`), `setSelectValue` no encuentra `gradient`/`solid` y aparece el messagebox "No changes were made.". `'Unidentified'` no es printable (length ≠ 1) así que no dispara la búsqueda de autocomplete.

**Quirk del datepicker GP1 — orden de seteo de rangos:** GP1 valida en tiempo real "From ≤ To" en los inputs de fecha. Si el producto ya tenía un tag con `endDay` viejo y la nueva configuración tiene un `beginDay` posterior a ese viejo `endDay`, el front rechaza el set transitorio y dispara *"The From Date is earlier than To Date can not be input"*. `gp1/daterange.js#setDateRange` evita el rebote: primero empuja `endDay/endTime` a un sentinel (`2099-12-31 / 23:30`) para destrabar la constraint previa, después setea begin y por último end con los valores reales. Lo usan tanto el flow de Delivery como el de Product Tag.

**Limitaciones reportadas por el usuario:**
- Si un producto ya tiene 2 tags y se manda 1 nuevo, el 2° se sobrescribe (queda sólo el 1° nuevo). Comportamiento del sistema, no del flow.
- Si se mandan 2 tags, se aplican en orden (1 → 2). El flow ya cumple esto.

**Reorganización del handler `content/index.js`:** los tres puertos (`DELIVERY_RUN`, `PRODUCT_RUN` y `OFFER_RUN`) comparten el mismo loop `runSkuBatch`, parametrizado vía `PORT_RUNNERS[port.name].runPerSku`. Esto evita duplicar manejo de SkuNotFoundError, WaitAbortedError y reporting de progress.

**Tag de Oferta — flujo (etapa 4):**

Pantalla objetivo: la tabla **"Additional Disclaimer Text"** dentro del mismo modal MIM (`#dialog2`). Son **4 filas fijas** por tipo de oferta, en orden por índice (1=Gift, 2=Discount, 3=Coupon, 4=Truck). La columna "Icon" sólo muestra ícono + nombre (read-only); el **índice de fila** determina el tipo, no se parsea texto. El usuario puede aplicar de 1 a 4 ofertas.

Estructura del DOM de cada fila N (prefijo `obsAdditionalDisclaimerText`, ver `OFFER_SELECTORS` en `constants.js`):
- `${prefix}${N}Chk` — checkbox de **selección de fila** ("row chk"). Marcarlo es lo que GP1 usa para detectar que la fila cambió e incluirla en el save (el dirty trigger del flujo de oferta — confirmado en Pedida.md).
- `${prefix}${N}Flag` — checkbox **"Use"** (activa/desactiva la oferta).
- `${prefix}${N}Msg` — input de texto **"Description"**.
- `${prefix}${N}StartDate` / `${prefix}${N}EndDate` — inputs de fecha **YYYY-MM-DD, SIN hora** (datepickers `datePick`).

1. Popup recolecta: `skus[]` + las ofertas activadas, cada una `{ index, label, use, description, startDate, endDate }`, más `skipProd` global. Persiste el estado completo de las 4 ofertas en `chrome.storage.local` (key `colocar-tags:offer:last-config`) para repoblar el form.
2. Popup abre port `colocar-tags:offer-run` con `START + config`.
3. Content (frame que detecta MIM) itera SKUs:
   - `searchProductBySku(sku)` — idéntico a Delivery/Product.
   - `applyOfferTags({ offers, skipProd })` por cada oferta, en orden de índice:
     1. Marca el row chk (`...Chk`) — **siempre**, es el dirty trigger.
     2. Setea el checkbox "Use" (`...Flag`) según el toggle del usuario.
     3. Setea la Description (`...Msg`) si vino.
     4. Setea Start/End Date (`...StartDate`/`...EndDate`) si vinieron, vía `setDateOnlyRange` (variante sólo-fecha de `gp1/daterange.js`, mismo sentinel `2099-12-31` para no rebotar contra la constraint "From ≤ To").
   - Click `SAVE TO STG` → confirm YES → ack OK (con el mismo retry ante "No changes were made." que Product Tag, como defensa en profundidad).
   - Si `!skipProd`: SAVE PROD + confirm + ack. GP1 cierra el modal solo tras el último OK.
4. Mismo protocolo de progreso por SKU; los pasos llevan `detail.offerIndex` / `detail.offerLabel` para que el popup pinte "Gift — Setteando fechas", etc.

**Validación de oferta (popup + `validateOffers` en el flow):** si la oferta queda activa (`use` marcado), se exigen Description + Start + End Date. Si `use` está desmarcado (desactivar una oferta existente), las fechas/descripción son opcionales. Las fechas usan `validateDateRange` (sólo fecha, start ≤ end) en `content/validators.js`.

**Comandos debug expuestos** (todos bajo `__extLgeCl.colocarTags.`):
- `diagnose()` — diagnóstico completo del frame.
- `check()` — `{selector: bool}` por cada selector contra el DOM actual.
- `find(key)` — `document.querySelector(SELECTORS[key])`.
- `iframes()` — lista de iframes con id/name/src.
- `frameInfo()` — `{ url, title, isTopFrame }`.
- `parse()` — corre el parser y devuelve el resultado.
- `selectors()` — copia del mapa de selectores.
- `checkProductTagRow(i)` — estado de los selectores de la fila i (1 o 2).
- `snapshotProductTags()` — **muy útil para debug del "No changes were made.":** imprime `console.table` con el estado completo de ambas filas (rowChk, category, group, tag, type, useFlag, userType, fechas). Llamarlo a mano en la consola DESPUÉS de que el flow termine para inspeccionar qué quedó vs qué se esperaba.
- `checkOfferRow(i)` — estado de los selectores de la fila i (1..4) de Tag de Oferta.
- `snapshotOfferTags()` — `console.table` con el estado de las 4 filas de oferta (rowChk, use, description, startDate, endDate).
- `runOffer({sku, offers, skipProd?})` — corre 1 SKU end-to-end loguendo por consola.

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

## Feature: Cupones (Magento)

Pantalla objetivo: **Cart Price Rules** (`/obsadm/sales_rule/promo_quote/index/...`) y la página de edición de cada cupón (`/obsadm/sales_rule/promo_quote/edit/id/<N>/...`). Igual que lead-times, cruza navegaciones full-page entre listing y edit.

Sub-secciones (sub-router en `popup/view.js`):
- **Quitar Regla de Cupón** — elimina TODAS las condiciones (Conditions) del bloque "Actions" del cupón y guarda. Es el único sub-flujo implementado por ahora; la estructura tabbed está lista para sumar más.

**Estructura:**
```
src/features/cupones/
├── constants.js              SELECTORS, STORAGE_KEYS, ITEM_STATUS, SEARCH_BY, PAGE_TYPE, EDIT_URL_RE, LISTING_URL_RE
├── state.js                  get/set/clear/update del run + appendLog (chrome.storage.local)
├── debug.js                  Comandos __extLgeCl.cupones.*
├── content/
│   ├── detector.js           detectPage() → { type: 'listing'|'edit'|'other', editId? } + diagnose()
│   ├── parser.js             parseListingRows() / getActiveFilters() / getRowCount()
│   ├── index.js              init() — tick inicial + listener de storage.onChanged
│   ├── magento/
│   │   ├── filters.js        clearFilters / applyFilter (rule_id o name) + waitForGridReady — pressEnter sintético
│   │   └── edit-page.js      openActionsCollapsible / removeAllConditions / clickSave / leaveEditPage
│   └── flows/
│       └── run.js            tickIfActive() — state machine; onListing / onEdit / finalize
└── popup/
    ├── view.js               Sub-router (preparado para más secciones)
    ├── utils.js              escapeHtml / formatTime / parseQueries (split por líneas/comas/;)
    └── sections/
        └── remove-rule.js    Form (radio ID/Rule + textarea cupones) + start/stop + progreso + log
```

**Modelo de estado (`chrome.storage.local["cupones:run"]`):**
```ts
{
  active: boolean,
  startedAt, finishedAt, finishReason?,
  searchBy: 'id' | 'rule',
  currentItemIndex: number,
  items: [{
    query: string,                          // ID o nombre tal como lo escribió el usuario
    status: ITEM_STATUS,                    // pending|searching|editing|ok|error|not-found
    matchedRuleId?: number,                 // id real una vez encontrado en el grid
    matchedName?: string,                   // nombre real
    editHref?: string,
    removedConditions?: number,
    savedAt?: number,
    error?: string,
  }],
  log: [{ ts, level, message }],            // cap 400
}
```

**Detección de página** (`content/detector.js`):
- `EDIT_URL_RE = /\/sales_rule\/promo_quote\/edit\/id\/(\d+)/i` → `type: 'edit'`, `editId: N`.
- `h1.page-title === 'Cart Price Rules'` o URL listing + grid presente → `type: 'listing'`.
- Cualquier otra → `type: 'other'` (ignorada).

**State machine** (`flows/run.js`):
- `tickIfActive()` se invoca en `init` (tras 300 ms para dejar montar el grid legacy) y en cada `chrome.storage.onChanged` del key del run. Sólo top frame; guard de reentrancia con `running` flag.
- **onListing:**
  1. Si algún item quedó EDITING (volvimos del edit con save OK) → marcarlo OK + log.
  2. Si no quedan PENDING → `finalize({ reason: 'done' })`.
  3. Tomar el siguiente PENDING, marcarlo SEARCHING.
  4. `waitForGridReady` → `clearFilters` (el usuario lo pidió explícitamente entre cupones) → `applyFilter({ searchBy, value })`.
  5. `findMatchingRow(searchBy, query)`:
     - `id` → match exacto por `ruleId` numérico; fallback: si quedó 1 sola fila, esa.
     - `rule` → match exacto por nombre (case-insensitive, trim); fallback: si quedó 1 sola fila, esa.
     - Si nada → NOT_FOUND + warn, próximo tick.
  6. Match → guardar `matchedRuleId`, `matchedName`, `editHref`, marcar EDITING y `window.location.href = editHref`.
- **onEdit:**
  1. Buscar el item EDITING cuyo `matchedRuleId === page.editId`. Si no matchea, log warn y salir (no procesar).
  2. `openActionsCollapsible()` — click en `div[data-index="actions"] .fieldset-wrapper-title` si `data-state-collapsible="closed"`; espera a que el árbol esté montado.
  3. `removeAllConditions()` — loop: mientras existan `a.rule-param-remove` dentro del bloque Actions, click el primero y espera a que el conteo decrezca. Max 50 iteraciones por seguridad. Devuelve cuántas eliminó.
  4. `clickSave()` — `blur()` previo del activeElement, luego click `#save`. Magento navega solo al listing.
  5. **No** marcamos OK acá; lo hace el próximo tick al detectar listing (mismo patrón que lead-times: así sabemos que Magento efectivamente navegó).
  6. En error: marcar ERROR, log y `leaveEditPage()` (limpia `window.onbeforeunload` + click `#back`).

**Comunicación popup ↔ content:** únicamente vía `chrome.storage.local` + `chrome.storage.onChanged`. Mismo razonamiento que lead-times — los page reloads cerrarían cualquier port.

**Quirk del grid legacy de Magento (Cart Price Rules):**
- El grid tiene botones reales **Search** y **Reset Filter** (sí — descubrimos que existían tras un primer intento fallido con Enter sintético). Selectores: `button[data-action="grid-filter-apply"]` y `button[data-action="grid-filter-reset"]`. Sus `onclick` (declarados inline en la página) llaman directamente a `promo_quote_gridJsObject.doFilter()` y `.resetFilter()`. Usar estos botones es lo robusto.
- **Por qué NO usar Enter sintético:** los handlers legacy de Magento (prototype.js) verifican `event.keyCode == 13`, pero `new KeyboardEvent('keypress', { keyCode: 13 })` deja `keyCode` en 0 incluso con el init dict. Aún sobreescribiendo el getter vía `Object.defineProperty`, el handler está bound al form (no al input), y no siempre dispara. Resultado real observado: el value queda escrito en el input pero la grid no recarga, y los items terminan como NOT_FOUND con muestra de IDs del grid sin filtrar.
- **Por qué NO inyectar `<script>`:** la CSP de Magento bloquea inline scripts (`"Executing inline script violates the following Content Security Policy directive"`). El click nativo en el botón existente sortea ese bloqueo porque el `onclick` ya está declarado en la página.
- **Cómo clickeamos:** `el.click()` nativo, NO `dispatchEvent(MouseEvent('click'))`. Para botones legacy con `onclick = function(){ ... }` (declarados por un inline `<script>` de Magento que itera con `forEach(element => element.onclick = ...)`) el `.click()` activa el handler de manera idéntica al click real. `dispatchEvent` puede fallar silenciosamente en ese setup.
- **Modo AJAX vs nav full-page:** Magento puede operar el grid en modo AJAX (refresh in-place) o no-AJAX (`setLocation` con el filtro en base64 en la URL). En modo nav el page reload corta el tick a mitad y deja el item en SEARCHING. `onListing` retoma items en estado `SEARCHING && !matchedRuleId` al próximo tick; si `isFilterAppliedFor(searchBy, query)` retorna true (los inputs ya muestran el query desde la URL), saltamos `clearFilters` + `applyFilter` y vamos directo a `findMatchingRow`.
- `applyFilter()` / `clearFilters()` esperan el refresh detectando cambio de snapshot del grid (`{count, firstRuleId}`) en lugar de un chip de filtro activo (el grid legacy no tiene esa señal).

**Modos de búsqueda (`SEARCH_BY`):**
- `id` — usa el input `#promo_quote_grid_filter_rule_id`. Comparación numérica exacta.
- `rule` — usa el input `#promo_quote_grid_filter_name`. El filtro de Magento es contains, por eso el código exige match exacto (case-insensitive) o fallback a "única fila restante".
- **No se pueden mezclar** en un mismo batch — el popup tiene radio buttons y valida que sea uno u otro. Si el usuario eligió `id` y alguna entrada no es numérica, se aborta con alert.

**Eliminación de condiciones (Actions):**
- El árbol vive en `div[data-index="actions"] .rule-tree`. Cada condición es un `<li>` con un `<a class="rule-param-remove">` ("X" rojo).
- La condición fija que abre el árbol (`If ALL of these conditions are TRUE:`) y la opción "+" para agregar nueva NO tienen `.rule-param-remove`, así que el selector las ignora naturalmente.
- **Activación del handler:** `target.click()` nativo (no `dispatchEvent`). Síntoma observado con dispatchEvent: visualmente la condición se elimina **a veces** pero el listener no corre de forma consistente, y nuestro código quedaba esperando indefinidamente. `.click()` lo activa de manera idéntica al click del usuario.
- **Detección de eliminación:** retenemos la referencia al `<li>` target antes del click y esperamos a que salga del DOM (`!document.body.contains(targetLi)`) — más confiable que contar botones porque el rule editor a veces re-renderiza el árbol completo. Caso B (fallback): si el conteo total baja respecto al snapshot pre-click, también lo damos por bueno.
- Anidación (combinaciones dentro de combinaciones): el selector `a.rule-param-remove` matchea cualquier profundidad. Cada click elimina su `<li>` con sus hijos.

**Selectores Magento clave** (`constants.SELECTORS`):
- `h1.page-title` → detección de listing.
- `#promo_quote_grid_table` → tabla del grid legacy.
- `#promo_quote_grid_filter_rule_id` / `#promo_quote_grid_filter_name` → inputs de filtro.
- `button[data-action="grid-filter-apply"]` → botón **Search** (dispara `doFilter()`).
- `button[data-action="grid-filter-reset"]` → botón **Reset Filter** (dispara `resetFilter()`).
- `#promo_quote_grid_table tbody tr[data-role="row"]` → filas.
- `td[data-column="rule_id"]` / `td[data-column="name"]` → celdas con ID y Rule name.
- `td[data-column="action"] a` → link "Edit" hacia el edit page.
- `div[data-index="actions"]` → bloque colapsable Actions de la página de edición.
- `div[data-index="actions"] .rule-tree a.rule-param-remove` → botones X de cada condición.
- `#save` / `#back` → botones del page-main-actions.

**MUY IMPORTANTE:** el botón `#delete` (al lado de `#save`) NUNCA se toca. El driver sólo conoce `#save`, `#back` y los `rule-param-remove`. Tampoco se toca el botón `#save_and_continue`.

**Comandos debug** (todos bajo `__extLgeCl.cupones.`):
- `diagnose()`, `page()`, `selectors()`, `check()`, `parseRows()`, `filters()`, `rows()`.
- `state()` — devuelve el run persistido.
- `stop()` — marca el run como inactivo (no detiene un tick en vuelo).
- `reset()` — borra todo el storage del run.
- `tick()` — fuerza un tick del state machine en este frame.

**UI del popup:** radio `ID | Rule (nombre)` + textarea con los cupones (uno por línea o separados por coma/punto y coma), botones `Iniciar` / `Detener` / `Limpiar`, barra de progreso, lista de items con estado por cupón + el nombre real cuando se encuentra, y un `<details>` con los últimos 50 logs. Refresco live por `storage.onChanged`. Persiste `{ searchBy, rawQueries }` como último config.

**Pendientes / no resueltos:**
- Si hay múltiples tabs de Magento abiertas, el run no distingue (igual que lead-times).
- No hay reintento automático si un cupón falla al eliminar condiciones; queda ERROR y se sigue.
- No se guarda historial de runs (sólo el último + el último config).
- Si el grid legacy tarda más de 15 s en refrescar tras Enter, el filtro vence con timeout.

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
