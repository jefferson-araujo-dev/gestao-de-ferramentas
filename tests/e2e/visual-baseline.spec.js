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
      mask: dynamicMasks(page),
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
