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
