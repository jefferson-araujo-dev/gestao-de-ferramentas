import { expect, test as base } from '@playwright/test';

import { classifyRequestUrl } from './env.mjs';
import { E2E_PASSWORD } from './seed-data.mjs';

// Problemas JÁ EXISTENTES e conhecidos, tolerados de forma explícita e específica (nunca genérica).
// Cada item exige justificativa. Qualquer erro fora desta lista falha o teste.
export const KNOWN_ISSUES = [];

function isKnown(message) {
  return KNOWN_ISSUES.find((issue) => issue.pattern.test(message));
}

// PNG 1x1 transparente (67 bytes), usado no lugar de imagens de terceiros.
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

function createGuardState() {
  return {
    hosts: new Set(),
    stubbedThirdParty: new Set(),
    blocked: [],
    apiCalls: [],
    unexpectedApi: [],
    dialogs: [],
    pageErrors: [],
    consoleErrors: [],
    requestFailures: [],
    badResponses: [],
    known: [],
  };
}

async function installGuards(page, state) {
  await page.context().route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const verdict = classifyRequestUrl(request.url());

    state.hosts.add(verdict.host || verdict.kind);

    if (!verdict.allowed) {
      state.blocked.push(`${request.method()} ${url.hostname}`);
      return route.abort('blockedbyclient');
    }

    if (verdict.kind === 'third-party-image-stubbed') {
      state.stubbedThirdParty.add(url.hostname);
      return route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG });
    }

    if (verdict.kind === 'fonts-stubbed') {
      // Fontes remotas substituídas por CSS vazio: renderização determinística, sem rede externa.
      return url.hostname === 'fonts.googleapis.com'
        ? route.fulfill({ status: 200, contentType: 'text/css', body: '/* fontes stub (e2e) */' })
        : route.abort('blockedbyclient');
    }

    if (verdict.kind === 'local' && url.pathname.startsWith('/api/')) {
      const call = `${request.method()} ${url.pathname}`;

      state.apiCalls.push(call);

      // Único endpoint de API tolerado: telemetria de último login (função Vercel, fora do escopo).
      if (request.method() === 'POST' && url.pathname === '/api/session/last-login') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      }

      state.unexpectedApi.push(call);
      return route.abort('blockedbyclient');
    }

    return route.continue();
  });

  page.on('dialog', async (dialog) => {
    // Nenhum confirm()/alert() deve aparecer nestes fluxos; se aparecer, cancela e registra.
    state.dialogs.push(`${dialog.type()}: ${dialog.message().slice(0, 80)}`);
    await dialog.dismiss();
  });
  page.on('pageerror', (error) => state.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      state.consoleErrors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? '';

    if (!reason.includes('ERR_ABORTED')) {
      state.requestFailures.push(`${reason} ${new URL(request.url()).pathname}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      state.badResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
}

export const test = base.extend({
  guard: [
    async ({ page }, use, testInfo) => {
      const state = createGuardState();

      await installGuards(page, state);
      await use(state);

      if (state.stubbedThirdParty.size > 0) {
        testInfo.annotations.push({
          type: 'stubbed-third-party',
          description: [...state.stubbedThirdParty].sort().join(', '),
        });
      }

      const groups = {
        'request bloqueado (host fora da allowlist)': state.blocked,
        'chamada de API inesperada': state.unexpectedApi,
        'dialogo nativo inesperado (confirm/alert)': state.dialogs,
        pageerror: state.pageErrors,
        'console.error': state.consoleErrors,
        'request falhou': state.requestFailures,
        'resposta HTTP >= 400': state.badResponses,
      };
      const unexpected = [];

      for (const [label, messages] of Object.entries(groups)) {
        for (const message of messages) {
          const known = isKnown(message);

          if (known) {
            testInfo.annotations.push({ type: 'known-baseline', description: known.reason });
          } else {
            unexpected.push(`${label}: ${message}`);
          }
        }
      }

      expect(unexpected, 'erros/requests inesperados durante o fluxo').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// ---------------------------------------------------------------------------
// Login / navegação / logout
// ---------------------------------------------------------------------------

export async function assertEmulatorConnected(page) {
  // Fail-closed: sem a flag do app, nunca tenta autenticar (evita tocar Firebase real).
  await expect
    .poll(() => page.evaluate(() => globalThis.__FIREBASE_EMULATOR_CONNECTED__ === true), {
      message: 'o app deve estar conectado ao Firebase Emulator antes do login',
    })
    .toBe(true);
}

export async function loginAs(page, user) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await assertEmulatorConnected(page);
  await expect(page.locator('#login-screen')).toBeVisible();
  await page.locator('#login-email').fill(user.email);
  await page.locator('#login-password').fill(E2E_PASSWORD);
  await page.locator('#btn-login').click();
  await expect(page.locator('#main-app')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(page.locator('#user-name')).toHaveText(/\S/);
}

// Contrato ATUAL de navegação (pré-router por hash). Centralizado para que o Gate 1-D
// ajuste apenas este mapa e as funções abaixo quando a navegação mudar de propósito.
export const TABS = {
  dashboard: {
    nav: '#nav-dashboard',
    label: 'Painel',
    title: 'Visão Geral',
    panel: '#tab-dashboard',
  },
  scanner: {
    nav: '#nav-scanner',
    label: 'Leitor / Scanner',
    title: 'Leitor / Scanner',
    panel: '#tab-scanner',
  },
  collaborators: {
    nav: '#nav-collaborators',
    label: 'Colaboradores',
    title: 'Colaboradores',
    panel: '#tab-collaborators',
  },
  management: {
    nav: { admin: '#nav-management', standard: '#nav-tools' },
    label: { admin: 'Inventário', standard: 'Ferramentas' },
    title: 'Ferramentas',
    panel: '#tab-management',
  },
  users: {
    nav: '#nav-users',
    label: 'Controle de Acesso',
    title: 'Controle de Acesso',
    panel: '#tab-users',
  },
  history: {
    nav: '#nav-history',
    label: 'Auditoria',
    title: 'Auditoria de Sistema',
    panel: '#tab-history',
  },
};

const pick = (value, isAdmin) =>
  typeof value === 'object' && value !== null && 'admin' in value
    ? value[isAdmin ? 'admin' : 'standard']
    : value;

export const navSelector = (tab, isAdmin = false) => pick(TABS[tab].nav, isAdmin);
export const navLabel = (tab, isAdmin = false) => pick(TABS[tab].label, isAdmin);

export async function openTab(page, tab, { isAdmin = false } = {}) {
  await page
    .locator('#main-sidebar')
    .getByRole('button', { name: navLabel(tab, isAdmin), exact: true })
    .click();
}

// Item ativo hoje = classe de destaque no botão de navegação. O redesign deve trocar esta
// única função por aria-current="page" quando mudar de propósito.
export async function expectActiveTab(page, tab, { isAdmin = false, initialLoad = false } = {}) {
  await expect(page.locator('#topbar-title')).toHaveText(TABS[tab].title);
  await expect(page.locator(TABS[tab].panel)).toBeVisible();

  for (const [other, definition] of Object.entries(TABS)) {
    if (other !== tab) {
      await expect(page.locator(definition.panel)).toBeHidden();
    }
  }

  if (initialLoad) {
    // Baseline atual: logo após o login nenhum item de navegação está destacado.
    await expect(page.locator('.nav-btn.bg-brand-600')).toHaveCount(0);
    return;
  }

  await expect(page.locator(navSelector(tab, isAdmin))).toHaveClass(/(^|\s)bg-brand-600(\s|$)/);
  await expect(page.locator('.nav-btn.bg-brand-600')).toHaveCount(1);
}

export async function openUserMenu(page) {
  await page.getByTestId('user-menu-trigger').click();
  await expect(page.locator('#user-dropdown-menu')).toBeVisible();
}

export async function logoutViaSidebar(page) {
  await page.locator('#btn-logout-sidebar').click();

  const dialog = page.locator('#logout-modal');

  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.locator('#login-screen')).toBeVisible();
  await expect(page.locator('#main-app')).toBeHidden();
}

// KPIs do dashboard exibem "N (P%)": compara apenas o número inicial.
export const expectKpi = (page, id, value) =>
  expect(page.locator(`#${id}`)).toHaveText(new RegExp(`^${value}\\b`));

// Lê permissões efetivas da aplicação (contrato de estado, não apenas visibilidade).
export function readPermissions(page) {
  return page.evaluate(() => ({ ...window.App.Auth.permissions, isAdm: window.App.Auth.isAdm }));
}
