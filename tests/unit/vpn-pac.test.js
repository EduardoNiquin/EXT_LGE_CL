// El PAC del modo "Solo sitios de LG".
//
// Se construye el texto y se EVALUA, porque lo que importa no es como se ve
// sino que decide: el PAC corre en el proceso de red de Chrome, donde no se
// puede depurar, asi que cualquier error de escape o de mascara solo se veria
// en produccion como "un sitio sale por donde no toca".
//
// La tabla de dominios replica a proposito la de internal/directo/directo_test.go
// del repo de Enlace LG: son las mismas reglas y tienen que dar lo mismo.

import { describe, expect, it } from 'vitest';
import { construirPac, parsearCidr } from '../../src/features/vpn/pac.js';
import { DOMINIOS_LG, REDES_LG, SOCKS_POR_DEFECTO } from '../../src/features/vpn/constants.js';

const TUNEL = `SOCKS5 ${SOCKS_POR_DEFECTO}`;
const DIRECTO = 'DIRECT';

/** Compila el PAC generado y devuelve el FindProxyForURL listo para llamar. */
function compilar(opciones = {}) {
  const texto = construirPac({
    proxy: TUNEL,
    dominios: DOMINIOS_LG,
    redes: REDES_LG,
    ...opciones,
  });
  // eslint-disable-next-line no-new-func
  const fn = new Function(`return (${texto})`)();
  return (host) => fn(`https://${host}/`, host);
}

describe('parsearCidr', () => {
  it('convierte un CIDR valido en [base, bits]', () => {
    expect(parsearCidr('136.166.0.0/16')).toEqual([2292580352, 16]);
    expect(parsearCidr('10.0.0.0/8')).toEqual([167772160, 8]);
  });

  it('asume /32 cuando no hay mascara', () => {
    expect(parsearCidr('8.8.8.8')).toEqual([134744072, 32]);
  });

  it('rechaza lo que no es un CIDR IPv4', () => {
    for (const malo of ['', 'lg.com', '999.1.1.1', '10.0.0.0/33', '10.0.0.0/-1', '::1/128', '10.0.0']) {
      expect(parsearCidr(malo)).toBeNull();
    }
  });
});

describe('construirPac', () => {
  it('rechaza una directiva de proxy mal escrita', () => {
    const malos = [
      '', undefined,
      'SOCKS5 127.0.0.1',                  // sin puerto
      'socks5://127.0.0.1:1080',           // esquema de URL, no de PAC
      'SOCKS5127.0.0.1:1080',              // sin espacio
      // HTTP en claro no se admite: las credenciales del proxy viajarian en
      // base64 y el CONNECT sin cifrar.
      'PROXY vpn.midominio.com:8080',
      'DIRECT',
    ];
    for (const malo of malos) {
      expect(() => construirPac({ proxy: malo, dominios: [], redes: [] }), String(malo)).toThrow();
    }
  });

  it('acepta el proxy remoto con TLS', () => {
    const pac = compilar({ proxy: 'HTTPS vpn.midominio.com:443' });
    expect(pac('shop.lg.com')).toBe('HTTPS vpn.midominio.com:443');
    expect(pac('136.166.26.211')).toBe('HTTPS vpn.midominio.com:443');
    expect(pac('google.com')).toBe(DIRECTO);
  });

  it('manda los dominios de LG y sus subdominios por el tunel', () => {
    const pac = compilar();
    for (const host of ['lg.com', 'shop.lg.com', 'www.lg.com', 'lge.com', 'a.b.lge.com']) {
      expect(pac(host), host).toBe(TUNEL);
    }
  });

  it('trata el punto final como parte del mismo dominio', () => {
    const pac = compilar();
    expect(pac('lg.com.')).toBe(TUNEL);
    expect(pac('shop.lg.com..')).toBe(TUNEL);
  });

  it('casa por sufijo de dominio y no por sufijo de cadena', () => {
    // El caso que justifica la regla: "malg.com" es de otra persona, y
    // "lg.com.atacante.net" es un dominio que cualquiera puede registrar.
    const pac = compilar();
    for (const host of ['malg.com', 'notlg.com', 'lg.com.atacante.net', 'lge.com.evil.net']) {
      expect(pac(host), host).toBe(DIRECTO);
    }
  });

  it('manda las IP de las redes internas por el tunel', () => {
    const pac = compilar();
    for (const host of ['136.166.26.211', '136.166.0.0', '10.1.2.3', '172.16.5.5', '172.31.255.255', '192.168.0.9']) {
      expect(pac(host), host).toBe(TUNEL);
    }
  });

  it('respeta los bordes de las mascaras', () => {
    const pac = compilar();
    for (const host of ['136.167.0.1', '136.165.255.255', '11.0.0.1', '172.15.255.255', '172.32.0.0', '192.169.0.1']) {
      expect(pac(host), host).toBe(DIRECTO);
    }
  });

  it('deja salir directo todo lo demas', () => {
    const pac = compilar();
    for (const host of ['google.com', 'www.magento.com', '8.8.8.8', '1.1.1.1', 'localhost']) {
      expect(pac(host), host).toBe(DIRECTO);
    }
  });

  it('no confunde una IP invalida con un dominio ni la enruta', () => {
    const pac = compilar();
    for (const host of ['999.1.1.1', '10.0.0', '10.0.0.0.1', '10.0.0.a']) {
      expect(pac(host), host).toBe(DIRECTO);
    }
  });

  it('con las listas vacias no enruta nada', () => {
    const pac = compilar({ dominios: [], redes: [] });
    for (const host of ['lg.com', '136.166.26.211', 'google.com']) {
      expect(pac(host), host).toBe(DIRECTO);
    }
  });

  it('usa el proxy que se le pase', () => {
    expect(compilar({ proxy: 'SOCKS5 127.0.0.1:9999' })('lg.com')).toBe('SOCKS5 127.0.0.1:9999');
    expect(compilar({ proxy: 'HTTPS vpn.otro.com:8443' })('lg.com')).toBe('HTTPS vpn.otro.com:8443');
  });

  it('normaliza los dominios que se escriban con punto o en mayusculas', () => {
    const pac = compilar({ dominios: ['.LG.com.', '  lge.com  '], redes: [] });
    expect(pac('shop.lg.com')).toBe(TUNEL);
    expect(pac('LGE.COM')).toBe(TUNEL);
  });

  it('ignora las redes mal escritas en vez de romper el PAC entero', () => {
    const pac = compilar({ dominios: ['lg.com'], redes: ['no-es-una-red', '10.0.0.0/8'] });
    expect(pac('10.1.1.1')).toBe(TUNEL);
    expect(pac('lg.com')).toBe(TUNEL);
    expect(pac('8.8.8.8')).toBe(DIRECTO);
  });

  it('una red /0 lo manda todo por el tunel', () => {
    // Borde real: en JavaScript -1 << 32 es -1 << 0, que no filtraria nada.
    const pac = compilar({ dominios: [], redes: ['0.0.0.0/0'] });
    expect(pac('8.8.8.8')).toBe(TUNEL);
    expect(pac('google.com')).toBe(DIRECTO);
  });
});
