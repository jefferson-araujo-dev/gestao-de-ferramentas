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

// MOBILE 390x844 (Gate 1-D): barra inferior com 4 destinos + "Mais" (o drawer antigo, só com ícones,
// deixou de existir abaixo de 768px). Baselines visuais/axe abaixo descrevem o shell NOVO.
const dynamicMasks = (page) => [
  page.locator('#current-date-full'),
  page.locator('#current-date-full-short'),
  page.locator('#statusChart'),
  page.locator('#categoryChart'),
  page.locator('#network-status-dot'),
  page.locator('#dash-mini-timeline'),
];

test.describe('MOBILE 390x844 — navegação (barra inferior)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  test('barra inferior: Painel ativo no início; escolher um destino navega e marca aria-current', async ({
    page,
  }) => {
    await expect(page.locator('#main-sidebar')).toBeHidden();
    await expectActiveTab(page, 'dashboard');

    await page.locator('#bnav-scanner').click();
    await expectActiveTab(page, 'scanner');
    await expect(page.locator('#bnav-scanner')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#bnav-dashboard')).not.toHaveAttribute('aria-current', 'page');
  });

  // Achado C-01 (Gate 1-A) RESOLVIDO: no mobile todo destino tem rótulo visível e nome acessível
  // (antes: botões só com ícone, sem texto, aria-label ou title).
  test('C-01 resolvido: todo destino da barra inferior tem rótulo visível e nome acessível', async ({
    page,
  }) => {
    const nav = page.getByRole('navigation', { name: 'Navegação inferior' });

    for (const [id, name] of [
      ['bnav-dashboard', 'Painel'],
      ['bnav-scanner', 'Retirar/Devolver'],
      ['bnav-tools', 'Ferramentas'],
      ['bnav-collaborators', 'Colaboradores'],
    ]) {
      const link = page.locator(`#${id}`);

      await expect(link).toBeVisible();
      expect((await link.innerText()).replace(/\s+/g, '')).toBe(name.replace(/\s+/g, ''));
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }

    await expect(nav.getByRole('button', { name: 'Mais', exact: true })).toBeVisible();
  });

  test('avatar: menu abre e mostra as ações do perfil admin', async ({ page }) => {
    await page.getByTestId('user-menu-trigger').click();
    await expect(page.locator('#user-dropdown-menu')).toBeVisible();
    await expect(page.locator('#btn-logout-header')).toBeVisible();
    await expect(page.locator('#btn-reset-data')).toBeVisible();
  });
});

test.describe('MOBILE 390x844 — visual (baseline do shell novo)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  test('dashboard', async ({ page }) => {
    await expect(page.locator('#dash-list')).toContainText('Furadeira de Impacto');
    await expect(page).toHaveScreenshot('dashboard-admin-mobile.png', { mask: dynamicMasks(page) });
  });

  test('navegação: "Mais" aberto', async ({ page }) => {
    await page.locator('#bnav-more').click();
    await expect(page.locator('#more-sheet')).toBeVisible();
    await expect(page).toHaveScreenshot('mais-aberto-mobile.png', { mask: dynamicMasks(page) });
  });
});

test.describe('MOBILE 390x844 — axe (shell novo)', () => {
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

  test('dashboard e Mais aberto', async ({ page }, testInfo) => {
    const project = testInfo.project.name;

    await loginAs(page, E2E_USERS.admin);
    await freezeMotion(page);
    await expect(page.locator('#dash-list')).toContainText('Furadeira de Impacto');

    for (const [screen, prepare] of [
      ['mobile-dashboard', async () => {}],
      ['mobile-mais-aberto', async () => page.locator('#bnav-more').click()],
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
