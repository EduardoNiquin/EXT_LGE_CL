import { render as renderColocarTags } from '../features/colocar-tags/popup/view.js';
import { render as renderLeadTimes }   from '../features/lead-times/popup/view.js';
import { render as renderCupones }     from '../features/cupones/popup/view.js';
import { render as renderOrdenInfo }   from '../features/orden-info/popup/view.js';
import { render as renderStarkoms }    from '../features/starkoms/popup/view.js';
import { render as renderLgcom }       from '../features/lgcom/popup/view.js';
import { render as renderSellerCenterFalabella } from '../features/seller-center-falabella/popup/view.js';
import { render as renderEpromoters }   from '../features/e-promoters/popup/view.js';
import { render as renderPim }          from '../features/pim/popup/view.js';
import { render as renderGato }        from '../features/gato/popup/view.js';
import { render as renderAjustes }     from '../features/ajustes/popup/view.js';

export const features = [
  {
    id: 'colocar-tags',
    name: 'Colocar TAGs',
    description: 'Gestión y colocación de etiquetas en GP1',
    abbr: 'TAG',
    keywords: ['tag', 'etiqueta', 'colocar', 'gp1', 'marketing'],
    render: renderColocarTags,
  },
  {
    id: 'lead-times',
    name: 'Lead Times',
    description: 'Modificar lead times de comunas por región en Magento',
    abbr: 'LT',
    keywords: ['lead', 'time', 'magento', 'comuna', 'región', 'region', 'delivery', 'despacho'],
    render: renderLeadTimes,
  },
  {
    id: 'cupones',
    name: 'Cupones',
    description: 'Automatización sobre Cart Price Rules en Magento',
    abbr: 'CUP',
    keywords: ['cupon', 'cupón', 'coupon', 'cart', 'price', 'rule', 'regla', 'magento', 'promo'],
    render: renderCupones,
  },
  {
    id: 'orden-info',
    name: 'Información de Orden',
    description: 'Detalle de una orden de Magento con el motivo de pagos rechazados',
    abbr: 'ORD',
    keywords: ['orden', 'order', 'magento', 'pago', 'pedido', 'transbank', 'webpay', 'mercadopago', 'rechazo', 'transaccion', 'transacción'],
    render: renderOrdenInfo,
  },
  {
    id: 'starkoms',
    name: 'Starkoms',
    description: 'Verificar órdenes y stock (On Hold / Fuera de Stock)',
    abbr: 'STK',
    keywords: ['starkoms', 'orden', 'ordenes', 'stock', 'despacho', 'logistica', 'logística', 'on hold', 'fuera de stock', 'inventario'],
    render: renderStarkoms,
  },
  {
    id: 'lgcom',
    name: 'LG.com',
    description: 'Información y utilidades sobre www.lg.com',
    abbr: 'LG',
    keywords: ['lg', 'lg.com', 'producto', 'pdp', 'graphql', 'precio', 'info', 'web', 'destacados', 'spotlight', 'tag', 'stock', 'categoria', 'categoría'],
    render: renderLgcom,
  },
  {
    id: 'seller-center-falabella',
    name: 'SellerCenter Falabella',
    description: 'SoporteSeller: cargar "Detalle Orden" desde un CSV',
    abbr: 'SCF',
    keywords: ['seller', 'sellercenter', 'falabella', 'fallabella', 'soporte', 'soporteseller', 'detalle', 'orden', 'guia', 'guía', 'paquetes', 'csv'],
    render: renderSellerCenterFalabella,
  },
  {
    id: 'e-promoters',
    name: 'E-promoters',
    description: 'Informe de ordenes a recuperar (CSV para e-promoters)',
    abbr: 'EPR',
    keywords: ['epromoter', 'e-promoter', 'promoter', 'informe', 'orden', 'ordenes', 'recuperar', 'csv', 'api', 'magento', 'cupon', 'reporte'],
    render: renderEpromoters,
  },
  {
    id: 'pim',
    name: 'PIM',
    description: 'Verificar si un producto existe en PIM (Creación de producto)',
    abbr: 'PIM',
    keywords: ['pim', 'producto', 'sku', 'creacion', 'creación', 'existe', 'existencia', 'staging', 'stg', 'model', 'gp1'],
    render: renderPim,
  },
  {
    id: 'gato',
    name: 'GATO',
    description: 'Tic-tac-toe multijugador (¡secreto desbloqueado!)',
    abbr: '🐱',
    keywords: ['gato', 'tic', 'tac', 'toe', 'tictactoe', 'tres en raya', 'juego', 'multijugador'],
    secret: true,
    render: renderGato,
  },
  {
    id: 'ajustes',
    name: 'Ajustes',
    description: 'Configuración de logs y opciones de la extensión',
    abbr: 'CFG',
    keywords: ['ajustes', 'config', 'settings', 'logs', 'debug', 'scope', 'opciones'],
    render: renderAjustes,
  },
];
