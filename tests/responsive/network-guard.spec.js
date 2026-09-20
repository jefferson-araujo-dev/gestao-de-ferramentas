import { expect, test as baseTest } from '@playwright/test';

import {
  createNetworkGuardState,
  installNetworkGuard,
  test as guardedTest,
} from './support/network-guard.js';

// Prova de PODER DE DETECÇÃO do guard de rede da suíte responsiva (Addendum 1-C1).
// Nenhuma requisição real é feita: as URLs remotas abaixo são simuladas e abortadas no navegador
// pelo próprio guard (route.abort), antes de qualquer conexão de rede.
const SIMULATED_REMOTE = [
  [
    'https://firestore.googleapis.com/v1/projects/simulado/databases/(default)/documents/x',
    'Firestore remoto',
  ],
  [
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=SIMULADA',
    'Firebase Auth remoto',
  ],
  ['https://securetoken.googleapis.com/v1/token?key=SIMULADA', 'Firebase Auth remoto'],
  ['https://us-central1-simulado.cloudfunctions.net/fn', 'Firebase Functions real'],
  ['https://simulado.vercel.app/api/session/last-login', 'Vercel real'],
  ['https://host-desconhecido.example/x', 'host fora da allowlist'],
];

baseTest.describe('guard de rede: bloqueia e registra tentativas remotas simuladas', () => {
  baseTest(
    'fetch remoto é abortado no navegador e registrado, sem sair da máquina',
    async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL });
      const state = await installNetworkGuard(context);
      const page = await context.newPage();

      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const outcomes = await page.evaluate(
        (urls) =>
          Promise.all(
            urls.map((url) =>
              fetch(url, { mode: 'no-cors' }).then(
                () => 'ENVIADO',
                () => 'ABORTADO'
              )
            )
          ),
        SIMULATED_REMOTE.map(([url]) => url)
      );

      expect(outcomes).toEqual(SIMULATED_REMOTE.map(() => 'ABORTADO'));

      for (const [, label] of SIMULATED_REMOTE) {
        expect(state.violations.some((entry) => entry.includes(`[${label}]`))).toBe(true);
      }

      // A query (que poderia carregar chave de API) nunca é registrada.
      expect(state.violations.join('\n')).not.toContain('SIMULADA');
      await context.close();
    }
  );

  baseTest(
    'chamada local /api/* também é bloqueada (não existe função Vercel na suíte)',
    async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL });
      const state = await installNetworkGuard(context);
      const page = await context.newPage();

      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const outcome = await page.evaluate(() =>
        fetch('/api/session/last-login', { method: 'POST' }).then(
          () => 'ENVIADO',
          () => 'ABORTADO'
        )
      );

      expect(outcome).toBe('ABORTADO');
      expect(state.violations).toEqual([
        expect.stringContaining('/api/session/last-login [API do projeto (/api/*)]'),
      ]);
      await context.close();
    }
  );

  baseTest(
    'WebSocket remoto é fechado e registrado; WebSocket local não é violação',
    async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL });
      const state = await installNetworkGuard(context);
      const page = await context.newPage();

      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const closed = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const socket = new WebSocket('wss://firestore.googleapis.com/simulado');

            socket.onclose = () => resolve('FECHADO');
            socket.onerror = () => resolve('FECHADO');
            setTimeout(() => resolve('TIMEOUT'), 5000);
          })
      );

      expect(closed).toBe('FECHADO');
      expect(state.violations).toEqual([
        expect.stringContaining('WEBSOCKET firestore.googleapis.com'),
      ]);
      await context.close();
    }
  );

  baseTest(
    'tráfego permitido (app local, CDN estática) não gera violação',
    async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL });
      const state = createNetworkGuardState();

      await installNetworkGuard(context, state);

      const page = await context.newPage();

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.locator('#login-screen').waitFor({ state: 'visible' });
      expect(state.violations).toEqual([]);
      expect(Object.keys(state.byHostKind).length).toBeGreaterThan(0);
      await context.close();
    }
  );
});

guardedTest.describe('fixture oficial: uma tentativa remota reprova o teste', () => {
  // test.fail(): este teste só PASSA se o fixture reprovar por causa da tentativa remota simulada.
  // Se o guard deixasse de detectar, o Playwright reportaria "expected to fail but passed".
  guardedTest(
    'tentativa a Firestore remoto simulada reprova o teste (falha esperada)',
    async ({ page }) => {
      guardedTest.fail();

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() =>
        fetch(
          'https://firestore.googleapis.com/v1/projects/simulado/databases/(default)/documents/x',
          {
            mode: 'no-cors',
          }
        ).catch(() => 'ABORTADO')
      );
    }
  );
});
