import { expect, expectActiveTab, loginAs, openTab, test } from './support/fixtures.js';
import { readFileSync } from 'node:fs';

import { E2E_TOOLS, E2E_USERS } from './support/seed-data.mjs';

// Versão que o app envia em X-App-Version (vite.config.js `define`, a partir de package.json).
const APP_VERSION = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version;

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
function allowDenial(guard, status, path = '/api/tools/movement') {
  guard.badResponses = guard.badResponses.filter((entry) => entry !== `${status} ${path}`);
  guard.consoleErrors = guard.consoleErrors.filter((entry) => !new RegExp(`status of ${status}`).test(entry));
}

// Gate 1-F4.C4, Decisão 1 (B1): a função Vercel /api/tools/status também não existe no servidor de
// desenvolvimento do E2E — igual a stubMovement, substituída por um stub que responde com os
// mesmos dados sintéticos do seed (E2E_TOOLS), na mesma lista fechada de campos do endpoint real
// (nunca currentUser/currentCollaboratorId). O id do documento é igual ao código no seed
// (tests/e2e/support/global-setup.mjs), então `data.tool.id === body.code` para os fixtures.
// `overrides` sobrepõe campos sintéticos por código (ex.: manutenção vencida); `failures` força uma
// resposta de erro por código. O endpoint real é coberto por toolStatusEmulator.test.mjs e pela
// validação visual com round-trip real (REPORT do Gate 1-F4.C4).
async function stubToolStatus(page, { overrides = {}, failures = {} } = {}) {
  const requests = [];

  await page.route('**/api/tools/status', async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    const tool = E2E_TOOLS[body.code] && { ...E2E_TOOLS[body.code], ...overrides[body.code] };

    requests.push({
      method: request.method(),
      authorization: request.headers().authorization,
      appVersion: request.headers()['x-app-version'],
      body,
    });

    if (failures[body.code]) {
      const { status, payload } = failures[body.code];

      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
      return;
    }

    if (!tool) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Ferramenta não encontrada.' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          tool: {
            id: body.code,
            code: tool.code,
            name: tool.name,
            category: tool.category,
            status: tool.status,
            imageUrl: tool.imageUrl,
            nextMaintenance: tool.nextMaintenance,
          },
        },
      }),
    });
  });

  return requests;
}

async function scanTool(page, code) {
  const input = page.locator('#manual-scan-input');
  const isRestricted = await page.evaluate(() => window.App.Auth.isRestricted === true);

  // Admin/Padrão: as ferramentas chegam por listener logo após o login, só escaneia com a lista
  // carregada. Restrito (Gate 1-F4.C4): não há listener de `tools`; a busca é feita por
  // /api/tools/status (stubToolStatus), sem lista local para esperar.
  if (!isRestricted) {
    await expect
      .poll(() => page.evaluate(() => window.App.Data.toolsLoaded && window.App.Data.tools.length))
      .toBeGreaterThan(0);
  }

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
  let statusRequests;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.restricted);
    await openTab(page, 'scanner');
    await expectActiveTab(page, 'scanner');
    statusRequests = await stubToolStatus(page);
  });

  // Gate 1-F4.C4 (Decisões 1 e 7): contrato da chamada ao endpoint de status feita pelo cliente.
  test('consulta: POST /api/tools/status com Bearer, X-App-Version e só o código; nenhum listener', async ({
    page,
  }) => {
    await scanTool(page, 'T-E2E-001');

    expect(statusRequests).toHaveLength(1);
    expect(statusRequests[0]).toEqual({
      method: 'POST',
      authorization: expect.stringMatching(/^Bearer \S+/),
      appVersion: APP_VERSION,
      body: { code: 'T-E2E-001' },
    });
    expect(
      await page.evaluate(() => ({
        listeners: window.App.Data.listeners.length,
        tools: window.App.Data.tools.length,
      }))
    ).toEqual({ listeners: 0, tools: 0 });
    // "Ver detalhes" leva a Ferramentas, que não existe para o Restrito.
    await expect(page.locator('#scanner-quick-actions')).toBeHidden();
  });

  test('miniatura e manutenção vencida vêm do endpoint: aviso e bloqueio antes do crachá', async ({
    page,
  }) => {
    const imageUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';

    await stubToolStatus(page, {
      overrides: {
        'T-E2E-001': { imageUrl },
        'T-E2E-007': { nextMaintenance: '2020-01-01' },
      },
    });

    await scanTool(page, 'T-E2E-001');
    await expect(page.locator('#res-image-container img')).toHaveAttribute('src', imageUrl);
    await expect(page.locator('#scanner-checkout')).toBeVisible();

    // Encerra a operação (volta à espera, onde fica o campo manual) antes da próxima leitura.
    await page.evaluate(() => window.App.Scanner.reset());
    await scanTool(page, 'T-E2E-007');
    await expect(page.locator('#toast-container')).toContainText(
      'Empréstimo bloqueado: Ferramenta com revisão/calibração vencida.'
    );
    await expect(page.locator('#scanner-blocked')).toBeVisible();
    await expect(page.locator('#scanner-checkout')).toBeHidden();
  });

  test('não localizada, duplicada e excesso de consultas: mensagens fixas, sem dado pessoal', async ({
    page,
    guard,
  }) => {
    const RATE_LIMITED = 'Muitas consultas sem resultado. Aguarde e tente novamente.';
    const DUPLICATED = 'Patrimônio duplicado. Contate o administrador.';

    await stubToolStatus(page, {
      failures: {
        'T-DUP': json(409, { success: false, message: DUPLICATED }),
        'T-LIMITE': json(429, { success: false, message: RATE_LIMITED, code: 'TOOL_LOOKUP_RATE_LIMITED' }),
      },
    });

    const input = page.locator('#manual-scan-input');

    for (const [code, message] of [
      ['T-NAO-EXISTE', 'Patrimônio não localizado.'],
      ['T-DUP', DUPLICATED],
      ['T-LIMITE', RATE_LIMITED],
    ]) {
      await input.fill(code);
      await input.press('Enter');
      await expect(page.locator('.toast-item').filter({ hasText: message }).first()).toBeVisible();
      await expect(page.locator('#scanner-result')).toBeHidden();
    }

    await expect(page.locator('#toast-container')).not.toContainText('Colaborador');

    for (const status of [404, 409, 429]) {
      allowDenial(guard, status, '/api/tools/status');
    }
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

    // Restrito: comprovante operacional, sem nome do colaborador (E.1 do plano de contenção).
    await expect(page.locator('#toast-container')).toContainText('Empréstimo registrado.');
    await expect(page.locator('#toast-container')).not.toContainText('Colaborador');
    await expect(page.locator('#scanner-status-box')).not.toContainText('Colaborador');

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

  test('recibo: comprovante operacional, sem nome/crachá/função/ID do colaborador (E.1)', async ({
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

    expect((await download).suggestedFilename()).toMatch(/^Comprovante_T-E2E-003_\d{8}-\d{4}\.pdf$/);

    const texts = await readReceiptTexts(page);

    expect(texts).toEqual(expect.arrayContaining(['T-E2E-003', 'Martelo', 'Empréstimo']));
    expect(texts).not.toContain('Colaborador Alfa');
    expect(texts).not.toContain('E2E-001');
    expect(texts).not.toContain('Operador');
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

  // Gate 1-F4.C3: a devolução passa a exigir a conferência de crachá de quem está devolvendo,
  // para todos os perfis — substitui o teste anterior ("devolução continua disponível e não envia
  // colaborador nem toolCode"), que exercitava o contrato antigo (sem crachá).
  test('devolução: exige o crachá de quem está devolvendo; envia collaboratorBadge, sem toolCode', async ({
    page,
  }) => {
    const requests = await stubMovement(page, (body) =>
      json(200, {
        success: true,
        message: 'Devolução registrada.',
        data: { action: body.action, tool: { id: body.toolId, status: 'available' } },
      })
    );

    await scanTool(page, 'T-E2E-002');
    await expect(page.locator('#scanner-return')).toBeVisible();
    // Gate 1-F4.C4, Decisão 1 (B1): o endpoint de status nunca devolve currentUser — "Responsável
    // atual" não aparece mais em nenhuma forma para o Restrito (substitui o achado do REPORT do C3,
    // que mostrava "Responsável atual: Colaborador Alfa" nesta mesma tela).
    await expect(page.locator('#return-user-info')).toBeEmpty();
    await expect(page.locator('#return-user-info')).toBeHidden();

    // Restrito: sem caminho de devolução administrativa (decisão do Cowork em 1-F4.C3).
    await expect(page.locator('#btn-return-admin-open')).toBeHidden();

    await page.locator('#return-user-badge').fill('E2E-001');
    await page
      .locator('#scanner-return')
      .getByRole('button', { name: 'Devolver', exact: true })
      .click();

    await expect(page.locator('#toast-container')).toContainText('Devolução registrada.');
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({
      action: 'return',
      toolId: 'T-E2E-002',
      collaboratorBadge: 'E2E-001',
      device: expect.any(String),
    });
  });

  test('devolução: NÃO CONFERE mostra mensagem operacional, sem dado pessoal, e reabre o formulário', async ({
    page,
    guard,
  }) => {
    const NOT_CONFIRMED = 'Crachá não confere com o registro do empréstimo.';
    const requests = await stubMovement(page, () =>
      json(422, { success: false, message: NOT_CONFIRMED, code: 'RETURN_NOT_CONFIRMED' })
    );

    await scanTool(page, 'T-E2E-002');
    await page.locator('#return-user-badge').fill('E2E-999');
    await page
      .locator('#scanner-return')
      .getByRole('button', { name: 'Devolver', exact: true })
      .click();

    await expect(page.locator('#return-error')).toContainText(NOT_CONFIRMED);
    await expect(page.locator('#return-error')).not.toContainText('Colaborador');
    await expect(page.locator('#scanner-return')).toBeVisible();
    await expect(page.locator('#scanner-processing')).toBeHidden();
    expect(requests).toHaveLength(1);
    allowDenial(guard, 422);
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

  // Gate 1-F4.C3: devolução administrativa — disponível para Padrão (decisão do Cowork), ignora a
  // conferência de crachá e exige motivo.
  test('devolução administrativa: disponível para Padrão, sem conferência de crachá, com motivo obrigatório', async ({
    page,
  }) => {
    const requests = await stubMovement(page, (body) =>
      json(200, {
        success: true,
        message: 'Devolução registrada.',
        data: { action: body.action, tool: { id: body.toolId, status: 'available' } },
      })
    );

    await scanTool(page, 'T-E2E-002');
    await expect(page.locator('#scanner-return')).toBeVisible();
    await expect(page.locator('#btn-return-admin-open')).toBeVisible();

    await page.locator('#btn-return-admin-open').click();
    await expect(page.locator('#return-admin-step')).toBeVisible();
    await expect(page.locator('#return-badge-step')).toBeHidden();

    await page.getByRole('button', { name: 'Confirmar devolução' }).click();
    await expect(page.locator('#return-error')).toContainText('pelo menos 10 caracteres');
    expect(requests).toHaveLength(0);

    await page
      .locator('#return-admin-reason')
      .fill('Colaborador de férias; devolução feita pelo supervisor do setor.');
    await page.getByRole('button', { name: 'Confirmar devolução' }).click();

    await expect(page.locator('#toast-container')).toContainText(
      'Devolução administrativa registrada.'
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({
      action: 'return_admin',
      toolId: 'T-E2E-002',
      reason: 'Colaborador de férias; devolução feita pelo supervisor do setor.',
      device: expect.any(String),
    });
  });
});
