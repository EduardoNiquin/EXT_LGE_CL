# EXT LGE CL
UTILIZA ESPAÑOL NEUTRAL, NADA DE ACENTOS.
Extensión Chrome + Edge (Chromium, Manifest V3). Modular, escalable, segura.

> **Este archivo es el núcleo.** El detalle de cada feature (quirks, selectores, estado, debug, pendientes) vive en `docs/features/<feature>.md`: **leer el doc de la feature antes de tocarla**, y actualizarlo al cambiarla. Índice al final.

## Stack
- **Bundler:** Vite 8 + `vite-plugin-web-extension` (entry points desde el manifest). Dev usa `vite build --watch`, NO `vite dev` (el CSP estricto bloquea el HMR server).
- **Tests:** Vitest 4 (`--passWithNoTests`) + happy-dom para los que parsean HTML (`// @vitest-environment happy-dom`). **Lint:** ESLint 10 (flat config). **Node:** 22 LTS. **Módulos:** ESM.
- **Packaging:** `web-ext` 10 (ZIPs para stores) + scripts propios para instalación corporativa por política.

## Estructura
```
EXT_LGE_CL/
├── .github/workflows/ci.yml   CI: lint + test + build chrome/edge
├── assets/icons/              PNG 16/32/48/128
├── docs/features/             Un .md por feature (detalle completo)
├── manifests/                 manifest.base.json (MV3 compartido) + .chrome/.edge (overrides)
├── scripts/                   pack-extension / generate-policy / build-installer / install.ps1 / build.js / package.js
│                              dev-browser.mjs + browser-eval.mjs (ver docs/browser-testing.md)
├── src/
│   ├── background/service-worker.js
│   ├── content/index.js       Debug API + init de features + runSkuBatch
│   ├── popup/                 popup.js (routing) + features.js (registro)
│   ├── options/
│   ├── features/<feature-id>/ Ver "Arquitectura de features"
│   └── shared/                api/ debug/ messaging/ storage/ utils/logger.js
│       ├── dom/               wait.js (waitFor/waitForElement/waitForGone/sleep + WaitTimeoutError/WaitAbortedError)
│       │                      events.js (setInputValue/setSelectValue/setChecked/clickEl/findByText)
│       │                      describe.js (cssPath/describeElement/textoAccesible/contextoTabla/esVisible)
│       │                      inventario.js (inventarioPagina: formularios, campos, botones, tablas, iframes)
│       ├── event-store/       Cola de eventos en IndexedDB (agregarLote + recorrer por cursor)
│       ├── errors/index.js    ExtError + toMessage + isAbortError + describeError
│       ├── dev-mode/index.js  Flag modo dev (`dev-mode:enabled`, cross-context)
│       ├── diagnostics/       Ring buffer de errores (`diagnostics:errors`) + installGlobalErrorCapture()
│       ├── run-store/         createRunStore + createPersistedValue + wireAsync/ReloadTickLifecycle
│       └── log-config/        Cache de scopes habilitados (`log-config:scopes`)
├── tests/{unit,e2e}/   keys/ (.pem, gitignored)   build/ (gitignored)
└── eslint.config.js  vite.config.js  package.json  EXTENSION_INSTALL.md
```
Todas las esperas de `shared/dom` aceptan `AbortSignal`.

## Comandos
```bash
npm run dev / dev:edge                # build --watch (sin HMR)
npm run build                         # ambos → dist/{chrome,edge}/
npm run build:chrome / :edge / :ext   # :ext = build Edge para release
npm run package:chrome / :edge        # ZIPs para stores
npm run lint / npm test
npm run browser / browser:edge        # navegador con la extension cargada + CDP
npm run browser -- --restart          # aplicar un rebuild
npm run browser:eval -- --storage     # conducirlo / inspeccionarlo   (docs/browser-testing.md)
# Release corporativo
npm run version:bump      # +0.1 (X.Y) con rollover en 9: 0.9→1.0. Sync manifest.base.json + package.json (--set=x.y)
npm run pack:ext          # dist/edge → .crx firmado + extension-id.txt
npm run policy:gen        # build/update.xml + install/uninstall-policy.reg
npm run release:ext       # version:bump + build:ext + pack:ext + policy:gen (fuente de versión: manifest.base.json)
npm run installer:build   # release:ext + ZIP build/EXT_LGE_CL-installer-<version>.zip
npm run install:ext / uninstall:ext   # importa/revierte .reg (con elevación)
```

## Convenciones
- **Permisos mínimos:** agregar a `manifest.base.json` solo cuando se necesite; justificar. Cambios comunes van a la base; overrides solo para diferencias reales Chrome/Edge.
- **CSP estricto:** `script-src 'self'; object-src 'self'`. Sin eval ni inline scripts. Todo HTML lleva `<meta http-equiv="Content-Security-Policy">`.
- **No llamar `chrome.*` directo desde features:** usar `shared/messaging`, `shared/storage`, `shared/utils/logger`. Si una feature lo necesita, evaluar moverlo a `shared/`.
- **Logger antes que `console.log`** (respeta nivel global + scope). **Debug API antes que helpers ad-hoc.**
- **Errores:** `toMessage(err)` (no `err?.message || String(err)`) e `isAbortError(err, signal)` (no `err instanceof WaitAbortedError || signal.aborted`), desde `shared/errors`.
- Assets se referencian desde el manifest como `assets/icons/iconN.png` (relativo a raíz, no a `src/`).
- **Nunca commitear** `keys/`, `*.pem`, `*.crx`, `build/`.

## Arquitectura de features
Cada feature en `src/features/<feature-id>/`:
```
constants.js   IDs de mensajes/puertos (prefijo `<feature-id>:`), selectores, enums
state.js       run persistido vía createRunStore + makeRun propio + persisted values
debug.js       comandos auto-registrados en window.__extLgeCl
content/       detector.js (+diagnose) · parser.js · index.js (listener one-shot + wire*Lifecycle) · drivers/ · flows/
popup/         view.js (sub-router) · utils.js · sections/ (una sub-vista por archivo)
```
**Wiring:** registrar en `src/popup/features.js` (`{ id kebab-case, name, description, abbr 2-4 letras, keywords[], render }`) **y** en `src/content/index.js` (import de `init()` y de `debug.js`). Faltar uno deja la feature escrita pero muerta.
**Estado de ejecución:** `createRunStore`/`createPersistedValue` en `state.js`; ciclo de vida con `wireAsyncRunLifecycle` (SPA) o `wireReloadTickLifecycle` (Magento full-page).
**Multi-frame** (`all_frames: true`): el handler diferencia top vs iframe. Si el frame detecta la pantalla responde sincrónico; si no, espera unos ms y responde con diagnóstico, dando prioridad a otros frames (patrón en `colocar-tags/content/index.js`).

## Comunicación popup ↔ content
- **One-shot:** `chrome.tabs.sendMessage` con `MESSAGES.<NAME>` (helper `shared/messaging/messaging.js`).
- **Streaming con cancelación (SPA, ej. Colocar TAGs):** `chrome.tabs.connect(tabId, { name: PORTS.<NAME> })`. Popup→content `{type:'start',config}` | `{type:'cancel'}`; content→popup `progress {sku,index,total,status,step,detail?,reason?}` | `done` | `cancelled` | `error {reason}`. Cerrar el port aborta el loop (`AbortController` + `port.onDisconnect`). Solo el frame que detecta la pantalla acepta `onConnect`.
- **Features con recargas (Magento, Lead Times, Cupones):** SOLO `chrome.storage.local` + `storage.onChanged` (un reload cerraría el port).
- **Streaming content → service worker (Registro de acciones):** `connectToBackground(PORTS.EVENTOS)` de `shared/messaging`, un port por frame. Se usa port y no `sendMessage` porque lo posteado en `pagehide` sí se entrega (el clic que causa la navegación), mantiene vivo al SW mientras se graba y le da al SW `port.sender.tab.id`/`frameId`.

## Logs por scope (`Ajustes`)
`logger('foo')` registra el scope `foo`, con toggle individual en Ajustes (`features/ajustes`) + "Habilitar/Deshabilitar todos". `log-config` cachea en memoria y persiste en `chrome.storage.local` (`log-config:scopes`, cross-context vía `storage.onChanged`); `logger.js` chequea `isScopeEnabled(scope)` antes de emitir. Default: todos habilitados. Hay un scope por feature/módulo (`colocar-tags[:product|:offer|:delivery-remove|:combobox]`, `magento/<módulo>` (incluye `magento/informacion-de-orden`), `lead-times`, `cupones`, `orden-info`, `starkoms`, `lgcom[/popup]`, `seller-center-falabella`, `e-promoters`, `pim`, `solotodo`, `gato`, `registro-acciones`) más `content`, `service-worker`, `debug`, `popup`.

## Errores y Modo Dev (`shared/errors` · `shared/dev-mode` · `shared/diagnostics`)
- **errors:** `ExtError` (con `code`/`context`/`cause`), `toMessage(err)`, `isAbortError(err, signal)` (WaitAbortedError/AbortError/signal.aborted), `describeError(err, meta)` (serializable, stack recortado).
- **dev-mode:** flag persistente (`dev-mode:enabled`, cache sync + `storage.onChanged`). `isDevMode()` sync, `setDevMode()`, `subscribeDevMode()`, `whenDevModeReady()`. Activo ⇒ el logger fuerza nivel `debug` en todos los contextos.
- **diagnostics:** ring buffer (cap 60) en `diagnostics:errors` con coalescing. `recordError(err,{context,scope,extra})`, `getErrors()`, `clearErrors()`, `subscribeErrors()`, `installGlobalErrorCapture(context)` (engancha `window.onerror`/`unhandledrejection`, idempotente; se llama en content, popup y SW). **Todo `logger().error()` alimenta el buffer** (busca el primer `Error` entre los args para preservar el stack). UI en **Ajustes** (toggle "Modo desarrollador" + "Errores recientes" en vivo).

## Run store compartido (`shared/run-store`)
- **`createRunStore({ key, logCap=400 })`** → `{ getRun, setRun, clearRun, updateRun, appendLog, subscribeToRun }`. `updateRun` **coalesce escrituras**: encola updaters y los drena en lotes (un `getRun` + un `setRun` por lote, FIFO), bajando de O(N) round-trips a O(rondas de IO) en ráfagas de `onStep` y reduciendo re-renders del popup. Multi-writer correcto: cada lote re-lee storage, así ve la cancelación que escribe el popup.
- **`createPersistedValue(key, fallback)`** → `{ get, set }` para last-config / draft / last-query.
- **`wireAsyncRunLifecycle({ subscribeToRun, tickIfActive, abortActiveRun?, reconcileOnInit?, topFrameOnly?, log })`** — storage-driven async (Colocar TAGs, Starkoms, Seller Center, PIM, SoloTodo).
- **`wireReloadTickLifecycle({ runKey, tickIfActive, abortActiveRun?, delay=300, log })`** — tick-por-reload (Magento, Lead Times, Cupones). **Ojo:** ese tick corre en el MISMO documento que acaba de pedir la navegación (el `storage.onChanged` llega en ~1 ms; el navegador tarda cientos). Si el flow marca un item "en curso", escribe y recién después navega, el tick lo ve "en curso" en la página vieja → usar el flag `navigating` (patrón en `magento/content/flows/run.js`).
- Los `state.js` de las features con batch usan el factory y conservan su `makeRun` propio.

## Debug API (`window.__extLgeCl`)
Existe en content, popup y service worker. En DevTools cambiar "JavaScript context" al de la extensión (los content scripts viven en isolated world).
Generales: `help()`, `features()`, `log.setLevel('debug'|'info'|'warn'|'error'|'silent')` (persiste en localStorage), `log.getLevel()`, `dev.on()/off()/status()`, `errors()`, `clearErrors()`, `<feature>.<comando>()` (los comandos de cada feature están en su doc).
Sumar comandos: `features/<feature>/debug.js` → `register('<feature>', {...})` (de `shared/debug`) → side-effect import desde `content/index.js` y/o `popup/popup.js` → helper `cmd(fn, 'descripción')`.

## Popup navegación
`popup.js`: routing simple `renderHome()` ↔ `openFeature(feature)`. Back button en header en vistas de feature; título refleja la vista.

## Distribución a otras PC corporativas
`npm run installer:build` → `build/EXT_LGE_CL-installer-<version>.zip` (~22 KB) autocontenido: `.crx` firmado + `Install.cmd`/`Uninstall.cmd` + `install.ps1` (auto-eleva, copia a `C:\ProgramData\EXT_LGE_CL`, genera update.xml con paths reales, aplica política, reinicia Edge, abre `edge://extensions` + `edge://policy`) + `README.txt`. El destinatario solo necesita Windows + Edge + admin local.
**Update:** subir `version` en `manifest.base.json` → `installer:build` → enviar ZIP → correr `Install.cmd` de nuevo.

## Decisiones tomadas
- **`webNavigation` + `unlimitedStorage` (Registro de acciones):** `onCommitted` da `transitionType`/`transitionQualifiers` (link, form_submit, server_redirect) y `onHistoryStateUpdated` es la única forma de ver los `pushState` de una SPA desde el mundo aislado; `unlimitedStorage` es para la cola de eventos en IndexedDB. No agregan aviso nuevo al usuario sobre el `<all_urls>` que ya se pide.
- **Vite sobre Webpack:** config simple, builds rápidos (Rolldown/Vite 8). **MV3 solo:** Chrome elimina MV2 en jun 2026. **ESM en todo.**
- **Manifests separados Chrome/Edge:** las stores requieren IDs distintos.
- **Force-install vía política local (no Web Store):** el entorno corporativo bloquea DLP/drag&drop de `.crx` y la carga manual (`CRX_REQUIRED_PROOF_MISSING`). Política en `HKLM\SOFTWARE\Policies\Microsoft\Edge` es la única vía.
- **`.pem` local, ID estable:** el ID deriva del SHA-256 del SPKI de la pública; se inyecta `key` en el manifest para ID estable también en "unpacked".
- **`all_frames: true`:** GP1 carga módulos en iframes. **Logger vía localStorage:** sobrevive reloads.
- **Content script `world:"MAIN"` para captar GraphQL (LG.com):** única forma de observar el `fetch`/XHR de la página sin inyectar inline scripts (bloqueado por CSP). El bridge solo `postMessage`. Requiere Chromium 111+.

## Estado del proyecto
Scaffolding + CI completos. Pipeline release corporativo (.crx firmado + política + ZIP). Debug API modular + logger persistente. Errores centralizados (`shared/errors`) + Modo Dev + ring buffer con captura global. Content multi-frame con resolución de carrera. Capa `shared/dom`. Driver GP1 L-* (modal/messagebox/combobox).
⏳ Pendiente: más tests en `tests/unit/*.test.js` (hoy `devoluciones-*.test.js` y `magento-*.test.js`); sin E2E automatizado. Ya hay unit con DOM real vía happy-dom (`magento-informacion-de-orden-*.test.js`).

## Features (detalle en `docs/features/`)
| Feature | Qué hace | Patrón | Doc |
|---|---|---|---|
| Colocar TAGs | GP1 Marketing Info Mapping: Lectura, Tag Delivery, Quitar Delivery, Tag Producto, Tag Oferta (batch por SKU) | SPA + ports | `colocar-tags.md` |
| Magento · Buscar orden | Encontrar la orden por los datos del pago (read-only, CSV) | tick-por-reload | `magento-buscar-orden.md` |
| Magento · Informacion de Orden | Entra a la ficha de cada orden de un rango (o de una lista) y exporta lo que hay ahi a CSV, una fila por orden (read-only) | storage-driven async | `magento-informacion-de-orden.md` |
| Magento · Crear Softbundles | Package rules en lote (padre + hijos); único módulo con acción destructiva opcional | tick-por-reload | `magento-softbundles.md` |
| Magento · Global Shipping Rules | Recorre las rules y exporta CSV (read-only) | tick-por-reload | `magento-global-shipping-rules.md` |
| Lead Times | Manage Address Level 2: lead times por región/comuna | tick-por-reload | `lead-times.md` |
| Cupones | Cart Price Rules: quitar las condiciones del bloque Actions | tick-por-reload | `cupones.md` |
| Información de Orden | Detalle de orden + decodificación de pagos Transbank/MercadoPago (read-only) | one-shot + búsqueda | `orden-info.md` |
| Starkoms | Verificar órdenes y stock (SPA Vuetify, hash routing) | storage-driven async | `starkoms.md` |
| LG.com | Información web (captura GraphQL/REST en PDP/PLP/PBP) + Revisar Destacados (SW + pestañas de fondo + alarms) | bridge MAIN + SW | `lgcom.md` |
| SellerCenter Falabella | SoporteSeller — Detalle Orden desde CSV; Buscar caso (Salesforce LWC) | storage-driven async | `seller-center-falabella.md` |
| Devoluciones | Falabella: cargar/guardar evidencias + gestión automática (apelar o levantar ticket). Walmart/Paris pendientes | SW + content multi-frame | `devoluciones.md` |
| E-promoters | Informe ordenes: API/CSV → filtrado → CSV. Corre entero en el service worker | SW puro | `e-promoters.md` |
| PIM | Creación de producto: verificar si un SKU existe en PIM/STG (+ Spec Assign) | storage-driven async | `pim.md` |
| SoloTodo | Generar reporte de export en el backoffice (React/MUI) | storage-driven async | `solotodo.md` |
| GATO | Tic-tac-toe multijugador secreto (Firebase REST); solo popup | popup-only | `gato.md` |
| Registro de acciones | Graba clics, campos, teclas y navegación del usuario en cualquier sitio y lo exporta en Markdown para analizar el flujo con una IA | Port + SW + IndexedDB | `registro-acciones.md` |

Los tres módulos de **Magento** comparten router, wiring y bridge: eso está en **`docs/features/magento.md`** (leerlo antes de sumar un módulo nuevo).

Otros docs: **`docs/browser-testing.md`** (probar en un navegador real: `npm run browser` / `browser:eval`, diferencias Chrome/Edge, mundos de evaluación) · **`src/features/magento/softbundles/docs/flujo.md`** (recorrido medido contra el admin real; ignorar su §2 de red/túnel).
