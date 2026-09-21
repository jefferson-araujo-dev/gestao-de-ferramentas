import { expect, expectActiveTab, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_EXPECTED_COUNTS, E2E_USERS } from './support/seed-data.mjs';

// Colaboradores no mobile (390x844, toque): cartões compactos, alvos de toque de 44px, filtros e
// menu de ações utilizáveis e a barra inferior sem cobrir o conteúdo.
test.describe('MOBILE 390x844 — Colaboradores', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'collaborators');
    await expectActiveTab(page, 'collaborators');
    await expect(page.locator('#collab-list')).toContainText('Colaborador Alfa');
  });

  test('a lista vira cartões (sem tabela desktop) com os mesmos dados e situação em texto', async ({
    page,
  }) => {
    await expect(page.locator('#collab-list table')).toHaveCount(0);
    await expect(page.locator('#collab-list li.collab-card')).toHaveCount(
      E2E_EXPECTED_COUNTS.collaborators
    );

    const card = page.locator('#collab-list li.collab-card', { hasText: 'Colaborador Alfa' });

    await expect(card.getByRole('heading', { level: 4, name: 'Colaborador Alfa' })).toBeVisible();
    // Agrupado por cargo, o cartão mostra só o crachá (o cargo está no título do grupo).
    await expect(card.locator('.collab-person__meta')).toHaveText('E2E-001');
    await expect(card).toContainText('Ativo');
    await expect(card).toContainText('1 ferramenta em posse');
    await expect(card).toContainText('(00) 00000-0000');
    await expect(card.getByRole('button', { name: 'Histórico de Colaborador Alfa' })).toBeVisible();

    // Agrupado por cargo: cada grupo é uma seção com título próprio.
    await expect(page.locator('.collab-group-section')).toHaveCount(3);
    await expect(page.locator('.collab-group__title .collab-group__name')).toHaveText([
      'Auxiliar',
      'Operador',
      'Supervisor',
    ]);

    // Sem agrupamento não há título de grupo: aí o cargo volta para a linha de identificação.
    await page.getByRole('switch', { name: 'Agrupar por cargo' }).focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.collab-group-section')).toHaveCount(0);
    await expect(
      page
        .locator('#collab-list li.collab-card', { hasText: 'Colaborador Alfa' })
        .locator('.collab-person__meta')
    ).toHaveText('E2E-001 · Operador');
  });

  test('alvos de toque de 44px em filtros, campos, ação principal e menu', async ({ page }) => {
    const small = await page.evaluate(() => {
      const issues = [];
      const seen = new Set();

      for (const element of document.querySelectorAll(
        '#tab-collaborators .ui-btn, #tab-collaborators .ui-control, #tab-collaborators .ui-icon-btn'
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
      .getByRole('group', { name: 'Filtrar por pendências' })
      .getByRole('button')
      .tap();
    await expect(page.locator('#collab-result-count')).toHaveText(
      'Mostrando 2 de 2 colaboradores'
    );
    await expect(page.locator('#collab-list li.collab-card')).toHaveCount(2);

    await page.locator('#collab-clear-filters').tap();
    await expect(page.locator('#collab-result-count')).toHaveText(
      'Mostrando 5 de 5 colaboradores'
    );

    await page.getByRole('searchbox').fill('gama');
    await expect(page.locator('#collab-list li.collab-card')).toHaveCount(1);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      )
    ).toBe(false);
  });

  test('menu de ações abre por toque, fica na tela e aciona a edição', async ({ page }) => {
    const card = page.locator('#collab-list li.collab-card', { hasText: 'Colaborador Delta' });
    const trigger = card.getByRole('button', { name: 'Mais ações de Colaborador Delta' });

    await trigger.scrollIntoViewIfNeeded();
    await trigger.tap();

    const menu = card.getByRole('menu', { name: 'Ações de Colaborador Delta' });

    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();
    const viewport = page.viewportSize();

    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    await card.getByRole('menuitem', { name: 'Editar' }).tap();
    await expect(page.locator('#crud-collab-modal')).toBeVisible();
    await expect(page.locator('#crud-collab-name')).toHaveValue('Colaborador Delta');
  });

  test('o último cartão é alcançável acima da barra inferior', async ({ page }) => {
    const gap = await page.evaluate(async () => {
      const scroller = document.getElementById('main-content-scroll');

      scroller.scrollTop = scroller.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const cards = document.querySelectorAll('#collab-list li.collab-card');
      const last = cards[cards.length - 1].getBoundingClientRect();
      const navTop = document.getElementById('bottom-nav').getBoundingClientRect().top;

      return { lastBottom: last.bottom, navTop };
    });

    expect(gap.lastBottom).toBeLessThanOrEqual(gap.navTop);
  });

  test('o formulário é utilizável no mobile: campos, rolagem e ações sempre visíveis', async ({
    page,
  }) => {
    await page.locator('#btn-collaborators-new').tap();

    const modal = page.locator('#crud-collab-modal');

    await expect(modal).toBeVisible();

    const layout = await page.evaluate(() => {
      const dialog = document.getElementById('crud-collab-modal');
      const [, body, footer] = [...dialog.children];

      body.scrollTop = body.scrollHeight;

      return {
        parts: dialog.childElementCount,
        footerBottom: footer.getBoundingClientRect().bottom,
        viewport: window.innerHeight,
        buttons: footer.querySelectorAll('button').length,
        fields: ['crud-collab-badge', 'crud-collab-name', 'crud-collab-role', 'crud-collab-phone']
          .map((id) => document.getElementById(id).getBoundingClientRect())
          .map((rect) => Math.round(rect.height)),
      };
    });

    expect(layout.parts).toBe(3);
    expect(layout.buttons).toBe(2);
    expect(layout.footerBottom).toBeLessThanOrEqual(layout.viewport + 1);
    expect(Math.min(...layout.fields)).toBeGreaterThanOrEqual(44);
  });
});

// Addendum 1-F2.1 (mesmo contrato): também no toque, o menu aberto isola o resto da tela.
test.describe('MOBILE 390x844 — menu aberto isola o restante da tela', () => {
  test('toque fora do menu só o fecha e não aciona o botão de outro cartão', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'collaborators');
    await expect(page.locator('#collab-list')).toContainText('Colaborador Alfa');
    await page.evaluate(() => {
      window.__historyCalls = [];

      const original = window.App.CRUDCollaborators.showHistory.bind(window.App.CRUDCollaborators);

      window.App.CRUDCollaborators.showHistory = (...args) => {
        window.__historyCalls.push(args[0]);
        return original(...args);
      };
    });

    const triggers = page.locator('#collab-list [data-collab-menu-trigger]');
    let point = null;

    // Procura uma abertura em que o botão de OUTRO cartão (inerte) esteja visível, fora do menu e
    // acima da barra inferior: é onde o toque antes atravessava para a ação de baixo.
    for (let index = 0; index < (await triggers.count()) && !point; index += 1) {
      await triggers.nth(index).scrollIntoViewIfNeeded();
      await triggers.nth(index).tap();
      await expect(page.getByRole('menu')).toBeVisible();

      const open = await page.evaluate(() => ({
        active: document.querySelectorAll('#collab-list [data-collab-row]:not([inert])').length,
        inert: document.querySelectorAll('#collab-list [data-collab-row][inert]').length,
      }));

      expect(open).toEqual({ active: 1, inert: E2E_EXPECTED_COUNTS.collaborators - 1 });

      point = await page.evaluate(() => {
        const menu = document.querySelector('.ui-menu:not([hidden])').getBoundingClientRect();
        const navTop = document.getElementById('bottom-nav').getBoundingClientRect().top;

        for (const button of document.querySelectorAll(
          '#collab-list .collab-card[inert] .ui-btn'
        )) {
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
    expect(await page.evaluate(() => window.__historyCalls)).toEqual([]);
    await expect(page.locator('#collab-history-modal')).toBeHidden();
  });
});
