import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { htmlPartials } from './vite/plugins/html-partials.js';

const { version: appVersion } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
);

export default defineConfig({
  define: {
    // Gate 1-F4.C4, Decisão 7: versão do app enviada em requisições instrumentadas, só para
    // registro no servidor (nenhum bloqueio nesta etapa).
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  plugins: [
    htmlPartials(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: '.', // Lê do diretório root atual ("src")
      filename: 'sw.js',
      injectRegister: false, // Mantém seu registro customizado no app.js
      manifest: false, // Usa seu manifest.json existente
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      },
      devOptions: {
        enabled: false, // Mantenha false no dia a dia para o cache não atrapalhar
        type: 'module',
      },
    }),
  ],
  root: realpathSync.native(fileURLToPath(new URL('./src', import.meta.url))),
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: true,
  },
});
