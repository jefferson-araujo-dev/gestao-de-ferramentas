import { expect, test } from '@playwright/test';

/**
 * Regressão: no iPhone, o scroll vertical deriva horizontalmente e o handler
 * global de swipe abria a sidebar sem o usuário tocar no botão hambúrguer.
 * A abertura por swipe foi removida; apenas o hambúrguer abre.
 */
test.describe('Responsividade da sidebar mobile', () => {
  test('@sidebar-mobile só abre pelo hambúrguer', async ({ page }, testInfo) => {
    const viewport = page.viewportSize();

    test.skip(
      !viewport || viewport.width >= 1024,
      'A sidebar mobile só existe abaixo de 1024px.',
    );

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Revela o app sem depender de autenticação, como nos demais specs.
    await page.evaluate(() => {
      const login = document.getElementById('login-screen');
      const app = document.getElementById('main-app');

      if (!login || !app) {
        throw new Error('Estrutura principal da aplicação não encontrada.');
      }

      login.classList.add('hidden');
      app.classList.remove('hidden');
    });

    await page.waitForTimeout(200);

    const sidebar = page.locator('#main-sidebar');
    const overlay = page.locator('#sidebar-overlay');

    await expect(sidebar).toHaveCount(1);

    // Fora da viewport: a borda direita da sidebar não pode passar de x = 0.
    const expectClosed = async (label) => {
      await page.waitForTimeout(400); // transition-transform duration-300
      const box = await sidebar.boundingBox();

      expect(box, label + ': sidebar sem boundingBox').not.toBeNull();
      expect(box.x + box.width, label).toBeLessThanOrEqual(1);
    };

    const expectOpen = async (label) => {
      await page.waitForTimeout(400);
      const box = await sidebar.boundingBox();

      expect(box, label + ': sidebar sem boundingBox').not.toBeNull();
      expect(box.x, label).toBeGreaterThanOrEqual(-1);
      expect(box.width, label).toBeGreaterThan(0);
    };

    /**
     * Reproduz o gesto que antes satisfazia `diffX < -50` em handleSwipe:
     * touchstart e touchend reais no document, com screenX derivando para a
     * direita enquanto o dedo sobe (scroll vertical típico de polegar).
     */
    const verticalScrollGestureWithDrift = async () => {
      await page.evaluate(() => {
        const target = document.body;

        const makeTouch = (screenX, screenY) =>
          new Touch({
            identifier: 1,
            target,
            screenX,
            screenY,
            clientX: screenX,
            clientY: screenY,
          });

        // startX = 40, endX = 140  ->  diffX = 40 - 140 = -100  (< -50)
        const start = makeTouch(40, 600);
        const end = makeTouch(140, 120);

        target.dispatchEvent(
          new TouchEvent('touchstart', {
            bubbles: true,
            cancelable: true,
            changedTouches: [start],
            targetTouches: [start],
            touches: [start],
          }),
        );

        target.dispatchEvent(
          new TouchEvent('touchend', {
            bubbles: true,
            cancelable: true,
            changedTouches: [end],
            targetTouches: [],
            touches: [],
          }),
        );
      });
    };

    // 1. Estado inicial: fechada.
    await expectClosed('estado inicial');

    // 2 e 3. Gesto de scroll com deriva horizontal > 50px não pode abrir.
    await verticalScrollGestureWithDrift();
    await expectClosed('após gesto de scroll com deriva horizontal');

    // 4 e 5. O hambúrguer abre.
    const hamburger = page
      .locator('header button[onclick="App.UI.toggleSidebar()"]')
      .first();

    await expect(hamburger).toBeVisible();
    await hamburger.click();
    await expectOpen('após clique no hambúrguer');
    await expect(overlay).toBeVisible();

    // 6 e 7. O mecanismo existente (overlay) fecha.
    // O overlay cobre a viewport inteira, mas a sidebar aberta fica por cima
    // na borda esquerda (z-50): clicar longe dela, próximo à borda direita.
    await overlay.click({
      position: {
        x: viewport.width - 10,
        y: Math.floor(viewport.height / 2),
      },
    });
    await expectClosed('após clique no overlay');

    // 8. Novo gesto de scroll não reabre.
    await verticalScrollGestureWithDrift();
    await expectClosed('após novo gesto de scroll');

    // 9. Sidebar fechada não pode gerar rolagem horizontal.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    const context =
      'Projeto: ' +
      testInfo.project.name +
      '\nViewport: ' +
      viewport.width +
      ' x ' +
      viewport.height;

    expect(overflow.scrollWidth, context).toBeLessThanOrEqual(
      overflow.clientWidth + 1,
    );
  });
});
