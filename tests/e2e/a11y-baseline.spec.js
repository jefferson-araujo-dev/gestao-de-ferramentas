import AxeBuilder from '@axe-core/playwright';

import {
  AXE_TAGS,
  UPDATE_BASELINE,
  findRegressions,
  freezeMotion,
  loadBaseline,
  saveBaseline,
  scan,
  summarize,
} from './support/axe.js';
import {
  assertEmulatorConnected,
  expect,
  loginAs,
  openTab,
  openUserMenu,
  test,
} from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// Baseline de acessibilidade (axe) pré-redesign, tema claro. Falha somente por REGRESSÃO
// em relação ao baseline versionado (regra nova, impacto maior ou mais nós).
// Atualizar de propósito: UPDATE_AXE_BASELINE=1 (registrar a razão no commit).
test.describe.configure({ mode: 'serial' });

const collected = {};
let axeVersion = 'desconhecida';

async function check(page, project, screen) {
  const { violations, axeVersion: version } = await scan(page);

  axeVersion = version;
  collected[screen] = violations;

  if (!UPDATE_BASELINE) {
    const regressions = findRegressions(loadBaseline(project).screens[screen], violations);

    expect(regressions, `regressões de acessibilidade em "${screen}"`).toEqual([]);
  }
}

// Gate 1-F1: a varredura de página inteira inclui o cabeçalho do shell (#network-status-text, texto
// 10px em slate-400, contraste anterior a este gate e presente em todas as telas). Para a tela nova,
// a varredura restrita ao seu próprio conteúdo/diálogo não pode ter NENHUMA violação.
async function expectScopedClean(page, selector, label) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(AXE_TAGS).analyze();

  expect(
    results.violations.map((violation) => `${violation.id}: ${violation.nodes.length} nó(s)`),
    `axe restrito a ${selector} (${label})`
  ).toEqual([]);
}

test.describe('AXE — baseline (desktop, tema claro; atualizado no Gate 1-D para o shell novo)', () => {
  test.afterAll(async ({}, testInfo) => {
    if (UPDATE_BASELINE) {
      saveBaseline(testInfo.project.name, collected, axeVersion);
    }

    const { perImpact, uniqueByImpact } = summarize(collected);

    console.log(`EVIDENCE AXE_SCREENS=${Object.keys(collected).length}`);
    console.log(`EVIDENCE AXE_RULE_INSTANCES_BY_IMPACT=${JSON.stringify(perImpact)}`);
    console.log(`EVIDENCE AXE_UNIQUE_RULES_BY_IMPACT=${JSON.stringify(uniqueByImpact)}`);
  });

  test('login (sem autenticação)', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await assertEmulatorConnected(page);
    await expect(page.locator('#login-screen')).toBeVisible();
    await freezeMotion(page);
    await check(page, testInfo.project.name, 'login');
  });

  test('ADMIN: as 7 telas, menu do avatar e modais', async ({ page }, testInfo) => {
    const project = testInfo.project.name;

    await loginAs(page, E2E_USERS.admin);
    await freezeMotion(page);
    await expect(page.locator('#dash-list')).toContainText('Furadeira de Impacto');
    await check(page, project, 'admin-dashboard');

    for (const [tab, screen, ready] of [
      ['scanner', 'admin-scanner', '#manual-scan-input'],
      ['collaborators', 'admin-colaboradores', '#collab-list'],
      ['management', 'admin-ferramentas', '#crud-list'],
      ['history', 'admin-auditoria', '#history-list'],
      ['users', 'admin-controle-acesso', '#user-management-body'],
      ['data', 'admin-dados', '#data-restore-file'],
    ]) {
      await openTab(page, tab, { isAdmin: true });
      await expect(page.locator(ready)).toBeVisible();
      await check(page, project, screen);
    }

    await openUserMenu(page);
    await check(page, project, 'admin-menu-avatar');
    await page.getByRole('menuitem', { name: 'Meu Perfil' }).click();
    await expect(page.locator('#profile-modal')).toBeVisible();
    await check(page, project, 'admin-modal-perfil');
    await page.keyboard.press('Escape');

    await openTab(page, 'management', { isAdmin: true });
    await page.locator('#tools-action-new').click();
    await expect(page.locator('#crud-modal')).toBeVisible();
    await check(page, project, 'admin-modal-ferramenta');
    await page.keyboard.press('Escape');
  });

  // Gate 1-F1: estados da tela Dados e backup (ociosa já acima; arquivo, diálogo destrutivo e erro).
  test('DADOS: arquivo selecionado, diálogo destrutivo aberto e estado de erro', async ({
    page,
  }, testInfo) => {
    const project = testInfo.project.name;

    await loginAs(page, E2E_USERS.admin);
    await freezeMotion(page);
    await openTab(page, 'data');
    await expect(page.locator('#data-restore-file')).toBeVisible();
    await expectScopedClean(page, '#data-screen', 'ociosa');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#data-export-backup').click(),
    ]);
    const file = testInfo.outputPath('backup-axe.json');

    await download.saveAs(file);
    await page.locator('#data-restore-file').setInputFiles(file);
    await expect(page.locator('#data-restore-review')).toContainText('Arquivo válido');
    await check(page, project, 'admin-dados-arquivo-valido');
    await expectScopedClean(page, '#data-screen', 'arquivo válido');

    await page.locator('#data-restore-run').click();
    await expect(page.locator('#confirm-dialog')).toBeVisible();
    await check(page, project, 'admin-dados-dialog-restaurar');
    await expectScopedClean(page, '#confirm-dialog', 'diálogo de restauração');
    await page.keyboard.press('Escape');
    await expect(page.locator('#confirm-dialog')).toBeHidden();

    await page.locator('#data-reset').click();
    await expect(page.locator('#confirm-dialog')).toBeVisible();
    await check(page, project, 'admin-dados-dialog-reset');
    await expectScopedClean(page, '#confirm-dialog', 'diálogo de reset');
    await page.keyboard.press('Escape');
    await expect(page.locator('#confirm-dialog')).toBeHidden();

    await page.locator('#data-restore-file').setInputFiles({
      name: 'invalido.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ nao e json'),
    });
    await expect(page.locator('#data-restore-review').getByRole('alert')).toBeVisible();
    await check(page, project, 'admin-dados-erro');
    await expectScopedClean(page, '#data-screen', 'erro de arquivo');
  });

  // Gate 1-F1: a tela também é verificada no tema escuro (mesmos tokens, sem dark: ad hoc).
  test('DADOS: tema escuro (tela e diálogo destrutivo)', async ({ page }, testInfo) => {
    const project = testInfo.project.name;

    await page.emulateMedia({ colorScheme: 'dark' });
    await loginAs(page, E2E_USERS.admin);
    await freezeMotion(page);
    await openTab(page, 'data');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('#data-restore-file')).toBeVisible();
    await check(page, project, 'admin-dados-escuro');
    await expectScopedClean(page, '#data-screen', 'tema escuro');

    await page.locator('#data-reset').click();
    await expect(page.locator('#confirm-dialog')).toBeVisible();
    await check(page, project, 'admin-dados-dialog-escuro');
    await expectScopedClean(page, '#confirm-dialog', 'diálogo no tema escuro');
    await page.keyboard.press('Escape');
  });

  // Gate 1-F2: estados da tela Ferramentas (a ociosa já foi verificada acima). A varredura restrita à
  // própria tela não pode ter NENHUMA violação; a de página inteira só herda o nó do cabeçalho do shell.
  test('FERRAMENTAS: busca e filtros, menu aberto, modal, vazio, erro e tema escuro', async ({
    page,
  }, testInfo) => {
    const project = testInfo.project.name;

    await loginAs(page, E2E_USERS.admin);
    await freezeMotion(page);
    await openTab(page, 'management', { isAdmin: true });
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');
    await expectScopedClean(page, '#tab-management', 'ociosa');

    await page
      .locator('#tools-filters')
      .getByRole('button', { name: /^Disponíveis/ })
      .click();
    await page.locator('#inventory-category-filter').selectOption('Elétrica');
    await page.getByRole('searchbox').fill('furad');
    await expect(page.locator('#tools-active-filters')).toHaveText('3 filtros ativos');
    await check(page, project, 'admin-ferramentas-filtros');
    await expectScopedClean(page, '#tab-management', 'busca e filtros ativos');

    await page.locator('#tools-clear-filters').click();
    await expect(page.locator('#inventory-result-count')).toHaveText(
      'Mostrando 8 de 8 ferramentas'
    );

    await page.locator('#crud-list [data-tools-menu-trigger]').first().click();
    await expect(page.getByRole('menu')).toBeVisible();
    await check(page, project, 'admin-ferramentas-menu');
    await expectScopedClean(page, '#tab-management', 'menu de ações aberto');
    await page.getByRole('menuitem', { name: 'Histórico' }).click();
    await expect(page.locator('#tool-history-modal')).toBeVisible();
    await check(page, project, 'admin-ferramentas-modal-historico');
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
      window.App.Data.tools = [];
      window.App.CRUDTools.render();
    });
    await expect(page.locator('#crud-list')).toContainText('Nenhuma ferramenta cadastrada');
    await check(page, project, 'admin-ferramentas-vazio');
    await expectScopedClean(page, '#tab-management', 'estado vazio');

    await page.evaluate(() => {
      window.App.Data.toolsError = true;
      window.App.CRUDTools.render();
    });
    await expect(page.locator('#tools-feedback').getByRole('alert')).toBeVisible();
    await check(page, project, 'admin-ferramentas-erro');
    await expectScopedClean(page, '#tab-management', 'estado de erro');
  });

  // Addendum 1-F2.1: o menu flutuante cobria parte de botões de outras linhas e o axe (target-size) acusava
  // a faixa visível. Sem exclusão nenhuma: cada abertura (a borda do menu corta linhas diferentes) fica limpa.
  test('FERRAMENTAS: menu aberto em cada linha, sem exclusão e sem violações', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await freezeMotion(page);
    await openTab(page, 'management', { isAdmin: true });
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');

    const triggers = page.locator('#crud-list [data-tools-menu-trigger]');
    const total = await triggers.count();

    expect(total).toBe(8);

    for (let index = 0; index < total; index += 1) {
      await triggers.nth(index).scrollIntoViewIfNeeded();
      await triggers.nth(index).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectScopedClean(page, '#tab-management', `menu aberto na linha ${index + 1}`);
      await page.keyboard.press('Escape');
    }
  });

  test('FERRAMENTAS: tema escuro (lista e menu de ações)', async ({ page }, testInfo) => {
    const project = testInfo.project.name;

    await page.emulateMedia({ colorScheme: 'dark' });
    await loginAs(page, E2E_USERS.admin);
    await freezeMotion(page);
    await openTab(page, 'management', { isAdmin: true });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');
    await check(page, project, 'admin-ferramentas-escuro');
    await expectScopedClean(page, '#tab-management', 'tema escuro');

    await page.locator('#crud-list [data-tools-menu-trigger]').first().click();
    await expect(page.getByRole('menu')).toBeVisible();
    await check(page, project, 'admin-ferramentas-menu-escuro');
    await expectScopedClean(page, '#tab-management', 'menu no tema escuro');
  });

  // Gate 1-F3: estados da tela Colaboradores (a ociosa já foi verificada acima). A varredura restrita
  // à própria tela não pode ter NENHUMA violação; a de página inteira só herda o nó do cabeçalho do shell.
  test('COLABORADORES: busca e filtros, menu aberto, formulário, histórico, vazio e erro', async ({
    page,
  }, testInfo) => {
    const project = testInfo.project.name;

    await loginAs(page, E2E_USERS.admin);
    await freezeMotion(page);
    await openTab(page, 'collaborators', { isAdmin: true });
    await expect(page.locator('#collab-list')).toContainText('Colaborador Alfa');
    await expectScopedClean(page, '#tab-collaborators', 'ociosa');

    await page.getByRole('button', { name: /^Ativos\s*\d+/ }).click();
    await page.locator('#collab-role-filter').selectOption('Operador');
    await page.getByRole('searchbox').fill('alfa');
    await expect(page.locator('#collab-active-filters')).toHaveText('3 filtros ativos');
    await check(page, project, 'admin-colaboradores-filtros');
    await expectScopedClean(page, '#tab-collaborators', 'busca e filtros ativos');

    await page.locator('#collab-clear-filters').click();
    await expect(page.locator('#collab-result-count')).toHaveText(
      'Mostrando 5 de 5 colaboradores'
    );

    await page.locator('#collab-list [data-collab-menu-trigger]').first().click();
    await expect(page.getByRole('menu')).toBeVisible();
    await check(page, project, 'admin-colaboradores-menu');
    await expectScopedClean(page, '#tab-collaborators', 'menu de ações aberto');
    await page.keyboard.press('Escape');

    await page.locator('#btn-collaborators-new').click();
    await expect(page.locator('#crud-collab-modal')).toBeVisible();
    await check(page, project, 'admin-colaboradores-modal-formulario');
    await expectScopedClean(page, '#crud-collab-modal', 'formulário vazio');

    // Formulário com erro: a mensagem precisa estar ligada ao campo, não só colorida.
    await page.locator('#btn-save-collab').click();
    await expect(page.locator('#crud-collab-badge-error')).toBeVisible();
    await check(page, project, 'admin-colaboradores-modal-erro');
    await expectScopedClean(page, '#crud-collab-modal', 'formulário com erro');
    await page.keyboard.press('Escape');

    await page.locator('#collab-list').getByRole('button', { name: /^Histórico de/ }).first().click();
    await expect(page.locator('#collab-history-modal')).toBeVisible();
    await check(page, project, 'admin-colaboradores-modal-historico');
    await expectScopedClean(page, '#collab-history-modal', 'histórico individual');
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
      window.App.Data.collaborators = [];
      window.App.CRUDCollaborators.render();
    });
    await expect(page.locator('#collab-list')).toContainText('Nenhum colaborador cadastrado');
    await check(page, project, 'admin-colaboradores-vazio');
    await expectScopedClean(page, '#tab-collaborators', 'estado vazio');

    await page.evaluate(() => {
      window.App.Data.collaboratorsError = true;
      window.App.CRUDCollaborators.render();
    });
    await expect(page.locator('#collab-feedback').getByRole('alert')).toBeVisible();
    await check(page, project, 'admin-colaboradores-erro');
    await expectScopedClean(page, '#tab-collaborators', 'estado de erro');
  });

  // Gate 1-F3: a borda do menu flutuante corta linhas diferentes a cada abertura (contrato do 1-F2.1).
  test('COLABORADORES: menu aberto em cada linha, sem exclusão e sem violações', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await freezeMotion(page);
    await openTab(page, 'collaborators', { isAdmin: true });
    await expect(page.locator('#collab-list')).toContainText('Colaborador Alfa');

    const triggers = page.locator('#collab-list [data-collab-menu-trigger]');
    const total = await triggers.count();

    expect(total).toBe(5);

    for (let index = 0; index < total; index += 1) {
      await triggers.nth(index).scrollIntoViewIfNeeded();
      await triggers.nth(index).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectScopedClean(page, '#tab-collaborators', `menu aberto na linha ${index + 1}`);
      await page.keyboard.press('Escape');
    }
  });

  test('COLABORADORES: tema escuro (lista e menu de ações)', async ({ page }, testInfo) => {
    const project = testInfo.project.name;

    await page.emulateMedia({ colorScheme: 'dark' });
    await loginAs(page, E2E_USERS.admin);
    await freezeMotion(page);
    await openTab(page, 'collaborators', { isAdmin: true });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('#collab-list')).toContainText('Colaborador Alfa');
    await check(page, project, 'admin-colaboradores-escuro');
    await expectScopedClean(page, '#tab-collaborators', 'tema escuro');

    await page.locator('#collab-list [data-collab-menu-trigger]').first().click();
    await expect(page.getByRole('menu')).toBeVisible();
    await check(page, project, 'admin-colaboradores-menu-escuro');
    await expectScopedClean(page, '#tab-collaborators', 'menu no tema escuro');
  });

  // Gate 1-D: estados novos do shell (drawer no tablet e rail expandido sobre o conteúdo no notebook).
  test('SHELL: drawer (tablet) e rail expandido (notebook)', async ({ page }, testInfo) => {
    const project = testInfo.project.name;

    await loginAs(page, E2E_USERS.admin);
    await freezeMotion(page);
    await expect(page.locator('#dash-list')).toContainText('Furadeira de Impacto');

    await page.setViewportSize({ width: 820, height: 1000 });
    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('#main-sidebar')).toBeVisible();
    await check(page, project, 'admin-drawer-tablet');
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 1100, height: 900 });
    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('#main-sidebar')).toHaveAttribute('data-state', 'open');
    await check(page, project, 'admin-rail-expandido-notebook');
  });

  test('PADRÃO: dashboard e ferramentas', async ({ page }, testInfo) => {
    const project = testInfo.project.name;

    await loginAs(page, E2E_USERS.standard);
    await freezeMotion(page);
    await expect(page.locator('#dash-list')).toContainText('Furadeira de Impacto');
    await check(page, project, 'padrao-dashboard');

    await openTab(page, 'management');
    await expect(page.locator('#crud-list')).toBeVisible();
    await check(page, project, 'padrao-ferramentas');
  });
});
