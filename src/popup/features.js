import { render as renderColocarTags } from '../features/colocar-tags/popup/view.js';

export const features = [
  {
    id: 'colocar-tags',
    name: 'Colocar TAGs',
    description: 'Gestión y colocación de etiquetas en GP1',
    abbr: 'TAG',
    keywords: ['tag', 'etiqueta', 'colocar', 'gp1', 'marketing'],
    render: renderColocarTags,
  },
];
