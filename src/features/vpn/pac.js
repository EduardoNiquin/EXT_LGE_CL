// Genera el PAC del modo "Solo sitios de LG".
//
// Logica pura y sin dependencias: lo que devuelve es el TEXTO de un
// FindProxyForURL que Chrome ejecuta en el proceso de red, fuera de la
// extension (por eso el CSP estricto no aplica aqui, y por eso tampoco se
// puede depurar desde DevTools: lo que falle hay que verlo en el resultado).
//
// Dos reglas se copian de internal/directo/directo.go del repo de Enlace LG,
// porque equivocarse en cualquiera de las dos manda trafico por donde no toca:
//
//   1. Sufijo de DOMINIO, no sufijo de cadena. "lg.com" casa con "shop.lg.com"
//      y con "lg.com." (punto final), pero NO con "malg.com" —que es de otra
//      persona— ni con "lg.com.atacante.net".
//
//   2. Las redes se comparan a mano contra la IP literal. No se usa isInNet()
//      con nombres: fuerza una resolucion DNS *local*, que es lenta y es justo
//      lo que el SOCKS5 remoto esta evitando. Un nombre que no case por dominio
//      sale DIRECT aunque resuelva a una IP interna; para eso esta el modo
//      "Todo el trafico".
//
// El texto generado no lleva ni una barra invertida a proposito: el PAC viaja
// como string dentro de otro string y cada capa de escape es una ocasion para
// que llegue distinto de como se escribio. Por eso la IP se reconoce a mano
// con split() y charCodeAt() en vez de con una expresion regular.

const RE_IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Una directiva de PAC: el tipo de proxy y su anfitrion:puerto.
//
// HTTPS es el proxy remoto con TLS (enlace-web, en el VPS) y SOCKS5 el local
// de enlace-lg.exe. PROXY —HTTP en claro— no se admite a proposito: las
// credenciales viajarian en base64 y el CONNECT sin cifrar.
const RE_DIRECTIVA = /^(HTTPS|SOCKS5) [\w.-]+:\d{1,5}$/;

/**
 * Convierte "136.166.0.0/16" en [base, bits].
 * Devuelve null si no es un CIDR IPv4 valido.
 */
export function parsearCidr(cidr) {
  const [ip, bitsCrudo] = String(cidr).trim().split('/');
  const m = RE_IPV4.exec(ip || '');
  if (!m) return null;

  const octetos = m.slice(1).map(Number);
  if (octetos.some((o) => o > 255)) return null;

  const bits = bitsCrudo === undefined ? 32 : Number(bitsCrudo);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;

  const base = octetos[0] * 16777216 + octetos[1] * 65536 + octetos[2] * 256 + octetos[3];
  return [base, bits];
}

/**
 * Arma el PAC.
 *
 * @param {object}   opciones
 * @param {string}   opciones.proxy     directiva PAC: "HTTPS vpn.dom:443" o "SOCKS5 127.0.0.1:1080"
 * @param {string[]} opciones.dominios  sufijos de dominio que van por el tunel
 * @param {string[]} opciones.redes     CIDR IPv4 que van por el tunel
 * @returns {string} el texto del PAC
 */
export function construirPac({ proxy, dominios = [], redes = [] }) {
  if (!RE_DIRECTIVA.test(String(proxy || ''))) {
    throw new Error(`VPN: "${proxy}" no es una directiva de PAC valida (HTTPS o SOCKS5 + host:puerto).`);
  }

  const limpios = dominios
    .map((d) => String(d).trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);

  const pares = redes.map(parsearCidr).filter(Boolean);

  // Las listas van embebidas como literales: el PAC no puede leer nada de
  // fuera, asi que cambiar la configuracion es regenerar y reaplicar el texto.
  return `function FindProxyForURL(url, host) {
  var TUNEL = "${proxy}";
  var DIRECTO = "DIRECT";
  var DOMINIOS = ${JSON.stringify(limpios)};
  var REDES = ${JSON.stringify(pares)};

  var h = ("" + host).toLowerCase();
  while (h.length > 0 && h.charAt(h.length - 1) === ".") { h = h.substring(0, h.length - 1); }
  if (h === "") { return DIRECTO; }

  var partes = h.split(".");
  var esIp = partes.length === 4;
  for (var k = 0; esIp && k < 4; k++) {
    var p = partes[k];
    if (p.length < 1 || p.length > 3) { esIp = false; break; }
    for (var c = 0; c < p.length; c++) {
      var cod = p.charCodeAt(c);
      if (cod < 48 || cod > 57) { esIp = false; break; }
    }
    if (esIp && (+p) > 255) { esIp = false; }
  }

  if (esIp) {
    var n = (+partes[0]) * 16777216 + (+partes[1]) * 65536 + (+partes[2]) * 256 + (+partes[3]);
    for (var i = 0; i < REDES.length; i++) {
      var bits = REDES[i][1];
      // bits 0 es "toda la internet": el desplazamiento de abajo daria -1 << 32,
      // que en JavaScript es -1 << 0 y no filtraria nada.
      if (bits === 0) { return TUNEL; }
      var masc = -1 << (32 - bits);
      if (((n ^ REDES[i][0]) & masc) === 0) { return TUNEL; }
    }
    return DIRECTO;
  }

  for (var j = 0; j < DOMINIOS.length; j++) {
    var d = DOMINIOS[j];
    if (h === d) { return TUNEL; }
    if (h.length > d.length && h.substring(h.length - d.length - 1) === "." + d) { return TUNEL; }
  }

  return DIRECTO;
}`;
}
