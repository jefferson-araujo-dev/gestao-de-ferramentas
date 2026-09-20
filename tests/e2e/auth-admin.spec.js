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

const admin = E2E_USERS.admin;
const asAdmin = { isAdmin: true };

test.describe('ADMIN — login, navegação e contrato visível de autorização', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, admin);
  });

  test('login: perfil Administrador, dashboard e permissões efetivas', async ({ page }) => {
    await expect(page.locator('#user-role')).toHaveText('Administrador');
    await expect(page.locator('#user-name')).toHaveText('Ana Administradora');
    await expectActiveTab(page, 'dashboard', { ...asAdmin, initialLoad: true });

    expect(await readPermissions(page)).toMatchObject({
      isAdm: true,
      canReadTools: true,
      canReadCollaborators: true,
      canAccessUsers: true,
      canAccessHistory: true,
      canAccessInventory: true,
      canExportData: true,
      canBackupData: true,
      canManageCollaborators: true,
      canManageTools: true,
    });
  });

  test('dashboard: dados semeados chegam pelos listeners reais do emulator', async ({ page }) => {
    await expectKpi(page, 'stat-total', E2E_EXPECTED_COUNTS.tools);
    await expectKpi(page, 'stat-available', E2E_EXPECTED_COUNTS.available);
    await expectKpi(page, 'stat-borrowed', E2E_EXPECTED_COUNTS.borrowed);
    await expectKpi(page, 'stat-maintenance', E2E_EXPECTED_COUNTS.maintenance);
    await expect(page.locator('#dash-list')).toContainText('Furadeira de Impacto');
  });

  test('navegação: as 7 telas abrem com título, painel e item ativo corretos', async ({ page }) => {
    for (const tab of ['scanner', 'collaborators', 'management', 'history', 'users', 'data', 'dashboard']) {
      await openTab(page, tab, asAdmin);
      await expectActiveTab(page, tab, asAdmin);
    }
  });

  test('telas carregam os dados do emulator (colaboradores, inventário, auditoria, acesso)', async ({
    page,
  }) => {
    await openTab(page, 'collaborators', asAdmin);
    await expect(page.locator('#collab-list')).toContainText('Colaborador Alfa');

    await openTab(page, 'management', asAdmin);
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');

    await openTab(page, 'history', asAdmin);
    await expect(page.locator('#history-list')).toContainText('Furadeira de Impacto');

    await openTab(page, 'users', asAdmin);
    await expect(page.locator('#count-total')).toHaveText(String(E2E_EXPECTED_COUNTS.users));
    await expect(page.locator('#user-management-body')).toContainText('Ana Administradora');
  });

  test('ações administrativas visíveis nas telas (novo/importar/exportar)', async ({ page }) => {
    await openTab(page, 'management', asAdmin);
    await expect(page.locator('#tools-action-new')).toBeVisible();
    await expect(page.locator('#tools-action-import')).toBeVisible();
    await expect(page.locator('#tools-action-export')).toBeVisible();

    await openTab(page, 'collaborators', asAdmin);
    await expect(page.locator('#btn-collaborators-new')).toBeVisible();
    await expect(page.locator('#btn-collaborators-import')).toBeVisible();
    await expect(page.locator('#btn-collaborators-export')).toBeVisible();
  });

  test('menu da conta: só Perfil, Senha, Tema e Sair; ações de dados vivem em Dados e backup', async ({
    page,
    guard,
  }) => {
    await openUserMenu(page);

    const menu = page.locator('#user-dropdown-menu');

    await expect(menu.getByRole('menuitem')).toHaveText([
      /Meu Perfil/,
      /Alterar Senha/,
      /Modo Noturno/,
      /Sair do Sistema/,
    ]);

    for (const name of ['Meu Perfil', 'Alterar Senha', 'Modo Noturno', 'Sair do Sistema']) {
      await expect(menu.getByRole('menuitem', { name })).toBeEnabled();
    }

    // Sem seção transitória: nada de reset, backup, restauração, Excel ou métricas no menu.
    await expect(page.locator('#admin-tools')).toHaveCount(0);
    await expect(menu.getByText(/Resetar|Backup|Restaurar|Importar Excel|Métricas/)).toHaveCount(0);
    expect(guard.apiCalls.filter((call) => call.includes('/api/backup'))).toEqual([]);
  });

  test('logout: confirma no modal e volta para a tela de login', async ({ page }) => {
    await logoutViaSidebar(page);
    await expect(page.locator('#login-email')).toBeVisible();
  });
});
