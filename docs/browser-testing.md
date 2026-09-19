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

## El MCP de chrome-devtools
Viene configurado en el repo (`.mcp.json`) y **no se usa directo**: el cliente MCP arranca `scripts/mcp-chrome.mjs`, que hace de intermediario y **se asegura de que haya navegador con la extensión cargada antes de cada herramienta que se use**. Antes de eso (handshake, `tools/list`) no abre nada, así que abrir el cliente no abre Chrome.
```json
{ "mcpServers": { "chrome-devtools": { "command": "node", "args": ["scripts/mcp-chrome.mjs"] } } }
```
El wrapper termina arrancando esto:
```
chrome-devtools-mcp --browserUrl=http://127.0.0.1:9222 --categoryExtensions --no-usage-statistics --no-performance-crux
```
- Si el 9222 ya responde, lo reutiliza (no abre un segundo navegador ni pisa el perfil). Si no, corre `dev-browser.mjs` —el mismo `npm run browser`— con `--no-build` cuando ya hay `dist/chrome/`.
- La verificación se repite (con una caché de 5 s para no pagarla en cada llamada de una ráfaga) en vez de hacerse una sola vez: si el navegador se cierra a mitad de sesión —`npm run browser -- --restart`, o cerrándolo a mano— la herramienta siguiente lo vuelve a levantar y el MCP se reconecta solo por `--browserUrl`. Si levantarlo falla, la llamada igual pasa: contesta el MCP con su propio error (mejor que colgarse) y se reintenta en la siguiente.
- Si en el 9222 hay un navegador que **no** levantó este proyecto (otro repo, o uno abierto a mano), no lo cierra: avisa por stderr. Cerrarlo sería tirar abajo el trabajo de otra ventana.
- `npm run browser:ensure` hace solo esa parte (levantar/verificar) sin arrancar el MCP, para probarlo a mano.
- `chrome-devtools-mcp` es devDependency: se usa el de `node_modules` (rápido y sin red) y queda `npx ...@latest` de respaldo si alguien clona sin `npm install`.
- El wrapper acepta `--port=` y `--browser=edge` si hiciera falta apuntar a otro lado.

**`--categoryExtensions` no es opcional acá** (medido el 19-09-2026 contra Chrome for Testing 153): sin ese flag el MCP se niega a navegar a `chrome-extension://…` (*"Navigating to chrome-extension: URLs is not allowed"*) y no ve ni el popup ni el service worker. La ayuda del paquete dice que el flag solo anda con conexión por pipe, pero esa limitación venció con Chrome 149: con `--browserUrl` y Chrome 153 funciona. Suma cinco herramientas —`list_extensions`, `reload_extension`, `trigger_extension_action`, `install_extension`, `uninstall_extension`— y `list_pages` pasa a mostrar dos secciones más: **Extension Pages** y **Extension Service Workers**. Los otros dos flags son por privacidad: `--no-usage-statistics` corta la telemetría del paquete y `--no-performance-crux` evita que las URLs de los traces (el admin de Magento, por ejemplo) se manden a la API de CrUX de Google.

**`reload_extension` sí aplica un rebuild, incluido el service worker** (medido el 19-09-2026, y es la forma rápida de iterar). No es un `chrome.runtime.reload()` —eso descarga la extensión y la deja muerta, ver más abajo— sino `browser.installExtension(path)` de Puppeteer sobre la misma carpeta de `dist/`: se marcó el build a mano, se llamó a `reload_extension` y tanto el popup como el SW ya servían el archivo nuevo (la marca estaba en `self`, y `chrome.runtime.onConnect.hasListeners()` daba `true`). O sea que por este camino **tampoco hace falta borrar el caché del service worker**. El `--restart` del script queda para cuando no hay MCP a mano.

**Para llegar a las páginas de la extensión el orden importa:**
1. `new_page` con una URL http (o una pestaña que ya esté en http).
2. `navigate_page` de esa pestaña a `chrome-extension://<id>/src/popup/popup.html`.
3. Recién ahí `evaluate_script`, `click`, etc. Ahí sí se ve `window.__extLgeCl` del popup, porque las páginas de la extensión tienen un solo mundo.

Una pestaña que **ya estaba** en `chrome-extension://` cuando el MCP se conectó se lista pero **no es direccionable**: toda llamada responde `No page found`. Hay que abrirla desde el propio MCP. Y los `pageId` son de la sesión del server (se renumeran en cada arranque), así que conviene un `list_pages` antes de operar. `trigger_extension_action` abre el popup real del toolbar, que después queda listado como Extension Page.

El service worker aparece como `sw-N`, pero **no se puede evaluar código adentro**: `evaluate_script` exige un `pageId` numérico y `sw-N` no valida. Para eso sigue haciendo falta el WebSocket a mano contra el target `service_worker` (ver abajo).

## Chrome y Edge no se comportan igual (medido en vivo el 10-09-2026)
- **Edge 152 estable SÍ acepta `--load-extension`** → se usa el Edge del sistema tal cual.
- **Chrome 152 estable lo IGNORA** (el switch se retiró por seguridad). Se probó además con `--disable-features=DisableLoadExtensionCommandLineSwitch` y con `--enable-unsafe-extension-debugging`: la página de la extensión seguía dando `ERR_BLOCKED_BY_CLIENT`. `Extensions.loadUnpacked` por CDP devuelve un id pero **tampoco** la deja utilizable, ni manteniendo viva la sesión (ojo: eso es sobre el Chrome estable; sobre Chrome for Testing sí funciona, y es justamente lo que hace `reload_extension` del MCP). Por eso para Chrome se usa **Chrome for Testing**, un binario aparte sin esas restricciones, que `npm run browser` descarga solo la primera vez a `.browsers/` (vía `npx @puppeteer/browsers`).
- El equipo tiene además política corporativa en `HKLM\SOFTWARE\Policies\Google\Chrome` (`ExtensionInstallForcelist` → `aljopfonbkkdpndlpgghhfdjkcekjfhn` desde `file:///C:/ProgramData/EXT_LGE_CL/update.xml`). Eso instala **el .crx que esté en ProgramData**, no el build de trabajo, así que no sirve para probar cambios; y `--disable-extensions-except` la desactiva. `npm run browser -- --system` levanta el Chrome del sistema para mirar justamente esa.

## Cosas que no son opcionales
- Desde Chrome 136 el puerto de depuración **se ignora sobre el perfil por defecto** → cada navegador usa su `--user-data-dir` propio (`.browser-profile-<navegador>/`, gitignored).
- Ese perfil es **persistente a propósito**: se inicia sesión en Magento (con su 2FA) **una sola vez** y queda para todas las corridas. Es lo que hace viable probar contra el admin real.
- **Para aplicar un rebuild hay que reiniciar el navegador** (`npm run browser -- --restart`). NO existe un `--reload`: `chrome.runtime.reload()` **descarga** una extensión cargada con `--load-extension` y no la vuelve a cargar — queda `ERR_BLOCKED_BY_CLIENT` y sin service worker. El reinicio conserva el perfil, así que no se pierde la sesión. **Atajo:** con el MCP de chrome-devtools conectado, `reload_extension` aplica el rebuild sin reiniciar nada (ver arriba).
- **Si lo que cambió es el service worker, `--restart` NO alcanza** (medido el 15-09-2026): Chrome guarda el script del SW en el perfil y al relanzar sigue ejecutando el bundle viejo, aunque el archivo nuevo ya esté en `dist/` y la extensión lo sirva. El síntoma engaña: el código está en el bundle, `chrome.runtime.getManifest()` responde y `install()` loguea, pero los listeners nuevos no existen (`chrome.runtime.onConnect.hasListeners() === false`). Hay que borrar el caché antes de levantar:
  ```bash
  npm run browser:eval -- --close
  rm -rf ".browser-profile-chrome/Default/Service Worker" ".browser-profile-chrome/Default/Code Cache"
  npm run browser -- --no-build
  ```
  (El perfil sobrevive: solo se borra el caché de SW, no las cookies ni la sesión de Magento.) Con `reload_extension` del MCP esto no hace falta: reinstala la carpeta y el SW arranca con el bundle nuevo.
- **Los eventos sintéticos no son `isTrusted`.** Un `el.click()` desde `browser:eval` no dispara nada que dependa de `event.isTrusted` (el Registro de acciones lo exige, justamente para no grabarse a sí mismo). Para probar interacción real hay que conducir el navegador por CDP — el **MCP de chrome-devtools** (`click`, `fill`) sí genera eventos de confianza porque los inyecta el navegador.

## En qué mundo se evalúa (`--world`), y por qué importa
- **`isolated`** — el del content script, donde vive `window.__extLgeCl` con los comandos de las features (`magentoSoftbundles`, `colocarTags`, …). Es el **defecto para URLs http(s)**.
- **`main`** — el de la página. Es lo que hace `evaluate_script` del MCP, y **por eso desde el MCP no se ve la Debug API del content script**.
- **El service worker no tiene página**, así que `browser-eval` no llega a él. Para evaluar dentro del SW hay que conectarse por CDP al target `service_worker` (`http://127.0.0.1:9222/json/list` → el que apunta a `/src/background/service-worker.js`) con un WebSocket y un `Runtime.evaluate`. Ojo: el SW **se duerme** y desaparece de `/json/list`; se lo despierta abriendo el popup o navegando. Y dentro de un service worker **`import()` dinámico está prohibido** por especificación: si un módulo lo usa, ahí revienta.
- Las páginas de la extensión (`--page=popup|options`) tienen un solo mundo: ahí están la Debug API del popup y `chrome.storage.local`, que es donde vive el estado de cada run.

## Detalles de implementación que cuestan de redescubrir
- **El id de la extensión se anota al levantar** (`.browsers/session-<puerto>.json`). Buscarlo por CDP solo funciona recién arrancado: el **service worker MV3 se duerme a los pocos segundos** y desaparece de `/json/list`, y entonces no queda ningún target por el que preguntar.
- Al buscarlo por CDP se filtra por la ruta del service worker del proyecto (`/src/background/service-worker.js`). Sin ese filtro se toma la primera `chrome-extension://` que aparezca, que suelen ser las que el navegador trae de fábrica (se llegó a reportar el id de Google Docs Offline).
- **Una pestaña del popup se reutiliza solo si su contexto sigue vivo**, y la comprobación es `chrome.runtime.id`: la pantalla de error de Chrome tiene contexto JS y responde a cualquier evaluación trivial, así que un `return 1` la daba por buena y todo fallaba después con un `__extLgeCl is not defined` sin explicación.
- El home del popup son `<li>`, no `<button>`: para abrir una feature, `document.querySelectorAll('.feature-name')` y `closest('li').click()`.
- Los ids de la extensión difieren por navegador (los manifests llevan `key` distinta): Chrome `mmefiaddcabbgpgdloaobejomgjpllad`, Edge `hoijmcmfjdpbhonmeobanfgjbicgnbeo`. No hace falta saberlos: los scripts los resuelven solos.

**Pendiente:** no hay E2E automatizado todavía. Las dos capas que faltan son (a) unit con jsdom sobre los fragmentos DOM reales de `Pedida.md` (selectores y parsers, sin navegador) y (b) E2E con fixtures locales servidas en rutas que imiten las de Magento — el content script matchea `<all_urls>`, así que corre igual en `localhost`, pero las fixtures son HTML estático **sin el JS de Magento**: los widgets Knockout (el multiselect que busca por AJAX, la tabla de precios, el modal que cierra al guardar) necesitarían mocks propios para comportarse como en producción.
