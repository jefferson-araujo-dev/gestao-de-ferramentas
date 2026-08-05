import { defineConfig } from '@playwright/test';
import { RESPONSIVE_VIEWPORTS } from './tests/responsive/viewports.js';

const externalBaseUrl = String(
  process.env.PLAYWRIGHT_BASE_URL || ''
).trim();

const baseURL = externalBaseUrl || 'http://127.0.0.1:3000';
const isCI = Boolean(process.env.CI);

const responsiveProjects = RESPONSIVE_VIEWPORTS.map(
  ({ name, width, height, category, tier }) => ({
    name,
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

  projects: responsiveProjects,

  webServer: externalBaseUrl
    ? undefined
    : {
        command:
          'npm.cmd run dev -- --host 127.0.0.1 --port 3000',
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe'
      }
});
