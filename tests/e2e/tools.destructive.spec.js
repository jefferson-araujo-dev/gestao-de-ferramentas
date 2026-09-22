import globalSetup from './support/global-setup.mjs';
import { expect, expectActiveTab, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_EXPECTED_COUNTS, E2E_USERS } from './support/seed-data.mjs';

// Escrita REAL no Firebase Emulator (nunca em produção: as fixtures recusam qualquer outro host):
// trocar o status de uma ferramenta pelo menu da linha. Roda por último (projeto "destructive-tools",
// depois de "destructive") porque altera um documento semeado; o emulator é re-semeado ao final.
test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await globalSetup();
});

const row = (page, name) => page.locator('#crud-list tr.tools-row', { hasText: name });
const chip = (page, label) =>
  page.locator('#tools-filters').getByRole('button', { name: new RegExp(`^${label}\\s*\\d+`) });

test('trocar status pelo menu grava no emulator, atualiza a linha e as contagens', async ({
  page,
}) => {
  await loginAs(page, E2E_USERS.admin);
  await openTab(page, 'management');
  await expectActiveTab(page, 'management');
  await expect(page.locator('#inventory-result-count')).toHaveText('Mostrando 8 de 8 ferramentas');

  const martelo = row(page, 'Martelo');
  const menu = () => martelo.getByRole('button', { name: 'Mais ações de Martelo' }).click();

  await expect(martelo).toContainText('Disponível');

  // Disponível -> Manutenção
  await menu();
  await page.getByRole('menuitem', { name: 'Marcar como em manutenção' }).click();
  await expect(
    page.locator('.toast-item').filter({ hasText: 'Status atualizado.' }).first()
  ).toBeVisible();
  await expect(row(page, 'Martelo')).toContainText('Manutenção');
  await expect(chip(page, 'Manutenção')).toContainText(String(E2E_EXPECTED_COUNTS.maintenance + 1));
  await expect(chip(page, 'Disponíveis')).toContainText(String(E2E_EXPECTED_COUNTS.available - 1));

  // O menu passa a oferecer o caminho de volta, e não o status atual.
  await row(page, 'Martelo').getByRole('button', { name: 'Mais ações de Martelo' }).click();
  await expect(page.getByRole('menuitem', { name: 'Marcar como em manutenção' })).toHaveCount(0);

  // Manutenção -> Disponível
  await page.getByRole('menuitem', { name: 'Marcar como disponível' }).click();
  await expect(row(page, 'Martelo')).toContainText('Disponível');
  await expect(chip(page, 'Manutenção')).toContainText(String(E2E_EXPECTED_COUNTS.maintenance));
  await expect(chip(page, 'Disponíveis')).toContainText(String(E2E_EXPECTED_COUNTS.available));
});

test('quickStatusUpdate rejeita "borrowed" programaticamente, mesmo com ferramenta disponível', async ({
  page,
}) => {
  await loginAs(page, E2E_USERS.admin);
  await openTab(page, 'management');
  await expect(row(page, 'Martelo')).toContainText('Disponível');

  await page.evaluate(() => window.App.CRUDTools.quickStatusUpdate('T-E2E-003', 'borrowed'));
  await expect(
    page.locator('.toast-item').filter({ hasText: 'Status inválido para ajuste manual.' }).first()
  ).toBeVisible();
  // Nenhuma escrita real no emulator: a linha continua "Disponível" após recarregar os dados.
  await expect(row(page, 'Martelo')).toContainText('Disponível');
});

test('ferramenta emprestada não tem troca de status e a função recusa a alteração', async ({
  page,
}) => {
  await loginAs(page, E2E_USERS.admin);
  await openTab(page, 'management');
  await expect(page.locator('#inventory-result-count')).toHaveText('Mostrando 8 de 8 ferramentas');

  await row(page, 'Parafusadeira').getByRole('button', { name: 'Mais ações de Parafusadeira' }).click();
  await expect(page.getByRole('menuitem', { name: /Marcar como/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.App.CRUDTools.quickStatusUpdate('T-E2E-002', 'available'));
  await expect(
    page
      .locator('.toast-item')
      .filter({ hasText: 'Não é possível alterar status de ferramenta emprestada.' })
      .first()
  ).toBeVisible();
  await expect(row(page, 'Parafusadeira')).toContainText('Emprestada');
});
