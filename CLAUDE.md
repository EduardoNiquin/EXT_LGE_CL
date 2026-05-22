# EXT LGE CL

Extensión de navegador para **Chrome y Edge** (ambos Chromium, Manifest V3). Objetivos: modular, escalable, segura.

## Stack

- **Bundler:** Vite 8 + `vite-plugin-web-extension` (descubre entry points desde el manifest automáticamente)
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
npm run dev              # Vite watch + Chrome
npm run dev:edge         # Vite watch + Edge
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

## Estado del proyecto

- ✅ Scaffolding inicial completo
- ✅ CI en GitHub Actions funcionando (lint + test + build chrome/edge)
- ✅ ESLint 10 flat config con globals browser/webextensions
- ✅ GitHub Actions con Node 22 y actions v5
- ⏳ Pendiente: agregar íconos PNG reales en `assets/icons/`
- ⏳ Pendiente: definir el primer feature/módulo funcional
- ⏳ Pendiente: escribir tests en `tests/unit/*.test.js` (Vitest listo)

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
