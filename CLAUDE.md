# EXT LGE CL

Extensión de navegador para **Chrome y Edge** (ambos Chromium, Manifest V3). Objetivos: modular, escalable, segura.

## Stack

- **Bundler:** Vite 8 + `vite-plugin-web-extension` (descubre entry points desde el manifest automáticamente). Modo dev usa `vite build --watch` (no `vite dev`) porque el CSP estricto bloquea el HMR server de Vite.
- **Tests:** Vitest 4 (`--passWithNoTests` habilitado hasta que haya tests reales)
- **Lint:** ESLint 10 (flat config, `eslint.config.js`)
- **Packaging:** `web-ext` 10 (genera ZIPs para las stores)
- **Node:** 22 LTS (CI corre con v22)
- **Módulos:** ESM (`"type": "module"` en `package.json`)

## Estructura

```
EXT_LGE_CL/
├── .github/workflows/ci.yml      CI: lint + test + build chrome/edge
├── assets/icons/                 Íconos PNG 16/32/48/128 (faltan, son placeholders)
├── manifests/
│   ├── manifest.base.json        MV3 compartido — paths apuntan a src/ y assets/
│   ├── manifest.chrome.json      Override Chrome (futuro: store ID)
│   └── manifest.edge.json        Override Edge (futuro: add-ons ID)
├── scripts/
│   ├── build.js                  Placeholder (Vite lo reemplaza)
│   └── package.js                Genera ZIPs post-build (node scripts/package.js)
├── src/
│   ├── background/service-worker.js   Service worker MV3 (no persistent bg)
│   ├── content/index.js               Content script — corre en <all_urls>
│   ├── popup/                         UI del action button
│   ├── options/                       Página de configuración
│   └── shared/                        Código reutilizable entre contextos
│       ├── api/                       Clientes HTTP externos
│       ├── messaging/messaging.js     Wrapper de chrome.runtime messages
│       ├── storage/storage.js         Wrapper de chrome.storage.local
│       └── utils/                     Helpers generales
├── tests/{unit,e2e}/
├── eslint.config.js              Flat config + globals browser/webextensions
├── vite.config.js                Hace merge de manifests según --mode
└── package.json
```

## Comandos

```bash
npm run dev              # build --watch para Chrome (rebuild auto, sin HMR)
npm run dev:edge         # build --watch para Edge
npm run build            # Build para ambos browsers → dist/{chrome,edge}/
npm run build:chrome     # Solo Chrome
npm run build:edge       # Solo Edge
npm run package:chrome   # ZIP para Chrome Web Store
npm run package:edge     # ZIP para Edge Add-ons
npm run lint
npm test
```

## Convenciones

- **Permisos:** mínimos posibles. Agregar a `manifests/manifest.base.json` → `permissions` / `host_permissions` solo cuando se necesite.
- **CSP estricto:** `script-src 'self'; object-src 'self'`. Sin `eval`, sin inline scripts. Todos los HTML tienen `<meta http-equiv="Content-Security-Policy">`.
- **Comunicación entre contextos:** usar `src/shared/messaging/` (no llamar `chrome.runtime.sendMessage` directo desde features).
- **Storage:** usar `src/shared/storage/` (no llamar `chrome.storage` directo).
- **Manifests:** modificar `manifest.base.json` para cambios comunes; los overrides solo para diferencias reales Chrome/Edge.
- **Cross-browser:** Chrome y Edge comparten 99% del código. Si algo no funciona en Edge, documentarlo aquí.

## Arquitectura de features

Cada feature vive en `src/features/<feature-id>/` con esta estructura:

```
src/features/<feature-id>/
├── constants.js              IDs de mensajes, selectores, enums del dominio
├── content/                  Lógica que corre en la página objetivo
│   ├── detector.js           Confirma que estamos en la pantalla correcta
│   ├── parser.js             Extrae datos del DOM
│   └── index.js              Init: registra el listener de mensajes
└── popup/
    └── view.js               Exporta render(container)
```

**Wiring:**
- Cada feature se registra en `src/popup/features.js` (objeto + import del `render`).
- El content script global (`src/content/index.js`) importa e inicializa el `init()` de cada feature.
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
- ✅ Feature "Colocar TAGs" — etapa 1: detector + parser + vista que muestra filtros y productos capturados de GP1
- ⏳ Pendiente: etapa 2 de "Colocar TAGs" — lógica para aplicar los tags
- ⏳ Pendiente: tests en `tests/unit/*.test.js`

## Feature: Colocar TAGs (estado actual — etapa 1)

Pantalla objetivo: **Marketing Info Mapping** dentro de GP1 (SPA).

**Detección (`detector.js`):** verifica presencia de `#aform`, `#LblockSearch`, `#tabView`, `#divGrid_stg`.

**Parser (`parser.js`):**
- `parseSearchForm()`: extrae 11 campos del formulario (site B2C/B2B, super/category/sub, salesModel, modelName, productId, modelStatus, modelType, promotionId, publish).
- `parseGrid()`: detecta tab activa (STG/PROD), lee `tbody tr.L-grid-row`, extrae por fila: rowId (de la clase `L-grid-row-rXXXX`), rowIndex (col `num`), `editIndex` (de `onclick="fncModelPopup(N)"`), isSelected, salesModel, modelName, productId, pimSku, super/category/sub, modelStatus, modelType, publish.
- Contadores: `#mSelectCount`, `#mStgListCount`, `#mProdListCount`.

**Convención de búsqueda:** preferir Sales Model con sufijo (ej: `24U421A-B.AWHQ`) sobre Model Name puro — es más preciso.

**Estados de Model:** ACTIVE / INACTIVE / DISCONTINUED. El que interesa para los tags es ACTIVE.

**Mensaje único:** `colocar-tags:get-page-data` → responde `{ ok, data?, reason? }`.

Pendiente etapa 2: documentar el flujo de cómo se aplican los tags (el usuario lo va a explicar).

## Decisiones tomadas

- **Vite sobre Webpack:** simpler config, HMR mejor, builds más rápidos con Rolldown (Vite 8).
- **Manifest V3 solo:** Chrome elimina MV2 en junio 2026 (Chrome 139). No vale la pena soportar MV2.
- **Manifests separados Chrome/Edge:** aunque comparten todo hoy, las stores requieren IDs distintos.
- **ESM en todo:** Vite, Node 22 y MV3 service workers lo soportan nativamente.

## Notas para la IA

- Antes de agregar un permiso al manifest, justificar por qué es necesario.
- Si una feature necesita usar `chrome.*` API directamente, considerar primero si debería ir en `src/shared/`.
- Los assets en `assets/` se referencian desde el manifest como `assets/icons/iconN.png` (relativos a la raíz del proyecto, no a `src/`).
- El build genera `dist/chrome/manifest.json` y `dist/edge/manifest.json` desde el merge de `manifests/manifest.base.json` + el override correspondiente (lógica en `vite.config.js`).
