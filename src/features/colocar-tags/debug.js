// Comandos de debug específicos de "colocar-tags".
// Se auto-registra al ser importado desde el content script.
import { register, cmd } from '../../shared/debug/index.js';
import { SELECTORS } from './constants.js';
import { diagnose } from './content/detector.js';
import { parsePage } from './content/parser.js';

register('colocarTags', {
  diagnose: cmd(
    () => diagnose(),
    'Diagnóstico de detección de la pantalla MIM en este frame',
  ),
  parse: cmd(
    () => parsePage(),
    'Corre el parser y devuelve { searchForm, grid }',
  ),
  selectors: cmd(
    () => ({ ...SELECTORS }),
    'Mapa de selectores que usa la feature',
  ),
  check: cmd(
    () =>
      Object.fromEntries(
        Object.entries(SELECTORS).map(([k, sel]) => [k, Boolean(document.querySelector(sel))]),
      ),
    'true/false por cada selector contra el DOM actual',
  ),
  find: cmd(
    (key) => document.querySelector(SELECTORS[key]),
    'find("searchForm") → elemento DOM o null',
  ),
  iframes: cmd(
    () =>
      Array.from(document.querySelectorAll('iframe')).map((f) => ({
        id: f.id || null,
        name: f.name || null,
        src: f.getAttribute('src') || '(sin src)',
      })),
    'Lista de iframes del frame actual',
  ),
  frameInfo: cmd(
    () => ({
      url: location.href,
      title: document.title,
      isTopFrame: window === window.top,
    }),
    'Info del frame donde corre este content script',
  ),
});
