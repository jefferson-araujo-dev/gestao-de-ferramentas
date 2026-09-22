import { expect, expectActiveTab, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// Empréstimo e devolução no Scanner. A função Vercel /api/tools/movement NÃO existe no servidor
// de desenvolvimento do E2E: aqui ela é substituída por um stub na página que registra o
// payload EXATO enviado pelo app e responde como o servidor real (o servidor de verdade é
// coberto por tests/integration/movementEmulator.test.mjs). Nenhum dado do emulator muda.
//
// Contrato unificado (Gate 1-F3.2B): TODOS os perfis (Admin, Padrão, Restrito) enviam
//   { action: 'loan', toolId, toolCode, collaboratorBadge, device }
// O cliente NUNCA resolve o colaborador localmente (nem por crachá, nem por nome) e NUNCA envia
// collaboratorId. O servidor resolve o crachá; Admin/Padrão recebem mensagens específicas de
// erro (visíveis nos testes desta suíte), Restrito recebe sempre a mesma resposta genérica.
const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const GENERIC_DENIAL = 'Não foi possível autorizar a retirada. Confira o crachá informado.';
const NOT_FOUND_DENIAL = 'Colaborador não encontrado.';

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

// A negação genérica/específica do servidor usa um status de erro (422/404/...): o navegador
// registra esse status como erro de rede. Só o caso esperado é retirado do guard; qualquer outro
// erro continua falhando.
function allowDenial(guard, status) {
  guard.badResponses = guard.badResponses.filter((entry) => entry !== `${status} /api/tools/movement`);
  guard.consoleErrors = guard.consoleErrors.filter((entry) => !new RegExp(`status of ${status}`).test(entry));
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

  test('empréstimo: pede o crachá exato e envia toolCode + collaboratorBadge (sem lista, sem ID)', async ({
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
    allowDenial(guard, 422);
  });

  test('nome no lugar do crachá não é resolvido no cliente: segue como texto para o servidor decidir', async ({
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
    allowDenial(guard, 422);
  });

  test('devolução continua disponível e não envia colaborador nem toolCode', async ({ page }) => {
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

test.describe('PADRÃO — mesmo contrato por crachá (sem resolução local, sem nome, sem ID)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.standard);
    await openTab(page, 'scanner');
    await expectActiveTab(page, 'scanner');
  });

  test('empréstimo: envia toolCode + collaboratorBadge, nunca collaboratorId', async ({ page }) => {
    const requests = await stubMovement(page, () =>
      okLoan('T-E2E-001', { collaborator: { name: 'Colaborador Beta', role: 'Operador' } })
    );

    await captureReceiptTexts(page);
    await scanTool(page, 'T-E2E-001');
    await expect(page.locator('#checkout-user-badge')).toHaveAttribute(
      'placeholder',
      'Crachá do colaborador'
    );

    const download = page.waitForEvent('download');

    await page.locator('#checkout-user-badge').fill('e2e-002');
    await page.getByRole('button', { name: 'Confirmar Empréstimo' }).click();

    await expect(page.locator('#toast-container')).toContainText('Autorizada para Colaborador Beta');
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({
      action: 'loan',
      toolId: 'T-E2E-001',
      toolCode: 'T-E2E-001',
      collaboratorBadge: 'e2e-002',
      device: expect.any(String),
    });
    expect(requests[0].body).not.toHaveProperty('collaboratorId');
    expect((await download).suggestedFilename()).toBe('Termo_T-E2E-001_Colaborador_Beta.pdf');
    // O recibo mostra exatamente o que foi digitado (o cliente não resolve mais contra o cadastro
    // local para exibir a grafia "canônica" do crachá): mesmo comportamento do perfil restrito.
    expect(await readReceiptTexts(page)).toEqual(
      expect.arrayContaining(['Colaborador Beta', 'e2e-002', 'Operador'])
    );
  });

  test('nome do colaborador não substitui o crachá: rejeitado com mensagem específica do servidor', async ({
    page,
    guard,
  }) => {
    const requests = await stubMovement(page, () =>
      json(404, { success: false, message: NOT_FOUND_DENIAL })
    );

    await scanTool(page, 'T-E2E-005');
    await page.locator('#checkout-user-badge').fill('Colaborador Gama');
    await page.getByRole('button', { name: 'Confirmar Empréstimo' }).click();

    await expect(page.locator('#toast-container')).toContainText(NOT_FOUND_DENIAL);
    expect(requests).toHaveLength(1);
    expect(requests[0].body.collaboratorBadge).toBe('Colaborador Gama');
    expect(requests[0].body).not.toHaveProperty('collaboratorId');
    allowDenial(guard, 404);
  });
});
