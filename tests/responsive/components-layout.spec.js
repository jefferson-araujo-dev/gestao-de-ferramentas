import { expect, test } from './support/network-guard.js';

// Componentes fundamentais (Gate 1-E) isolados na galeria /components.html (só dev), em TODOS os
// viewports do gate responsivo: sem rolagem horizontal, controles dentro da tela, alvos de toque,
// modal/confirmação/menu/toast cabendo na viewport. Sem autenticação e sem rede externa.
const TOUCH_MIN = 40; // 44 em ponteiro grosso (--ui-control-h)

async function openGallery(page) {
  await page.goto('/components.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-section="overlays"]')).toBeVisible();
  await page.waitForTimeout(200);
}

const within = (box, viewport) =>
  box.x >= -1 &&
  box.y >= -1 &&
  box.x + box.width <= viewport.width + 1 &&
  box.y + box.height <= viewport.height + 1;

test('@components-layout galeria sem rolagem horizontal, controles na tela e alvos de toque', async ({
  page
}, testInfo) => {
  const viewport = page.viewportSize();
  const context = testInfo.project.name;

  await openGallery(page);

  const report = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const issues = [];
    const coarse = matchMedia('(pointer: coarse)').matches;
    const selectors = [
      '.ui-btn:not(.ui-btn--sm)',
      '.ui-icon-btn',
      '.ui-control',
      '.ui-check',
      '.ui-switch',
      '.ui-stat--interactive'
    ];

    if (document.documentElement.scrollWidth > clientWidth + 1) {
      issues.push(`rolagem horizontal (${document.documentElement.scrollWidth} > ${clientWidth})`);
    }

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const rect = element.getBoundingClientRect();
        const label = `${selector} "${(element.textContent || element.getAttribute('aria-label') || element.id || '').trim().slice(0, 24)}"`;

        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.left < -1 || rect.right > clientWidth + 1) {
          issues.push(`${label} fora da tela horizontalmente (${Math.round(rect.left)}..${Math.round(rect.right)})`);
        }
        if (selector !== '.ui-stat--interactive' && rect.height < 39.5) {
          issues.push(`${label} com altura ${Math.round(rect.height)}px (< 40)`);
        }
        if (coarse && selector !== '.ui-stat--interactive' && rect.height < 43.5 && !element.matches('.ui-btn--sm')) {
          issues.push(`${label} < 44px em ponteiro grosso (${Math.round(rect.height)}px)`);
        }
      }
    }

    const cards = [...document.querySelectorAll('.ui-stat')].map((card) => card.getBoundingClientRect().width);

    return { issues, coarse, minCard: Math.min(...cards) };
  });

  expect(report.issues, context).toEqual([]);
  expect(report.minCard, `${context}: StatCard estreito demais`).toBeGreaterThan(120);
  expect(viewport.width).toBeGreaterThan(0);
  expect(TOUCH_MIN).toBe(40);
});

test('@components-layout modal, confirmação, menu e toast cabem na viewport', async ({
  page
}, testInfo) => {
  const viewport = page.viewportSize();
  const context = testInfo.project.name;

  await openGallery(page);

  // Modal com formulário (não dispensável)
  await page.locator('#open-modal-form').click();

  const modal = page.locator('#modal-form');

  await expect(modal).toBeVisible();
  expect(within(await modal.boundingBox(), viewport), `${context}: modal`).toBe(true);

  for (const button of await modal.locator('.ui-modal__footer .ui-btn').all()) {
    expect(within(await button.boundingBox(), viewport), `${context}: ação do modal`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();

  // Confirmação perigosa (com Alert) e reforçada (com campo)
  for (const id of ['#open-confirm-danger', '#open-confirm-strong']) {
    await page.locator(id).click();

    const dialog = page.locator('#confirm-dialog');

    await expect(dialog).toBeVisible();
    expect(within(await dialog.boundingBox(), viewport), `${context}: ${id}`).toBe(true);

    for (const button of await dialog.locator('.ui-btn').all()) {
      expect(within(await button.boundingBox(), viewport), `${context}: botão de ${id}`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }

  // Menu de ações
  await page.locator('#dd-trigger').click();
  expect(within(await page.locator('#dd-panel').boundingBox(), viewport), `${context}: menu`).toBe(true);
  await page.keyboard.press('Escape');

  // Toast (após a transição de entrada)
  await page.locator('#toast-error').click();
  await expect(page.locator('.toast-item')).toHaveClass(/show/);
  await expect
    .poll(async () => within(await page.locator('.toast-item').boundingBox(), viewport))
    .toBe(true);
});
