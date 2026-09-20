import { defineConfig } from '@playwright/test';
import { assertResponsiveLocalEnvironment } from './tests/responsive/support/network-policy.mjs';
import { RESPONSIVE_VIEWPORTS } from './tests/responsive/viewports.js';

// Fail-closed: recusa credenciais reais e PLAYWRIGHT_BASE_URL remoto (salvo opt-in explícito).
assertResponsiveLocalEnvironment();

const externalBaseUrl = String(
  process.env.PLAYWRIGHT_BASE_URL || ''
).trim();

const managedPort = 3100;
const baseURL =
  externalBaseUrl || `http://127.0.0.1:${managedPort}`;
const isCI = Boolean(process.env.CI);

const responsiveProjects = RESPONSIVE_VIEWPORTS.map(
  ({ name, width, height, category, tier }) => ({
    name,
    testIgnore: /network-guard\.spec\.js$/,
    metadata: {
      category,
      tier,
      width,
      height
    },
    use: {
      viewport: {
        width,
        height
      },
      screen: {
        width,
        height
      },
      hasTouch: category !== 'desktop'
    }
  })
);

export default defineConfig({
  testDir: './tests/responsive',
  testMatch: '**/*.spec.js',
  outputDir: 'test-results',

  timeout: 30_000,

  expect: {
    timeout: 5_000
  },

  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : 4,

  reporter: [
    ['line'],
    [
      'html',
      {
        outputFolder: 'playwright-report',
        open: 'never'
      }
    ]
  ],

  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
    serviceWorkers: 'block',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },

  projects: [
    ...responsiveProjects,
    // Prova de poder de detecção do guard de rede (roda uma única vez, fora dos viewports).
    {
      name: 'network-guard',
      testMatch: /network-guard\.spec\.js$/
    }
  ],

  webServer: externalBaseUrl
    ? undefined
    : {
        command: `npm.cmd run dev -- --host 127.0.0.1 --port ${managedPort} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe'
      }
});
