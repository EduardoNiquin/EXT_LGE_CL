import { readFileSync } from 'fs';
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
    ],
    publicDir: 'assets',
    build: {
      outDir: `dist/${browser}`,
      emptyOutDir: true,
    },
  };
});
