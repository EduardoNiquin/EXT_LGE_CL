# VPN
Conecta **este** navegador (el perfil que ya estas usando, con tus sesiones y con esta extension) a la red de LG. **NO opera sobre una pestaña** (sin content script ni detector): corre en el **service worker** y lo unico que hace es apuntar `chrome.proxy` a un proxy que saca el trafico por LG, y vigilar que el camino siga en pie.

## Lo primero: una extension no puede hacer un tunel
No hay sockets TCP crudos en MV3 (`chrome.sockets.*` era de las Chrome Apps, que ya no existen): solo `fetch`, WebSocket y WebRTC. No hay forma de hablar SSH desde aqui. Lo unico que la extension puede hacer es **apuntar el navegador a un proxy que ya exista**. Por eso hay dos origenes, y cual se use decide si hace falta instalar algo:

| Origen | Que es | Hace falta instalar algo? |
|---|---|---|
| `ORIGEN.SERVIDOR` (por defecto) | `enlace-web`, un proxy HTTP con TLS publicado en el VPS | **No.** Es lo que hace que esta feature se baste sola |
| `ORIGEN.LOCAL` | El SOCKS5 que publica `enlace-lg.exe` en el loopback | Si: ese programa, abierto y en verde |

El local sigue existiendo porque no cuesta nada y cubre dos casos reales: que el servidor todavia no este desplegado, y que alguien prefiera la ruta con clave SSH y cuenta propia en vez de una contrasena compartida.

## El origen "servidor" (`enlace-web`)

```
[navegador + extension]  --TLS + Basic auth-->  [VPS]  --:14332-->  [PC oficina]  -->  red de LG
      nada instalado                          enlace-web            enlace-host.exe
```

Vive en el repo `LG-VPN`: `cmd/enlace-web/`, `despliegue/vps/enlace-web.service`.

**Desplegado y funcionando** en `147-93-176-66.sslip.io:8443` (16-09-2026). Dos decisiones que se tomaron mirando el servidor y conviene no re-descubrir:

- **El puerto es el 8443, no el 443**, porque en ese VPS el 443 y el 80 los tiene **nginx**. Por lo mismo, `certbot --standalone` no sirve ahi: el certificado ya existia, emitido por Let's Encrypt.
- **El dominio es un `sslip.io`**, que resuelve al propio servidor sin registrar nada y para el que Let's Encrypt emite igual. Hacia falta un nombre porque Chrome rechaza el TLS de un proxy cuyo certificado no case y **no deja aceptar la excepcion** como haria con una pagina.

**Por que es un proxy HTTPS y no un SOCKS5 publicado.** Chromium **no sabe autenticarse contra un proxy SOCKS** — no implementa el usuario/clave de la RFC 1929. Un SOCKS5 publicado en internet no tendria forma de pedir credenciales: seria un proxy abierto con salida a la red de LG para cualquiera que lo encuentre. Un proxy HTTP si puede: responde **407** y el navegador manda `Proxy-Authorization`. El TLS es lo que impide que esa credencial viaje en base64 por una red ajena. `enlace-web` **se niega a arrancar** sin certificado o sin contrasena, porque quedarse a medias ahi es dejar la red de LG abierta.

**Contra la fuerza bruta** lleva un limitador por IP (`cmd/enlace-web/limitador.go`): 3 fallos gratis, y a partir de ahi cada intento bloquea esa IP un rato que se dobla (2 s, 4 s, 8 s…) hasta 5 minutos. Estando bloqueada no se le mira la contrasena aunque acierte. Hace falta porque la credencial es una sola y compartida: sin freno se sacaria probando.

**A donde se puede llegar no lo decide este servidor**, sino el PC de la oficina con la lista `permitir` de `enlace-host.json` (hoy `"*"`, por eso se puede navegar libremente con IP de LG). `enlace-web` solo entrega la conexion al SOCKS5 que aquel publica; no hay aqui ninguna copia de esa lista que pudiera quedar desfasada.

**El PC de la oficina sigue siendo necesario**: es lo que da la salida por LG, y algo tiene que estar dentro de esa red. Lo que desaparece es el programa en el PC de cada persona.

## Que es "Enlace LG" y por que existe el origen local
`Enlace LG` vive en otro repo (`C:\Users\eniquin\Desktop\Proyectos\LG-VPN`, Go). **No es una VPN real**: no hay adaptador TUN, ni driver, ni tabla de rutas modificada. Es SSH + proxies locales en espacio de usuario, y **solo redirige TCP**. Mientras `enlace-lg.exe` corre, deja en el loopback:

| Puerto | Que es |
|---|---|
| `127.0.0.1:1080` | **SOCKS5, sin autenticacion, solo CONNECT.** El que usa esta feature |
| `127.0.0.1:1081` | Proxy HTTP/CONNECT, tambien sin auth |
| `127.0.0.1:1433` | Forward TCP al DW (`136.166.26.211:1433`) |

La cadena real es `PC → SSH al VPS 147.93.176.66 → SOCKS5 publicado por el PC de la oficina (:14332) → red de LG`. El extremo de la oficina hoy permite `["*"]` (`internal/config/host.go`), asi que por ahi **se puede navegar libremente con IP de LG**, no solo alcanzar lo interno.

Hasta ahora, la unica forma de que un navegador saliera por ahi era que Enlace LG lanzara Chrome con `--proxy-server=socks5://127.0.0.1:1080` **y un `--user-data-dir` aparte** (obligatorio: si ya hay una instancia abierta, el flag se ignora en silencio). Eso significa trabajar en un perfil sin sesiones iniciadas, sin marcadores y **sin esta extension**. Esta feature elimina ese perfil paralelo.

**Por que SOCKS5 y no el proxy HTTP del 1081:** con el esquema `socks5` el navegador **no resuelve el nombre en casa**: lo manda entero al proxy y lo resuelve el otro extremo. Eso es lo que hace que los nombres internos de LG existan y que la IP de origen sea una de LG. Con el proxy HTTP o con `socks4` la resolucion seria local y lo interno no existiria.

```
src/features/vpn/
├── constants.js   STORAGE_KEYS, MESSAGES, MODO(+LABEL), MOTIVO, SOCKS_POR_DEFECTO,
│                  DOMINIOS_LG, REDES_LG, BYPASS, SONDA_*, ERRORES_PROXY, ALARM_VIGILANCIA
├── pac.js         construirPac({socks,dominios,redes}) + parsearCidr  (puro, testeado)
├── state.js       run store del estado (createRunStore) + getConfig/setConfig + asegurarEstado
├── debug.js       __extLgeCl.vpn.* (registrado en el SW y en el popup)
├── background/
│   └── conexion.js  conectar/desconectar/comprobar/reconciliar/ipDeSalida + wireVpnBackground()
└── popup/
    ├── view.js      sub-router (una seccion)
    ├── utils.js     escapeHtml, formatTime, desdeHace, lineas
    └── sections/conexion.js   la UI + su CSS inyectado
```

## Los dos modos
| Modo | Que aplica | Para que |
|---|---|---|
| `MODO.LG` — **Solo sitios de LG** (por defecto) | `pac_script` con `mandatory: true` | Lo interno va por el tunel, el resto directo. Si el tunel cae, la navegacion normal no se entera |
| `MODO.TODO` — **Todo el trafico** | `fixed_servers` con `singleProxy: {scheme:'socks5'}` + `bypassList` de loopback y `<local>` | Navegar con IP de LG. Es el que hace falta para un `shop.lg.com/obsadm/admin/` o un "cual es mi IP" |

`mandatory: true` en el PAC es deliberado: si el script no se puede evaluar, la peticion **falla** en vez de salir directo sin avisar. Un fallo ruidoso es preferible a creer que estas por el tunel.

## El PAC (`pac.js`)
Devuelve el TEXTO de un `FindProxyForURL`. Corre en el proceso de red de Chrome, **fuera de la extension**: el CSP estricto no aplica, pero tampoco se puede depurar desde DevTools — lo que falle solo se ve en el resultado. Por eso esta cubierto por `tests/unit/vpn-pac.test.js`, que **compila el texto generado con `new Function` y evalua la tabla de decisiones**.

Dos reglas copiadas de `internal/directo/directo.go` del repo de Enlace LG, porque equivocarse en cualquiera manda trafico por donde no toca:

1. **Sufijo de DOMINIO, no sufijo de cadena.** `lg.com` casa con `shop.lg.com` y con `lg.com.` (punto final), pero **no** con `malg.com` —que es de otra persona— ni con `lg.com.atacante.net`.
2. **Las redes se comparan a mano contra la IP literal.** No se usa `isInNet()` con nombres: fuerza una resolucion DNS *local*, que es lenta y es justo lo que el SOCKS5 remoto esta evitando. Un nombre que no case por dominio sale `DIRECT` aunque resuelva a una IP interna; para eso esta `MODO.TODO`.

**El texto generado no lleva ni una barra invertida a proposito** (la IP se reconoce con `split()` y `charCodeAt()`, no con un regex): el PAC viaja como string dentro de otro string y cada capa de escape es una ocasion para que llegue distinto de como se escribio. Esto ya paso una vez durante el desarrollo.

Borde cubierto: una red `/0` se trata aparte, porque en JavaScript `-1 << 32` es `-1 << 0` y no filtraria nada.

**Listas por defecto** (de `internal/config/host.go`, la lista con la que se acoto la salida web en la V1 de Enlace LG): dominios `lg.com`, `lge.com`; redes `136.166.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`. Editables desde el popup y persistidas.

## Estado y configuracion
Dos keys separadas a proposito:

- **`vpn:config`** — lo que la persona eligio: `{ modo, socks, dominios[], redes[] }`. Sobrevive a desconectar y es lo que se reaplica la proxima vez.
- **`vpn:estado`** — como esta la conexion ahora: `{ conectado, modo, desde, ultimoSondeo, ultimoError, motivo, ipSalida?:{ip,porLg,ts}, log:[{ts,level,message}] (cap 50) }`. El **service worker es el unico writer**; el popup solo lee y se suscribe.

El estado usa `createRunStore` aunque esto no sea un batch: lo que se necesita es exactamente lo que da (`updateRun` coalescido, `appendLog` con tope, `subscribeToRun`), y el registro con tope es justo lo que hace explicable una desconexion que ocurrio con el popup cerrado.

**Ojo — `asegurarEstado()`:** `updateRun()` del run-store **no escribe cuando no hay nada guardado** (resuelve `null` y no toca storage). Sin esa llamada previa, el primerisimo `updateEstado` de una instalacion nueva se perderia en silencio.

## Sondeo y vigilancia
**La sonda** es un `fetch('https://www.lg.com/favicon.ico')` con `AbortSignal.timeout` **desde el service worker**, que respeta el proxy del perfil. Por eso un exito prueba el **camino completo** (SOCKS5 arriba + el otro extremo con salida) y no solamente que el puerto acepta — la misma distincion que le costo horas al montaje de Enlace LG. Es un dominio de LG a proposito: asi la misma URL sirve para los dos modos (en `MODO.LG` casa con el PAC y tambien va por el tunel). No se mira el codigo HTTP: que el servidor conteste cualquier cosa ya significa que el tunel entrego la conexion.

**Al conectar se sondea antes de cantar victoria.** Si Enlace LG no esta corriendo, el proxy quedaria puesto apuntando a un puerto cerrado y el navegador sin internet — exactamente lo que esta feature existe para evitar. Si la sonda falla, se limpia el proxy y se explica.

**Mientras hay conexion**, tres disparadores llaman al mismo `comprobar()` (con guard `comprobando` para que no se pisen):
1. `chrome.alarms` (`vpn:vigilancia`) cada **1 min**.
2. `chrome.webRequest.onErrorOccurred` filtrado a `ERR_PROXY_CONNECTION_FAILED` / `ERR_SOCKS_*` / `ERR_TUNNEL_CONNECTION_FAILED` — camino rapido, reacciona en cuanto una peticion cualquiera falla en vez de esperar hasta un minuto.
3. Abrir el popup.

**Dos fallos seguidos** (`FALLOS_PARA_CAER`) y no uno: un corte de un segundo no justifica cambiarle el enrutamiento al navegador entero. Al segundo, `chrome.proxy.settings.clear()`, entrada en el registro y estado a desconectado. El contador vive en memoria a proposito: si el SW muere y revive, volver a empezar de cero es lo correcto — no hay forma de saber cuanto paso ni si el tunel volvio mientras tanto.

## Reconciliacion al arrancar (importante)
`chrome.proxy.settings` del scope `regular` **sobrevive al reinicio del navegador, y el service worker no**. Por eso `reconciliar()` corre en `onStartup` y `onInstalled`:
- Estado dice desconectado + proxy puesto por nosotros → se limpia.
- Estado dice conectado + seguimos mandando → se rearma la alarma (se fue con el SW anterior) y se comprueba de inmediato.
- Estado dice conectado + ya no mandamos → desconectar.

**Gana siempre "desconectar":** si algo no cuadra, lo seguro es que el navegador tenga internet. Sin esto, un navegador que arranca sin Enlace LG se queda sin internet y sin explicacion.

## "Comprobar IP de salida"
Boton, **no automatico**. Es la **unica llamada a un tercero** de la feature: confirmar de un vistazo que el tunel hace lo que dice vale la pena, pero no a costa de mandar algo fuera cada minuto sin que nadie lo pida.

**Ojo con que servicio se use: la red de LG bloquea `api.ipify.org`**, que es justo el primero que uno elige. El sintoma enganya —el tunel se abre (`200 Connection Established`) y el flujo muere despues— y parece un fallo del proxy. Medido contra el tunel real el 16-09-2026: `checkip.amazonaws.com` (el que se usa), `ifconfig.me` e `ident.me` si pasan; `icanhazip.com` e `ipinfo.io` no.

**El resultado se lee distinto segun el modo**, y por eso se guarda el modo junto a la IP:
- En **Todo el trafico** se espera `136.166.x.x`; otra cosa es un problema y se marca en rojo.
- En **Solo sitios de LG** el echo no es un dominio de LG, asi que sale directo por definicion: ver la IP de casa ahi es **lo correcto**, y la UI lo dice con esas palabras en vez de marcarlo en rojo.

## UI popup (`sections/conexion.js`)
Semaforo (verde conectado / rojo caido o sin tunel / gris desconectado) con el detalle debajo, selector de modo (`scf-mode-btn`, **deshabilitado mientras hay conexion**: el proxy se aplica entero, no por partes, asi que cambiar de modo exige reconectar), `<details>` con las listas y el SOCKS editables, Conectar/Desconectar + Comprobar IP, y `<details>` con el registro (ultimas 12, mas recientes arriba). El CSS propio se **inyecta desde JS** (mismo camino que Ajustes) para no sumar otro bloque al `popup.css` de 2600 lineas por una feature autocontenida. Teardown por `MutationObserver` sobre `isConnected`, porque el popup no avisa del desmontaje.

## Debug `__extLgeCl.vpn.`
`estado()`, `config()`, `setConfig(parcial)`, `pac()` (imprime el PAC que se aplicaria), `proxyActual()` (lo que el navegador tiene puesto, con su `levelOfControl`), `reset()` (borra el estado, no toca el proxy). Los que tocan `chrome.proxy` solo funcionan en el contexto del **service worker**.

## Credenciales del proxy remoto

Se responden desde `onAuthRequired` en modo **`asyncBlocking`**, no `blocking`: la credencial vive en `chrome.storage` y leerla es asincrono. Con `blocking` habria que mantener una copia en memoria, y el service worker muere cada dos por tres — al revivir para atender justo ese evento, la copia estaria vacia. Solo se contestan los retos del **proxy** (`isProxy`); un 401 de un sitio cualquiera no es asunto nuestro.

Si el proxy vuelve a pedir credenciales **para la misma peticion**, es que las rechazo: se deja de responder (si no, navegador y proxy se quedan en un ida y vuelta sin fin y la persona solo ve una pagina que no carga) y se marca el motivo `CREDENCIALES`, que la UI muestra con esas palabras.

### Dos cosas medidas en Chrome que conviene no re-descubrir

1. **Un 407 llega como respuesta, no como error de red.** Cuando la extension declina seguir autenticando, Chrome entrega el 407 a quien pidio. Una sonda que solo mire "¿resolvio el `fetch`?" lo da por bueno, deja el proxy puesto y el navegador se queda sin internet diciendo **"Conectado"**. Por eso `sondear()` trata el 407 aparte, y por eso hay un test (`tests/unit/vpn-conexion.test.js`) que lo fija.
2. **Chrome cachea las credenciales del proxy por perfil.** Tras una autenticacion correcta no vuelve a disparar `onAuthRequired`, asi que **cambiar la contrasena en el popup no tiene efecto hasta reiniciar el navegador**. No hay API para vaciar ese cache. Al rotar la contrasena, hay que decir a la gente que reinicie el navegador.

## Limitaciones (leer antes de tocar)
- **`chrome.proxy` es por perfil de navegador, no por pestaña.** Al conectar, todo el navegador queda sujeto al modo elegido. En `MODO.TODO` eso incluye **las demas features de esta extension** (Magento, Starkoms, la API de e-promoters…), que saldran por LG. `MODO.LG` acota el impacto a las listas.
- **El origen local requiere `enlace-lg.exe` corriendo.** La extension **no puede abrirlo ni matarlo**: Enlace LG no expone ninguna API local — ni HTTP, ni named pipe, ni socket de control (verificado; el unico `net/http` de ese repo es su propio proxy). `estado.json` solo guarda la marca temporal del ultimo estado `listo`, no el estado actual. Por eso el estado aqui es por **sondeo activo** y no por consulta. El origen servidor no tiene este problema.
- **El servidor tiene que ser un NOMBRE con certificado valido**, no la IP pelada (`147.93.176.66`): Chrome rechaza el TLS de un proxy cuyo certificado no case, y **no hay forma de aceptar la excepcion** para un proxy como se hace para una pagina.
- **La credencial del servidor es compartida:** una sola para todo el mundo, y revocarla es cambiarla para todos. Frente al origen local —clave SSH ed25519 por persona y cuenta confinada en el VPS— es un escalon menos. La **contrasena no va compilada** (`CLAVE_POR_DEFECTO` vacio): la escribe la persona la primera vez, para que no viaje dentro del `.crx` que se reparte. El servidor y el usuario si vienen puestos, que no son secretos.
- **Esto cubre el navegador y nada mas.** Excel, DBeaver y ODBC siguen necesitando `enlace-lg.exe`: no pasan por el proxy del navegador.
- **No cubre incognito** (`scope: 'regular'`).
- Si otra extension controla el proxy (`levelOfControl: 'controlled_by_other_extensions'`) o lo fija una politica corporativa (`not_controllable`), Conectar se niega y lo dice.
- Convivir con el modo "todo el trafico" de **Enlace LG** (que toca el proxy de **Windows**, `HKCU\...\Internet Settings`, apuntando al 1081) es redundante: el proxy del navegador gana. Si algo quedo raro, ese lado se arregla con `enlace-lg.exe -restaurar-proxy`.
- Solo TCP. Nada de UDP/QUIC por el tunel: Chrome no manda QUIC por un proxy, cae a TCP solo.
- El SOCKS es configurable (Enlace LG lo permite en su `config.json`), pero **solo en loopback**: ese programa se niega a arrancar si se le pide escuchar en otra interfaz, para no exponer el acceso a LG a quien comparta la wifi.

## Desplegar o actualizar el servidor
Ya esta desplegado. Para rehacerlo o cambiar la contrasena, desde `LG-VPN`:

```bash
.\compilar.ps1                                              # deja despliegue/vps/enlace-web
scp despliegue/vps/{enlace-web,enlace-web.service,instalar-web.sh} root@147.93.176.66:/tmp/
ssh root@147.93.176.66 "cd /tmp && ENLACE_WEB_CLAVE='...' ./instalar-web.sh 147-93-176-66.sslip.io 8443"
```

El script es idempotente y comprueba, antes y despues, que no se lleva por delante el tunel de produccion del `14330`. El detalle esta en el README de ese repo, seccion "Solo el navegador, sin instalar nada".

**El PC de la oficina no hay que tocarlo**: `enlace-host` no usa nada de lo que se cambio (solo `NuevoSocks` y `Trasvasar`), y ya publica el `:14332`, que es lo unico que el proxy consume.

## Pendientes
- Sin E2E automatizado (como el resto del repo). El PAC y la sonda si tienen unit tests, y las cuatro combinaciones de origen x modo se probaron contra el servidor real.
- Si en algun momento Enlace LG expone un endpoint local de estado (`nucleo.Vista` ya tiene los tags JSON completos y `Nucleo.Suscribir()` ya emite cambios), se podria mostrar el estado semantico real (`listo` / `host_apagado` / `sin_salida` / `sin_internet`) en vez de un binario, y hasta ofrecer abrir el programa. Hoy no existe y **esta feature no toca ese repo**.
