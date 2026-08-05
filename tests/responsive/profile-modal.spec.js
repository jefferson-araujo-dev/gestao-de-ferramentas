import { expect, test } from '@playwright/test';

test.describe('Responsividade do modal de perfil', () => {
  test('@profile-modal mantém cabeçalho e ações acessíveis', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      const login = document.getElementById('login-screen');
      const app = document.getElementById('main-app');
      const modal = document.getElementById('profile-modal');

      if (!login || !app || !(modal instanceof HTMLDialogElement)) {
        throw new Error('Estrutura do modal de perfil não encontrada.');
      }

      login.classList.add('hidden');
      app.classList.remove('hidden');

      if (modal.open) {
        modal.close();
      }

      modal.showModal();

      const nextFrame = () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });

      await nextFrame();

      const parts = [...modal.children].filter(
        (element) => element instanceof HTMLElement,
      );

      if (parts.length !== 3) {
        throw new Error(
          'Estrutura inesperada do modal: ' + parts.length + ' blocos.',
        );
      }

      const [header, body, footer] = parts;
      const buttons = [...footer.querySelectorAll('button')];

      const rect = (element) => {
        const value = element.getBoundingClientRect();

        return {
          left: value.left,
          right: value.right,
          top: value.top,
          bottom: value.bottom,
        };
      };

      const footerBefore = rect(footer);

      body.scrollTop = body.scrollHeight;
      await nextFrame();

      return {
        viewport: {
          width: document.documentElement.clientWidth,
          height: window.innerHeight,
        },
        dialog: {
          ...rect(modal),
          display: getComputedStyle(modal).display,
          flexDirection: getComputedStyle(modal).flexDirection,
        },
        body: {
          overflowY: getComputedStyle(body).overflowY,
          minHeight: getComputedStyle(body).minHeight,
        },
        footer: {
          before: footerBefore,
          after: rect(footer),
          flexShrink: getComputedStyle(footer).flexShrink,
        },
        buttons: buttons.map(rect),
      };
    });

    const context =
      'Projeto: ' +
      testInfo.project.name +
      '\nViewport: ' +
      result.viewport.width +
      ' x ' +
      result.viewport.height;

    expect(result.dialog.display, context).toBe('flex');
    expect(result.dialog.flexDirection, context).toBe('column');
    expect(result.body.overflowY, context).toBe('auto');
    expect(result.body.minHeight, context).toBe('0px');
    expect(result.footer.flexShrink, context).toBe('0');
    expect(result.buttons, context).toHaveLength(2);

    expect(result.dialog.left, context).toBeGreaterThanOrEqual(-1);
    expect(result.dialog.right, context).toBeLessThanOrEqual(
      result.viewport.width + 1,
    );
    expect(result.dialog.top, context).toBeGreaterThanOrEqual(-1);
    expect(result.dialog.bottom, context).toBeLessThanOrEqual(
      result.viewport.height + 1,
    );

    expect(
      Math.abs(result.footer.after.top - result.footer.before.top),
      context,
    ).toBeLessThanOrEqual(1);

    expect(
      Math.abs(result.footer.after.bottom - result.footer.before.bottom),
      context,
    ).toBeLessThanOrEqual(1);

    for (const button of result.buttons) {
      expect(button.left, context).toBeGreaterThanOrEqual(-1);
      expect(button.right, context).toBeLessThanOrEqual(
        result.viewport.width + 1,
      );
      expect(button.top, context).toBeGreaterThanOrEqual(-1);
      expect(button.bottom, context).toBeLessThanOrEqual(
        result.viewport.height + 1,
      );
    }
  });
});
