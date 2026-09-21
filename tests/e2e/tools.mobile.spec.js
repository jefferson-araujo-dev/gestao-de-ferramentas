import { expect, expectActiveTab, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_EXPECTED_COUNTS, E2E_USERS } from './support/seed-data.mjs';

// Ferramentas no mobile (390x844, toque): cartões compactos, alvos de toque de 44px, filtros e
// menu de ações utilizáveis e a barra inferior sem cobrir o conteúdo.
test.describe('MOBILE 390x844 — Ferramentas', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'management');
    await expectActiveTab(page, 'management');
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');
  });

  test('a lista vira cartões (sem tabela desktop) com os mesmos dados e status em texto', async ({
    page,
  }) => {
    await expect(page.locator('#crud-list table')).toHaveCount(0);
    await expect(page.locator('#crud-list ul.tools-cards > li')).toHaveCount(
      E2E_EXPECTED_COUNTS.tools
    );

    const card = page.locator('#crud-list li.tools-card', { hasText: 'Esmerilhadeira' });

    await expect(card.getByRole('heading', { level: 3, name: 'Esmerilhadeira' })).toBeVisible();
    await expect(card).toContainText('T-E2E-006 · Elétrica');
    await expect(card).toContainText('Emprestada');
    await expect(card).toContainText(/Atrasada \(\d+d\)/);
    await expect(card.getByText('Colaborador Beta')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Devolver Esmerilhadeira' })).toBeVisible();
  });

  test('alvos de toque de 44px em filtros, campos, ação principal e menu', async ({ page }) => {
    const small = await page.evaluate(() => {
      const issues = [];
      const seen = new Set();

      for (const element of document.querySelectorAll(
        '#tab-management .ui-btn, #tab-management .ui-control, #tab-management .ui-icon-btn'
      )) {
        if (element.offsetParent === null || seen.has(element)) {
          continue;
        }

        seen.add(element);

        const rect = element.getBoundingClientRect();
        const name = (element.textContent || element.getAttribute('aria-label') || '')
          .trim()
          .slice(0, 28);

        if (rect.height < 43.5 || rect.width < 43.5) {
          issues.push(`"${name}" ${Math.round(rect.width)}x${Math.round(rect.height)}`);
        }
      }

      return issues;
    });

    expect(small).toEqual([]);
  });

  test('filtros e busca funcionam com toque e sem rolagem horizontal', async ({ page }) => {
    await page
      .locator('#tools-filters')
      .getByRole('button', { name: /^Manutenção/ })
      .tap();
    await expect(page.locator('#inventory-result-count')).toHaveText(
      'Mostrando 2 de 2 ferramentas'
    );
    await expect(page.locator('#crud-list ul.tools-cards > li')).toHaveCount(2);

    await page.locator('#tools-clear-filters').tap();
    await expect(page.locator('#inventory-result-count')).toHaveText(
      'Mostrando 8 de 8 ferramentas'
    );

    await page.getByRole('searchbox').fill('trena');
    await expect(page.locator('#crud-list ul.tools-cards > li')).toHaveCount(1);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      )
    ).toBe(false);
  });

  test('menu de ações abre por toque, fica na tela e aciona o histórico', async ({ page }) => {
    const card = page.locator('#crud-list li.tools-card', { hasText: 'Martelo' });
    const trigger = card.getByRole('button', { name: 'Mais ações de Martelo' });

    await trigger.scrollIntoViewIfNeeded();
    await trigger.tap();

    const menu = card.getByRole('menu', { name: 'Ações de Martelo' });

    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();
    const viewport = page.viewportSize();

    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    await card.getByRole('menuitem', { name: 'Histórico' }).tap();
    await expect(page.locator('#tool-history-modal')).toBeVisible();
  });

  test('o último item da lista é alcançável acima da barra inferior', async ({ page }) => {
    const gap = await page.evaluate(async () => {
      const scroller = document.getElementById('main-content-scroll');

      scroller.scrollTop = scroller.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const cards = document.querySelectorAll('#crud-list li.tools-card');
      const last = cards[cards.length - 1].getBoundingClientRect();
      const navTop = document.getElementById('bottom-nav').getBoundingClientRect().top;

      return { lastBottom: last.bottom, navTop };
    });

    expect(gap.lastBottom).toBeLessThanOrEqual(gap.navTop);
  });
});

// Addendum 1-F2.1: também no toque, o menu aberto isola o resto da tela.
test.describe('MOBILE 390x844 — menu aberto isola o restante da tela', () => {
  test('toque fora do menu só o fecha e não aciona o botão de outro cartão', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'management');
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');
    await page.evaluate(() => {
      window.__switchCalls = [];

      const original = window.App.UI.switchTab.bind(window.App.UI);

      window.App.UI.switchTab = (...args) => {
        window.__switchCalls.push(args[0]);
        return original(...args);
      };
    });

    const triggers = page.locator('#crud-list [data-tools-menu-trigger]');
    let point = null;

    // Procura uma abertura em que um botão principal de OUTRO cartão (inerte) esteja visível, fora do
    // menu e acima da barra inferior: é onde o toque antes atravessava para a ação de baixo.
    for (let index = 0; index < (await triggers.count()) && !point; index += 1) {
      await triggers.nth(index).scrollIntoViewIfNeeded();
      await triggers.nth(index).tap();
      await expect(page.getByRole('menu')).toBeVisible();

      const open = await page.evaluate(() => ({
        active: document.querySelectorAll('#crud-list li[data-tool-id]:not([inert])').length,
        inert: document.querySelectorAll('#crud-list li[data-tool-id][inert]').length,
      }));

      expect(open).toEqual({ active: 1, inert: E2E_EXPECTED_COUNTS.tools - 1 });

      point = await page.evaluate(() => {
        const menu = document.querySelector('.ui-menu:not([hidden])').getBoundingClientRect();
        const navTop = document.getElementById('bottom-nav').getBoundingClientRect().top;

        for (const button of document.querySelectorAll('#crud-list .tools-card[inert] .ui-btn')) {
          const rect = button.getBoundingClientRect();
          const x = (rect.left + rect.right) / 2;
          const y = (rect.top + rect.bottom) / 2;
          const underMenu = x >= menu.left && x <= menu.right && y >= menu.top && y <= menu.bottom;

          if (!underMenu && rect.top > 60 && rect.bottom < navTop) {
            return { x, y };
          }
        }

        return null;
      });

      if (!point) {
        await page.keyboard.press('Escape');
      }
    }

    expect(
      point,
      'alguma abertura deve deixar um botão de outro cartão visível fora do menu'
    ).not.toBeNull();
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.getByRole('menu')).toBeHidden();
    expect(await page.evaluate(() => window.__switchCalls)).toEqual([]);
  });
});
