import { readFileSync, writeFileSync } from 'node:fs';

import { verifyBackupDataHash } from '../../src/js/utils/backupContract.js';
import {
  APP_TITLE,
  expect,
  expectActiveTab,
  loginAs,
  openTab,
  test,
} from './support/fixtures.js';
import { E2E_EXPECTED_COUNTS, E2E_USERS } from './support/seed-data.mjs';

// TELA "DADOS E BACKUP" (Gate 1-F1). Roda no Firebase Emulator com dados sintéticos.
//
// Restore e reset NUNCA são executados de verdade: a API de backup (Vercel + firebase-admin) é
// SIMULADA por page.route (nenhum request sai da máquina). O contrato real do servidor é coberto
// por `npm run test:backup:emulator`. O único fluxo destrutivo que confirma de fato (limpar
// histórico) está em data-backup.destructive.spec.js, que roda por último e re-semeia o emulator.
const RESTORE_API = '**/api/backup/restore';
const RESET_API = '**/api/backup/reset';

// Falha SIMULADA de propósito: o navegador registra o 500 e o app registra o erro no console.
const allowSimulatedApiFailure = (guard) => {
  guard.allow(
    /Failed to load resource: the server responded with a status of 500/,
    'API de backup simulada respondendo 500'
  );
  guard.allow(/^Erro na (reset|restauração): Falha simulada/, 'erro do app para a falha simulada');
  guard.allow(/^500 \/api\/backup\/(reset|restore)$/, 'resposta 500 simulada da API de backup');
};

const gotoHash = (page, hash) => page.evaluate((value) => (window.location.hash = value), hash);

async function openData(page) {
  // Tablet (768-1023): a navegação é um drawer aberto pelo botão da barra superior.
  const width = page.viewportSize().width;

  if (width >= 768 && width < 1024) {
    await page.locator('#btn-sidebar-toggle').click();
    await page.locator('#nav-data').click();
  } else {
    await openTab(page, 'data');
  }

  await expectActiveTab(page, 'data');
  await expect(page.locator('#data-restore-file')).toBeVisible();
  // Espera os listeners do emulator entregarem os dados (contagens do resumo e dos diálogos).
  await expect(page.locator('[data-fact="history"] .data-fact__value')).toHaveText(/^\d+$/);
  await expect(page.locator('[data-fact="tools"] .data-fact__value')).toHaveText(/^\d+$/);
}

// Sequência única de eventos (downloads e chamadas de API) para provar a ORDEM entre eles.
function trackDownloads(page) {
  const events = [];
  let seq = 0;

  page.on('download', (download) => {
    events.push({ seq: ++seq, kind: 'download', name: download.suggestedFilename() });
  });

  return {
    events,
    next: () => ++seq,
    downloads: () => events.filter((event) => event.kind === 'download').map((event) => event.name),
  };
}

// Simula a API de backup. `handler` decide a resposta; toda chamada fica registrada (sem PII).
async function mockBackupApi(page, tracker, { restore, reset, delayMs = 0 } = {}) {
  const calls = [];
  const answer = (spec) => async (route) => {
    const request = route.request();
    let body = null;

    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }

    calls.push({
      seq: tracker.next(),
      endpoint: new URL(request.url()).pathname,
      method: request.method(),
      authorization: Boolean(request.headers().authorization),
      body,
    });

    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    await route.fulfill({
      status: spec.status,
      contentType: 'application/json',
      body: JSON.stringify(spec.json),
    });
  };
  const ok = (data) => ({ status: 200, json: { success: true, data } });

  await page.route(RESTORE_API, answer(restore ?? ok({ totalRecords: 0 })));
  await page.route(RESET_API, answer(reset ?? ok({ totalDeleted: 0 })));

  return calls;
}

async function exportBackup(page, testInfo, name = 'backup-export.json') {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#data-export-backup').click(),
  ]);
  const file = testInfo.outputPath(name);

  await download.saveAs(file);

  return { file, backup: JSON.parse(readFileSync(file, 'utf8')), name: download.suggestedFilename() };
}

const confirmDialog = (page) => page.locator('#confirm-dialog');

async function typeAndConfirm(page, word) {
  await page.locator('#confirm-dialog-input').fill(word);
  await page.locator('#confirm-dialog-confirm').click();
}

test.describe('ADMIN — rota, item de navegação e estrutura da tela', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  test('item "Dados e backup" no grupo Administração; abre #/dados com título e aria-current', async ({
    page,
  }) => {
    const group = page.locator('#main-sidebar [role="group"][aria-labelledby="nav-group-admin"]');

    await expect(group.locator('.shell-nav-group-label')).toHaveText('Administração');
    await expect(group.getByRole('link', { name: 'Dados e backup', exact: true })).toBeVisible();

    await openData(page);
    await expect(page).toHaveURL(/#\/dados$/);
    await expect(page).toHaveTitle(`Dados e backup · ${APP_TITLE}`);
    await expect(page.locator('#topbar-title')).toHaveText('Dados e backup');
    await expect(page.locator('#nav-data')).toHaveAttribute('aria-current', 'page');
  });

  test('reload mantém a tela; voltar/avançar acompanham o histórico', async ({ page }) => {
    await openData(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#main-app')).toBeVisible({ timeout: 20_000 });
    await expectActiveTab(page, 'data');

    await openTab(page, 'history');
    await expectActiveTab(page, 'history');
    await page.goBack();
    await expectActiveTab(page, 'data');
    await page.goForward();
    await expectActiveTab(page, 'history');
  });

  test('deep link #/dados no login abre a tela para o administrador', async ({ page }) => {
    await page.evaluate(() => window.App.Auth.logout(true));
    await expect(page.locator('#login-screen')).toBeVisible();
    await loginAs(page, E2E_USERS.admin, { hash: '#/dados' });
    await expectActiveTab(page, 'data');
  });

  test('hierarquia de títulos e rótulos: h1 + seções h2; controles com nome acessível', async ({
    page,
  }) => {
    await openData(page);

    const screen = page.locator('#data-screen');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dados e backup');
    await expect(screen.getByRole('heading', { level: 2 })).toHaveText([
      'Resumo',
      'Backup',
      'Importação e restauração',
      'Manutenção de dados',
      'Métricas de uso',
    ]);
    await expect(screen.getByRole('heading', { level: 3 })).toHaveText([
      'O que o arquivo contém',
      'Restaurar de um backup (JSON)',
      'Importar ferramentas de uma planilha (Excel)',
      'Excluir histórico antigo',
      'Resetar dados operacionais',
    ]);
    await expect(screen.getByLabel('Arquivo de backup (.json)')).toBeAttached();
    await expect(screen.getByLabel('Planilha (.xlsx ou .xls)')).toBeAttached();

    for (const name of [
      'Exportar backup (JSON)',
      'Restaurar dados…',
      'Excluir histórico com mais de 30 dias',
      'Resetar dados operacionais…',
    ]) {
      await expect(screen.getByRole('button', { name })).toBeVisible();
    }

    // Sem onclick inline na tela nova.
    expect(await page.locator('#tab-data [onclick]').count()).toBe(0);
  });

  test('resumo e diagnóstico mostram só o que o sistema já calcula (contagens do emulator)', async ({
    page,
  }) => {
    await openData(page);

    const value = (key) => page.locator(`[data-fact="${key}"] .data-fact__value`);

    await expect(value('tools')).toHaveText(String(E2E_EXPECTED_COUNTS.tools));
    await expect(value('collaborators')).toHaveText(String(E2E_EXPECTED_COUNTS.collaborators));
    await expect(value('history')).toHaveText(String(E2E_EXPECTED_COUNTS.history));
    await expect(value('users')).toHaveText(String(E2E_EXPECTED_COUNTS.users));
    await expect(value('schema')).toContainText('4.0');
    await expect(value('uptime')).toHaveText(/\S/);
    await expect(value('errorRate')).toHaveText(/%$/);
  });
});

test.describe('ADMIN — backup (exportação, sem alterar dados)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openData(page);
  });

  test('exporta o schema v4 com hash válido; users só como referência redigida', async ({
    page,
    guard,
  }, testInfo) => {
    const { backup, name } = await exportBackup(page, testInfo);

    expect(name).toMatch(/^backup_gestao_ferramentas_v4_\d{4}-\d{2}-\d{2}\.json$/);
    expect(backup.schemaVersion).toBe('4.0');
    expect(Object.keys(backup.data).sort()).toEqual(['collaborators', 'history', 'tools']);
    expect(backup.data.users).toBeUndefined();
    expect(backup.summary.collections).toEqual({
      tools: E2E_EXPECTED_COUNTS.tools,
      collaborators: E2E_EXPECTED_COUNTS.collaborators,
      history: E2E_EXPECTED_COUNTS.history,
    });
    expect(backup.summary.usersReferenceCount).toBe(E2E_EXPECTED_COUNTS.users);
    expect(backup.reference.users.some((user) => 'lastIp' in user || 'lastDevice' in user)).toBe(false);
    expect((await verifyBackupDataHash(backup)).ok).toBe(true);

    await expect(
      page.locator('.toast-item').filter({ hasText: 'Backup exportado com sucesso' })
    ).toBeVisible();
    // Exportar é somente leitura e local: nenhuma API de backup foi chamada.
    expect(guard.apiCalls.filter((call) => call.includes('/api/backup'))).toEqual([]);
  });

  test('duplo clique em Exportar gera um único arquivo e o botão volta ao normal', async ({
    page,
  }) => {
    const tracker = trackDownloads(page);

    await page.locator('#data-export-backup').evaluate((button) => {
      button.click();
      button.click();
    });
    await expect(page.locator('#data-export-backup')).not.toHaveAttribute('aria-busy', 'true', {
      timeout: 15_000,
    });
    await expect
      .poll(() => tracker.downloads().length, { message: 'downloads' })
      .toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(500);
    expect(tracker.downloads()).toHaveLength(1);
  });

  test('durante a exportação o botão fica em carregamento e os outros controles ficam desabilitados', async ({
    page,
  }) => {
    // Atrasa a leitura das coleções do emulator apenas para observar o estado de carregamento.
    await page.evaluate(() => {
      const original = window.App.Data._generateBackup.bind(window.App.Data);

      window.App.Data._generateBackup = async (options) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        return original(options);
      };
    });

    await page.locator('#data-export-backup').click();
    await expect(page.locator('#data-export-backup')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#data-reset')).toBeDisabled();
    await expect(page.locator('#data-clean-history')).toBeDisabled();
    await expect(page.locator('#data-restore-file')).toBeDisabled();
    await expect(page.locator('#data-export-backup')).not.toHaveAttribute('aria-busy', 'true', {
      timeout: 15_000,
    });
    await expect(page.locator('#data-reset')).toBeEnabled();
  });
});

test.describe('ADMIN — importação: selecionar, validar e revisar (nada é enviado)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openData(page);
  });

  const select = (page, file) => page.locator('#data-restore-file').setInputFiles(file);
  const review = (page) => page.locator('#data-restore-review');

  for (const [title, file, expected] of [
    [
      'extensão errada',
      { name: 'backup.txt', mimeType: 'text/plain', buffer: Buffer.from('{}') },
      /extensão \.json/,
    ],
    [
      'JSON inválido',
      { name: 'quebrado.json', mimeType: 'application/json', buffer: Buffer.from('{ nao e json') },
      /não é um JSON válido/,
    ],
    [
      'schema não suportado',
      {
        name: 'futuro.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ schemaVersion: '999.0' })),
      },
      /Versão de schema não suportada/,
    ],
    [
      'formato desconhecido',
      {
        name: 'outro.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ hello: 'world' })),
      },
      /Formato não reconhecido/,
    ],
  ]) {
    test(`arquivo inválido (${title}): erro persistente associado ao campo, restauração bloqueada, sem API`, async ({
      page,
      guard,
    }) => {
      await select(page, file);

      const alert = review(page).getByRole('alert');

      await expect(alert).toContainText('Este arquivo não pode ser restaurado');
      await expect(alert).toContainText(expected);
      await expect(alert).toContainText('Nenhum dado foi alterado');
      await expect(review(page)).toContainText(file.name);

      const input = page.locator('#data-restore-file');

      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(input).toHaveAttribute('aria-describedby', /data-restore-alert/);
      await expect(page.locator('#data-restore-run')).toBeDisabled();
      await expect(page.locator('#data-restore-clear')).toBeVisible();

      expect(guard.apiCalls.filter((call) => call.includes('/api/backup'))).toEqual([]);
      expect(guard.dialogs).toEqual([]);
    });
  }

  test('nome de arquivo longo quebra dentro da tela (sem rolagem horizontal)', async ({ page }) => {
    await select(page, {
      name: `${'arquivo-com-nome-muito-longo-'.repeat(4)}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('x'),
    });
    await expect(review(page).getByRole('alert')).toBeVisible();

    const overflow = await page.evaluate(() => {
      const card = document.querySelector('.data-file');
      const scroll = document.getElementById('main-content-scroll');

      return {
        card: card.scrollWidth > card.clientWidth + 1,
        page: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        scroll: scroll.scrollWidth > scroll.clientWidth + 1,
      };
    });

    expect(overflow).toEqual({ card: false, page: false, scroll: false });
  });

  test('backup v4 válido (exportado pelo próprio sistema): resumo para revisão e restauração habilitada', async ({
    page,
    guard,
  }, testInfo) => {
    const { file } = await exportBackup(page, testInfo);

    await select(page, file);
    await expect(review(page)).toContainText('Arquivo válido');
    await expect(review(page)).toContainText('Formato 4.0');
    await expect(review(page)).toContainText(
      `${E2E_EXPECTED_COUNTS.tools} ferramenta(s), ${E2E_EXPECTED_COUNTS.collaborators} colaborador(es) e ${E2E_EXPECTED_COUNTS.history} registro(s) de histórico`
    );
    await expect(review(page)).toContainText('nunca são restaurados');
    await expect(page.locator('#data-restore-run')).toBeEnabled();
    await expect(page.locator('#data-restore-file')).not.toHaveAttribute('aria-invalid', 'true');

    // Selecionar e revisar não enviou nada nem abriu confirmação.
    expect(guard.apiCalls.filter((call) => call.includes('/api/backup'))).toEqual([]);
    await expect(confirmDialog(page)).toBeHidden();
  });

  test('backup legado 3.0 é aceito pelo adaptador e sinalizado como legado', async ({ page }) => {
    const legacy = {
      exportDate: '2026-09-01T10:00:00.000Z',
      version: '3.0',
      data: {
        tools: [
          { id: 'T-L1', code: 'T-L1', name: 'Legada', category: 'Geral', status: 'available' },
        ],
        users: [{ id: 'u1', name: 'Legado', email: 'legado@example.test', accessLevel: 'Padrão' }],
        collaborators: [{ id: 'c1', name: 'Sem Status', badge: '1', role: 'Auxiliar' }],
        history: [],
      },
    };

    await select(page, {
      name: 'legado.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(legacy)),
    });
    await expect(review(page)).toContainText('Arquivo válido');
    await expect(review(page)).toContainText('Formato 3.0');
    await expect(review(page)).toContainText('Backup legado 3.0');
    await expect(page.locator('#data-restore-run')).toBeEnabled();
  });

  test('backup mais antigo que a atividade mais recente exibe aviso na revisão', async ({
    page,
  }, testInfo) => {
    const { file, backup } = await exportBackup(page, testInfo);
    const stale = testInfo.outputPath('backup-antigo.json');

    // exportedAt não faz parte do hash de `data`: o arquivo continua íntegro, só mais antigo.
    writeFileSync(stale, JSON.stringify({ ...backup, exportedAt: '2020-01-01T00:00:00.000Z' }));
    expect(file).toBeTruthy();

    await select(page, stale);
    await expect(review(page)).toContainText('Backup mais antigo que o sistema');
    await expect(page.locator('#data-restore-run')).toBeEnabled();
  });

  test('remover o arquivo limpa a revisão e bloqueia a restauração; sair da tela descarta o arquivo', async ({
    page,
  }, testInfo) => {
    const { file } = await exportBackup(page, testInfo);

    await select(page, file);
    await expect(page.locator('#data-restore-run')).toBeEnabled();
    await page.locator('#data-restore-clear').click();
    await expect(review(page)).toBeEmpty();
    await expect(page.locator('#data-restore-run')).toBeDisabled();
    await expect(page.locator('#data-restore-file')).toBeFocused();

    await select(page, file);
    await expect(page.locator('#data-restore-run')).toBeEnabled();
    await openTab(page, 'history');
    await expectActiveTab(page, 'history');
    await openTab(page, 'data');
    await expectActiveTab(page, 'data');
    await expect(review(page)).toBeEmpty();
    await expect(page.locator('#data-restore-run')).toBeDisabled();
  });
});

test.describe('ADMIN — restauração protegida (API simulada, nenhum dado real)', () => {
  let tracker;
  let calls;
  let backupFile;
  let backupJson;

  test.beforeEach(async ({ page }, testInfo) => {
    await loginAs(page, E2E_USERS.admin);
    await openData(page);
    ({ file: backupFile, backup: backupJson } = await exportBackup(page, testInfo));
    tracker = trackDownloads(page);
    calls = null;
  });

  const arm = async (page) => {
    await page.locator('#data-restore-file').setInputFiles(backupFile);
    await expect(page.locator('#data-restore-run')).toBeEnabled();
  };

  test('cancelar o ConfirmDialog não executa nada: sem backup de segurança e sem API', async ({
    page,
    guard,
  }) => {
    calls = await mockBackupApi(page, tracker);
    await arm(page);
    await page.locator('#data-restore-run').click();

    const dialog = confirmDialog(page);

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Restaurar os dados operacionais?' })).toBeVisible();
    await expect(dialog).toContainText('SUBSTITUÍDOS');
    await expect(dialog).toContainText('nunca são restaurados');
    await expect(dialog).toContainText('Não existe botão de desfazer');
    await expect(dialog).not.toContainText(/Tem certeza/i);
    await expect(dialog.getByLabel(/Digite RESTAURAR/)).toBeFocused();
    // Ainda decidindo: o botão NÃO está em "carregando" (a operação só começa após confirmar) e os
    // demais controles ficam bloqueados.
    await expect(page.locator('#data-restore-run')).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#data-reset')).toBeDisabled();

    // O fundo não cancela; Cancelar cancela.
    await page.mouse.click(4, 4);
    await expect(dialog).toBeVisible();
    await page.locator('#confirm-dialog-cancel').click();
    await expect(dialog).toBeHidden();

    // Esc também cancela (reabrindo para provar os dois caminhos).
    await page.locator('#data-restore-run').click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.waitForTimeout(400);
    expect(calls).toEqual([]);
    expect(tracker.downloads()).toEqual([]);
    expect(guard.apiCalls.filter((call) => call.includes('/api/backup'))).toEqual([]);
    // O arquivo continua selecionado e o botão volta ao normal (foco devolvido ao botão).
    await expect(page.locator('#data-restore-run')).toBeEnabled();
    await expect(page.locator('#data-restore-run')).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#data-restore-run')).toBeFocused();
  });

  test('confirmação reforçada: palavra errada bloqueia; só "RESTAURAR" libera', async ({ page }) => {
    calls = await mockBackupApi(page, tracker);
    await arm(page);
    await page.locator('#data-restore-run').click();
    await typeAndConfirm(page, 'restaurar agora');
    await expect(page.locator('#confirm-dialog-error')).toContainText('Digite exatamente "RESTAURAR"');
    await expect(page.locator('#confirm-dialog-input')).toHaveAttribute('aria-invalid', 'true');
    await expect(confirmDialog(page)).toBeVisible();
    await page.waitForTimeout(300);
    expect(calls).toEqual([]);
    expect(tracker.downloads()).toEqual([]);
  });

  test('confirma: backup de segurança baixa ANTES da API; payload v4 sem users; sucesso persistente', async ({
    page,
  }) => {
    calls = await mockBackupApi(page, tracker, {
      restore: { status: 200, json: { success: true, data: { totalRecords: 14 } } },
    });
    await arm(page);
    await page.locator('#data-restore-run').click();
    await typeAndConfirm(page, 'RESTAURAR');

    await expect(page.locator('#data-feedback-restore')).toContainText('Concluído', { timeout: 20_000 });
    await expect(page.locator('#data-feedback-restore')).toContainText(
      'Backup restaurado e verificado: 14 registros. Usuários preservados.'
    );

    expect(calls).toHaveLength(1);

    const [call] = calls;
    const safety = tracker.events.find((event) => /^pre_restore_backup_gestao_ferramentas_v4_/.test(event.name));

    expect(call.endpoint).toBe('/api/backup/restore');
    expect(call.method).toBe('POST');
    expect(call.authorization).toBe(true);
    // A confirmação exigida pela API vai junto (a confirmação visual nunca a substitui).
    expect(call.body.confirmation).toBe('RESTORE_OPERATIONAL_DATA');
    expect(Object.keys(call.body).sort()).toEqual(['backup', 'confirmation']);
    // Users: somente referência; nada de users em `data` (writes em users durante restore = 0).
    expect(Object.keys(call.body.backup.data).sort()).toEqual(['collaborators', 'history', 'tools']);
    expect(call.body.backup.data.users).toBeUndefined();
    expect(call.body.backup.summary.dataSha256).toBe(backupJson.summary.dataSha256);
    expect(safety, 'backup de segurança pre_restore baixado').toBeTruthy();
    expect(safety.seq).toBeLessThan(call.seq);

    // Arquivo descartado depois do sucesso.
    await expect(page.locator('#data-restore-review')).toBeEmpty();
    await expect(page.locator('#data-restore-run')).toBeDisabled();
  });

  test('loading e duplo envio: um único request; demais controles bloqueados durante a operação', async ({
    page,
  }) => {
    calls = await mockBackupApi(page, tracker, { delayMs: 1200 });
    await arm(page);
    await page.locator('#data-restore-run').click();
    await page.locator('#confirm-dialog-input').fill('RESTAURAR');
    // Dois cliques no mesmo turno: o segundo cai no diálogo já fechado e não pode duplicar a operação.
    await page.locator('#confirm-dialog-confirm').evaluate((button) => {
      button.click();
      button.click();
    });

    await expect(page.locator('#data-restore-run')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#data-export-backup')).toBeDisabled();
    await expect(page.locator('#data-reset')).toBeDisabled();
    await expect(page.locator('#data-clean-history')).toBeDisabled();
    await expect(page.locator('#data-restore-file')).toBeDisabled();

    // Segundo acionamento durante a operação é recusado pela camada de dados.
    const outcome = await page.evaluate(() => window.App.Data.resetAllData());

    expect(outcome.status).toBe('busy');

    await expect(page.locator('#data-feedback-restore')).toContainText('Concluído', { timeout: 20_000 });
    expect(calls).toHaveLength(1);
    await expect(page.locator('#data-reset')).toBeEnabled();
  });

  for (const [title, json, fragment, alertTitle] of [
    [
      'revertido pelo servidor',
      { success: false, message: 'Falha simulada', applied: true, rolledBack: true },
      'o estado anterior foi restaurado automaticamente',
      'Restauração não concluída',
    ],
    [
      'não aplicada',
      { success: false, message: 'Falha simulada', applied: false },
      'não foi aplicada. Nenhum dado foi alterado',
      'Restauração não concluída',
    ],
    [
      'incidente (servidor não reverteu)',
      { success: false, message: 'Falha simulada', applied: true, rolledBack: false, incident: true },
      'INCIDENTE na restauração',
      'Incidente: ação do administrador necessária',
    ],
  ]) {
    test(`falha da API (${title}): Alert persistente com o estado real dos dados`, async ({
      page,
      guard,
    }) => {
      allowSimulatedApiFailure(guard);
      calls = await mockBackupApi(page, tracker, { restore: { status: 500, json } });
      await arm(page);
      await page.locator('#data-restore-run').click();
      await typeAndConfirm(page, 'RESTAURAR');

      const alert = page.locator('#data-feedback-restore').getByRole('alert');

      await expect(alert).toContainText(alertTitle, { timeout: 20_000 });
      await expect(alert).toContainText(fragment);
      // Não é só um toast: o aviso continua na tela e o arquivo segue selecionado para nova tentativa.
      await page.waitForTimeout(600);
      await expect(alert).toBeVisible();
      await expect(page.locator('#data-restore-run')).toBeEnabled();
      expect(calls).toHaveLength(1);
    });
  }
});

test.describe('ADMIN — reset protegido (API simulada, nenhum dado real)', () => {
  let tracker;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openData(page);
    tracker = trackDownloads(page);
  });

  test('cancelar não baixa backup nem chama API; o diálogo descreve o efeito concreto', async ({
    page,
  }) => {
    const calls = await mockBackupApi(page, tracker);

    await page.locator('#data-reset').click();

    const dialog = confirmDialog(page);

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Resetar os dados operacionais?' })).toBeVisible();
    await expect(dialog).toContainText(
      `Serão apagados: ${E2E_EXPECTED_COUNTS.tools} ferramenta(s), ${E2E_EXPECTED_COUNTS.collaborators} colaborador(es) e ${E2E_EXPECTED_COUNTS.history} registro(s) de histórico`
    );
    await expect(dialog).toContainText('Usuários e contas de acesso são preservados');
    await expect(dialog).toContainText('backup de segurança');
    await expect(dialog.getByLabel(/Digite RESETAR/)).toBeFocused();
    await page.locator('#confirm-dialog-cancel').click();
    await expect(dialog).toBeHidden();

    await page.waitForTimeout(400);
    expect(calls).toEqual([]);
    expect(tracker.downloads()).toEqual([]);
    await expect(page.locator('#data-reset')).toBeFocused();
    // Nada foi apagado do emulator.
    expect(await page.evaluate(() => window.App.Data.tools.length)).toBe(E2E_EXPECTED_COUNTS.tools);
  });

  test('por teclado: digitar RESETAR, Tab até Resetar e Enter; backup de segurança antes da API', async ({
    page,
  }) => {
    const calls = await mockBackupApi(page, tracker, {
      reset: { status: 200, json: { success: true, data: { totalDeleted: 21 } } },
    });

    await page.locator('#data-reset').focus();
    await page.keyboard.press('Enter');
    await expect(confirmDialog(page)).toBeVisible();
    await page.keyboard.type('RESETAR');
    await page.keyboard.press('Tab'); // Cancelar
    await page.keyboard.press('Tab'); // Resetar dados
    await expect(page.locator('#confirm-dialog-confirm')).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('#data-feedback-maintenance')).toContainText('Concluído', {
      timeout: 20_000,
    });
    await expect(page.locator('#data-feedback-maintenance')).toContainText(
      'Dados operacionais resetados e verificados (21 registros). Usuários preservados.'
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].endpoint).toBe('/api/backup/reset');
    expect(calls[0].body).toEqual({ confirmation: 'RESET_OPERATIONAL_DATA' });

    const safety = tracker.events.find((event) => /^pre_reset_backup_gestao_ferramentas_v4_/.test(event.name));

    expect(safety, 'backup de segurança pre_reset baixado').toBeTruthy();
    expect(safety.seq).toBeLessThan(calls[0].seq);
  });

  test('palavra errada não executa; falha do servidor fica na tela', async ({ page, guard }) => {
    allowSimulatedApiFailure(guard);

    const calls = await mockBackupApi(page, tracker, {
      reset: { status: 500, json: { success: false, message: 'Falha simulada', applied: false } },
    });

    await page.locator('#data-reset').click();
    await typeAndConfirm(page, 'resetar');
    await expect(page.locator('#confirm-dialog-error')).toContainText('Digite exatamente "RESETAR"');
    expect(calls).toEqual([]);

    await typeAndConfirm(page, 'RESETAR');
    await expect(page.locator('#data-feedback-maintenance').getByRole('alert')).toContainText(
      'A reset não foi aplicada. Nenhum dado foi alterado.',
      { timeout: 20_000 }
    );
    expect(calls).toHaveLength(1);
  });
});

test.describe('ADMIN — limpar histórico e importar Excel (confirmação, sem alterar dados)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openData(page);
  });

  test('limpar histórico: o diálogo mostra o que será removido; cancelar preserva tudo', async ({
    page,
  }) => {
    await page.locator('#data-clean-history').click();

    const dialog = confirmDialog(page);

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: /Excluir o histórico com mais de 30 dias/ })).toBeVisible();
    await expect(dialog).toContainText('Ação administrativa');
    await expect(dialog).toContainText(`${E2E_EXPECTED_COUNTS.history} registro(s) serão excluídos`);
    await expect(dialog).toContainText('Ferramentas, colaboradores, usuários');
    await expect(dialog).toContainText('Nenhum backup é gerado automaticamente');
    await expect(dialog).toContainText('Esta ação não pode ser desfeita');
    await expect(page.locator('#confirm-dialog-cancel')).toBeFocused();

    await page.locator('#confirm-dialog-cancel').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#data-clean-history')).toBeFocused();
    expect(await page.evaluate(() => window.App.Data.allHistoryLogs.length)).toBe(
      E2E_EXPECTED_COUNTS.history
    );
    await expect(page.locator('.toast-item').filter({ hasText: 'excluidos' })).toHaveCount(0);
  });

  test('limpar histórico: Esc cancela e o fundo não fecha', async ({ page }) => {
    await page.locator('#data-clean-history').click();
    await expect(confirmDialog(page)).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(confirmDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirmDialog(page)).toBeHidden();
    expect(await page.evaluate(() => window.App.Data.allHistoryLogs.length)).toBe(
      E2E_EXPECTED_COUNTS.history
    );
  });

  test('Excel: extensão inválida é recusada sem confirmar; .xlsx pede confirmação e cancelar não importa', async ({
    page,
    guard,
  }) => {
    const input = page.locator('#data-excel-file');

    await input.setInputFiles({ name: 'ferramentas.csv', mimeType: 'text/csv', buffer: Buffer.from('a') });
    await expect(page.locator('#data-feedback-excel').getByRole('alert')).toContainText(
      'Formato inválido. Use .xlsx ou .xls'
    );
    await expect(confirmDialog(page)).toBeHidden();

    await input.setInputFiles({
      name: 'ferramentas.xlsx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('nao-e-uma-planilha-real'),
    });

    const dialog = confirmDialog(page);

    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Importar ferramentas da planilha?');
    await expect(dialog).toContainText('ferramentas.xlsx');
    await expect(dialog).toContainText('linhas repetidas criam ferramentas duplicadas');
    await page.locator('#confirm-dialog-cancel').click();
    await expect(dialog).toBeHidden();
    await expect(input).toHaveValue('');
    await expect(page.locator('.toast-item').filter({ hasText: 'Importando' })).toHaveCount(0);
    expect(await page.evaluate(() => window.App.Data.tools.length)).toBe(E2E_EXPECTED_COUNTS.tools);
    // Nenhum motor de planilha foi baixado (a rede externa segue bloqueada pelo guard).
    expect(guard.blocked).toEqual([]);
  });
});

for (const [label, user] of [
  ['PADRÃO', E2E_USERS.standard],
  ['RESTRITO', E2E_USERS.restricted],
]) {
  test.describe(`${label} — sem acesso a Dados e backup`, () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, user);
    });

    test('sem item de navegação em nenhum lugar do DOM', async ({ page }) => {
      await expect(page.locator('[data-nav-id="data"]')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Dados e backup' })).toHaveCount(0);
      await expect(page.locator('#user-dropdown-menu').getByText(/Backup|Restaurar|Resetar/)).toHaveCount(0);
    });

    test('deep link #/dados é recusado no login, sem renderizar a tela nem carregar dados', async ({
      page,
      guard,
    }) => {
      await page.evaluate(() => window.App.Auth.logout(true));
      await expect(page.locator('#login-screen')).toBeVisible();
      await loginAs(page, user, { hash: '#/dados' });

      await expectActiveTab(page, 'dashboard');
      await expect(page.locator('#tab-data')).toBeHidden();
      await expect(
        page.locator('.toast-item').filter({ hasText: 'Acesso restrito a administradores' }).first()
      ).toBeVisible();

      const state = await page.evaluate(() => ({
        rendered: document.getElementById('data-screen').children.length,
        mounted: window.App.DataAdmin._mounted,
        history: window.App.Data.allHistoryLogs,
        operation: window.App.Data.isOperationRunning(),
      }));

      expect(state).toEqual({ rendered: 0, mounted: false, history: null, operation: false });
      expect(guard.apiCalls.filter((call) => call.includes('/api/backup'))).toEqual([]);
    });

    test('editar o hash para #/dados e switchTab programático são recusados', async ({ page }) => {
      await gotoHash(page, '#/dados');
      await expectActiveTab(page, 'dashboard');
      await expect(page).toHaveURL(/#\/painel$/);

      await page.evaluate(() => window.App.UI.switchTab('data'));
      await expectActiveTab(page, 'dashboard');
      await expect(page.locator('#data-screen')).toBeEmpty();
    });

    test('funções de dados chamadas direto são negadas: sem diálogo, sem download, sem API', async ({
      page,
      guard,
    }) => {
      const tracker = trackDownloads(page);
      const results = await page.evaluate(async () => {
        const data = window.App.Data;

        return {
          export: await data.exportJSON(),
          reset: await data.resetAllData(),
          clean: await data.cleanOldLogs(),
          restore: await data.restoreBackup({ ok: true, payload: { schemaVersion: '4.0' } }),
          inspect: await data.inspectBackupFile({ name: 'x.json', size: 2, text: async () => '{}' }),
        };
      });

      expect(results.export).toBeNull();
      expect(results.inspect).toBeNull();
      expect(results.reset.status).toBe('denied');
      expect(results.clean.status).toBe('denied');
      expect(results.restore.status).toBe('denied');
      await expect(confirmDialog(page)).toBeHidden();
      expect(tracker.downloads()).toEqual([]);
      expect(guard.apiCalls.filter((call) => call.includes('/api/backup'))).toEqual([]);
    });
  });
}

// Responsividade: 320, 390, 768, 1024 e 1440. Ações críticas e diálogos ficam DENTRO da viewport,
// nome de arquivo longo quebra e nada exige rolagem horizontal.
for (const width of [320, 390, 768, 1024, 1440]) {
  test(`LAYOUT ${width}px: sem rolagem horizontal; ações críticas e diálogos cabem na viewport`, async ({
    page,
  }, testInfo) => {
    const height = width < 768 ? 800 : 900;

    await page.setViewportSize({ width, height });
    await loginAs(page, E2E_USERS.admin);
    await openData(page);

    const measure = () =>
      page.evaluate(() => {
        const inside = (rect) =>
          rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.width > 0;
        const scroll = document.getElementById('main-content-scroll');
        const issues = [];

        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
          issues.push('rolagem horizontal na página');
        }

        if (scroll.scrollWidth > scroll.clientWidth + 1) {
          issues.push('rolagem horizontal na área principal');
        }

        for (const element of document.querySelectorAll(
          '#data-screen .ui-btn, #data-screen .ui-control'
        )) {
          if (element.offsetParent === null) {
            continue;
          }

          const rect = element.getBoundingClientRect();
          const name = (element.textContent || element.id).trim().slice(0, 30);

          if (!inside(rect)) {
            issues.push(
              `"${name}" fora da tela (${Math.round(rect.left)}..${Math.round(rect.right)})`
            );
          }

          if (rect.height < 39.5) {
            issues.push(`"${name}" com ${Math.round(rect.height)}px de altura (< 40)`);
          }
        }

        return issues;
      });

    expect(await measure(), `${width}px: tela`).toEqual([]);

    // Nome de arquivo longo (erro de extensão) quebra dentro do cartão.
    await page.locator('#data-restore-file').setInputFiles({
      name: `${'arquivo-com-nome-muito-longo-'.repeat(5)}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('x'),
    });
    await expect(page.locator('#data-restore-review').getByRole('alert')).toBeVisible();
    expect(await measure(), `${width}px: nome de arquivo longo`).toEqual([]);
    await page.locator('#data-restore-clear').click();

    // Botões destrutivos alcançáveis sem rolagem horizontal (rolagem vertical é esperada).
    for (const id of ['#data-clean-history', '#data-reset']) {
      await page.locator(id).scrollIntoViewIfNeeded();
      await expect(page.locator(id)).toBeInViewport();
    }

    // Diálogos: reset (campo reforçado), limpar histórico e restauração com arquivo válido.
    const { file } = await exportBackup(page, testInfo, `backup-${width}.json`);

    await page.locator('#data-restore-file').setInputFiles(file);
    await expect(page.locator('#data-restore-run')).toBeEnabled();

    for (const trigger of ['#data-reset', '#data-clean-history', '#data-restore-run']) {
      await page.locator(trigger).scrollIntoViewIfNeeded();
      await page.locator(trigger).click();

      const dialog = confirmDialog(page);

      await expect(dialog).toBeVisible();

      const fits = await page.evaluate(() => {
        const dialogBox = document.getElementById('confirm-dialog').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('#confirm-dialog .ui-btn')].map((button) =>
          button.getBoundingClientRect()
        );
        const within = (rect) =>
          rect.left >= -1 &&
          rect.top >= -1 &&
          rect.right <= window.innerWidth + 1 &&
          rect.bottom <= window.innerHeight + 1;

        return { dialog: within(dialogBox), buttons: buttons.every(within), count: buttons.length };
      });

      expect(fits, `${width}px: diálogo de ${trigger}`).toEqual({
        dialog: true,
        buttons: true,
        count: 2,
      });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  });
}

test.describe('ADMIN — tema escuro usa os tokens do design system', () => {
  test('cores vêm dos tokens (superfície, texto e perigo) e a tela funciona no escuro', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await loginAs(page, E2E_USERS.admin);
    await openData(page);
    await expect(page.locator('html')).toHaveClass(/dark/);

    const colors = await page.evaluate(() => {
      const css = (selector, property) =>
        getComputedStyle(document.querySelector(selector))[property];
      const token = (name) => {
        const probe = document.createElement('span');

        probe.style.color = `var(${name})`;
        document.body.appendChild(probe);

        const value = getComputedStyle(probe).color;

        probe.remove();
        return value;
      };

      return {
        card: [css('#data-screen .ui-card', 'backgroundColor'), token('--color-surface')],
        fact: [css('#data-screen .data-fact', 'backgroundColor'), token('--color-surface-muted')],
        title: [css('#data-screen .data-section__title', 'color'), token('--color-text-primary')],
        danger: [css('#data-reset', 'backgroundColor'), token('--color-danger')],
        onDanger: [css('#data-reset', 'color'), token('--color-on-danger')],
        border: [
          css('#data-screen .data-section--danger > .ui-card', 'borderTopColor'),
          token('--color-danger'),
        ],
      };
    });

    for (const [name, [actual, expected]] of Object.entries(colors)) {
      expect(actual, `token ${name}`).toBe(expected);
    }

    // O diálogo também responde ao tema (superfície elevada do escuro: #1e293b).
    await page.locator('#data-reset').click();
    await expect(confirmDialog(page)).toBeVisible();
    expect(
      await confirmDialog(page).evaluate((element) => getComputedStyle(element).backgroundColor)
    ).toBe('rgb(30, 41, 59)');
    await page.keyboard.press('Escape');
  });
});
