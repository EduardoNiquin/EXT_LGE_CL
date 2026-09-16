// Feature "VPN" — apunta este navegador a la red de LG.
//
// Hay DOS origenes posibles, y el que importa es el primero:
//
//   ORIGEN.SERVIDOR (por defecto) — un proxy HTTP con TLS publicado en el VPS
//     (enlace-web, en el repo LG-VPN). No hace falta instalar NADA en el PC:
//     el navegador habla directo con el servidor y este saca el trafico por la
//     red de LG. Es lo que hace que esta feature se baste sola.
//
//   ORIGEN.LOCAL — el SOCKS5 que publica enlace-lg.exe en el loopback. Sigue
//     aqui porque no cuesta nada y cubre dos casos reales: que el servidor
//     todavia no este desplegado, y que alguien prefiera la ruta con clave SSH
//     y cuenta propia en vez de una contrasena compartida.
//
// Por que el remoto es HTTPS y no SOCKS5: Chromium NO sabe autenticarse contra
// un proxy SOCKS —no implementa el usuario/clave de la RFC 1929—, asi que un
// SOCKS5 publicado en internet no tendria forma de pedir credenciales y seria
// un proxy abierto con salida a la red de LG. Un proxy HTTP si: responde 407 y
// el navegador manda Proxy-Authorization. El TLS es lo que impide que esas
// credenciales viajen en base64 por una red ajena.
//
// En los dos casos el nombre del destino viaja entero hasta el otro extremo
// (en el CONNECT o en el SOCKS5) y se resuelve alli, que es lo que hace que
// los nombres internos de LG existan y que la IP de origen sea una de LG.
//
// Todo corre en el SERVICE WORKER (la vigilancia tiene que sobrevivir al
// cierre del popup); el estado vive en chrome.storage.local y el popup lo
// refleja en vivo via storage.onChanged.

export const FEATURE_ID = 'vpn';

export const STORAGE_KEYS = {
  ESTADO: `${FEATURE_ID}:estado`, // conexion actual + registro de eventos
  CONFIG: `${FEATURE_ID}:config`, // origen, modo, servidor, credenciales y listas
};

// Mensajes popup -> service worker.
export const MESSAGES = {
  CONECTAR:    `${FEATURE_ID}:conectar`,
  DESCONECTAR: `${FEATURE_ID}:desconectar`,
  COMPROBAR:   `${FEATURE_ID}:comprobar`,
  IP_SALIDA:   `${FEATURE_ID}:ip-salida`,
};

// Nombre de la alarma que vigila el tunel mientras hay conexion.
export const ALARM_VIGILANCIA = `${FEATURE_ID}:vigilancia`;

// De donde sale el tunel.
export const ORIGEN = {
  SERVIDOR: 'servidor', // proxy con TLS en el VPS; no hay que instalar nada
  LOCAL:    'local',    // SOCKS5 de enlace-lg.exe en este PC
};

export const ORIGEN_LABEL = {
  [ORIGEN.SERVIDOR]: 'Servidor',
  [ORIGEN.LOCAL]:    'Enlace LG local',
};

// Que se enruta por el tunel.
export const MODO = {
  LG:   'lg',   // solo dominios y redes de LG (PAC). El resto, directo
  TODO: 'todo', // todo el navegador sale por LG
};

export const MODO_LABEL = {
  [MODO.LG]:   'Solo sitios de LG',
  [MODO.TODO]: 'Todo el trafico',
};

// --- Servidor remoto --------------------------------------------------------
//
// El proxy publicado en el VPS. Lo despliega despliegue/vps/instalar-web.sh
// del repo LG-VPN.
//
// Es un NOMBRE y no la IP pelada (147.93.176.66) porque Chrome rechaza el TLS
// de un proxy cuyo certificado no case, y no hay forma de aceptar la excepcion
// para un proxy como se hace para una pagina. sslip.io resuelve al propio
// servidor sin registrar ningun dominio, y Let's Encrypt emite para el.
//
// El puerto es el 8443 y no el 443 porque en ese VPS el 443 lo tiene nginx.
export const SERVIDOR_POR_DEFECTO = '147-93-176-66.sslip.io:8443';

// La credencial es compartida (una sola para todo el mundo), pero la CONTRASENA
// se deja vacia a proposito y la escribe la persona la primera vez: asi no viaja
// dentro del .crx que se reparte, donde cualquiera que lo tenga podria sacarla
// con un editor de texto. El usuario si viene puesto, porque no es secreto.
//
// Lo que la persona hace la primera vez, y nada mas: abrir el apartado VPN,
// escribir la contrasena y pulsar Conectar. El bloque de credenciales se abre
// solo mientras falte, para que no haya que buscarlo.
export const USUARIO_POR_DEFECTO = 'lg';
export const CLAVE_POR_DEFECTO = '';

// --- Origen local -----------------------------------------------------------
//
// El SOCKS5 que publica enlace-lg.exe. Es configurable en su config.json
// ("socks"), pero solo en loopback: el propio programa se niega a arrancar si
// se le pide escuchar en otra interfaz.
export const SOCKS_POR_DEFECTO = '127.0.0.1:1080';

// --- Que es "de LG" ---------------------------------------------------------
//
// Sale de internal/config/host.go del repo de Enlace LG: era la lista con la
// que se acoto la salida web en su V1. Hoy el extremo de la oficina permite
// "*" (por eso MODO.TODO puede navegar libremente), pero esta sigue siendo la
// descripcion correcta de "lo interno" y por eso es el punto de partida.
export const DOMINIOS_LG = ['lg.com', 'lge.com'];
export const REDES_LG = ['136.166.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

// Destinos que nunca deben salir por el tunel en MODO.TODO.
export const BYPASS = ['localhost', '127.0.0.1', '[::1]', '<local>'];

// --- Sonda ------------------------------------------------------------------
//
// Se pide por fetch desde el service worker, que respeta el proxy del perfil,
// asi que un exito prueba que el proxy esta arriba Y que el otro extremo tiene
// salida. Es un dominio de LG a proposito: asi la misma URL sirve para los dos
// modos (en MODO.LG casa con el PAC y tambien va por el tunel).
export const SONDA_URL = 'https://www.lg.com/favicon.ico';
export const SONDA_TIMEOUT_MS = 10000;

// Fallos de sonda seguidos antes de volver a directo. Dos y no uno para no
// desconectar por un corte de un segundo.
export const FALLOS_PARA_CAER = 2;

// Echo de IP publica para el boton "Comprobar IP de salida". Es la unica
// llamada a un tercero de la feature y solo ocurre si se pulsa el boton.
//
// Devuelve la IP en texto plano y nada mas. No se usa api.ipify.org —que seria
// lo primero que uno busca— porque **la red de LG lo bloquea**: el tunel se
// abre y el flujo muere despues, que es el sintoma mas confuso posible. Medido
// el 16-09-2026 contra el tunel real; checkip.amazonaws.com e ifconfig.me si
// pasan.
export const IP_ECHO_URL = 'https://checkip.amazonaws.com';

// Prefijo de las IP publicas de LG: si la salida da esto, el tunel esta
// haciendo lo que dice.
export const PREFIJO_IP_LG = '136.166.';

// Errores de red que significan "el proxy dejo de responder". Se usan para
// reaccionar al instante en vez de esperar a la alarma.
export const ERRORES_PROXY = [
  'net::ERR_PROXY_CONNECTION_FAILED',
  'net::ERR_SOCKS_CONNECTION_FAILED',
  'net::ERR_SOCKS_CONNECTION_HOST_UNREACHABLE',
  'net::ERR_TUNNEL_CONNECTION_FAILED',
  'net::ERR_PROXY_CERTIFICATE_INVALID',
  'net::ERR_PROXY_AUTH_UNSUPPORTED',
];

export const MOTIVO = {
  SIN_CONTROL:   'sin-control',   // otra extension manda sobre el proxy
  SIN_SERVIDOR:  'sin-servidor',  // no hay servidor configurado
  SIN_TUNEL:     'sin-tunel',     // no se llega al proxy
  CREDENCIALES:  'credenciales',  // se llega, pero rechaza el usuario/clave
  CAIDO:         'caido',         // estaba conectado y dejo de responder
  ERROR:         'error',
};

export const LOG_CAP = 50;
