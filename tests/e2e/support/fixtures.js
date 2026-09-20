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
    allowed: [],
    // Falha SIMULADA de propósito por um teste (ex.: API de backup respondendo 500): declarada por teste,
    // com justificativa, e válida só para ele. Qualquer outro erro continua falhando o teste.
    allow(pattern, reason) {
      this.allowed.push({ pattern, reason });
    },
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
          const known = isKnown(message) ?? state.allowed.find((item) => item.pattern.test(message));

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

// `hash` (ex.: '#/auditoria') abre o app já com um deep link: a rota só é aplicada após o login.
export async function loginAs(page, user, { hash = '' } = {}) {
  await page.goto(`/${hash}`, { waitUntil: 'domcontentloaded' });
  await assertEmulatorConnected(page);
  await expect(page.locator('#login-screen')).toBeVisible();
  await page.locator('#login-email').fill(user.email);
  await page.locator('#login-password').fill(E2E_PASSWORD);
  await page.locator('#btn-login').click();
  await expect(page.locator('#main-app')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(page.locator('#user-name')).toHaveText(/\S/);
}

// Contrato de navegação do app shell (Gate 1-D): rotas por hash, itens gerados por App.Shell a
// partir de src/js/config/navigation.js e item ativo marcado com aria-current="page".
// Centralizado aqui para não espalhar seletores pelos testes.
export const APP_TITLE = 'Gestão de Ferramentas';

export const TABS = {
  dashboard: {
    id: 'dashboard',
    route: 'painel',
    nav: '#nav-dashboard',
    label: 'Painel',
    title: 'Painel',
    panel: '#tab-dashboard',
  },
  scanner: {
    id: 'scanner',
    route: 'scanner',
    nav: '#nav-scanner',
    label: 'Retirar/Devolver',
    title: 'Retirar/Devolver',
    panel: '#tab-scanner',
  },
  collaborators: {
    id: 'collaborators',
    route: 'colaboradores',
    nav: '#nav-collaborators',
    label: 'Colaboradores',
    title: 'Colaboradores',
    panel: '#tab-collaborators',
  },
  management: {
    id: 'tools',
    route: 'ferramentas',
    nav: '#nav-tools',
    label: 'Ferramentas',
    title: 'Ferramentas',
    panel: '#tab-management',
  },
  users: {
    id: 'users',
    route: 'usuarios',
    nav: '#nav-users',
    label: 'Usuários e acessos',
    title: 'Usuários e acessos',
    panel: '#tab-users',
  },
  history: {
    id: 'history',
    route: 'auditoria',
    nav: '#nav-history',
    label: 'Auditoria',
    title: 'Auditoria',
    panel: '#tab-history',
  },
  data: {
    id: 'data',
    route: 'dados',
    nav: '#nav-data',
    label: 'Dados e backup',
    title: 'Dados e backup',
    panel: '#tab-data',
  },
};

// O segundo argumento (isAdmin) é aceito só por compatibilidade com os testes existentes: o item
// "Ferramentas" é o mesmo para todos os perfis (não existe mais "Inventário" separado).
export const navSelector = (tab) => TABS[tab].nav;
export const navLabel = (tab) => TABS[tab].label;

// Abre uma tela pela navegação visível no viewport atual: sidebar/rail (tablet+) ou barra inferior;
// no mobile, destinos que não couberam na barra inferior ficam em "Mais".
export async function openTab(page, tab) {
  const { id } = TABS[tab];
  const visible = page.locator(`[data-nav-id="${id}"]:visible`).first();

  if ((await visible.count()) > 0) {
    await visible.click();
    return;
  }

  await page.locator('#bnav-more').click();
  await expect(page.locator('#more-sheet')).toBeVisible();
  await page.locator(`#more-nav [data-nav-id="${id}"]`).click();
  await expect(page.locator('#more-sheet')).toBeHidden();
}

// Tela ativa = painel visível + título + URL (#/rota) + document.title + aria-current no item.
export async function expectActiveTab(page, tab) {
  const { id, route, title, panel } = TABS[tab];

  await expect(page.locator('#topbar-title')).toHaveText(title);
  await expect(page.locator(panel)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/${route}$`));
  await expect(page).toHaveTitle(`${title} · ${APP_TITLE}`);

  for (const [other, definition] of Object.entries(TABS)) {
    if (other !== tab) {
      await expect(page.locator(definition.panel)).toBeHidden();
    }
  }

  // Todo item com aria-current="page" (sidebar, barra inferior, "Mais") é o da tela ativa.
  await expect
    .poll(() =>
      page
        .locator('[aria-current="page"]')
        .evaluateAll((nodes) => [...new Set(nodes.map((node) => node.dataset.navId))])
    )
    .toEqual([id]);
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
