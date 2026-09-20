import {
  UPDATE_BASELINE,
  findRegressions,
  freezeMotion,
  loadBaseline,
  saveBaseline,
  scan,
  summarize,
} from './support/axe.js';
import { expect, expectActiveTab, loginAs, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// BASELINE MOBILE (390x844) da navegação ATUAL, pré-redesign. Estes testes documentam o
// comportamento de hoje e serão atualizados DE PROPÓSITO no Gate 1-D (barra inferior / novo shell).
const hamburger = (page) =>
  page.locator('header button[onclick="App.UI.toggleSidebar()"]:visible').first();

// O drawer anima por 300ms (transition-all): espera a posição estabilizar fora da tela.
async function expectDrawerClosed(page) {
  await expect
    .poll(async () => {
      const box = await page.locator('#main-sidebar').boundingBox();

      return box ? box.x + box.width : null;
    })
    .toBeLessThanOrEqual(1);
  await expect(page.locator('#sidebar-overlay')).toBeHidden();
}

const dynamicMasks = (page) => [
  page.locator('#current-date-full'),
  page.locator('#current-date-full-short'),
  page.locator('#statusChart'),
  page.locator('#categoryChart'),
  page.locator('#network-status-dot'),
  page.locator('#dash-mini-timeline'),
];

test.describe('MOBILE 390x844 — navegação atual (baseline)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  test('drawer: fechado no início, abre pelo hambúrguer e fecha ao escolher uma tela', async ({
    page,
  }) => {
    await expectDrawerClosed(page);
    await expectActiveTab(page, 'dashboard', { isAdmin: true, initialLoad: true });

    await hamburger(page).click();
    await expect(page.locator('#sidebar-overlay')).toBeVisible();
    await expect(page.locator('#nav-scanner')).toBeVisible();

    await page.locator('#nav-scanner').click();
    await expectActiveTab(page, 'scanner', { isAdmin: true });
    await expectDrawerClosed(page);
  });

  test('drawer: fecha ao tocar no overlay', async ({ page }) => {
    await hamburger(page).click();
    await expect(page.locator('#sidebar-overlay')).toBeVisible();
    await page.locator('#sidebar-overlay').click({ position: { x: 380, y: 400 } });
    await expectDrawerClosed(page);
  });

  // Baseline do achado C-01 (Gate 1-A): abaixo de 768px o drawer mostra só ícones. Os botões não
  // têm rótulo visível nem aria-label/title. Este teste muda de propósito no Gate 1-D.
  test('drawer atual: botões de navegação só com ícone (sem rótulo visível nem nome acessível)', async ({
    page,
  }) => {
    await hamburger(page).click();

    for (const id of ['nav-dashboard', 'nav-scanner', 'nav-collaborators', 'nav-management']) {
      const button = page.locator(`#${id}`);

      await expect(button).toBeVisible();
      expect(await button.evaluate((el) => el.innerText.trim())).toBe('');
      expect(await button.getAttribute('aria-label')).toBeNull();
      expect(await button.getAttribute('title')).toBeNull();
    }
  });

  test('avatar: menu abre e mostra as ações do perfil admin', async ({ page }) => {
    await page.getByTestId('user-menu-trigger').click();
    await expect(page.locator('#user-dropdown-menu')).toBeVisible();
    await expect(page.locator('#btn-logout-header')).toBeVisible();
    await expect(page.locator('#btn-reset-data')).toBeVisible();
  });
});

test.describe('MOBILE 390x844 — visual (baseline estrutural)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  test('dashboard', async ({ page }) => {
    await expect(page.locator('#dash-list')).toContainText('Furadeira de Impacto');
    await expect(page).toHaveScreenshot('dashboard-admin-mobile.png', { mask: dynamicMasks(page) });
  });

  test('navegação: drawer aberto', async ({ page }) => {
    await hamburger(page).click();
    await expect(page.locator('#sidebar-overlay')).toBeVisible();
    await expect(page).toHaveScreenshot('drawer-aberto-mobile.png', { mask: dynamicMasks(page) });
  });
});

test.describe('MOBILE 390x844 — axe (baseline)', () => {
  test.describe.configure({ mode: 'serial' });

  const collected = {};
  let axeVersion = 'desconhecida';

  test.afterAll(async ({}, testInfo) => {
    if (UPDATE_BASELINE) {
      saveBaseline(testInfo.project.name, collected, axeVersion);
    }

    const { perImpact, uniqueByImpact } = summarize(collected);

    console.log(`EVIDENCE AXE_MOBILE_SCREENS=${Object.keys(collected).length}`);
    console.log(`EVIDENCE AXE_MOBILE_RULE_INSTANCES_BY_IMPACT=${JSON.stringify(perImpact)}`);
    console.log(`EVIDENCE AXE_MOBILE_UNIQUE_RULES_BY_IMPACT=${JSON.stringify(uniqueByImpact)}`);
  });

  test('dashboard e drawer aberto', async ({ page }, testInfo) => {
    const project = testInfo.project.name;

    await loginAs(page, E2E_USERS.admin);
    await freezeMotion(page);
    await expect(page.locator('#dash-list')).toContainText('Furadeira de Impacto');

    for (const [screen, prepare] of [
      ['mobile-dashboard', async () => {}],
      ['mobile-drawer-aberto', async () => hamburger(page).click()],
    ]) {
      await prepare();

      const { violations, axeVersion: version } = await scan(page);

      axeVersion = version;
      collected[screen] = violations;

      if (!UPDATE_BASELINE) {
        expect(
          findRegressions(loadBaseline(project).screens[screen], violations),
          `regressões de acessibilidade em "${screen}"`
        ).toEqual([]);
      }
    }
  });
});
