import { TABS, expect, expectActiveTab, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// BASELINE DA NAVEGAÇÃO ATUAL (pré-router por hash). Estes testes documentam o comportamento de
// hoje e serão atualizados DE PROPÓSITO no Gate 1-D. Não são a especificação do redesign.
test.describe('NAVEGAÇÃO ATUAL — baseline pré-router', () => {
  test('ADMIN: títulos e itens ativos das 6 telas (mapa atual)', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);

    const titles = {};

    for (const tab of Object.keys(TABS)) {
      await openTab(page, tab, { isAdmin: true });
      await expectActiveTab(page, tab, { isAdmin: true });
      titles[tab] = await page.locator('#topbar-title').innerText();
    }

    expect(titles).toEqual({
      dashboard: 'Visão Geral',
      scanner: 'Leitor / Scanner',
      collaborators: 'Colaboradores',
      management: 'Ferramentas',
      users: 'Controle de Acesso',
      history: 'Auditoria de Sistema',
    });
  });

  test('sem URL por tela: a navegação não altera a URL', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);

    const before = page.url();

    for (const tab of ['scanner', 'management', 'history']) {
      await openTab(page, tab, { isAdmin: true });
      expect(page.url()).toBe(before);
    }
  });

  test('sem persistência da tela: recarregar volta ao dashboard', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'management', { isAdmin: true });
    await expectActiveTab(page, 'management', { isAdmin: true });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#main-app')).toBeVisible({ timeout: 20_000 });
    await expectActiveTab(page, 'dashboard', { isAdmin: true, initialLoad: true });
  });

  test('PADRÃO: item "Ferramentas" (não "Inventário") abre a mesma tela de gestão', async ({
    page,
  }) => {
    await loginAs(page, E2E_USERS.standard);
    await openTab(page, 'management');
    await expectActiveTab(page, 'management');
    await expect(page.locator('#nav-tools')).toBeVisible();
    await expect(page.locator('#nav-management')).toBeHidden();
  });

  test('PADRÃO: acesso a tela administrativa retorna ao dashboard com aviso', async ({ page }) => {
    await loginAs(page, E2E_USERS.standard);
    await openTab(page, 'management');
    await page.evaluate(() => window.App.UI.switchTab('history'));
    await expect(page.locator('#topbar-title')).toHaveText('Visão Geral');
    await expect(page.locator('#tab-dashboard')).toBeVisible();
    await expect(
      page.locator('.toast-item').filter({ hasText: 'Acesso restrito' }).first()
    ).toBeVisible();
  });

  test('sessão: logout limpa a tela e o próximo login começa no dashboard', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'history', { isAdmin: true });
    await page.locator('#btn-logout-sidebar').click();
    await page.locator('#logout-modal').getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page.locator('#login-screen')).toBeVisible();

    await loginAs(page, E2E_USERS.standard);
    await expectActiveTab(page, 'dashboard', { initialLoad: true });
  });
});
