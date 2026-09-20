import globalSetup from './support/global-setup.mjs';
import { expect, expectActiveTab, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_EXPECTED_COUNTS, E2E_USERS } from './support/seed-data.mjs';

// ÚNICO fluxo destrutivo de Dados e backup que confirma de verdade: "Excluir histórico antigo".
// Roda SOMENTE no Firebase Emulator (fixtures de assertEmulatorOnlyEnvironment) e por último
// (projeto "destructive", que depende de desktop e mobile), porque apaga documentos semeados.
// Ao final o emulator é re-semeado com o mesmo seed idempotente. Restore/reset seguem SIMULADOS.
test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await globalSetup();
});

test('limpar histórico: confirma, apaga só o histórico antigo e informa o resultado', async ({
  page,
}) => {
  await loginAs(page, E2E_USERS.admin);
  await openTab(page, 'data');
  await expectActiveTab(page, 'data');

  const before = await page.evaluate(() => ({
    history: window.App.Data.allHistoryLogs.length,
    tools: window.App.Data.tools.length,
    collaborators: window.App.Data.collaborators.length,
    users: window.App.Data.users.length,
  }));

  expect(before).toEqual({
    history: E2E_EXPECTED_COUNTS.history,
    tools: E2E_EXPECTED_COUNTS.tools,
    collaborators: E2E_EXPECTED_COUNTS.collaborators,
    users: E2E_EXPECTED_COUNTS.users,
  });

  await page.locator('#data-clean-history').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.locator('#confirm-dialog-confirm').click();

  await expect(page.locator('#data-feedback-maintenance')).toContainText(
    `${E2E_EXPECTED_COUNTS.history} registro(s) de histórico excluído(s).`,
    { timeout: 20_000 }
  );
  await expect(
    page.locator('.toast-item').filter({ hasText: `${E2E_EXPECTED_COUNTS.history} registros antigos excluidos` })
  ).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => window.App.Data.allHistoryLogs.length), { timeout: 15_000 })
    .toBe(0);

  // Só o histórico foi tocado.
  expect(
    await page.evaluate(() => ({
      tools: window.App.Data.tools.length,
      collaborators: window.App.Data.collaborators.length,
      users: window.App.Data.users.length,
    }))
  ).toEqual({
    tools: E2E_EXPECTED_COUNTS.tools,
    collaborators: E2E_EXPECTED_COUNTS.collaborators,
    users: E2E_EXPECTED_COUNTS.users,
  });

  // Sem registros antigos: nova tentativa não abre diálogo e informa que não há nada a excluir.
  await page.locator('#data-clean-history').click();
  await expect(page.locator('#data-feedback-maintenance')).toContainText(
    'Nenhum registro com mais de 30 dias'
  );
  await expect(page.locator('#confirm-dialog')).toBeHidden();
});
