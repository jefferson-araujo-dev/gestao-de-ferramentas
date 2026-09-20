import {
  expect,
  expectActiveTab,
  expectKpi,
  loginAs,
  logoutViaSidebar,
  openTab,
  openUserMenu,
  readPermissions,
  test,
} from './support/fixtures.js';
import { E2E_EXPECTED_COUNTS, E2E_USERS } from './support/seed-data.mjs';

const standard = E2E_USERS.standard;

test.describe('PADRÃO — login, navegação e limites de autorização da UI', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, standard);
  });

  test('login: perfil Usuário, dashboard e permissões efetivas sem privilégios de admin', async ({
    page,
  }) => {
    await expect(page.locator('#user-role')).toHaveText('Usuário');
    await expect(page.locator('#user-name')).toHaveText('Paulo Padrao');
    await expectActiveTab(page, 'dashboard', { initialLoad: true });
    await expectKpi(page, 'stat-total', E2E_EXPECTED_COUNTS.tools);

    expect(await readPermissions(page)).toMatchObject({
      isAdm: false,
      canReadTools: true,
      canReadCollaborators: true,
      canAccessDashboard: true,
      canAccessScanner: true,
      canAccessInventory: false,
      canAccessUsers: false,
      canAccessHistory: false,
      canExportData: false,
      canBackupData: false,
      canManageCollaborators: false,
      canManageTools: false,
    });
  });

  test('navegação: dashboard, scanner, colaboradores e ferramentas', async ({ page }) => {
    for (const tab of ['scanner', 'collaborators', 'management', 'dashboard']) {
      await openTab(page, tab);
      await expectActiveTab(page, tab);
    }

    await openTab(page, 'management');
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');
  });

  test('ausência visual: itens de navegação, menu e ações administrativas', async ({ page }) => {
    const sidebar = page.locator('#main-sidebar');

    for (const name of ['Auditoria', 'Usuários e acessos', 'Inventário']) {
      await expect(sidebar.getByRole('link', { name, exact: true })).toHaveCount(0);
    }
    await expect(page.locator('#btn-export-dashboard')).toBeHidden();

    await openUserMenu(page);

    const menu = page.locator('#user-dropdown-menu');

    await expect(page.locator('#admin-tools')).toBeHidden();

    for (const name of [
      'Resetar dados operacionais',
      'Backup JSON',
      'Métricas do Sistema',
    ]) {
      await expect(menu.getByRole('button', { name })).toBeHidden();
    }

    for (const name of ['Meu Perfil', 'Alterar Senha', 'Sair do Sistema']) {
      await expect(menu.getByRole('button', { name })).toBeVisible();
    }

    await page.keyboard.press('Escape');
    await openTab(page, 'management');
    await expect(page.locator('#tools-action-new')).toBeHidden();
    await expect(page.locator('#tools-action-import')).toBeHidden();
    await expect(page.locator('#tools-action-export')).toBeHidden();

    await openTab(page, 'collaborators');
    await expect(page.locator('#btn-collaborators-new')).toBeHidden();
    await expect(page.locator('#btn-collaborators-import')).toBeHidden();
    await expect(page.locator('#btn-collaborators-export')).toBeHidden();
  });

  test('não apenas oculto: telas administrativas recusam navegação programática', async ({
    page,
  }) => {
    for (const tab of ['users', 'history']) {
      await page.evaluate((target) => window.App.UI.switchTab(target), tab);
      await expect(page.locator('#topbar-title')).toHaveText('Painel');
      await expect(page.locator(`#tab-${tab}`)).toBeHidden();
      await expect(
        page.locator('.toast-item').filter({ hasText: 'Acesso restrito' }).first()
      ).toBeVisible();
    }
  });

  test('não apenas oculto: dados administrativos nem chegam ao cliente', async ({ page }) => {
    const loaded = await page.evaluate(() => ({
      users: window.App.Data.users.length,
      history: window.App.Data.allHistoryLogs,
    }));

    expect(loaded).toEqual({ users: 0, history: null });

    // Mesmo revelando o painel via DevTools, não há dados de usuários para exibir.
    await page.evaluate(() => document.getElementById('tab-users').classList.remove('hidden'));
    await expect(page.locator('#user-management-body')).not.toContainText('Ana Administradora');
  });

  test('não apenas oculto: ações administrativas são recusadas em JS (sem diálogo, sem API, sem download)', async ({
    page,
    guard,
  }) => {
    let downloads = 0;

    page.on('download', () => (downloads += 1));

    const result = await page.evaluate(async () => ({
      exported: await window.App.Data.exportJSON(),
      reset: (await window.App.Data.resetAllData()) ?? null,
    }));

    expect(result).toEqual({ exported: null, reset: null });
    await expect(
      page.locator('.toast-item').filter({ hasText: 'Acesso restrito' }).first()
    ).toBeVisible();
    expect(downloads).toBe(0);
    expect(guard.dialogs).toEqual([]);
    expect(guard.apiCalls.filter((call) => call.includes('/api/backup'))).toEqual([]);
  });

  test('não apenas oculto: modais de gestão não abrem sem permissão', async ({ page }) => {
    await page.evaluate(() => {
      window.App.CRUDTools.openModal();
      window.App.CRUDCollaborators.openModal();
    });

    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });

  test('logout: volta para a tela de login', async ({ page }) => {
    await logoutViaSidebar(page);
  });
});
