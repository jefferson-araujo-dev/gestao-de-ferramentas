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

  // Gate 1-F4.C4-FIX1: leitura repetida do mesmo código depois de 404/409/429 é ignorada por um
  // intervalo (cooldown), para a câmera parada diante de uma etiqueta não cadastrada não esgotar o
  // limite do servidor. Leitura ignorada não gera requisição, toast, Recentes nem estatística.
  test('cooldown: mesmo código sem resultado não gera nova consulta; outro código passa; reset libera', async ({
    page,
    guard,
  }) => {
    const input = page.locator('#manual-scan-input');
    const scan = async (code) => {
      await input.fill(code);
      await input.press('Enter');
    };
    const requestedCodes = () => statusRequests.map((request) => request.body.code);
    const recentItems = page.locator('#recent-scans-list .recent-scan-item');
    const notFoundToasts = page.locator('.toast-item').filter({ hasText: 'Patrimônio não localizado.' });

    await scan('T-NAO-EXISTE');
    await expect(notFoundToasts).toHaveCount(1);
    await expect(recentItems).toHaveCount(1);
    await expect(page.locator('#stat-scans-today')).toHaveText('1');

    for (let index = 0; index < 4; index += 1) {
      await scan('T-NAO-EXISTE');
    }

    // Código diferente segue normalmente; quando ele aparece, as leituras anteriores já terminaram.
    await scanTool(page, 'T-E2E-001');
    expect(requestedCodes()).toEqual(['T-NAO-EXISTE', 'T-E2E-001']);
    await expect(notFoundToasts).toHaveCount(1);
    await expect(recentItems).toHaveCount(2);
    await expect(page.locator('#stat-scans-today')).toHaveText('2');

    // "Nova operação"/"Cancelar" (reset) libera o cooldown: a mesma leitura volta a consultar.
    await page.evaluate(() => window.App.Scanner.reset());
    await scan('T-NAO-EXISTE');
    await expect.poll(requestedCodes).toEqual(['T-NAO-EXISTE', 'T-E2E-001', 'T-NAO-EXISTE']);
    await expect(recentItems).toHaveCount(3);

    // Dentro do intervalo, ignorada de novo; vencido o intervalo, consulta outra vez.
    await scan('T-NAO-EXISTE');
    const cooldown = await page.evaluate(() => {
      const until = window.App.Scanner._lookupCooldown.get('T-NAO-EXISTE');

      window.App.Scanner._lookupCooldown.set('T-NAO-EXISTE', Date.now() - 1);
      return until - Date.now();
    });

    expect(cooldown).toBeGreaterThan(7000);
    expect(cooldown).toBeLessThanOrEqual(10000);
    await scan('T-NAO-EXISTE');
    await expect.poll(requestedCodes).toHaveLength(4);
    await expect(recentItems).toHaveCount(4);

    allowDenial(guard, 404, '/api/tools/status');
  });

  test('cooldown só depois de 404/409/429; Recentes só registra "Não encontrado" para 404', async ({
    page,
    guard,
  }) => {
    const RATE_LIMITED = 'Muitas consultas sem resultado. Aguarde e tente novamente.';
    const DUPLICATED = 'Patrimônio duplicado. Contate o administrador.';
    const ACCESS_DENIED = 'Sessão expirada ou acesso não permitido. Entre novamente.';
    const LOOKUP_FAILED = 'Falha ao consultar a ferramenta. Tente novamente.';

    const requests = await stubToolStatus(page, {
      failures: {
        'T-DUP': json(409, { success: false, message: DUPLICATED }),
        // Ferramenta REAL barrada pelo limite: não pode virar "Não encontrado".
        'T-E2E-001': json(429, { success: false, message: RATE_LIMITED, code: 'TOOL_LOOKUP_RATE_LIMITED' }),
        'T-401': json(401, { success: false, message: 'DETALHE-INTERNO-401' }),
        'T-403': json(403, { success: false, message: 'DETALHE-INTERNO-403' }),
        'T-500': json(500, { success: false, message: 'DETALHE-INTERNO-500' }),
        'T-503': json(503, { success: false, message: 'DETALHE-INTERNO-503' }),
      },
    });

    // Falha de rede: a requisição nem chega a uma resposta.
    await page.route('**/api/tools/status', async (route) => {
      if (route.request().postDataJSON().code === 'T-REDE') {
        requests.push({ body: { code: 'T-REDE' } });
        await route.abort('failed');
        return;
      }
      await route.fallback();
    });

    const input = page.locator('#manual-scan-input');
    const recentList = page.locator('#recent-scans-list');
    const countFor = (code) => requests.filter((request) => request.body.code === code).length;

    const cases = [
      ['T-DUP', DUPLICATED, 1],
      ['T-E2E-001', RATE_LIMITED, 1],
      ['T-401', ACCESS_DENIED, 2],
      ['T-403', ACCESS_DENIED, 2],
      ['T-500', LOOKUP_FAILED, 2],
      ['T-503', LOOKUP_FAILED, 2],
      ['T-REDE', LOOKUP_FAILED, 2],
    ];

    for (const [code, message, expectedRequests] of cases) {
      const toasts = page.locator('.toast-item').filter({ hasText: message });

      // Lido duas vezes: só 409/429 entram em cooldown (a segunda leitura não consulta).
      for (let read = 0; read < 2; read += 1) {
        await input.fill(code);
        await input.press('Enter');
        await expect(toasts).toHaveCount(Math.min(read + 1, expectedRequests));
      }

      await expect.poll(() => countFor(code), { message: code }).toBe(expectedRequests);
      await expect(page.locator('#scanner-result')).toBeHidden();
      await expect(recentList).not.toContainText(code);
      await expect(page.locator('#toast-container')).not.toContainText('Patrimônio não localizado.');
      await expect(page.locator('#toast-container')).not.toContainText('DETALHE-INTERNO');

      // O contêiner mostra no máximo 5 toasts por vez (NotificationManager): fecha os deste caso.
      for (const button of await page.locator('.toast-item [data-dismiss]').all()) {
        await button.click();
      }
      await expect(page.locator('.toast-item')).toHaveCount(0);
    }

    await expect(page.locator('#recent-scans-list .recent-scan-item')).toHaveCount(0);

    // 404: único caso registrado como "Não encontrado".
    await input.fill('T-NAO-EXISTE');
    await input.press('Enter');
    await expect(page.locator('.toast-item').filter({ hasText: 'Patrimônio não localizado.' })).toHaveCount(1);
    await expect(page.locator('#recent-scans-list .recent-scan-item')).toHaveCount(1);
    await expect(recentList).toContainText('T-NAO-EXISTE');
    await expect(recentList).toContainText('Não Encontrado');

    for (const status of [401, 403, 404, 409, 429, 500, 503]) {
      allowDenial(guard, status, '/api/tools/status');
    }
    guard.allow(/ERR_FAILED/, 'falha de rede simulada de propósito em /api/tools/status (T-REDE)');
  });

  // O cooldown só nasce com a resposta: com rede lenta, releituras do mesmo código enquanto a
  // consulta está pendente também não podem gerar novas consultas (nem novas falhas no servidor).
  test('consulta pendente: releitura do mesmo código não gera nova consulta; resposta tardia segue valendo', async ({
    page,
    guard,
  }) => {
    const requests = [];

    await page.route('**/api/tools/status', async (route) => {
      requests.push(route.request().postDataJSON().code);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Ferramenta não encontrada.' }),
      });
    });

    const input = page.locator('#manual-scan-input');

    for (let read = 0; read < 3; read += 1) {
      await input.fill('T-LENTO');
      await input.press('Enter');
      await page.waitForTimeout(200);
    }

    await expect(page.locator('.toast-item').filter({ hasText: 'Patrimônio não localizado.' })).toHaveCount(1);
    await expect(page.locator('#recent-scans-list .recent-scan-item')).toHaveCount(1);
    await expect(page.locator('#stat-scans-today')).toHaveText('1');

    // Já respondido: segue em cooldown.
    await input.fill('T-LENTO');
    await input.press('Enter');
    await page.waitForTimeout(300);
    expect(requests).toEqual(['T-LENTO']);

    allowDenial(guard, 404, '/api/tools/status');
  });

  // A câmera para a cada leitura; leitura ignorada pelo cooldown religa a câmera só quando não há
  // operação aberta nem consulta em andamento, e nunca duas religações simultâneas. Sem câmera real
  // no E2E: startCamera é substituída por um contador só dentro deste teste.
  test('cooldown com câmera: leitura ignorada religa a câmera uma vez, sem operação nem consulta pendente', async ({
    page,
    guard,
  }) => {
    await page.locator('#manual-scan-input').fill('T-NAO-EXISTE');
    await page.locator('#manual-scan-input').press('Enter');
    await expect(page.locator('.toast-item').filter({ hasText: 'Patrimônio não localizado.' })).toHaveCount(1);

    const starts = await page.evaluate(async () => {
      const scanner = window.App.Scanner;
      const originalStart = scanner.startCamera;
      const result = {};
      let count = 0;

      scanner.startCamera = () => {
        count += 1;
        return new Promise((resolve) => setTimeout(resolve, 300));
      };
      scanner.currentMode = 'cam';

      // Duas leituras ignoradas seguidas: só uma religação enquanto a primeira está em curso.
      await scanner.processCode('T-NAO-EXISTE');
      await scanner.processCode('T-NAO-EXISTE');
      result.idle = count;
      await new Promise((resolve) => setTimeout(resolve, 400));

      scanner._lookupsInFlight += 1;
      await scanner.processCode('T-NAO-EXISTE');
      scanner._lookupsInFlight -= 1;
      result.lookupPending = count;

      scanner.currentTool = { code: 'T-OUTRA' };
      await scanner.processCode('T-NAO-EXISTE');
      scanner.currentTool = null;
      result.operationOpen = count;

      await scanner.processCode('T-NAO-EXISTE');
      result.idleAgain = count;

      scanner.startCamera = originalStart;
      scanner.currentMode = 'usb';
      return result;
    });

    expect(starts).toEqual({ idle: 1, lookupPending: 1, operationOpen: 1, idleAgain: 2 });
    expect(statusRequests.map((request) => request.body.code)).toEqual(['T-NAO-EXISTE']);
    await expect(page.locator('#recent-scans-list .recent-scan-item')).toHaveCount(1);

    allowDenial(guard, 404, '/api/tools/status');
  });

  test('429 durante uma operação em andamento: volta à espera, sem operação aberta nem Recentes', async ({
    page,
    guard,
  }) => {
    const RATE_LIMITED = 'Muitas consultas sem resultado. Aguarde e tente novamente.';

    await stubToolStatus(page, {
      failures: {
        'T-LIMITE': json(429, { success: false, message: RATE_LIMITED, code: 'TOOL_LOOKUP_RATE_LIMITED' }),
      },
    });

    await scanTool(page, 'T-E2E-001');
    await expect(page.locator('#scanner-checkout')).toBeVisible();
    await page.locator('#checkout-user-badge').fill('e2e-002');

    // Leitura que chega com a operação aberta (ex.: leitor USB) e é barrada pelo limite.
    await page.evaluate(() => window.App.Scanner.processCode('T-LIMITE'));

    await expect(page.locator('.toast-item').filter({ hasText: RATE_LIMITED })).toHaveCount(1);
    await expect(page.locator('#scanner-result')).toBeHidden();
    await expect(page.locator('#scanner-waiting')).toBeVisible();
    await expect(page.locator('#scanner-checkout')).toBeHidden();
    await expect(page.locator('#scanner-processing')).toBeHidden();
    await expect(page.locator('#checkout-user-badge')).toHaveValue('');
    expect(await page.evaluate(() => window.App.Scanner.currentTool)).toBeNull();
    await expect(page.locator('#recent-scans-list .recent-scan-item')).toHaveCount(1);
    await expect(page.locator('#recent-scans-list')).not.toContainText('T-LIMITE');

    allowDenial(guard, 429, '/api/tools/status');
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

// Gate 1-F4.C4-FIX1: o cooldown de leitura e as mensagens por status valem só para o caminho do
// Restrito. Admin e Padrão continuam com a busca local síncrona: código desconhecido lido de novo
// gera nova mensagem e nova entrada "Não encontrado", sem nenhuma chamada a /api/tools/status (o
// guard falharia o teste com "chamada de API inesperada").
for (const profile of ['admin', 'standard']) {
  test.describe(`${profile.toUpperCase()} — busca local sem cooldown (Gate 1-F4.C4-FIX1)`, () => {
    test('código desconhecido repetido: toast e "Não encontrado" a cada leitura, sem endpoint', async ({
      page,
      guard,
    }) => {
      await loginAs(page, E2E_USERS[profile]);
      await openTab(page, 'scanner');
      await expectActiveTab(page, 'scanner');
      await expect
        .poll(() => page.evaluate(() => window.App.Data.toolsLoaded && window.App.Data.tools.length))
        .toBeGreaterThan(0);

      const input = page.locator('#manual-scan-input');

      for (let read = 1; read <= 3; read += 1) {
        await input.fill('T-NAO-EXISTE');
        await input.press('Enter');
        await expect(
          page.locator('.toast-item').filter({ hasText: 'Patrimônio não localizado.' })
        ).toHaveCount(read);
        await expect(page.locator('#recent-scans-list .recent-scan-item')).toHaveCount(read);
        await expect(page.locator('#stat-scans-today')).toHaveText(String(read));
      }

      await expect(page.locator('#recent-scans-list')).toContainText('Não Encontrado');
      expect(await page.evaluate(() => window.App.Scanner._lookupCooldown.size)).toBe(0);
      expect(guard.apiCalls.filter((call) => call.endsWith('/api/tools/status'))).toEqual([]);

      // Ferramenta válida segue pela busca local, com o mesmo fluxo de antes.
      await scanTool(page, 'T-E2E-001');
      await expect(page.locator('#scanner-checkout')).toBeVisible();
    });
  });
}
