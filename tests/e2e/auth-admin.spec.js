import { readFileSync } from 'node:fs';

import { verifyBackupDataHash } from '../../src/js/utils/backupContract.js';
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

  test('navegação: as 6 telas abrem com título, painel e item ativo corretos', async ({ page }) => {
    for (const tab of ['scanner', 'collaborators', 'management', 'history', 'users', 'dashboard']) {
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

  test('menu administrativo: itens presentes e habilitados (sem executar destrutivos)', async ({
    page,
    guard,
  }) => {
    await openUserMenu(page);

    const menu = page.locator('#user-dropdown-menu');

    for (const name of [
      'Resetar dados operacionais',
      'Backup JSON',
      'Métricas do Sistema',
      'Meu Perfil',
      'Alterar Senha',
      'Sair do Sistema',
    ]) {
      await expect(menu.getByRole('menuitem', { name })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name })).toBeEnabled();
    }

    await expect(menu.getByText('Importar Excel')).toBeVisible();
    await expect(menu.getByText('Restaurar JSON')).toBeVisible();
    await expect(page.locator('#file-restore-json')).toBeAttached();

    // Nenhum item destrutivo foi acionado e nenhuma API de backup foi tocada.
    expect(guard.apiCalls.filter((call) => call.includes('/api/backup'))).toEqual([]);
  });

  test('guard seguro: restore de arquivo inválido é recusado localmente, sem API', async ({
    page,
    guard,
  }) => {
    await openUserMenu(page);
    await page.locator('#file-restore-json').setInputFiles({
      name: 'e2e-invalid-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ schemaVersion: '999.0' })),
    });

    await expect(page.locator('.toast-item').filter({ hasText: 'Backup inválido' })).toBeVisible();
    await expect(
      page.locator('.toast-item').filter({ hasText: 'Nenhum dado foi alterado' })
    ).toBeVisible();
    expect(guard.apiCalls.filter((call) => call.includes('/api/backup'))).toEqual([]);
    expect(guard.dialogs).toEqual([]);
  });

  test('exportação (somente leitura): Backup JSON gera o schema v4 com hash válido', async ({
    page,
  }) => {
    await openUserMenu(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Backup JSON' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(
      /^backup_gestao_ferramentas_v4_\d{4}-\d{2}-\d{2}.*\.json$/
    );

    const backup = JSON.parse(readFileSync(await download.path(), 'utf8'));

    expect(backup.schemaVersion).toBe('4.0');
    expect(Object.keys(backup.data).sort()).toEqual(['collaborators', 'history', 'tools']);
    expect(backup.data.users).toBeUndefined();
    expect(backup.summary.collections).toEqual({
      tools: E2E_EXPECTED_COUNTS.tools,
      collaborators: E2E_EXPECTED_COUNTS.collaborators,
      history: E2E_EXPECTED_COUNTS.history,
    });
    expect(backup.summary.usersReferenceCount).toBe(E2E_EXPECTED_COUNTS.users);
    expect(backup.reference.users.some((u) => 'lastIp' in u || 'lastDevice' in u)).toBe(false);
    expect((await verifyBackupDataHash(backup)).ok).toBe(true);
  });

  test('logout: confirma no modal e volta para a tela de login', async ({ page }) => {
    await logoutViaSidebar(page);
    await expect(page.locator('#login-email')).toBeVisible();
  });
});
