import { expect, expectActiveTab, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// APP SHELL por breakpoint (Gate 1-D). Contrato oficial:
//   mobile < 768 (barra inferior) | tablet 768-1023 (drawer) | notebook 1024-1279 (rail 72px)
//   | desktop >= 1280 (sidebar 256px, recolhe para 72px).
// Cada teste redimensiona o viewport (o projeto "desktop" abre em 1440x900).
const SIDEBAR_EXPANDED = 256;
const SIDEBAR_RAIL = 72;
const TOPBAR = 64;

const resize = (page, width, height = 900) => page.setViewportSize({ width, height });

// A sidebar anima largura/posição: espera estabilizar antes de medir.
const sidebarWidth = async (page) => {
  let last = -1;

  await expect
    .poll(async () => {
      const box = await page.locator('#main-sidebar').boundingBox();
      const width = box ? Math.round(box.width) : -1;
      const stable = width === last;

      last = width;
      return stable ? width : -2;
    })
    .toBeGreaterThan(0);

  return last;
};

const mainLeft = async (page) =>
  Math.round((await page.locator('#main-content-scroll').boundingBox()).x);

const state = (page) => page.locator('#main-sidebar').getAttribute('data-state');

test.describe('DESKTOP >= 1280 — sidebar 256px, recolhe para 72px', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  for (const width of [1280, 1440, 1920]) {
    test(`${width}px: sidebar expandida (256px) com grupos e rótulos visíveis; conteúdo ao lado`, async ({
      page,
    }) => {
      await resize(page, width);
      await expect(page.locator('#main-sidebar')).toHaveAttribute('data-state', 'expanded');
      expect(await sidebarWidth(page)).toBe(SIDEBAR_EXPANDED);
      expect(await mainLeft(page)).toBe(SIDEBAR_EXPANDED);
      await expect(page.locator('#main-sidebar .shell-nav-group-label').first()).toBeVisible();
      await expect(page.locator('#nav-scanner .shell-nav-label')).toBeVisible();
      await expect(page.locator('#bottom-nav')).toBeHidden();
      await expect(page.locator('html')).toHaveAttribute('data-shell-mode', 'desktop');
    });
  }

  test('topbar de ~64px com título, estado de conexão e conta', async ({ page }) => {
    const header = await page.locator('#main-content-scroll > header').boundingBox();

    expect(Math.round(header.height)).toBe(TOPBAR);
    await expect(page.locator('#topbar-title')).toBeVisible();
    await expect(page.locator('#network-status-dot')).toBeVisible();
    await expect(page.getByTestId('user-menu-trigger')).toBeVisible();
  });

  test('recolher/expandir: 256 <-> 72px, aria-expanded, nome acessível preservado e persistência', async ({
    page,
  }) => {
    const toggle = page.locator('#btn-sidebar-toggle');

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAttribute('aria-controls', 'main-sidebar');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await sidebarWidth(page)).toBe(SIDEBAR_RAIL);
    expect(await mainLeft(page)).toBe(SIDEBAR_RAIL);
    // Rótulos saem da tela, mas o nome acessível continua (não depende de hover).
    await expect(page.getByRole('link', { name: 'Retirar/Devolver', exact: true })).toBeVisible();
    await expect(page.locator('#nav-scanner .shell-nav-label')).toHaveText('Retirar/Devolver');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#main-app')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#main-sidebar')).toHaveAttribute('data-state', 'collapsed');
    expect(await sidebarWidth(page)).toBe(SIDEBAR_RAIL);

    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('#main-sidebar')).toHaveAttribute('data-state', 'expanded');
    expect(await sidebarWidth(page)).toBe(SIDEBAR_EXPANDED);
  });

  test('o estado recolhido persistido não vaza para notebook/tablet', async ({ page }) => {
    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('#main-sidebar')).toHaveAttribute('data-state', 'collapsed');

    await resize(page, 900);
    await expect(page.locator('#main-sidebar')).toHaveAttribute('data-state', 'closed');
    await resize(page, 1440);
    await expect(page.locator('#main-sidebar')).toHaveAttribute('data-state', 'collapsed');
  });
});

test.describe('NOTEBOOK 1024-1279 — rail de 72px, expansão sobre o conteúdo', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  for (const width of [1024, 1100, 1279]) {
    test(`${width}px: rail de 72px, conteúdo começa em 72px e nada depende de hover`, async ({
      page,
    }) => {
      await resize(page, width);
      await expect(page.locator('html')).toHaveAttribute('data-shell-mode', 'notebook');
      await expect(page.locator('#main-sidebar')).toHaveAttribute('data-state', 'collapsed');
      expect(await sidebarWidth(page)).toBe(SIDEBAR_RAIL);
      expect(await mainLeft(page)).toBe(SIDEBAR_RAIL);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
        )
      ).toBe(true);

      // Rótulos acessíveis sem hover: todos os destinos têm nome de link.
      for (const name of [
        'Painel',
        'Retirar/Devolver',
        'Ferramentas',
        'Colaboradores',
        'Auditoria',
        'Usuários e acessos',
      ]) {
        await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
      }
    });
  }

  test('expandir abre 256px SOBRE o conteúdo (sem empurrar o layout); Esc fecha e devolve o foco', async ({
    page,
  }) => {
    await resize(page, 1100);

    const toggle = page.locator('#btn-sidebar-toggle');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(page.locator('#main-sidebar')).toHaveAttribute('data-state', 'open');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#sidebar-overlay')).toBeVisible();
    expect(await sidebarWidth(page)).toBe(SIDEBAR_EXPANDED);
    expect(await mainLeft(page)).toBe(SIDEBAR_RAIL); // o conteúdo não se moveu
    await expect(page.locator('#nav-scanner .shell-nav-label')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#main-sidebar')).toHaveAttribute('data-state', 'collapsed');
    await expect(page.locator('#sidebar-overlay')).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test('escolher um destino no rail expandido navega e recolhe', async ({ page }) => {
    await resize(page, 1100);
    await page.locator('#btn-sidebar-toggle').click();
    await page.getByRole('link', { name: 'Auditoria', exact: true }).click();
    await expectActiveTab(page, 'history');
    await expect(page.locator('#main-sidebar')).toHaveAttribute('data-state', 'collapsed');
  });

  test('clicar no overlay recolhe o rail', async ({ page }) => {
    await resize(page, 1100);
    await page.locator('#btn-sidebar-toggle').click();
    await page.locator('#sidebar-overlay').click({ position: { x: 1000, y: 400 } });
    await expect(page.locator('#main-sidebar')).toHaveAttribute('data-state', 'collapsed');
  });
});

test.describe('TABLET 768-1023 — drawer', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  for (const width of [768, 820, 1023]) {
    test(`${width}px: sem sidebar persistente; botão explícito abre o drawer com rótulos`, async ({
      page,
    }) => {
      await resize(page, width, 1000);
      await expect(page.locator('html')).toHaveAttribute('data-shell-mode', 'tablet');
      expect(await state(page)).toBe('closed');
      await expect(page.locator('#main-sidebar')).toBeHidden();
      expect(await mainLeft(page)).toBe(0);

      const toggle = page.locator('#btn-sidebar-toggle');

      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#main-sidebar')).toBeVisible();
      await expect(page.locator('#sidebar-overlay')).toBeVisible();
      expect(await sidebarWidth(page)).toBe(SIDEBAR_EXPANDED);
      // Rótulos visíveis (não só ícones, como na implementação antiga).
      for (const id of ['dashboard', 'scanner', 'tools', 'collaborators', 'history', 'users']) {
        const label = page.locator(`#nav-${id} .shell-nav-label`);

        await expect(label).toBeVisible();
        expect((await label.innerText()).trim().length).toBeGreaterThan(0);
      }
    });
  }

  test('foco vai para o drawer; Esc fecha e devolve o foco ao botão', async ({ page }) => {
    await resize(page, 820, 1000);

    const toggle = page.locator('#btn-sidebar-toggle');

    await toggle.click();
    await expect(page.locator('#nav-dashboard')).toBeFocused(); // item ativo recebe o foco
    await page.keyboard.press('Escape');
    await expect(page.locator('#main-sidebar')).toBeHidden();
    await expect(page.locator('#sidebar-overlay')).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('o foco fica preso no drawer enquanto ele está aberto (Tab e Shift+Tab)', async ({
    page,
  }) => {
    await resize(page, 820, 1000);
    await page.locator('#btn-sidebar-toggle').click();

    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() =>
          document.getElementById('main-sidebar').contains(document.activeElement)
        )
      ).toBe(true);
    }

    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(
        await page.evaluate(() =>
          document.getElementById('main-sidebar').contains(document.activeElement)
        )
      ).toBe(true);
    }
  });

  test('clicar no destino fecha o drawer e navega; clicar no overlay também fecha', async ({
    page,
  }) => {
    await resize(page, 820, 1000);
    await page.locator('#btn-sidebar-toggle').click();
    await page.getByRole('link', { name: 'Ferramentas', exact: true }).click();
    await expectActiveTab(page, 'management');
    await expect(page.locator('#main-sidebar')).toBeHidden();

    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('#main-sidebar')).toBeVisible();
    await page.locator('#sidebar-overlay').click({ position: { x: 780, y: 500 } });
    await expect(page.locator('#main-sidebar')).toBeHidden();
  });

  test('abrir o menu da conta fecha o drawer', async ({ page }) => {
    await resize(page, 820, 1000);
    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('#main-sidebar')).toBeVisible();
    await page.evaluate(() => window.App.UI.toggleUserMenu());
    await expect(page.locator('#main-sidebar')).toBeHidden();
  });

  test('reduced-motion: a animação do drawer é encerrada', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await resize(page, 820, 1000);

    const duration = await page
      .locator('#main-sidebar')
      .evaluate((el) => getComputedStyle(el).transitionDuration);

    for (const part of duration.split(',')) {
      expect(Number.parseFloat(part)).toBeLessThan(0.001);
    }
  });
});

test.describe('MOBILE < 768 — barra inferior + "Mais"', () => {
  for (const width of [320, 375, 390, 430, 767]) {
    test(`${width}px ADMIN: 4 destinos + Mais, rótulos visíveis, alvo de toque e sem sobreposição`, async ({
      page,
    }) => {
      await resize(page, width, 800);
      await loginAs(page, E2E_USERS.admin);
      await expect(page.locator('html')).toHaveAttribute('data-shell-mode', 'mobile');
      await expect(page.locator('#main-sidebar')).toBeHidden();
      await expect(page.locator('#btn-sidebar-toggle')).toBeHidden();

      const nav = page.getByRole('navigation', { name: 'Navegação inferior' });

      await expect(nav).toBeVisible();

      const items = nav.locator('a[data-nav-id], #bnav-more');

      await expect(items).toHaveCount(5); // 4 destinos primários + Mais
      await expect(nav.locator('a[data-nav-id]')).toHaveText([
        'Painel',
        'Retirar/Devolver',
        'Ferramentas',
        'Colaboradores',
      ]);

      const geometry = await items.evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          const label = node.querySelector('.shell-bnav-label');
          const labelRect = label.getBoundingClientRect();
          const icon = node.querySelector('svg');

          return {
            name: label.textContent.trim(),
            height: Math.round(rect.height),
            width: rect.width,
            left: rect.left,
            right: rect.right,
            labelVisible:
              labelRect.width > 0 &&
              labelRect.height > 0 &&
              getComputedStyle(label).visibility === 'visible',
            overflow: node.scrollWidth > node.clientWidth + 1,
            iconHidden: icon.getAttribute('aria-hidden'),
          };
        })
      );

      for (const item of geometry) {
        expect(item.labelVisible, `${item.name}: rótulo visível`).toBe(true);
        expect(item.height, `${item.name}: alvo de toque`).toBeGreaterThanOrEqual(44);
        expect(item.overflow, `${item.name}: texto transbordando`).toBe(false);
        expect(item.iconHidden, `${item.name}: ícone decorativo`).toBe('true');
        expect(item.left).toBeGreaterThanOrEqual(0);
        expect(item.right).toBeLessThanOrEqual(width + 1);
      }

      // O conteúdo nunca fica escondido sob a barra: padding inferior >= altura da barra.
      const layout = await page.evaluate(() => ({
        navHeight: document.getElementById('bottom-nav').getBoundingClientRect().height,
        padding: parseFloat(
          getComputedStyle(document.querySelector('.main-content-wrapper')).paddingBottom
        ),
        horizontalOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));

      expect(layout.padding).toBeGreaterThanOrEqual(layout.navHeight);
      expect(layout.horizontalOverflow).toBe(false);
    });
  }

  test('último conteúdo da tela é alcançável acima da barra (rolar até o fim)', async ({
    page,
  }) => {
    await resize(page, 390, 700);
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'management');
    await expect(page.locator('#crud-list')).toContainText('Furadeira de Impacto');

    const gap = await page.evaluate(async () => {
      const scroller = document.getElementById('main-content-scroll');

      scroller.scrollTop = scroller.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const wrapper = document.querySelector('.main-content-wrapper').getBoundingClientRect();
      const last = [...document.querySelectorAll('#tab-management > *')]
        .filter((n) => n.offsetHeight > 0)
        .pop()
        .getBoundingClientRect();
      const navTop = document.getElementById('bottom-nav').getBoundingClientRect().top;

      return { lastBottom: last.bottom, navTop, wrapperBottom: wrapper.bottom };
    });

    expect(gap.lastBottom).toBeLessThanOrEqual(gap.navTop);
  });

  test('ADMIN: "Mais" lista só Auditoria e Usuários e acessos + ações de conta; Esc fecha', async ({
    page,
  }) => {
    await resize(page, 390, 800);
    await loginAs(page, E2E_USERS.admin);

    const more = page.locator('#bnav-more');

    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');

    const sheet = page.locator('#more-sheet');

    await expect(sheet).toBeVisible();
    await expect(sheet.locator('#more-nav [data-nav-id]')).toHaveText([
      'Auditoria',
      'Usuários e acessos',
    ]);
    for (const name of ['Meu perfil', 'Alterar senha', 'Alternar tema', 'Sair']) {
      await expect(sheet.getByRole('button', { name, exact: true })).toBeVisible();
    }

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  test('ADMIN: destino em "Mais" navega, fecha a folha e destaca o botão Mais', async ({
    page,
  }) => {
    await resize(page, 390, 800);
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'history');
    await expectActiveTab(page, 'history');
    await expect(page.locator('#bnav-more')).toHaveAttribute('data-active', 'true');
    await expect(page.locator('#bottom-nav [aria-current="page"]')).toHaveCount(0);

    await openTab(page, 'users');
    await expectActiveTab(page, 'users');
  });

  test('PADRÃO: 4 destinos, "Mais" sem destinos extras (só conta)', async ({ page }) => {
    await resize(page, 390, 800);
    await loginAs(page, E2E_USERS.standard);
    await expect(page.locator('#bottom-nav a[data-nav-id]')).toHaveText([
      'Painel',
      'Retirar/Devolver',
      'Ferramentas',
      'Colaboradores',
    ]);
    await page.locator('#bnav-more').click();
    await expect(page.locator('#more-nav [data-nav-id]')).toHaveCount(0);
    await expect(
      page.locator('#more-sheet').getByRole('button', { name: 'Sair', exact: true })
    ).toBeVisible();
  });

  test('RESTRITO: 3 destinos + Mais; Colaboradores e áreas administrativas inexistentes', async ({
    page,
  }) => {
    await resize(page, 390, 800);
    await loginAs(page, E2E_USERS.restricted);
    await expect(page.locator('#bottom-nav a[data-nav-id]')).toHaveText([
      'Painel',
      'Retirar/Devolver',
      'Ferramentas',
    ]);
    await page.locator('#bnav-more').click();
    await expect(page.locator('#more-nav [data-nav-id]')).toHaveCount(0);

    for (const id of ['collaborators', 'history', 'users']) {
      await expect(page.locator(`[data-nav-id="${id}"]`)).toHaveCount(0);
    }
  });

  test('ações de conta no "Mais": Meu perfil abre o modal; Alternar tema alterna o tema', async ({
    page,
  }) => {
    await resize(page, 390, 800);
    await loginAs(page, E2E_USERS.admin);

    await page.locator('#bnav-more').click();
    await page
      .locator('#more-sheet')
      .getByRole('button', { name: 'Meu perfil', exact: true })
      .click();
    await expect(page.locator('#profile-modal')).toBeVisible();
    await page.keyboard.press('Escape');

    const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));

    await page.locator('#bnav-more').click();
    await page
      .locator('#more-sheet')
      .getByRole('button', { name: 'Alternar tema', exact: true })
      .click();
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
      !before
    );
  });

  test('item ativo da barra inferior usa aria-current e acompanha back/forward', async ({
    page,
  }) => {
    await resize(page, 390, 800);
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'scanner');
    await expect(page.locator('#bottom-nav [aria-current="page"]')).toHaveAttribute(
      'data-nav-id',
      'scanner'
    );
    await openTab(page, 'management');
    await page.goBack();
    await expect(page.locator('#bottom-nav [aria-current="page"]')).toHaveAttribute(
      'data-nav-id',
      'scanner'
    );
  });
});

test.describe('MUDANÇA DE BREAKPOINT em tempo real', () => {
  test('1440 -> 390 -> 900 -> 1100 -> 1440 troca o shell sem recarregar', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);

    await expect(page.locator('html')).toHaveAttribute('data-shell-mode', 'desktop');
    expect(await state(page)).toBe('expanded');

    await resize(page, 390, 800);
    await expect(page.locator('html')).toHaveAttribute('data-shell-mode', 'mobile');
    await expect(page.locator('#bottom-nav')).toBeVisible();
    await expect(page.locator('#main-sidebar')).toBeHidden();

    await resize(page, 900, 900);
    await expect(page.locator('html')).toHaveAttribute('data-shell-mode', 'tablet');
    await expect(page.locator('#bottom-nav')).toBeHidden();
    await expect(page.locator('#btn-sidebar-toggle')).toBeVisible();
    expect(await state(page)).toBe('closed');

    await resize(page, 1100, 900);
    await expect(page.locator('html')).toHaveAttribute('data-shell-mode', 'notebook');
    expect(await state(page)).toBe('collapsed');

    await resize(page, 1440, 900);
    await expect(page.locator('html')).toHaveAttribute('data-shell-mode', 'desktop');
    expect(await state(page)).toBe('expanded');
    await expectActiveTab(page, 'dashboard');
  });

  test('drawer aberto é encerrado ao cruzar para desktop e a tela ativa é preservada', async ({
    page,
  }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'management');
    await resize(page, 900, 900);
    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('#sidebar-overlay')).toBeVisible();

    await resize(page, 1440, 900);
    await expect(page.locator('#sidebar-overlay')).toBeHidden();
    expect(await state(page)).toBe('expanded');
    await expectActiveTab(page, 'management');
  });

  test('"Mais" aberto é encerrado ao sair do mobile', async ({ page }) => {
    await resize(page, 390, 800);
    await loginAs(page, E2E_USERS.admin);
    await page.locator('#bnav-more').click();
    await expect(page.locator('#more-sheet')).toBeVisible();

    await resize(page, 900, 900);
    await expect(page.locator('#more-sheet')).toBeHidden();
  });
});

test.describe('foco visível na navegação (foundation 1-C)', () => {
  test('Tab até um item da sidebar mostra contorno de foco sólido de 2px', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await page.locator('#nav-dashboard').focus();
    await page.keyboard.press('Tab');

    const focused = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);

      return {
        navId: document.activeElement.dataset.navId,
        style: style.outlineStyle,
        width: style.outlineWidth,
      };
    });

    expect(focused.navId).toBe('scanner');
    expect(focused.style).toBe('solid');
    expect(focused.width).toBe('2px');
  });
});
