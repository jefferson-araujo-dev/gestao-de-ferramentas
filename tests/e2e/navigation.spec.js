import {
  APP_TITLE,
  TABS,
  expect,
  expectActiveTab,
  loginAs,
  openTab,
  openUserMenu,
  test,
} from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// NAVEGAÇÃO E ROTEAMENTO POR HASH (Gate 1-D). Substitui o antigo baseline "pré-router":
// a URL representa a tela (#/painel, #/scanner, #/ferramentas, #/colaboradores, #/auditoria,
// #/usuarios), reload/back/forward funcionam, rota desconhecida cai no Painel e rota conhecida mas
// não autorizada é recusada (Painel + aviso) SEM carregar dados proibidos.
const gotoHash = (page, hash) => page.evaluate((value) => (window.location.hash = value), hash);

const historyLength = (page) => page.evaluate(() => window.history.length);

test.describe('ADMIN — rotas, histórico e título', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  test('login abre o Painel em #/painel, com aria-current e document.title', async ({ page }) => {
    await expectActiveTab(page, 'dashboard');
    await expect(page).toHaveURL(/#\/painel$/);
  });

  test('as 6 telas: URL, título da topbar, document.title e item ativo acompanham a rota', async ({
    page,
  }) => {
    for (const tab of ['scanner', 'collaborators', 'management', 'history', 'users', 'dashboard']) {
      await openTab(page, tab);
      await expectActiveTab(page, tab);
    }

    expect(await page.title()).toBe(`Painel · ${APP_TITLE}`);
  });

  test('há um único item ativo por navegação (sidebar) e ele é um link com nome acessível', async ({
    page,
  }) => {
    await openTab(page, 'management');

    const current = page.locator('#main-sidebar [aria-current="page"]');

    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute('href', '#/ferramentas');
    await expect(page.getByRole('link', { name: 'Ferramentas', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  test('reload preserva a tela autorizada', async ({ page }) => {
    await openTab(page, 'management');
    await expectActiveTab(page, 'management');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#main-app')).toBeVisible({ timeout: 20_000 });
    await expectActiveTab(page, 'management');
  });

  test('back/forward do navegador percorrem as telas visitadas', async ({ page }) => {
    await openTab(page, 'scanner');
    await openTab(page, 'management');
    await openTab(page, 'history');
    await expectActiveTab(page, 'history');

    await page.goBack();
    await expectActiveTab(page, 'management');
    await page.goBack();
    await expectActiveTab(page, 'scanner');
    await page.goForward();
    await expectActiveTab(page, 'management');
  });

  test('navegação programática (switchTab) escreve a rota e entra no histórico', async ({
    page,
  }) => {
    await page.evaluate(() => window.App.UI.switchTab('scanner'));
    await expectActiveTab(page, 'scanner');

    await page.evaluate(() => window.App.UI.switchTab('management'));
    await expectActiveTab(page, 'management');

    await page.goBack();
    await expectActiveTab(page, 'scanner');
  });

  test('rota desconhecida cai no Painel sem criar armadilha de histórico', async ({ page }) => {
    await openTab(page, 'scanner');

    const before = await historyLength(page);

    await gotoHash(page, '#/nao-existe');
    await expectActiveTab(page, 'dashboard');
    await expect(page).toHaveURL(/#\/painel$/);
    // A entrada da rota inválida foi SUBSTITUÍDA (replace): voltar leva ao Scanner, não a um loop.
    expect(await historyLength(page)).toBe(before + 1);
    await page.goBack();
    await expectActiveTab(page, 'scanner');
  });

  test('hash vazio, sem barra ou malformado também caem no Painel', async ({ page }) => {
    await openTab(page, 'scanner');

    for (const hash of ['#/', '#scanner', '#/%E0%A4%A']) {
      await gotoHash(page, hash);
      await expectActiveTab(page, 'dashboard');
      await openTab(page, 'scanner');
      await expectActiveTab(page, 'scanner');
    }
  });

  test('a IA aprovada: grupos e itens da sidebar; sem "Dados e backup" (não implementado)', async ({
    page,
  }) => {
    const sidebar = page.locator('#main-sidebar');

    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
    await expect(sidebar.locator('.shell-nav-group-label')).toHaveText([
      'Visão geral',
      'Operação',
      'Pessoas',
      'Controle',
      'Administração',
    ]);
    await expect(sidebar.locator('[data-nav-id]')).toHaveText([
      'Painel',
      'Retirar/Devolver',
      'Ferramentas',
      'Colaboradores',
      'Auditoria',
      'Usuários e acessos',
    ]);
    await expect(sidebar.getByRole('link', { name: /Dados e backup/ })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: /Invent/ })).toHaveCount(0);
  });

  test('menu da conta: Perfil, Senha, Tema e Sair; dados administrativos numa seção transitória', async ({
    page,
  }) => {
    await openUserMenu(page);

    const menu = page.locator('#user-dropdown-menu');

    for (const name of ['Meu Perfil', 'Alterar Senha', 'Modo Noturno', 'Sair do Sistema']) {
      await expect(menu.getByRole('menuitem', { name })).toBeVisible();
    }

    await expect(menu.getByText('Dados (transitório)')).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Resetar dados operacionais' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Gerenciar Usuários' })).toHaveCount(0);
  });

  test('sessão: logout limpa a URL e o próximo login começa no Painel', async ({ page }) => {
    await openTab(page, 'history');
    await expectActiveTab(page, 'history');

    await page.locator('#btn-logout-sidebar').click();
    await page.locator('#logout-modal').getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page.locator('#login-screen')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.title()).toBe('Painel de Controle');

    await loginAs(page, E2E_USERS.admin);
    await expectActiveTab(page, 'dashboard');
  });
});

test.describe('ADMIN — deep link', () => {
  test('hash direto autorizado é aplicado após o login', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin, { hash: '#/auditoria' });
    await expectActiveTab(page, 'history');
  });

  test('hash direto de Usuários e acessos também', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin, { hash: '#/usuarios' });
    await expectActiveTab(page, 'users');
    await expect(page.locator('#user-management-body')).toContainText('Ana Administradora');
  });
});

test.describe('PADRÃO — rotas permitidas e recusa das administrativas', () => {
  test('navega pelas telas permitidas; Ferramentas é o mesmo item para todos', async ({ page }) => {
    await loginAs(page, E2E_USERS.standard);

    for (const tab of ['scanner', 'collaborators', 'management', 'dashboard']) {
      await openTab(page, tab);
      await expectActiveTab(page, tab);
    }

    await expect(page.locator('#main-sidebar [data-nav-id]')).toHaveText([
      'Painel',
      'Retirar/Devolver',
      'Ferramentas',
      'Colaboradores',
    ]);
  });

  for (const [route, tab] of [
    ['auditoria', 'history'],
    ['usuarios', 'users'],
  ]) {
    test(`deep link #/${route} é recusado: Painel + aviso, sem carregar a tela`, async ({
      page,
    }) => {
      await loginAs(page, E2E_USERS.standard, { hash: `#/${route}` });
      await expectActiveTab(page, 'dashboard');
      await expect(page.locator(`#tab-${tab}`)).toBeHidden();
      await expect(
        page.locator('.toast-item').filter({ hasText: 'Acesso restrito' }).first()
      ).toBeVisible();
    });

    test(`editar o hash para #/${route} durante a sessão é recusado`, async ({ page }) => {
      await loginAs(page, E2E_USERS.standard);
      await openTab(page, 'management');
      await gotoHash(page, `#/${route}`);
      await expectActiveTab(page, 'dashboard');
      await expect(page).toHaveURL(/#\/painel$/);
      await expect(page.locator(`#tab-${tab}`)).toBeHidden();
      expect(
        await page.evaluate(() => ({
          users: window.App.Data.users.length,
          history: window.App.Data.history.length,
        }))
      ).toEqual({ users: 0, history: 0 });
    });
  }

  test('rota recusada não deixa armadilha: voltar retorna à tela anterior', async ({ page }) => {
    await loginAs(page, E2E_USERS.standard);
    await openTab(page, 'management');
    await gotoHash(page, '#/auditoria');
    await expectActiveTab(page, 'dashboard');
    await page.goBack();
    await expectActiveTab(page, 'management');
  });

  test('switchTab programático de tela administrativa continua recusado', async ({ page }) => {
    await loginAs(page, E2E_USERS.standard);
    await page.evaluate(() => window.App.UI.switchTab('history'));
    await expectActiveTab(page, 'dashboard');
    await expect(
      page.locator('.toast-item').filter({ hasText: 'Acesso restrito' }).first()
    ).toBeVisible();
  });
});

test.describe('RESTRITO — Colaboradores e áreas administrativas inacessíveis', () => {
  test('scanner e ferramentas funcionam; sem Colaboradores/Auditoria/Usuários na navegação', async ({
    page,
  }) => {
    await loginAs(page, E2E_USERS.restricted);

    await expect(page.locator('[data-nav-id]:visible')).toHaveText([
      'Painel',
      'Retirar/Devolver',
      'Ferramentas',
    ]);
    // Em nenhum lugar do DOM (sidebar, barra inferior ou "Mais").
    for (const id of ['collaborators', 'history', 'users']) {
      await expect(page.locator(`[data-nav-id="${id}"]`)).toHaveCount(0);
    }

    for (const tab of ['scanner', 'management', 'dashboard']) {
      await openTab(page, tab);
      await expectActiveTab(page, tab);
    }
  });

  test('deep link #/colaboradores é recusado e a coleção não é carregada', async ({ page }) => {
    await loginAs(page, E2E_USERS.restricted, { hash: '#/colaboradores' });
    await expectActiveTab(page, 'dashboard');
    await expect(page.locator('#tab-collaborators')).toBeHidden();
    await expect(
      page.locator('.toast-item').filter({ hasText: 'Acesso não permitido' }).first()
    ).toBeVisible();
    expect(
      await page.evaluate(() => ({
        collaborators: window.App.Data.collaborators.length,
        listeners: window.App.Data.listeners.length,
      }))
    ).toEqual({ collaborators: 0, listeners: 1 });
  });

  for (const route of ['colaboradores', 'auditoria', 'usuarios']) {
    test(`editar o hash para #/${route} durante a sessão é recusado`, async ({ page }) => {
      await loginAs(page, E2E_USERS.restricted);
      await openTab(page, 'scanner');
      await gotoHash(page, `#/${route}`);
      await expectActiveTab(page, 'dashboard');
      await expect(page).toHaveURL(/#\/painel$/);
    });
  }

  test('switchTab programático de Colaboradores continua recusado', async ({ page }) => {
    await loginAs(page, E2E_USERS.restricted);
    await page.evaluate(() => window.App.UI.switchTab('collaborators'));
    await expectActiveTab(page, 'dashboard');
    expect(await page.evaluate(() => window.App.UI.activeTab)).toBe('dashboard');
  });
});

test.describe('modelo único: o mapa de testes cobre exatamente as rotas do app', () => {
  test('cada rota do TABS existe no modelo de navegação em execução', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);

    const routes = await page.evaluate(() =>
      [...document.querySelectorAll('#main-sidebar [data-nav-id]')].map((a) =>
        a.getAttribute('href')
      )
    );

    expect(routes.sort()).toEqual(
      Object.values(TABS)
        .map((tab) => `#/${tab.route}`)
        .sort()
    );
  });
});
