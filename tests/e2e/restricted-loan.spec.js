import { expect, expectActiveTab, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// Empréstimo e devolução no Scanner. A função Vercel /api/tools/movement NÃO existe no servidor
// de desenvolvimento do E2E: aqui ela é substituída por um stub na página que registra o
// payload EXATO enviado pelo app e responde como o servidor real (o servidor de verdade é
// coberto por tests/integration/movementEmulator.test.mjs). Nenhum dado do emulator muda.
//
// Contrato validado no cliente (igual em todos os perfis):
//   { action, toolId, toolCode, collaboratorBadge, device }
//   patrimônio lido + crachá exato; sem collaboratorId, sem nome, sem consultar a lista.
const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const GENERIC_DENIAL = 'Não foi possível autorizar a retirada. Confira o crachá informado.';

const json = (status, payload) => ({ status, payload });
const okLoan = (toolId, extra = {}) =>
  json(200, {
    success: true,
    message: 'Empréstimo registrado.',
    data: { action: 'loan', tool: { id: toolId, status: 'borrowed' }, ...extra },
  });

async function stubMovement(page, respond) {
  const requests = [];

  await page.route('**/api/tools/movement', async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    const { status, payload } = respond(body);

    requests.push({ method: request.method(), authorization: request.headers().authorization, body });
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  return requests;
}

// A negação genérica do servidor é 422 de propósito: o navegador registra esse status como
// erro de rede. Só esse caso esperado é retirado do guard; qualquer outro erro continua falhando.
function allowGenericDenial(guard) {
  guard.badResponses = guard.badResponses.filter((entry) => entry !== '422 /api/tools/movement');
  guard.consoleErrors = guard.consoleErrors.filter((entry) => !/status of 422/.test(entry));
}

async function scanTool(page, code) {
  const input = page.locator('#manual-scan-input');

  // As ferramentas chegam por listener logo após o login: só escaneia com a lista carregada.
  await expect
    .poll(() => page.evaluate(() => window.App.Data.toolsLoaded && window.App.Data.tools.length))
    .toBeGreaterThan(0);

  await input.fill(code);
  await input.press('Enter');
  await expect(page.locator('#res-code')).toHaveText(code);
}

// Captura os textos que o termo de responsabilidade (jsPDF) desenha, sem abrir o PDF.
async function captureReceiptTexts(page) {
  await page.evaluate(async (url) => {
    await window.Utils.loadScript(url);

    // `text` é definido dentro do construtor do jsPDF: envolve o construtor, não o protótipo.
    const OriginalJsPdf = window.jspdf.jsPDF;

    window.__receiptTexts = [];
    window.jspdf.jsPDF = function jsPDF(...args) {
      const doc = new OriginalJsPdf(...args);
      const originalText = doc.text;

      doc.text = function text(value, ...rest) {
        window.__receiptTexts.push(...[value].flat().map(String));
        return originalText.call(this, value, ...rest);
      };

      return doc;
    };
  }, JSPDF_URL);
}

const readReceiptTexts = (page) => page.evaluate(() => window.__receiptTexts);

function expectDevice(request) {
  expect(typeof request.body.device).toBe('string');
  expect(request.body.device.length).toBeGreaterThan(0);
}

test.describe('RESTRITO — empréstimo por crachá exato e devolução no Scanner', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.restricted);
    await openTab(page, 'scanner');
    await expectActiveTab(page, 'scanner');
  });

  test('empréstimo: pede o crachá exato e envia só collaboratorBadge (sem lista, sem ID)', async ({
    page,
  }) => {
    const requests = await stubMovement(page, () =>
      okLoan('T-E2E-001', { collaborator: { name: 'Colaborador Alfa', role: 'Operador' } })
    );

    expect(await page.evaluate(() => window.App.Data.collaborators.length)).toBe(0);

    await scanTool(page, 'T-E2E-001');
    await expect(page.locator('#scanner-checkout')).toBeVisible();

    const input = page.locator('#checkout-user-badge');

    await expect(input).toHaveAttribute('placeholder', 'Crachá do colaborador');
    await expect(input).not.toHaveAttribute('list', /.+/);
    await input.fill('E2E-001');
    await page.getByRole('button', { name: 'Confirmar Empréstimo' }).click();

    await expect(page.locator('#toast-container')).toContainText('Autorizada para Colaborador Alfa');
    await expect(page.locator('#scanner-status-box')).toContainText('Colaborador Alfa');

    expect(requests).toHaveLength(1);
    expect(requests[0].authorization).toMatch(/^Bearer \S+/);
    expect(requests[0].body).toEqual({
      action: 'loan',
      toolId: 'T-E2E-001',
      toolCode: 'T-E2E-001',
      collaboratorBadge: 'E2E-001',
      device: expect.any(String),
    });
    expectDevice(requests[0]);
    expect(requests[0].body).not.toHaveProperty('collaboratorId');
    // A lista de colaboradores continua inexistente no cliente depois do empréstimo.
    expect(await page.evaluate(() => window.App.Data.collaborators.length)).toBe(0);
  });

  test('recibo: usa os dados da movimentação autorizada, sem depender da lista de colaboradores', async ({
    page,
  }) => {
    await stubMovement(page, () =>
      okLoan('T-E2E-003', { collaborator: { name: 'Colaborador Alfa', role: 'Operador' } })
    );
    await captureReceiptTexts(page);
    await scanTool(page, 'T-E2E-003');

    const download = page.waitForEvent('download');

    await page.locator('#checkout-user-badge').fill('E2E-001');
    await page.getByRole('button', { name: 'Confirmar Empréstimo' }).click();

    expect((await download).suggestedFilename()).toBe('Termo_T-E2E-003_Colaborador_Alfa.pdf');

    const texts = await readReceiptTexts(page);

    expect(texts).toEqual(expect.arrayContaining(['Colaborador Alfa', 'E2E-001', 'Operador']));
    expect(texts).not.toContain('Não registrado');
    expect(texts).not.toContain('Não registrada');
    expect(await page.evaluate(() => window.App.Data.collaborators.length)).toBe(0);
  });

  test('crachá recusado: resposta genérica, sem dados do colaborador, formulário reaberto', async ({
    page,
    guard,
  }) => {
    const requests = await stubMovement(page, () =>
      json(422, { success: false, message: GENERIC_DENIAL, code: 'LOAN_NOT_AUTHORIZED' })
    );

    await scanTool(page, 'T-E2E-001');
    await page.locator('#checkout-user-badge').fill('E2E-999');
    await page.getByRole('button', { name: 'Confirmar Empréstimo' }).click();

    await expect(page.locator('#toast-container')).toContainText(GENERIC_DENIAL);
    await expect(page.locator('#scanner-checkout')).toBeVisible();
    await expect(page.locator('#scanner-processing')).toBeHidden();
    await expect(page.locator('#toast-container')).not.toContainText('Colaborador');
    await expect(page.locator('#scanner-status-box')).toBeHidden();
    expect(requests).toHaveLength(1);
    allowGenericDenial(guard);
  });

  test('pesquisa por nome indisponível: o nome digitado não é resolvido no cliente', async ({
    page,
    guard,
  }) => {
    const requests = await stubMovement(page, () =>
      json(422, { success: false, message: GENERIC_DENIAL, code: 'LOAN_NOT_AUTHORIZED' })
    );

    await scanTool(page, 'T-E2E-001');
    await page.locator('#checkout-user-badge').fill('Colaborador Alfa');
    await page.getByRole('button', { name: 'Confirmar Empréstimo' }).click();

    await expect(page.locator('#toast-container')).toContainText(GENERIC_DENIAL);
    // Sem lista não há como sugerir/resolver nomes: o valor segue como crachá e o servidor decide.
    expect(requests).toHaveLength(1);
    expect(requests[0].body.collaboratorBadge).toBe('Colaborador Alfa');
    expect(requests[0].body).not.toHaveProperty('collaboratorId');
    await expect(page.locator('#checkout-user-badge')).not.toHaveAttribute('list', /.+/);
    expect(await page.evaluate(() => window.App.Data.collaborators.length)).toBe(0);
    allowGenericDenial(guard);
  });

  test('devolução continua disponível e não envia colaborador', async ({ page }) => {
    const requests = await stubMovement(page, (body) =>
      json(200, {
        success: true,
        message: 'Devolução registrada.',
        data: { action: body.action, tool: { id: body.toolId, status: 'available' } },
      })
    );

    await scanTool(page, 'T-E2E-002');
    await expect(page.locator('#scanner-return')).toBeVisible();
    await expect(page.locator('#return-user-info')).toContainText('Colaborador Alfa');
    await page
      .locator('#scanner-return')
      .getByRole('button', { name: 'Devolver', exact: true })
      .click();

    await expect(page.locator('#toast-container')).toContainText('Devolução registrada.');
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({
      action: 'return',
      toolId: 'T-E2E-002',
      device: expect.any(String),
    });
  });
});

// Admin e Padrão seguem o MESMO contrato do Restrito: o crachá vai ao servidor, que resolve o
// colaborador. A lista local (que esses perfis ainda carregam) não é usada para escolher ninguém.
for (const [label, user, toolCode] of [
  ['PADRÃO', E2E_USERS.standard, 'T-E2E-001'],
  ['ADMIN', E2E_USERS.admin, 'T-E2E-003'],
]) {
  test.describe(`${label} — empréstimo por crachá resolvido no servidor`, () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, user);
      await openTab(page, 'scanner');
    });

    test('envia patrimônio lido + crachá (sem collaboratorId) e o recibo usa a resposta da API', async ({
      page,
    }) => {
      const requests = await stubMovement(page, () =>
        okLoan(toolCode, { collaborator: { name: 'Colaborador Beta', role: 'Operador' } })
      );

      await captureReceiptTexts(page);
      await scanTool(page, toolCode);
      await expect(page.locator('#checkout-user-badge')).toHaveAttribute(
        'placeholder',
        'Crachá do colaborador'
      );

      const download = page.waitForEvent('download');

      await page.locator('#checkout-user-badge').fill('E2E-002');
      await page.getByRole('button', { name: 'Confirmar Empréstimo' }).click();

      await expect(page.locator('#toast-container')).toContainText('Autorizada para Colaborador Beta');
      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({
        action: 'loan',
        toolId: toolCode,
        toolCode,
        collaboratorBadge: 'E2E-002',
        device: expect.any(String),
      });
      expect(requests[0].body).not.toHaveProperty('collaboratorId');
      expect((await download).suggestedFilename()).toBe(`Termo_${toolCode}_Colaborador_Beta.pdf`);
      expect(await readReceiptTexts(page)).toEqual(
        expect.arrayContaining(['Colaborador Beta', 'E2E-002', 'Operador'])
      );
    });

    test('nome do colaborador não substitui o crachá: vai ao servidor como crachá e é recusado', async ({
      page,
      guard,
    }) => {
      const requests = await stubMovement(page, () =>
        json(422, { success: false, message: GENERIC_DENIAL, code: 'LOAN_NOT_AUTHORIZED' })
      );

      await scanTool(page, toolCode);
      await page.locator('#checkout-user-badge').fill('Colaborador Gama');
      await page.getByRole('button', { name: 'Confirmar Empréstimo' }).click();

      await expect(page.locator('#toast-container')).toContainText(GENERIC_DENIAL);
      expect(requests).toHaveLength(1);
      expect(requests[0].body.collaboratorBadge).toBe('Colaborador Gama');
      expect(requests[0].body).not.toHaveProperty('collaboratorId');
      await expect(page.locator('#scanner-checkout')).toBeVisible();
      await expect(page.locator('#scanner-status-box')).toBeHidden();
      allowGenericDenial(guard);
    });
  });
}
