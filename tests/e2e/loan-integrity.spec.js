import { expect, expectActiveTab, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// Integridade do empréstimo no cliente: nenhum caminho da tela Ferramentas nem das importações
// grava 'borrowed' (empréstimo só pelo Scanner, com patrimônio + crachá resolvidos na API), e o
// Scanner só confirma com as duas identidades da operação atual. As regras do Firestore também
// recusam 'borrowed' vindo de qualquer cliente (tests/integration/firestoreRulesEmulator.test.mjs);
// aqui se prova que o próprio app recusa antes, sem escrever nada no emulator.
const LOAN_ONLY = 'Empréstimo só pelo Scanner, com patrimônio e crachá do colaborador.';
const BORROWED_DELETE =
  'Ferramenta emprestada não pode ser excluída: registre a devolução no Scanner antes.';

const toast = (page, text) => page.locator('.toast-item').filter({ hasText: text }).first();
const row = (page, name) => page.locator('#crud-list tr.tools-row', { hasText: name });
const cachedStatus = (page, id) =>
  page.evaluate((toolId) => window.App.Data.tools.find((t) => t.firebaseId === toolId)?.status, id);

// Planilha simulada (sem baixar o SheetJS): devolve as linhas informadas como a biblioteca faria.
async function stubSpreadsheet(page, { arrays, objects }) {
  await page.evaluate(
    ({ arrays: rowsAsArrays, objects: rowsAsObjects }) => {
      window.XLSX = {
        read: () => ({ SheetNames: ['Planilha'], Sheets: { Planilha: {} } }),
        utils: {
          sheet_to_json: (_sheet, options = {}) => (options.header === 1 ? rowsAsArrays : rowsAsObjects),
        },
      };
    },
    { arrays, objects }
  );
}

test.describe('ADMIN — nenhum write do cliente entra em borrowed', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'management');
    await expect(page.locator('#inventory-result-count')).toHaveText('Mostrando 8 de 8 ferramentas');
  });

  test('quickStatusUpdate(…, "borrowed") é recusado pela função', async ({ page }) => {
    await page.evaluate(() => window.App.CRUDTools.quickStatusUpdate('T-E2E-005', 'borrowed'));

    await expect(toast(page, LOAN_ONLY)).toBeVisible();
    await expect(page.locator('.toast-item').filter({ hasText: 'Status atualizado.' })).toHaveCount(0);
    await expect(row(page, 'Chave de Fenda')).toContainText('Disponível');
    expect(await cachedStatus(page, 'T-E2E-005')).toBe('available');
  });

  test('bulkAction("status", "borrowed") é recusado antes de qualquer confirmação', async ({ page }) => {
    await page.evaluate(async () => {
      window.__confirmCalls = 0;
      window.App.UI.confirmAction = async () => {
        window.__confirmCalls += 1;
        return true;
      };
      window.App.CRUDTools.selectedTools.add('T-E2E-005');
      window.App.CRUDTools.selectedTools.add('T-E2E-004');
      await window.App.CRUDTools.bulkAction('status', 'borrowed');
    });

    await expect(toast(page, LOAN_ONLY)).toBeVisible();
    expect(await page.evaluate(() => window.__confirmCalls)).toBe(0);
    expect(await cachedStatus(page, 'T-E2E-005')).toBe('available');
    expect(await cachedStatus(page, 'T-E2E-004')).toBe('maintenance');
  });

  test('saveTool com o select de status adulterado para "borrowed" é recusado', async ({ page }) => {
    await page.evaluate(() => window.App.CRUDTools.openModal('T-E2E-005'));
    await expect(page.locator('#crud-modal')).toBeVisible();

    // O select só oferece Disponível/Manutenção: injeta a opção como um cliente adulterado faria.
    await page.evaluate(() => {
      const select = document.getElementById('crud-status');
      select.add(new Option('Emprestada', 'borrowed'));
      select.value = 'borrowed';
    });
    await page.evaluate(() => window.App.CRUDTools.saveTool());

    await expect(toast(page, LOAN_ONLY)).toBeVisible();
    await expect(page.locator('.toast-item').filter({ hasText: 'Atualizada com sucesso.' })).toHaveCount(0);
    await expect(page.locator('#crud-modal')).toBeVisible();
    expect(await cachedStatus(page, 'T-E2E-005')).toBe('available');
    await page.evaluate(() => window.App.CRUDTools.closeModal());
  });

  test('importação da tela Ferramentas recusa linhas "Emprestada" (nada é gravado)', async ({ page }) => {
    await stubSpreadsheet(page, {
      arrays: [
        ['Patrimônio', 'Descrição', 'Categoria', 'Status', 'Responsável'],
        ['T-IMP-001', 'Serra Tico-Tico', 'Elétrica', 'Emprestada', 'Colaborador Alfa'],
        ['T-IMP-002', 'Lixadeira', 'Elétrica', 'borrowed', 'Colaborador Beta'],
      ],
    });
    await page.evaluate(() => {
      const file = new File(['planilha'], 'ferramentas.xlsx');
      window.App.CRUDTools.importFile({ target: { files: [file], value: 'ferramentas.xlsx' } });
    });

    await expect(toast(page, '0 ferramentas importadas.')).toBeVisible();
    await expect(toast(page, '2 linha(s) com status "Emprestada" recusada(s)')).toBeVisible();
    expect(
      await page.evaluate(() => window.App.Data.tools.filter((t) => /^T-IMP-/.test(t.code)).length)
    ).toBe(0);
  });

  test('importação da tela Dados (Data.importExcel) recusa linhas "Emprestada" (nada é gravado)', async ({
    page,
  }) => {
    await stubSpreadsheet(page, {
      objects: [
        { Patrimônio: 'T-IMP-003', Descrição: 'Serra Mármore', Status: 'Emprestada', Responsável: 'Colaborador Alfa' },
        { Patrimônio: 'T-IMP-004', Descrição: 'Tupia', Status: 'borrowed' },
      ],
    });

    const result = await page.evaluate(async () => {
      window.App.UI.confirmAction = async () => true;
      const file = new File(['planilha'], 'ferramentas.xlsx');
      return window.App.Data.importExcel({ target: { files: [file], value: 'ferramentas.xlsx' } });
    });

    expect(result).toMatchObject({ status: 'done', imported: 0, errorCount: 2 });
    expect(
      await page.evaluate(() => window.App.Data.tools.filter((t) => /^T-IMP-/.test(t.code)).length)
    ).toBe(0);
  });

  test('ferramenta emprestada: sem ação de exclusão no menu e deleteTool recusa antes da confirmação', async ({
    page,
  }) => {
    const trigger = row(page, 'Parafusadeira').getByRole('button', { name: 'Mais ações de Parafusadeira' });

    await trigger.click();
    await expect(row(page, 'Parafusadeira').getByRole('menuitem', { name: /Excluir/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
      window.__dangerCalls = 0;
      const original = window.App.UI.confirmDanger;
      window.App.UI.confirmDanger = (...args) => {
        window.__dangerCalls += 1;
        return original.apply(window.App.UI, args);
      };
      window.App.CRUDTools.deleteTool('T-E2E-002');
    });

    await expect(toast(page, BORROWED_DELETE)).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Excluir ferramenta?' })).toHaveCount(0);
    expect(await page.evaluate(() => window.__dangerCalls)).toBe(0);
    await expect(row(page, 'Parafusadeira')).toContainText('Emprestada');
    expect(await cachedStatus(page, 'T-E2E-002')).toBe('borrowed');
  });

  test('bulkAction("delete") com emprestada na seleção não exclui nada (sem exclusão parcial)', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      window.__dangerCalls = 0;
      window.App.UI.confirmDanger = async () => {
        window.__dangerCalls += 1;
        return true;
      };
      window.App.CRUDTools.selectedTools.add('T-E2E-002');
      window.App.CRUDTools.selectedTools.add('T-E2E-005');
      await window.App.CRUDTools.bulkAction('delete');
    });

    await expect(toast(page, '1 ferramenta(s) emprestada(s) na seleção')).toBeVisible();
    await expect(toast(page, 'Nada foi excluído.')).toBeVisible();
    expect(await page.evaluate(() => window.__dangerCalls)).toBe(0);
    await expect(page.locator('#inventory-result-count')).toHaveText('Mostrando 8 de 8 ferramentas');
    expect(await cachedStatus(page, 'T-E2E-002')).toBe('borrowed');
    expect(await cachedStatus(page, 'T-E2E-005')).toBe('available');
  });

  test('"Emprestar" continua levando ao Scanner (fluxo oficial)', async ({ page }) => {
    await row(page, 'Chave de Fenda').getByRole('button', { name: 'Emprestar Chave de Fenda' }).click();
    await expectActiveTab(page, 'scanner');
  });
});

// Scanner: identidades da operação atual. A API é substituída por um stub que só registra o payload.
async function stubMovement(page) {
  const requests = [];

  await page.route('**/api/tools/movement', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: 'Empréstimo registrado.',
        data: {
          action: 'loan',
          tool: { id: 'x', status: 'borrowed' },
          collaborator: { name: 'Colaborador Alfa', role: 'Operador' },
        },
      }),
    });
  });

  return requests;
}

async function scanTool(page, code) {
  await expect
    .poll(() => page.evaluate(() => window.App.Data.toolsLoaded && window.App.Data.tools.length))
    .toBeGreaterThan(0);

  const input = page.locator('#manual-scan-input');

  await input.fill(code);
  await input.press('Enter');
  await expect(page.locator('#res-code')).toHaveText(code);
}

test.describe('SCANNER — empréstimo exige ferramenta + crachá da operação atual', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.standard);
    await openTab(page, 'scanner');
  });

  test('"Confirmar Empréstimo" só habilita com ferramenta lida e crachá preenchido', async ({ page }) => {
    const requests = await stubMovement(page);
    // Por id: antes da leitura o botão existe, mas o bloco de retirada está oculto.
    const confirm = page.locator('#btn-checkout-confirm');
    const badge = page.locator('#checkout-user-badge');

    await expect(confirm).toBeDisabled();
    await scanTool(page, 'T-E2E-001');
    await expect(page.locator('#scanner-checkout')).toBeVisible();
    await expect(confirm).toBeDisabled();

    await badge.fill('   ');
    await expect(confirm).toBeDisabled();

    // Mesmo chamada direto, a função não envia nada sem crachá.
    await page.evaluate(() => window.App.Scanner.processCheckout());
    expect(requests).toHaveLength(0);

    await badge.fill('E2E-001');
    await expect(confirm).toBeEnabled();
  });

  test('sem ferramenta lida a função não envia empréstimo, mesmo com crachá', async ({ page }) => {
    const requests = await stubMovement(page);

    await page.evaluate(() => {
      document.getElementById('checkout-user-badge').value = 'E2E-001';
      window.App.Scanner.processCheckout();
    });
    await page.waitForTimeout(800);
    expect(requests).toHaveLength(0);
  });

  test('nova leitura e troca de aba não reaproveitam ferramenta nem crachá anteriores', async ({ page }) => {
    const requests = await stubMovement(page);
    const badge = page.locator('#checkout-user-badge');

    await scanTool(page, 'T-E2E-001');
    await badge.fill('E2E-001');

    // Nova leitura com o resultado anterior aberto (o campo de digitação fica oculto): mesma
    // entrada do leitor/câmera. O crachá digitado para a ferramenta anterior é descartado.
    await page.evaluate(() => window.App.Scanner.processCode('T-E2E-003'));
    await expect(page.locator('#res-code')).toHaveText('T-E2E-003');
    await expect(badge).toHaveValue('');
    await expect(page.locator('#btn-checkout-confirm')).toBeDisabled();

    // Sair e voltar ao Scanner: a operação acabou.
    await badge.fill('E2E-002');
    await openTab(page, 'dashboard');
    await openTab(page, 'scanner');
    await expect(page.locator('#scanner-result')).toBeHidden();
    await expect(page.locator('#scanner-waiting')).toBeVisible();
    await expect(badge).toHaveValue('');
    expect(await page.evaluate(() => window.App.Scanner.currentTool)).toBeNull();

    await page.evaluate(() => window.App.Scanner.processCheckout());
    await page.waitForTimeout(800);
    expect(requests).toHaveLength(0);

    // Nova operação completa envia só as identidades lidas agora.
    await scanTool(page, 'T-E2E-005');
    await badge.fill('E2E-003');
    await page.getByRole('button', { name: 'Confirmar Empréstimo' }).click();
    await expect(page.locator('#toast-container')).toContainText('Autorizada para Colaborador Alfa');
    expect(requests).toEqual([
      {
        action: 'loan',
        toolId: 'T-E2E-005',
        toolCode: 'T-E2E-005',
        collaboratorBadge: 'E2E-003',
        device: expect.any(String),
      },
    ]);
  });

  test('ferramenta com revisão vencida: o formulário de retirada não aparece', async ({ page }) => {
    await expect
      .poll(() => page.evaluate(() => window.App.Data.tools.length))
      .toBeGreaterThan(0);
    // Só no cache do cliente (a API recusa a revisão vencida por conta própria).
    await page.evaluate(() => {
      window.App.Data.tools.find((t) => t.firebaseId === 'T-E2E-007').nextMaintenance = '2020-01-01';
    });
    await scanTool(page, 'T-E2E-007');

    await expect(toast(page, 'Empréstimo bloqueado: Ferramenta com revisão/calibração vencida.')).toBeVisible();
    await expect(page.locator('#scanner-checkout')).toBeHidden();
    await page.evaluate(() => window.App.Scanner.quickAction('loan'));
    await expect(page.locator('#scanner-checkout')).toBeHidden();
  });

  test('ferramenta em manutenção: o atalho de empréstimo não abre a retirada', async ({ page }) => {
    await scanTool(page, 'T-E2E-004');
    await page.evaluate(() => window.App.Scanner.quickAction('loan'));

    await expect(toast(page, 'Ferramenta indisponível para empréstimo.')).toBeVisible();
    await expect(page.locator('#scanner-checkout')).toBeHidden();
  });
});
