# Registro de acciones
Graba **lo que hace el usuario en el navegador** —clics, campos, teclas, copiar/pegar, navegacion, pestanas— y al terminar descarga uno o mas **Markdown**. El destinatario del archivo es una **IA**: la idea es que lea el registro de un proceso manual y proponga (o programe) como automatizarlo. Por eso cada accion lleva selector reproducible, contexto (formulario, fila de tabla, modal, iframe) y **que paso despues**.

**Corre en todos los sitios** (`<all_urls>`, todos los frames) y en **todas las pestanas y ventanas**, con una unica linea de tiempo. No hace nada hasta que el usuario aprieta **Iniciar**.

```
src/features/registro-acciones/
├── constants.js     FEATURE_ID, STORAGE_KEYS, PORTS, MESSAGES, TIPOS (catalogo de eventos),
│                    MOTIVO_FIN, EXPORTACION, LIMITES, TECLAS_REGISTRADAS, EXPORT, LOG_CAP
├── state.js         run store (createRunStore) + makeRun + duracionEfectiva + opciones
├── privacidad.js    PURO: motivoSensible · ocultar · crearPolitica · tratarTexto · pareceTarjeta
├── resumen.js       PURO: resumirEvento · resumenParaFeed · agruparPorVisita · estadisticas
├── markdown.js      PURO: crearConstructor (streaming) · construirIndice · generarPartes
├── debug.js         __extLgeCl.registroAcciones.* (+ ampliarDebug para el content)
├── content/         index.js (init + cache de estado) · captura.js (listeners) ·
│                    consecuencias.js (MutationObserver por ventana) · pagina.js (visita +
│                    inventario) · transporte.js (lotes por Port)
├── background/      grabador.js (wireRegistroAccionesBackground) · navegacion.js (webNavigation
│                    + tabs) · exportar.js (cursor -> Markdown -> downloads)
└── popup/           view.js · utils.js · sections/grabador.js
```
Compartido nuevo: **`src/shared/dom/describe.js`** (cssPath/describeElement/textoAccesible/contextoTabla), **`src/shared/dom/inventario.js`** (inventarioPagina) y **`src/shared/event-store/index.js`** (cola en IndexedDB). `shared/messaging` suma `connectToBackground(nombre)`.

## Reparto entre contextos
| Contexto | Rol |
|---|---|
| **content** (isolated, todos los frames) | Escucha el DOM, describe lo que paso y manda lotes. **No persiste nada**. |
| **service worker** | Unico escritor: sella pestana/frame, asigna la id, guarda en IndexedDB, observa la navegacion, mantiene el run y genera los archivos. |
| **popup** | Refleja el run y manda ordenes. Si se cierra, la grabacion sigue. |

**Por que el estado no vive en el content:** el documento muere en cada navegacion y el usuario salta entre pestanas (mismo motivo que `devoluciones/.../gestion`).

## Donde se guarda cada cosa
- **Eventos → IndexedDB** (`registro-acciones`, store `eventos`, `id` autoIncrement = numero de secuencia global). `chrome.storage.local` se reescribe entero en cada `set` y dispara `storage.onChanged` en **todos** los frames de todas las pestanas: con decenas de miles de eventos es inviable. Permiso `unlimitedStorage` en el manifest.
- **Run → `chrome.storage.local["registro-acciones:run"]`**: `{ active, paused, sesionId, startedAt, pausedAt, finishedAt, pausaAcumuladaMs, finishReason, contadores:{total,descartados,porTipo,...}, ultimos:[60 resumenes], exportacion:{estado,carpeta,partes[],error}, log }`. Nunca pasa de unos KB.
- **Contadores y feed NO se escriben por lote**: se acumulan en memoria del SW y se vuelcan cada `LIMITES.feedMs` (3 s). El popup abierto recibe el feed **por su propio port**, sin pasar por storage.

## Transporte: Port, no sendMessage
Cada frame abre `chrome.runtime.connect({name: PORTS.EVENTOS})` la primera vez que tiene algo que decir. Tres motivos: (1) lo posteado en `pagehide` **si** se entrega, y ahi esta el clic que causo la navegacion —el evento mas valioso—; (2) un port abierto **mantiene vivo al service worker** mientras se graba; (3) el SW obtiene `port.sender.tab.id`/`frameId` sin que el content los conozca.
Lotes cada `loteMs` (400 ms) o `loteEventos` (50), **salvo** clic navegable, submit y Enter, que se mandan al instante. Si el port se corta con un lote en vuelo, ese lote vuelve al frente de la cola (mejor un duplicado raro que un hueco).

## Que se captura (`TIPOS`)
- **Sesion (SW):** `sesion.inicio` (con navegador, zona horaria, opciones y pestanas abiertas), `sesion.pausa`, `sesion.reanudar`, `sesion.fin`, `nota`.
- **Navegacion (SW):** `navegacion` (con `transitionType` y `transitionQualifiers` → link / form_submit / typed / reload / server_redirect…), `navegacion.spa` (`pushState`), `navegacion.error`, `pestana.abierta` (con `abiertaPor`), `pestana.activada`, `pestana.cerrada`, `descarga`.
- **Interaccion (content):** `clic` (boton, doble, modificadores, href, abre-en-pestana-nueva), `campo.cambio` (**valor final**, no tecla por tecla), `tecla` (solo la lista blanca + cualquier combinacion con Ctrl/Alt/Meta), `envio-formulario` (con el resumen de campos), `copiar`/`cortar`/`pegar`.
- **Pagina (content):** `pagina.visita`, `pagina.inventario` (formularios, campos, botones, enlaces, tablas con muestra, iframes, dialogos), `pagina.oculta`/`pagina.visible`.
- **Consecuencia (content):** `aparecio` / `desaparecio` (dialogo, cargando, mensaje de error/exito, tabla) con `msDesdeAccion`.

**Fuera de alcance a proposito:** trafico de red, HTML crudo, `alert/confirm` nativos (invisibles desde el mundo aislado), shadow roots cerrados, scroll y movimiento del mouse.

## Correlacion accion → efecto → navegacion
Dos mecanismos distintos, los dos verificados en vivo:
- **Efectos:** tras un clic / submit / Enter se abre una ventana de `ventanaCausaMs` (2,5 s) con un MutationObserver **temporal**; lo que aparece o desaparece se emite con `accionRef` (la referencia local `frameToken:seq` del evento causante). El SW la traduce a la id global con un Map de 400 entradas. En el Markdown esos efectos se escriben **dentro** del bloque de la accion.
- **Navegacion:** el SW guarda por pestana la ultima accion "navegable"; si la navegacion llega dentro de la ventana, se sella `accionId`. Si no hay candidata, queda en `null` — un hueco honesto vale mas que una causa inventada.

## Privacidad (`privacidad.js`)
Se enmascara si: `type=password`, `autocomplete` reservado (`current-password`, `cc-number`, `cc-csc`, `one-time-code`…), el nombre/id/aria-label/placeholder casa `pass|clave|contrasen|cvv|tarjeta|cuenta|rut|token|secret…`, el elemento (o un ancestro) trae `data-sensitive`/`data-private`, o **el valor pasa el algoritmo de Luhn** (tarjeta en un campo de nombre inocente). Opcional: enmascarar tambien correos y RUT (off por defecto — en Magento el correo suele ser el dato de busqueda).
Enmascarar deja `"(oculto, N caracteres)"` + `enmascarado: true` + el motivo, y **conserva selector, etiqueta y largo**: el paso se sigue pudiendo automatizar sin conocer el secreto. Mientras se graba, el icono de la extension muestra el badge **REC** (o **II** en pausa).

## Rendimiento
Esto corre en cada frame de cada pagina: todo esta acotado.
- Un solo listener por tipo en `document`, en **captura**, con `passive`. **No** se escucha `input`, `mousemove`, `scroll` ni `wheel`.
- **`if (!e.isTrusted) return;`** en todos: sin eso, los clics sinteticos de las otras features de esta misma extension (`clickEl`, `setInputValue`, `clickReal`) se grabarian como si fueran del usuario.
- `event.composedPath()[0]` para el objetivo real (el `target` se retarguetea al host del shadow root).
- Guard barato primero: el estado `activo`/`pausado` esta en memoria y se refresca por `storage.onChanged`; ningun handler consulta storage.
- Freno de `eventosPorSegundo` (40) por frame, cola tope 500, texto 200 chars, valor 300, inventario con topes propios (y lo recortado se declara en `truncado`).
- El MutationObserver **no vive permanente**: solo dentro de la ventana post-accion, `childList+subtree` sin `attributes`, procesando en `requestAnimationFrame` y con tope de 6 consecuencias.
- Inventario una vez por visita, en `requestIdleCallback`, y solo en el frame principal o en un iframe que tenga formulario/tabla/campos (un iframe de publicidad no paga inventario).

## Formato de salida
`Descargas/registro-acciones/<sesion>/` con `registro_indice.md` + `registro_1.md`, `registro_2.md`… Se corta cada **350 KB** o **1500 eventos** (el que llegue primero) y cada parte repite el front-matter con `parte/de/continua_de/sigue_en`; si una pagina se parte al medio, la siguiente abre con `## Pn (continuacion)` y remite al inventario de la parte anterior.
- Una seccion `##` por **visita de pagina**: primero el inventario (el mapa), despues las acciones (el recorrido).
- Un bloque `####` por accion, con campos de nombre fijo (**Elemento**, **Selector**, **Valor final**, **Contexto**, **En tabla**, **Efecto**): legible para una persona y parseable con una regex.
- `#N` es la id global, asi que `Causado por #704` funciona aunque #704 este en otra parte.
- **Las paginas sin ninguna accion no se escriben.** Cada pestana abierta de fondo anuncia su visita; sin esto el recorrido se llenaba de paginas donde no paso nada.
- Solo se registran paginas `http(s)`: nada de `about:blank`, paginas internas del navegador ni el popup de la propia extension.

## UI (`popup/sections/grabador.js`)
Cuatro opciones (mapa de pagina, consecuencias, portapapeles, ocultar correo/RUT) que se bloquean mientras se graba. **Iniciar** pide confirmacion con el aviso de que se graba todo. Mientras corre: punto rojo latiendo, cronometro (descontando pausas), contador de eventos y paginas, y el **feed en vivo** (ultimos 60, lo mas nuevo arriba). **Pausar/Reanudar** no aborta nada. **Detener** confirma, genera los archivos y muestra la lista con su tamano; queda **Volver a generar** y **Descartar**.

## Debug `__extLgeCl.registroAcciones.`
`estado()`, `run()`, `opciones()`, `ultimos(n)` (resumidos), `crudo(n)` (completos), `iniciar()`, `pausar()`, `reanudar()`, `detener(exportar=true)`, `exportar()`, `descartar()`, `diagnose()` y, **solo en la pagina**: `describir('#sel')` (como se guardaria ese elemento), `selector('#sel')`, `inventario()`, `sensible('#sel')` (si su valor se ocultaria y por que), `frame()` (estado de la captura en ese frame).

## Cosas medidas en vivo (15-09-2026)
- **Un `import()` dinamico rompe el service worker**: `ServiceWorkerGlobalScope` los prohibe. Por eso los comandos de debug del content se suman con `ampliarDebug()` y no importando el content desde `debug.js`.
- **El service worker queda cacheado en el perfil del navegador de pruebas**: `npm run browser -- --restart` no alcanza para que tome un bundle nuevo. Hay que borrar `.browser-profile-chrome/Default/Service Worker` (ver `docs/browser-testing.md`). Costo dos horas de diagnosticar codigo que estaba bien.
- Los eventos sinteticos de `browser:eval` (`el.click()`) **no se graban** (no son `isTrusted`): para probar de verdad hay que conducir el navegador por CDP (el MCP de chrome-devtools) o a mano.

## Pendientes / limitaciones
- No se capturan `alert`/`confirm` nativos ni el trafico de red (decidido: fuera de alcance).
- Shadow roots **cerrados**: el selector apunta al host y se marca `sombraCerrada`.
- El content script entra en `document_idle`: se pierden los primeros ~200 ms de una pagina (la navegacion igual queda registrada por el SW).
- Si el service worker muere entre una accion y su navegacion, se pierde la **causa** (no el evento): queda `accionId: null`.
- No hay UI para releer sesiones viejas: al iniciar una nueva se limpia IndexedDB.
