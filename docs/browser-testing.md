# Probar la extensión en un navegador real (`npm run browser`)
Dos scripts: **`scripts/dev-browser.mjs`** levanta un navegador con la extensión del build ya cargada y el puerto de depuración abierto, y **`scripts/browser-eval.mjs`** ejecuta código dentro de él y devuelve el resultado por stdout. Con eso se conduce la extensión sin tocar nada a mano (y es también lo que el **MCP de chrome-devtools** necesita: el MCP **no lanza navegador**, se conecta por CDP a uno que ya esté corriendo — si ese navegador se abrió sin la extensión, no hay forma de instalarla desde una sesión de depuración).

```bash
npm run browser                 # Chrome for Testing en el 9222
npm run browser:edge            # Edge del sistema en el 9223
npm run browser -- --restart    # rebuild + reiniciar el que ya esté abierto
npm run browser -- --no-build   # sin rebuild, entre pruebas
npm run browser -- --url=https://shop.lg.com/obsadm

npm run browser:eval -- --expr="return __extLgeCl.help()"
npm run browser:eval -- --storage                          # índice del storage
npm run browser:eval -- --storage=magento:softbundles:run  # un run completo
npm run browser:eval -- --page=active --expr="return __extLgeCl.magentoSoftbundles.diagnose()"
npm run browser:eval -- --file=scripts/snippets/abrir-softbundles.js --keep
npm run browser:eval -- --port=9223 --close                # cerrar el navegador
```
Cada navegador tiene **su puerto y su perfil** (Chrome 9222, Edge 9223), así que pueden convivir levantados. `browser-eval` habla con el que le digas por `--port`.

## Chrome y Edge no se comportan igual (medido en vivo el 10-09-2026)
- **Edge 152 estable SÍ acepta `--load-extension`** → se usa el Edge del sistema tal cual.
- **Chrome 152 estable lo IGNORA** (el switch se retiró por seguridad). Se probó además con `--disable-features=DisableLoadExtensionCommandLineSwitch` y con `--enable-unsafe-extension-debugging`: la página de la extensión seguía dando `ERR_BLOCKED_BY_CLIENT`. `Extensions.loadUnpacked` por CDP devuelve un id pero **tampoco** la deja utilizable, ni manteniendo viva la sesión. Por eso para Chrome se usa **Chrome for Testing**, un binario aparte sin esas restricciones, que `npm run browser` descarga solo la primera vez a `.browsers/` (vía `npx @puppeteer/browsers`).
- El equipo tiene además política corporativa en `HKLM\SOFTWARE\Policies\Google\Chrome` (`ExtensionInstallForcelist` → `aljopfonbkkdpndlpgghhfdjkcekjfhn` desde `file:///C:/ProgramData/EXT_LGE_CL/update.xml`). Eso instala **el .crx que esté en ProgramData**, no el build de trabajo, así que no sirve para probar cambios; y `--disable-extensions-except` la desactiva. `npm run browser -- --system` levanta el Chrome del sistema para mirar justamente esa.

## Cosas que no son opcionales
- Desde Chrome 136 el puerto de depuración **se ignora sobre el perfil por defecto** → cada navegador usa su `--user-data-dir` propio (`.browser-profile-<navegador>/`, gitignored).
- Ese perfil es **persistente a propósito**: se inicia sesión en Magento (con su 2FA) **una sola vez** y queda para todas las corridas. Es lo que hace viable probar contra el admin real.
- **Para aplicar un rebuild hay que reiniciar el navegador** (`npm run browser -- --restart`). NO existe un `--reload`: `chrome.runtime.reload()` **descarga** una extensión cargada con `--load-extension` y no la vuelve a cargar — queda `ERR_BLOCKED_BY_CLIENT` y sin service worker. El reinicio conserva el perfil, así que no se pierde la sesión.

## En qué mundo se evalúa (`--world`), y por qué importa
- **`isolated`** — el del content script, donde vive `window.__extLgeCl` con los comandos de las features (`magentoSoftbundles`, `colocarTags`, …). Es el **defecto para URLs http(s)**.
- **`main`** — el de la página. Es lo que hace `evaluate_script` del MCP, y **por eso desde el MCP no se ve la Debug API del content script**.
- Las páginas de la extensión (`--page=popup|options`) tienen un solo mundo: ahí están la Debug API del popup y `chrome.storage.local`, que es donde vive el estado de cada run.

## Detalles de implementación que cuestan de redescubrir
- **El id de la extensión se anota al levantar** (`.browsers/session-<puerto>.json`). Buscarlo por CDP solo funciona recién arrancado: el **service worker MV3 se duerme a los pocos segundos** y desaparece de `/json/list`, y entonces no queda ningún target por el que preguntar.
- Al buscarlo por CDP se filtra por la ruta del service worker del proyecto (`/src/background/service-worker.js`). Sin ese filtro se toma la primera `chrome-extension://` que aparezca, que suelen ser las que el navegador trae de fábrica (se llegó a reportar el id de Google Docs Offline).
- **Una pestaña del popup se reutiliza solo si su contexto sigue vivo**, y la comprobación es `chrome.runtime.id`: la pantalla de error de Chrome tiene contexto JS y responde a cualquier evaluación trivial, así que un `return 1` la daba por buena y todo fallaba después con un `__extLgeCl is not defined` sin explicación.
- El home del popup son `<li>`, no `<button>`: para abrir una feature, `document.querySelectorAll('.feature-name')` y `closest('li').click()`.
- Los ids de la extensión difieren por navegador (los manifests llevan `key` distinta): Chrome `mmefiaddcabbgpgdloaobejomgjpllad`, Edge `hoijmcmfjdpbhonmeobanfgjbicgnbeo`. No hace falta saberlos: los scripts los resuelven solos.

**Pendiente:** no hay E2E automatizado todavía. Las dos capas que faltan son (a) unit con jsdom sobre los fragmentos DOM reales de `Pedida.md` (selectores y parsers, sin navegador) y (b) E2E con fixtures locales servidas en rutas que imiten las de Magento — el content script matchea `<all_urls>`, así que corre igual en `localhost`, pero las fixtures son HTML estático **sin el JS de Magento**: los widgets Knockout (el multiselect que busca por AJAX, la tabla de precios, el modal que cierra al guardar) necesitarían mocks propios para comportarse como en producción.
