// VPN — aplicar y quitar el proxy, y vigilar que el tunel siga en pie.
//
// Corre entero en el service worker. El popup solo manda mensajes y lee el
// estado por storage, de modo que cerrarlo no interrumpe nada: la vigilancia
// tiene que seguir corriendo justamente porque el sintoma de que Enlace LG se
// cayo aparece mientras nadie esta mirando el popup.
//
// Lo que hay que tener presente al tocar esto:
//
//   - chrome.proxy.settings del scope "regular" SOBREVIVE al reinicio del
//     navegador, y el service worker no. Por eso hay reconciliacion en
//     onStartup/onInstalled: si el estado guardado dice "desconectado" pero el
//     proxy sigue puesto, se limpia. Sin eso, un navegador que arranca sin
//     Enlace LG se queda sin internet y sin explicacion.
//
//   - La sonda se pide con fetch DESDE el service worker, que respeta el proxy
//     del perfil. Por eso un exito prueba el camino completo (SOCKS5 arriba +
//     el otro extremo con salida) y no solamente que el puerto acepta.

import { logger } from '../../../shared/utils/logger.js';
import { toMessage } from '../../../shared/errors/index.js';
import {
  ALARM_VIGILANCIA,
  BYPASS,
  ERRORES_PROXY,
  FALLOS_PARA_CAER,
  IP_ECHO_URL,
  MESSAGES,
  MODO,
  MODO_LABEL,
  MOTIVO,
  ORIGEN,
  ORIGEN_LABEL,
  PREFIJO_IP_LG,
  SONDA_TIMEOUT_MS,
  SONDA_URL,
} from '../constants.js';
import { construirPac } from '../pac.js';
import {
  asegurarEstado,
  getConfig,
  getEstadoOInicial,
  setConfig,
  updateEstado,
} from '../state.js';

const log = logger('vpn');

// Fallos de sonda seguidos. Vive en memoria a proposito: si el service worker
// muere y revive, volver a empezar de cero es lo correcto —no hay forma de
// saber cuanto tiempo paso ni si el tunel volvio mientras tanto.
let fallosSeguidos = 0;

// Evita que la alarma y el detector de errores de red sondeen a la vez.
let comprobando = null;

// Peticiones a las que ya se les dio la credencial. Si el proxy vuelve a pedir
// por la MISMA peticion es que la rechazo, y entonces hay que dejar de
// responder: si no, navegador y proxy se quedarian en un ida y vuelta sin fin
// y la persona no veria mas que una pagina que no carga.
const credencialEntregada = new Set();
let credencialesRechazadas = false;

// ---------------------------------------------------------------------------
// chrome.proxy
// ---------------------------------------------------------------------------

/**
 * A donde apunta el navegador, segun el origen elegido.
 *
 * Devuelve `{ scheme, host, port }`. El esquema es lo que decide dos cosas de
 * golpe: que el DNS se resuelva en el otro extremo (y no aqui) y si el enlace
 * hasta el proxy va cifrado.
 */
export function destinoDelProxy({ origen, servidor, socks }) {
  if (origen === ORIGEN.LOCAL) {
    const [host, puerto] = String(socks || '').split(':');
    return { scheme: 'socks5', host, port: Number(puerto) };
  }
  const [host, puerto] = String(servidor || '').split(':');
  return { scheme: 'https', host, port: Number(puerto || 443) };
}

/** La misma cosa, escrita como la quiere un PAC. */
function directivaPac(destino) {
  const tipo = destino.scheme === 'https' ? 'HTTPS' : 'SOCKS5';
  return `${tipo} ${destino.host}:${destino.port}`;
}

/** La config de chrome.proxy que corresponde al origen y al modo elegidos. */
export function configDeProxy(config) {
  const destino = destinoDelProxy(config);

  if (config.modo === MODO.TODO) {
    return {
      mode: 'fixed_servers',
      // singleProxy cubre http, https y ftp de una vez.
      rules: { singleProxy: destino, bypassList: [...BYPASS] },
    };
  }

  return {
    mode: 'pac_script',
    // mandatory: si el PAC no se puede evaluar, fallar en vez de salir directo
    // sin avisar. Un fallo ruidoso es preferible a creer que estas por el tunel.
    pacScript: {
      data: construirPac({
        proxy: directivaPac(destino),
        dominios: config.dominios,
        redes: config.redes,
      }),
      mandatory: true,
    },
  };
}

/** ¿Podemos tocar el proxy, o manda otro? */
async function quienManda() {
  const actual = await chrome.proxy.settings.get({});
  return actual?.levelOfControl || 'unknown';
}

function podemosEscribir(nivel) {
  return nivel === 'controllable_by_this_extension' || nivel === 'controlled_by_this_extension';
}

async function aplicarProxy(config) {
  await chrome.proxy.settings.set({ value: configDeProxy(config), scope: 'regular' });
}

async function limpiarProxy() {
  try {
    await chrome.proxy.settings.clear({ scope: 'regular' });
  } catch (err) {
    log.warn('no se pudo limpiar el proxy', new Error(toMessage(err)));
  }
}

// ---------------------------------------------------------------------------
// Sonda
// ---------------------------------------------------------------------------

/**
 * Prueba el camino completo.
 *
 * Devuelve true si la peticion llego al destino. No se mira el codigo HTTP
 * —que el servidor conteste cualquier cosa ya significa que el tunel entrego
 * la conexion— con UNA excepcion: el 407.
 *
 * El 407 no lo manda el destino, lo manda el proxy, y significa justo lo
 * contrario: que no entrego nada. Ademas llega como una respuesta normal y no
 * como un error de red, porque cuando la extension declina seguir autenticando
 * Chrome entrega el 407 a quien pidio. Sin esta comprobacion, conectar con la
 * contrasena mal daba "conectado" y dejaba el navegador sin internet.
 */
export async function sondear() {
  try {
    const res = await fetch(SONDA_URL, {
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(SONDA_TIMEOUT_MS),
    });
    if (res.status === 407) {
      credencialesRechazadas = true;
      log.debug('sonda: el proxy pide credenciales');
      return false;
    }
    // El listener de autenticacion pudo marcarlo mientras esta peticion estaba
    // en vuelo, aunque el fetch acabara resolviendo.
    return !credencialesRechazadas;
  } catch (err) {
    log.debug('sonda fallida', toMessage(err));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Conectar / desconectar
// ---------------------------------------------------------------------------

async function registrar(nivel, mensaje, extra = {}) {
  await updateEstado((estado) => {
    const log_ = Array.isArray(estado.log) ? estado.log : [];
    return { ...estado, ...extra, log: [...log_, { ts: Date.now(), level: nivel, message: mensaje }] };
  });
}

export async function conectar({ modo, origen } = {}) {
  await asegurarEstado();

  const nivel = await quienManda();
  if (!podemosEscribir(nivel)) {
    const mensaje = nivel === 'controlled_by_other_extensions'
      ? 'Otra extension esta controlando el proxy del navegador. Desactivala y volve a intentar.'
      : 'El navegador no deja cambiar el proxy (puede ser una politica corporativa).';
    await registrar('error', mensaje, { conectado: false, motivo: MOTIVO.SIN_CONTROL, ultimoError: mensaje });
    return { ok: false, reason: mensaje };
  }

  const cambios = {};
  if (modo) cambios.modo = modo;
  if (origen) cambios.origen = origen;
  const config = Object.keys(cambios).length ? await setConfig(cambios) : await getConfig();

  if (config.origen === ORIGEN.SERVIDOR) {
    // Se comprueba antes de tocar el proxy: si falta algo, intentarlo dejaria
    // el navegador apuntando a un sitio al que no puede entrar.
    let falta = null;
    if (!String(config.servidor || '').trim()) {
      falta = 'Falta el servidor. Ponlo en "Servidor y credenciales", '
        + 'o cambia el origen a "Enlace LG local".';
    } else if (!String(config.clave || '')) {
      falta = 'Falta la contrasena. Escribela en "Servidor y credenciales".';
    }
    if (falta) {
      await registrar('error', falta, {
        conectado: false, motivo: MOTIVO.SIN_SERVIDOR, ultimoError: falta,
      });
      return { ok: false, reason: falta };
    }
  }

  credencialEntregada.clear();
  credencialesRechazadas = false;

  try {
    await aplicarProxy(config);
  } catch (err) {
    const mensaje = toMessage(err);
    await limpiarProxy();
    await registrar('error', `No se pudo aplicar el proxy: ${mensaje}`, {
      conectado: false, motivo: MOTIVO.ERROR, ultimoError: mensaje,
    });
    return { ok: false, reason: mensaje };
  }

  // Probar antes de cantar victoria. Si Enlace LG no esta corriendo, el proxy
  // quedaria puesto apuntando a un puerto cerrado y el navegador sin internet:
  // exactamente lo que esta feature existe para evitar.
  if (!(await sondear())) {
    await limpiarProxy();
    const mensaje = motivoDelFallo(config);
    await registrar('error', mensaje, {
      conectado: false, modo: null, desde: null,
      motivo: credencialesRechazadas ? MOTIVO.CREDENCIALES : MOTIVO.SIN_TUNEL,
      ultimoError: mensaje, ultimoSondeo: Date.now(),
    });
    return { ok: false, reason: mensaje };
  }

  fallosSeguidos = 0;
  await registrar('info',
    `Conectado por ${ORIGEN_LABEL[config.origen]} en modo "${MODO_LABEL[config.modo]}"`, {
      conectado: true, modo: config.modo, origen: config.origen, desde: Date.now(),
      motivo: null, ultimoError: null, ultimoSondeo: Date.now(), ipSalida: null,
    });

  await chrome.alarms.create(ALARM_VIGILANCIA, { periodInMinutes: 1 });
  log.info('conectado', { origen: config.origen, modo: config.modo });
  return { ok: true };
}

/**
 * Por que no se pudo conectar, en palabras que digan que hacer.
 *
 * "No responde" a secas es lo que hace que la gente pruebe cosas al azar; el
 * siguiente paso no es el mismo si la credencial esta mal que si el servidor
 * no esta arriba.
 */
function motivoDelFallo(config) {
  if (credencialesRechazadas) {
    return 'El servidor rechazo el usuario o la contrasena. Revisalos en '
      + '"Servidor y credenciales".';
  }
  if (config.origen === ORIGEN.LOCAL) {
    return 'No hay respuesta por el tunel. Revisa que Enlace LG este abierto y en verde.';
  }
  return `No se pudo llegar a ${config.servidor}. Puede estar caido, o el `
    + 'certificado no ser valido para ese nombre.';
}

export async function desconectar({ motivo = null, mensaje = 'Desconectado' } = {}) {
  await asegurarEstado();
  await limpiarProxy();
  await chrome.alarms.clear(ALARM_VIGILANCIA);
  fallosSeguidos = 0;

  await registrar(motivo ? 'warn' : 'info', mensaje, {
    conectado: false, modo: null, desde: null, motivo, ipSalida: null,
    ultimoError: motivo ? mensaje : null,
  });
  log.info('desconectado', { motivo });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Vigilancia
// ---------------------------------------------------------------------------

/**
 * Sondea y, si el tunel se cayo, vuelve a directo.
 *
 * Dos fallos seguidos y no uno: un corte de un segundo no justifica cambiarle
 * el enrutamiento al navegador entero.
 */
export async function comprobar() {
  if (comprobando) return comprobando;
  comprobando = (async () => {
    const estado = await getEstadoOInicial();
    if (!estado.conectado) return { ok: true, conectado: false };

    const vivo = await sondear();
    if (vivo) {
      fallosSeguidos = 0;
      await updateEstado((e) => ({ ...e, ultimoSondeo: Date.now(), ultimoError: null }));
      return { ok: true, conectado: true };
    }

    fallosSeguidos += 1;
    log.warn('sonda fallida', { fallosSeguidos });
    if (fallosSeguidos < FALLOS_PARA_CAER) {
      await updateEstado((e) => ({ ...e, ultimoSondeo: Date.now() }));
      return { ok: true, conectado: true, fallosSeguidos };
    }

    await desconectar({
      motivo: credencialesRechazadas ? MOTIVO.CREDENCIALES : MOTIVO.CAIDO,
      mensaje: credencialesRechazadas
        ? 'El servidor dejo de aceptar las credenciales; se volvio a conexion directa.'
        : 'El tunel dejo de responder; se volvio a conexion directa.',
    });
    return { ok: true, conectado: false, caido: true };
  })().finally(() => { comprobando = null; });

  return comprobando;
}

/**
 * Reconcilia estado guardado y proxy real.
 *
 * El proxy sobrevive al reinicio del navegador y el service worker no, asi que
 * al arrancar hay que decidir cual de los dos tiene razon. Gana "desconectar":
 * si algo no cuadra, lo seguro es que el navegador tenga internet.
 */
export async function reconciliar() {
  await asegurarEstado();
  const estado = await getEstadoOInicial();
  const nivel = await quienManda();

  if (!estado.conectado) {
    if (nivel === 'controlled_by_this_extension') {
      log.info('reconciliando: habia proxy puesto sin estado conectado, se limpia');
      await limpiarProxy();
    }
    await chrome.alarms.clear(ALARM_VIGILANCIA);
    return;
  }

  if (!podemosEscribir(nivel) || nivel !== 'controlled_by_this_extension') {
    await desconectar({
      motivo: MOTIVO.ERROR,
      mensaje: 'La configuracion de proxy se perdio al reiniciar; se volvio a conexion directa.',
    });
    return;
  }

  // El proxy sigue puesto y el estado dice conectado: rearmar la vigilancia,
  // que se fue con el service worker anterior, y comprobar de inmediato.
  await chrome.alarms.create(ALARM_VIGILANCIA, { periodInMinutes: 1 });
  await comprobar();
}

// ---------------------------------------------------------------------------
// IP de salida (bajo demanda)
// ---------------------------------------------------------------------------

/**
 * Pregunta a un echo publico que IP se ve desde fuera.
 *
 * Es la unica llamada a un tercero de la feature y solo ocurre si se pulsa el
 * boton: confirmar de un vistazo que estas saliendo por LG vale la pena, pero
 * no a costa de mandar algo fuera cada minuto sin que nadie lo pida.
 *
 * Se guarda tambien EN QUE MODO se pregunto, porque la misma respuesta
 * significa cosas opuestas: en "Todo el trafico" una IP que no sea de LG es un
 * problema, y en "Solo sitios de LG" es lo correcto —el echo no es un dominio
 * de LG, asi que sale directo por definicion—. Sin ese dato la UI marcaria en
 * rojo el funcionamiento normal.
 */
export async function ipDeSalida() {
  try {
    const res = await fetch(IP_ECHO_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(SONDA_TIMEOUT_MS),
    });
    // Texto plano con un salto de linea al final, no JSON.
    const ip = (await res.text()).trim();
    const porLg = Boolean(ip) && ip.startsWith(PREFIJO_IP_LG);
    const { modo } = await getConfig();
    await updateEstado((e) => ({ ...e, ipSalida: { ip, porLg, modo, ts: Date.now() } }));
    return { ok: true, ip, porLg, modo };
  } catch (err) {
    const mensaje = toMessage(err);
    log.warn('no se pudo comprobar la IP de salida', new Error(mensaje));
    return { ok: false, reason: mensaje };
  }
}

// ---------------------------------------------------------------------------
// Credenciales del proxy
// ---------------------------------------------------------------------------

/**
 * Responde al 407 del proxy con el usuario y la clave configurados.
 *
 * Va en modo 'asyncBlocking' y no 'blocking' porque la credencial vive en
 * chrome.storage y leerla es asincrono. Con 'blocking' habria que mantener una
 * copia en memoria, y el service worker muere cada dos por tres: al revivir
 * para atender justo este evento, esa copia estaria vacia.
 *
 * Solo se contesta a los retos del PROXY (`isProxy`). Un 401 de un sitio web
 * cualquiera no es asunto nuestro.
 */
function atenderAutenticacion(detalles, responder) {
  if (!detalles?.isProxy) { responder({}); return; }

  if (credencialEntregada.has(detalles.requestId)) {
    // Segunda vez para la misma peticion: la credencial no sirve. Se deja de
    // responder para que la peticion falle y la vigilancia lo vea, en vez de
    // quedarse reintentando en un bucle invisible.
    credencialesRechazadas = true;
    log.warn('el proxy rechazo las credenciales');
    responder({});
    return;
  }
  credencialEntregada.add(detalles.requestId);

  getConfig()
    .then((config) => responder({
      authCredentials: { username: config.usuario || '', password: config.clave || '' },
    }))
    .catch((err) => {
      log.error('credenciales del proxy', new Error(toMessage(err)));
      responder({});
    });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

export function wireVpnBackground() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case MESSAGES.CONECTAR:
        conectar(msg.payload || {})
          .then(sendResponse)
          .catch((err) => sendResponse({ ok: false, reason: toMessage(err) }));
        return true; // se responde async: el popup espera el resultado del sondeo

      case MESSAGES.DESCONECTAR:
        desconectar()
          .then(sendResponse)
          .catch((err) => sendResponse({ ok: false, reason: toMessage(err) }));
        return true;

      case MESSAGES.COMPROBAR:
        comprobar()
          .then(sendResponse)
          .catch((err) => sendResponse({ ok: false, reason: toMessage(err) }));
        return true;

      case MESSAGES.IP_SALIDA:
        ipDeSalida()
          .then(sendResponse)
          .catch((err) => sendResponse({ ok: false, reason: toMessage(err) }));
        return true;

      default:
        return false;
    }
  });

  chrome.alarms.onAlarm.addListener((alarma) => {
    if (alarma?.name !== ALARM_VIGILANCIA) return;
    comprobar().catch((err) => log.error('vigilancia', new Error(toMessage(err))));
  });

  // Credenciales del proxy remoto. Se registra siempre, tambien con el origen
  // local: sin conexion no hay 407 que atender, asi que no estorba.
  chrome.webRequest.onAuthRequired.addListener(
    atenderAutenticacion,
    { urls: ['<all_urls>'] },
    ['asyncBlocking'],
  );

  // Camino rapido: en cuanto una peticion cualquiera falla porque el proxy no
  // responde, comprobar sin esperar hasta un minuto a la alarma.
  chrome.webRequest.onErrorOccurred.addListener(
    (detalles) => {
      credencialEntregada.delete(detalles?.requestId);
      if (!ERRORES_PROXY.includes(detalles?.error)) return;
      comprobar().catch((err) => log.error('comprobar tras error de proxy', new Error(toMessage(err))));
    },
    { urls: ['<all_urls>'] },
  );

  // Sin esto el Set crece sin tope mientras haya conexion.
  chrome.webRequest.onCompleted.addListener(
    (detalles) => credencialEntregada.delete(detalles?.requestId),
    { urls: ['<all_urls>'] },
  );

  chrome.runtime.onStartup.addListener(() => {
    reconciliar().catch((err) => log.error('reconciliar (onStartup)', new Error(toMessage(err))));
  });
  chrome.runtime.onInstalled.addListener(() => {
    reconciliar().catch((err) => log.error('reconciliar (onInstalled)', new Error(toMessage(err))));
  });
}
