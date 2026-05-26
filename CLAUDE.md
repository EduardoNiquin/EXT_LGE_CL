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
- ⏳ Pendiente: Feature "Colocar TAGs" — Tag de Producto (estructura ya lista, falta definir pasos)
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

**Comandos debug expuestos** (todos bajo `__extLgeCl.colocarTags.`):
- `diagnose()` — diagnóstico completo del frame.
- `check()` — `{selector: bool}` por cada selector contra el DOM actual.
- `find(key)` — `document.querySelector(SELECTORS[key])`.
- `iframes()` — lista de iframes con id/name/src.
- `frameInfo()` — `{ url, title, isTopFrame }`.
- `parse()` — corre el parser y devuelve el resultado.
- `selectors()` — copia del mapa de selectores.

Pendiente etapa 2: documentar el flujo de cómo se aplican los tags (el usuario lo va a explicar).

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
