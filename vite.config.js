import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildManifest(browser) {
  const base = JSON.parse(readFileSync(resolve(__dirname, 'manifests/manifest.base.json'), 'utf8'));
  const override = JSON.parse(readFileSync(resolve(__dirname, `manifests/manifest.${browser}.json`), 'utf8'));
  delete override['$extends'];
  return { ...base, ...override };
}

/**
 * Añade `match_origin_as_fallback` al content script global del manifest ya
 * emitido.
 *
 * Esa clave es la que hace que Chrome inyecte los content scripts en frames
 * `about:blank` / `about:srcdoc` / `data:` — sin ella, `<all_urls>` no casa con
 * esos esquemas por mucho que se declare `all_frames: true`. Hace falta porque
 * SellerCenter monta su módulo de devoluciones dentro de iframes sin `src`: sin
 * esto, el único frame con nuestro código es el de arriba, que no tiene el
 * formulario, y la automatización se queda mirando una pantalla vacía.
 *
 * Va aquí y no en `manifests/manifest.base.json` porque el esquema con el que
 * vite-plugin-web-extension valida el manifest todavía no conoce la clave
 * (válida en Chrome/Edge 119+) y aborta el build. Inyectándola después, la
 * validación sigue cubriendo todo lo demás.
 */
function matchOriginAsFallback(browser) {
  return {
    name: 'ext-lge-cl:match-origin-as-fallback',
    apply: 'build',

    // closeBundle corre cuando los archivos ya están escritos en disco.
    closeBundle() {
      const ruta = resolve(__dirname, `dist/${browser}/manifest.json`);
      if (!existsSync(ruta)) return;

      const manifest = JSON.parse(readFileSync(ruta, 'utf8'));

      // El content script global (el que corre en todos los frames), no el de
      // lg.com, que es de un solo host y del mundo MAIN.
      const global = (manifest.content_scripts ?? []).find((cs) => cs.all_frames === true);

      if (!global) {
        this.warn('No se encontró el content script global: no se aplicó match_origin_as_fallback.');
        return;
      }

      global.match_origin_as_fallback = true;
      writeFileSync(ruta, `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const browser = ['chrome', 'edge'].includes(mode) ? mode : 'chrome';

  return {
    plugins: [
      webExtension({
        manifest: () => buildManifest(browser),
        watchFilePaths: [
          resolve(__dirname, 'manifests/manifest.base.json'),
          resolve(__dirname, `manifests/manifest.${browser}.json`),
        ],
      }),
      matchOriginAsFallback(browser),
    ],
    publicDir: 'assets',
    build: {
      outDir: `dist/${browser}`,
      emptyOutDir: true,
    },
  };
});
