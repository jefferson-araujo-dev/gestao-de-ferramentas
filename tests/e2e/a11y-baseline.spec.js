import {
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

  test('ADMIN: as 6 telas, menu do avatar e modais', async ({ page }, testInfo) => {
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
