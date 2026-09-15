// Deteccion de pantalla. A diferencia del resto del apartado, este modulo NO
// navega ni lee el DOM del grid: le alcanza con estar en cualquier pagina del
// admin, porque consulta el endpoint por fetch desde el mismo origen (asi la
// cookie de sesion viaja sola).

import { ADMIN_BASE_RE, ORDERS_LISTING_PATH } from '../constants.js';

/** True si la pestana esta dentro del admin de Magento. */
export function isAdminPage(url = location.href) {
  return ADMIN_BASE_RE.test(String(url || ''));
}

/** Base del admin derivada de la URL actual ('' si no parece admin). */
export function adminBaseFrom(url = location.href) {
  const match = ADMIN_BASE_RE.exec(String(url || ''));
  return match ? match[1] : '';
}

/** True si ademas estamos en el listado de ordenes (ahi la key esta en el HTML). */
export function isOrdersListing(url = location.href) {
  return /\/sales\/order\/(?:index|grid)?(?:[/?#]|$)/i.test(String(url || ''));
}

export function diagnose() {
  return {
    url: location.href,
    isAdmin: isAdminPage(),
    adminBase: adminBaseFrom(),
    isOrdersListing: isOrdersListing(),
    listingPath: ORDERS_LISTING_PATH,
    isTopFrame: window === window.top,
    title: document.title,
  };
}
