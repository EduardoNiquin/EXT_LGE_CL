import { readFileSync } from 'fs';
import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';

function buildManifest(browser) {
  const base = JSON.parse(readFileSync('./manifests/manifest.base.json', 'utf8'));
  const override = JSON.parse(readFileSync(`./manifests/manifest.${browser}.json`, 'utf8'));
  delete override['$extends'];
  return { ...base, ...override };
}

export default defineConfig(({ mode }) => {
  const browser = ['chrome', 'edge'].includes(mode) ? mode : 'chrome';

  return {
    plugins: [
      webExtension({
        manifest: () => buildManifest(browser),
        watchFilePaths: ['manifests/*.json'],
      }),
    ],
    build: {
      outDir: `dist/${browser}`,
      emptyOutDir: true,
    },
  };
});
