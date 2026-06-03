import { render as renderColocarTags } from '../features/colocar-tags/popup/view.js';
import { render as renderLeadTimes }   from '../features/lead-times/popup/view.js';
import { render as renderCupones }     from '../features/cupones/popup/view.js';
import { render as renderLgcom }       from '../features/lgcom/popup/view.js';
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
    id: 'lgcom',
    name: 'LG.com',
    description: 'Información y utilidades sobre www.lg.com',
    abbr: 'LG',
    keywords: ['lg', 'lg.com', 'producto', 'pdp', 'graphql', 'precio', 'info', 'web'],
    render: renderLgcom,
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
