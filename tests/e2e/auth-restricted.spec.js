import {
  expect,
  expectActiveTab,
  loginAs,
  logoutViaSidebar,
  openTab,
  openUserMenu,
  readPermissions,
  test,
} from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

const restricted = E2E_USERS.restricted;

test.describe('RESTRITO — login, navegação e ausência de áreas administrativas', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, restricted);
  });

  test('login: perfil Usuário sem privilégios de admin', async ({ page }) => {
    await expect(page.locator('#user-role')).toHaveText('Usuário');
    await expect(page.locator('#user-name')).toHaveText('Rita Restrita');
    await expectActiveTab(page, 'dashboard', { initialLoad: true });

    expect(await readPermissions(page)).toMatchObject({
      isAdm: false,
      canAccessUsers: false,
      canAccessHistory: false,
      canBackupData: false,
      canManageTools: false,
      canManageCollaborators: false,
    });
  });

  test('navegação: dashboard, scanner e ferramentas; sem Colaboradores', async ({ page }) => {
    const sidebar = page.locator('#main-sidebar');

    await expect(sidebar.getByRole('button', { name: 'Colaboradores', exact: true })).toHaveCount(
      0
    );
    await expect(page.locator('#nav-collaborators')).toBeHidden();

    for (const tab of ['scanner', 'management', 'dashboard']) {
      await openTab(page, tab);
      await expectActiveTab(page, tab);
    }
  });

  test('ausência das áreas administrativas (nav, menu e ações)', async ({ page }) => {
    const sidebar = page.locator('#main-sidebar');

    await expect(page.locator('#admin-section')).toBeHidden();
    await expect(sidebar.getByRole('button', { name: 'Auditoria', exact: true })).toHaveCount(0);
    await expect(
      sidebar.getByRole('button', { name: 'Controle de Acesso', exact: true })
    ).toHaveCount(0);

    await openUserMenu(page);
    await expect(page.locator('#admin-tools')).toBeHidden();
    await page.keyboard.press('Escape');

    await openTab(page, 'management');
    await expect(page.locator('#tools-action-new')).toBeHidden();
  });

  test('não apenas oculto: telas administrativas recusam navegação programática', async ({
    page,
  }) => {
    for (const tab of ['users', 'history']) {
      await page.evaluate((target) => window.App.UI.switchTab(target), tab);
      await expect(page.locator('#topbar-title')).toHaveText('Visão Geral');
      await expect(page.locator(`#tab-${tab}`)).toBeHidden();
    }
  });

  // ACHADO DO GATE 1-B (comportamento atual, pré-existente): "restrito" só esconde o item de menu.
  // switchTab('collaborators') NÃO é bloqueado (ui.js só protege 'users' e 'history') e os dados
  // de colaboradores são carregados para qualquer perfil ativo (canReadCollaborators = true;
  // as regras do Firestore também permitem a leitura). O contrato desejado está descrito abaixo;
  // test.fail() faz a suíte avisar quando o comportamento for corrigido (remover o test.fail).
  test('contrato desejado: perfil restrito não alcança Colaboradores nem por navegação programática', async ({
    page,
  }) => {
    test.fail(
      true,
      'ACHADO: perfil restrito alcança Colaboradores via switchTab (só o menu é oculto).'
    );

    await page.evaluate(() => window.App.UI.switchTab('collaborators'));
    await expect(page.locator('#tab-collaborators')).toBeHidden();
    await expect(page.locator('#collab-list')).not.toContainText('Colaborador Alfa');
  });

  test('logout: volta para a tela de login', async ({ page }) => {
    await logoutViaSidebar(page);
  });
});
