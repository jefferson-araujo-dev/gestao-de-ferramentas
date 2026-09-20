import { expect, loginAs, openTab, openUserMenu, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// Abertura/fechamento dos modais críticos. Nenhuma ação destrutiva é executada e nada é salvo.
async function expectOpenThenEscape(page, selector) {
  const dialog = page.locator(selector);

  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

test.describe('MODAIS — perfil ADMIN', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  test('ferramenta: abre pelo botão "novo" e fecha com Esc', async ({ page }) => {
    await openTab(page, 'management', { isAdmin: true });
    await page.locator('#tools-action-new').click();
    await expect(page.locator('#modal-title')).toHaveText(/\S/);
    await expect(page.locator('#crud-name')).toBeVisible();
    await expect(page.locator('#btn-save-tool')).toBeVisible();
    await expectOpenThenEscape(page, '#crud-modal');
  });

  test('colaborador: abre pelo botão "novo" e fecha com Esc', async ({ page }) => {
    await openTab(page, 'collaborators', { isAdmin: true });
    await page.locator('#btn-collaborators-new').click();
    await expect(page.locator('#collab-modal-title')).toHaveText(/\S/);
    await expect(page.locator('#crud-collab-name')).toBeVisible();
    await expect(page.locator('#btn-save-collab')).toBeVisible();
    await expectOpenThenEscape(page, '#crud-collab-modal');
  });

  test('perfil: mostra e-mail e função da conta e fecha com Esc', async ({ page }) => {
    await openUserMenu(page);
    await page.getByRole('menuitem', { name: 'Meu Perfil' }).click();
    await expect(page.locator('#profile-modal-email')).toHaveText(E2E_USERS.admin.email);
    await expect(page.locator('#profile-modal-role')).toContainText('Administrador');
    await expectOpenThenEscape(page, '#profile-modal');
  });

  test('senha: abre o formulário sem enviar e fecha com Esc', async ({ page }) => {
    await openUserMenu(page);
    await page.getByRole('menuitem', { name: 'Alterar Senha' }).click();
    await expect(page.locator('#password-form')).toBeVisible();
    await expect(page.locator('#new-password')).toBeVisible();
    await expectOpenThenEscape(page, '#password-modal');
  });

  test('histórico da ferramenta: abre pelo menu da linha (aba Ferramentas) e lista os registros', async ({
    page,
  }) => {
    await openTab(page, 'management', { isAdmin: true });
    // Gate 1-F2: o histórico deixou de ser um botão solto no card e passou para o menu de ações da linha.
    await page.locator('#crud-list [data-tools-menu-trigger]').first().click();
    await page.getByRole('menuitem', { name: 'Histórico', exact: true }).click();
    await expect(page.locator('#tool-history-name')).toHaveText(/\S/);
    await expect(page.locator('#tool-history-list')).toBeVisible();
    await expectOpenThenEscape(page, '#tool-history-modal');
  });

  test('logout: cancelar mantém a sessão', async ({ page }) => {
    await page.locator('#btn-logout-sidebar').click();

    const dialog = page.locator('#logout-modal');

    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#main-app')).toBeVisible();
  });
});

test.describe('MODAIS — perfil PADRÃO', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.standard);
  });

  test('perfil e senha abrem e fecham; sem modais de gestão', async ({ page }) => {
    await openUserMenu(page);
    await page.getByRole('menuitem', { name: 'Meu Perfil' }).click();
    await expect(page.locator('#profile-modal-email')).toHaveText(E2E_USERS.standard.email);
    await expectOpenThenEscape(page, '#profile-modal');

    await openUserMenu(page);
    await page.getByRole('menuitem', { name: 'Alterar Senha' }).click();
    await expectOpenThenEscape(page, '#password-modal');
  });

  test('histórico da ferramenta: o botão não é exibido para o perfil padrão', async ({ page }) => {
    await openTab(page, 'management');
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');
    // Sem permissão de gestão a linha não tem menu de ações: nenhuma forma de abrir o histórico.
    await expect(page.locator('#crud-list [data-tools-menu-trigger]')).toHaveCount(0);
    await expect(page.locator('#crud-list').getByRole('menuitem', { name: 'Histórico' })).toHaveCount(0);
  });
});
