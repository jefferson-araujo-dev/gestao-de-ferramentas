import { appendFileSync } from 'node:fs';

import { expect, test as base } from '@playwright/test';

import {
  assertResponsiveLocalEnvironment,
  classifyResponsiveRequest,
  describeViolation,
} from './network-policy.mjs';

// Guard de rede FAIL-CLOSED da suíte responsiva (Addendum 1-C1). Toda requisição do navegador
// passa pela política de network-policy.mjs (mesma allowlist do E2E autenticado). Bloqueadas:
// Firestore/Auth/Functions/Vercel reais, qualquer host fora da allowlist e /api/* local.
// Os bloqueios são abortados NO NAVEGADOR (nada sai da máquina) e reprovam o teste.
//
// Evidência opcional: RESPONSIVE_NETWORK_EVIDENCE_FILE=<arquivo> acrescenta uma linha JSON por teste
// com a contagem de requisições por host/tipo (sem query string).

export function createNetworkGuardState() {
  return { byHostKind: {}, violations: [] };
}

function record(state, verdict) {
  const key = `${verdict.host || verdict.kind}|${verdict.kind}`;

  state.byHostKind[key] = (state.byHostKind[key] ?? 0) + 1;
}

// Instala o guard num BrowserContext. Retorna o estado para inspeção/asserção.
export async function installNetworkGuard(context, state = createNetworkGuardState()) {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const verdict = classifyResponsiveRequest(request.url());

    record(state, verdict);

    if (verdict.action === 'block') {
      state.violations.push(describeViolation(request.method(), request.url(), verdict));
      return route.abort('blockedbyclient');
    }

    return route.continue();
  });

  // WebSocket não passa por context.route: o HMR do Vite (local) segue, qualquer outro host é fechado.
  await context.routeWebSocket(/.*/, (ws) => {
    const verdict = classifyResponsiveRequest(ws.url());

    record(state, verdict);

    if (verdict.action === 'block') {
      state.violations.push(describeViolation('WEBSOCKET', ws.url(), verdict));
      return ws.close({ code: 1008, reason: 'blocked by responsive network guard' });
    }

    return ws.connectToServer();
  });

  return state;
}

export const test = base.extend({
  networkGuard: [
    async ({ context }, use, testInfo) => {
      const { remotePreview } = assertResponsiveLocalEnvironment();

      if (remotePreview) {
        // Opt-in explícito (RESPONSIVE_ALLOW_REMOTE_PREVIEW=1), fora do gate oficial.
        testInfo.annotations.push({
          type: 'network-guard',
          description: 'DESLIGADO: modo Vercel Preview remoto por opt-in explícito',
        });
        await use(null);
        return;
      }

      const state = await installNetworkGuard(context);

      await use(state);

      const evidenceFile = process.env.RESPONSIVE_NETWORK_EVIDENCE_FILE;

      if (evidenceFile) {
        appendFileSync(
          evidenceFile,
          `${JSON.stringify({
            project: testInfo.project.name,
            test: testInfo.title,
            byHostKind: state.byHostKind,
            violations: state.violations,
          })}\n`,
          'utf8'
        );
      }

      expect(
        state.violations,
        'a suíte responsiva tentou contatar serviço fora da allowlist (bloqueado no navegador)'
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
