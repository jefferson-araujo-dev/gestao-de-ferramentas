import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { htmlPartials } from './vite/plugins/html-partials.js';

export default defineConfig({
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
