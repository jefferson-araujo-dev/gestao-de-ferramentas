import { expect, test } from '@playwright/test';

test.describe('Responsividade do modal de colaborador', () => {
  test('@collaborator-modal mantém cabeçalho e ações acessíveis', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      const login = document.getElementById('login-screen');
      const app = document.getElementById('main-app');
      const modal = document.getElementById('crud-collab-modal');

      if (!login || !app || !(modal instanceof HTMLDialogElement)) {
        throw new Error('Estrutura do modal de colaborador não encontrada.');
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
          overflowY: getComputedStyle(modal).overflowY,
        },
        body: {
          ...rect(body),
          overflowY: getComputedStyle(body).overflowY,
          minHeight: getComputedStyle(body).minHeight,
          clientHeight: body.clientHeight,
          scrollHeight: body.scrollHeight,
        },
        fields: [
          'crud-collab-badge',
          'crud-collab-name',
          'crud-collab-role',
          'crud-collab-phone',
        ].map((id) => {
          const element = document.getElementById(id);

          if (!(element instanceof HTMLElement)) {
            throw new Error(
              'Campo obrigatório do colaborador não encontrado: ' + id,
            );
          }

          return {
            id,
            ...rect(element),
          };
        }),
        imageInputExists:
          document.getElementById('crud-collab-image') instanceof HTMLInputElement,
        footer: {
          before: footerBefore,
          after: rect(footer),
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

    expect(result.dialog.display, context).not.toBe('none');
    expect(result.dialog.overflowY, context).toBe('hidden');
    expect(result.body.overflowY, context).toBe('auto');
    expect(result.body.minHeight, context).toBe('0px');
    expect(result.body.bottom - result.body.top, context).toBeGreaterThan(150);
    expect(result.body.scrollHeight, context).toBeGreaterThanOrEqual(
      result.body.clientHeight,
    );
    expect(result.imageInputExists, context).toBe(true);
    expect(result.buttons, context).toHaveLength(2);

    for (const field of result.fields) {
      expect(field.bottom - field.top, context).toBeGreaterThanOrEqual(40);
    }

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

    expect(result.footer.after.top, context).toBeGreaterThanOrEqual(-1);
    expect(result.footer.after.bottom, context).toBeLessThanOrEqual(
      result.viewport.height + 1,
    );

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
