// Apartado "Devoluciones": un feature por encima de las plataformas.
//
// Cada devolucion se gestiona contra la plataforma del seller donde nacio la
// venta. Hoy la unica implementada es Falabella (subida de comprimidos +
// guardado de resultados + gestion automatica); Walmart y Paris se sumaran como
// subcarpetas hermanas de ./falabella/ y una entrada mas en PLATFORMS.

export const DEVOLUCIONES_FEATURE = 'devoluciones';

// Registro de plataformas para el router del popup. `enabled: false` se pinta
// como "proximamente" (la pestana existe para que se vea a donde va esto).
export const PLATFORMS = [
  { id: 'falabella', label: 'Falabella', enabled: true },
  { id: 'walmart', label: 'Walmart', enabled: false },
  { id: 'paris', label: 'Paris', enabled: false },
];
