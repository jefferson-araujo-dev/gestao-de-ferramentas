import { expect, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// BASELINE VISUAL pré-redesign (estrutural), NÃO aprovação do design atual.
// Dados sintéticos do emulator, fontes remotas substituídas (renderização com fonte do sistema),
// animações desativadas e regiões dinâmicas mascaradas (data do dia, gráficos, ponto de rede).
// As imagens são específicas de sistema operacional/navegador (Windows + Chromium). Regenerar de
// propósito com: --update-snapshots (registrar a razão no commit).
const dynamicMasks = (page) => [
  page.locator('#current-date-full'),
  page.locator('#current-date-full-short'),
  page.locator('#statusChart'),
  page.locator('#categoryChart'),
  page.locator('#network-status-dot'),
  page.locator('#dash-mini-timeline'),
];

// Gate 1-F2: os dias de atraso ("Atrasada (39d)") dependem da data do dia e são mascarados.
const toolsMasks = (page) => [...dynamicMasks(page), page.locator('#crud-list .ui-badge--danger:not(.ui-badge--status)')];

test.describe('VISUAL — desktop 1440x900 (ADMIN)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  test('dashboard', async ({ page }) => {
    await expect(page.locator('#dash-list')).toContainText('Furadeira de Impacto');
    await expect(page).toHaveScreenshot('dashboard-admin-desktop.png', {
      mask: dynamicMasks(page),
    });
  });

  test('ferramentas', async ({ page }) => {
    await openTab(page, 'management', { isAdmin: true });
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');
    await expect(page).toHaveScreenshot('ferramentas-admin-desktop.png', {
      mask: toolsMasks(page),
    });
  });

  test('colaboradores', async ({ page }) => {
    await openTab(page, 'collaborators', { isAdmin: true });
    await expect(page.locator('#collab-list')).toContainText('Colaborador Alfa');
    await expect(page).toHaveScreenshot('colaboradores-admin-desktop.png', {
      mask: dynamicMasks(page),
    });
  });

  test('scanner', async ({ page }) => {
    await openTab(page, 'scanner', { isAdmin: true });
    await expect(page.locator('#manual-scan-input')).toBeVisible();
    await expect(page).toHaveScreenshot('scanner-admin-desktop.png', { mask: dynamicMasks(page) });
  });
});

// Gate 1-F1: tela Dados e backup (topo, zona de manutenção destrutiva e o mesmo no tema escuro).
// O tempo ativo (métrica da sessão) é mascarado; o resto vem do emulator e é determinístico.
const dataMasks = (page) => dynamicMasks(page);
const hideVolatile = (page) =>
  page.addStyleTag({ content: '[data-fact="uptime"] .data-fact__value{visibility:hidden}' });

async function openDataAt(page, selector) {
  await openTab(page, 'data', { isAdmin: true });
  await expect(page.locator('#data-restore-file')).toBeVisible();
  await hideVolatile(page);
  await expect(page.locator('[data-fact="history"] .data-fact__value')).toHaveText(/^\d+$/);
  await page.evaluate((target) => {
    const element = document.querySelector(target);

    // Sem esconder o título sob o cabeçalho fixo: topo = rolagem zero; demais = seção ao centro.
    if (target === '#main-content-scroll') {
      element.scrollTop = 0;
    } else {
      element.scrollIntoView({ block: 'center' });
    }
  }, selector);
  await page.waitForTimeout(150);
}

test.describe('VISUAL — desktop 1440x900 (ADMIN): Dados e backup', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  test('dados e backup: topo', async ({ page }) => {
    await openDataAt(page, '#main-content-scroll');
    await expect(page).toHaveScreenshot('dados-admin-desktop.png', { mask: dataMasks(page) });
  });

  test('dados e backup: manutenção de dados (zona destrutiva)', async ({ page }) => {
    await openDataAt(page, '#data-h-maintenance');
    await expect(page).toHaveScreenshot('dados-admin-manutencao-desktop.png', {
      mask: dataMasks(page),
    });
  });

  test('dados e backup: diálogo de reset (confirmação reforçada)', async ({ page }) => {
    await openDataAt(page, '#data-h-maintenance');
    await page.locator('#data-reset').click();
    await expect(page.locator('#confirm-dialog')).toBeVisible();
    await page.locator('#confirm-dialog-input').fill('RESET');
    await expect(page).toHaveScreenshot('dados-dialogo-reset-desktop.png', { mask: dataMasks(page) });
  });
});

test.describe('VISUAL — desktop 1440x900 (ADMIN, tema escuro): Dados e backup', () => {
  test.use({ colorScheme: 'dark' });

  test('dados e backup: manutenção de dados no escuro', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await openDataAt(page, '#data-h-maintenance');
    await expect(page).toHaveScreenshot('dados-admin-manutencao-desktop-dark.png', {
      mask: dataMasks(page),
    });
  });
});

// Gate 1-F2: tela Ferramentas (menu de ações, busca/filtros ativos, perfil padrão e tema escuro).
test.describe('VISUAL — desktop 1440x900: Ferramentas', () => {
  test('ferramentas: menu de ações aberto', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'management', { isAdmin: true });
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');
    await page.locator('#crud-list [data-tools-menu-trigger]').first().click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page).toHaveScreenshot('ferramentas-admin-menu-desktop.png', {
      mask: toolsMasks(page),
    });
  });

  test('ferramentas: busca, categoria e status ativos', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'management', { isAdmin: true });
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');
    await page.locator('#tools-filters').getByRole('button', { name: /^Emprestadas/ }).click();
    await page.locator('#inventory-category-filter').selectOption('Elétrica');
    await expect(page.locator('#tools-active-filters')).toHaveText('2 filtros ativos');
    await expect(page).toHaveScreenshot('ferramentas-admin-filtros-desktop.png', {
      mask: toolsMasks(page),
    });
  });

  test('ferramentas: perfil padrão (somente leitura)', async ({ page }) => {
    await loginAs(page, E2E_USERS.standard);
    await openTab(page, 'management');
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');
    await expect(page).toHaveScreenshot('ferramentas-padrao-desktop.png', {
      mask: toolsMasks(page),
    });
  });
});

test.describe('VISUAL — desktop 1440x900 (ADMIN, tema escuro): Ferramentas', () => {
  test.use({ colorScheme: 'dark' });

  test('ferramentas no escuro', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await openTab(page, 'management', { isAdmin: true });
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');
    await expect(page).toHaveScreenshot('ferramentas-admin-desktop-dark.png', {
      mask: toolsMasks(page),
    });
  });
});
