import { defineConfig } from '@playwright/test';

import { assertEmulatorOnlyEnvironment } from './tests/e2e/support/env.mjs';

// E2E autenticado: roda SOMENTE dentro do Firebase Emulator (npm run test:e2e:auth).
// Recusa iniciar sem os hosts locais do emulator, com service account ou com URL externa.
assertEmulatorOnlyEnvironment();

const port = 3200;
const baseURL = `http://127.0.0.1:${port}`;
const chromiumArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  outputDir: 'test-results-e2e',
  globalSetup: './tests/e2e/support/global-setup.mjs',

  timeout: 60_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.02 },
  },

  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,

  reporter: [['line']],

  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
    // O caminho do service worker/PWA NÃO é exercitado neste gate (bloqueado de propósito).
    serviceWorkers: 'block',
    permissions: ['camera'],
    launchOptions: { args: chromiumArgs },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'desktop',
      testIgnore: /\.(mobile|destructive)\.spec\.js$/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: /\.mobile\.spec\.js$/,
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    {
      // Fluxos que apagam dados semeados do emulator (limpar histórico): rodam por último e re-semeiam.
      name: 'destructive',
      testMatch: /data-backup\.destructive\.spec\.js$/,
      dependencies: ['desktop', 'mobile'],
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      // Troca de status de ferramenta (escrita real no emulator). Depois de "destructive": os dois
      // re-semeiam o emulator ao final e não podem rodar em paralelo (um apagaria a mudança do outro).
      name: 'destructive-tools',
      testMatch: /tools\.destructive\.spec\.js$/,
      dependencies: ['destructive'],
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      // Criação/edição real de colaborador (Addendum 1-F3.1). Por último: cria documentos além do
      // seed, apaga o que criou e re-semeia ao final; não pode rodar em paralelo com os outros.
      name: 'destructive-collaborators',
      testMatch: /collaborators\.destructive\.spec\.js$/,
      dependencies: ['destructive-tools'],
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: {
    command: `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort --no-open`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // Ativa a conexão opt-in do app com o emulator (src/js/app.js).
    env: { VITE_USE_FIREBASE_EMULATOR: 'true' },
  },
});
