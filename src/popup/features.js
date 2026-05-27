import { render as renderColocarTags } from '../features/colocar-tags/popup/view.js';
import { render as renderLeadTimes }   from '../features/lead-times/popup/view.js';
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
    id: 'ajustes',
    name: 'Ajustes',
    description: 'Configuración de logs y opciones de la extensión',
    abbr: 'CFG',
    keywords: ['ajustes', 'config', 'settings', 'logs', 'debug', 'scope', 'opciones'],
    render: renderAjustes,
  },
];
