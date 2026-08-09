import { expect, test } from '@playwright/test';

test.describe('Responsividade do modal de ferramenta', () => {
  test('@tool-modal mantém cabeçalho e ações acessíveis', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      const login = document.getElementById('login-screen');
      const app = document.getElementById('main-app');
      const modal = document.getElementById('crud-modal');

      if (!login || !app || !(modal instanceof HTMLDialogElement)) {
        throw new Error('Estrutura do modal de ferramenta não encontrada.');
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

      const hitTest = (element) => {
        const value = element.getBoundingClientRect();
        const x = value.left + value.width / 2;
        const y = value.top + value.height / 2;
        const target = document.elementFromPoint(x, y);

        return Boolean(target && element.contains(target));
      };

      const closeButton = header.querySelector('button');

      if (!(closeButton instanceof HTMLElement)) {
        throw new Error('Botão de fechar da ferramenta não encontrado.');
      }

      const bodyChildren = [...body.children].filter(
        (element) =>
          element instanceof HTMLElement &&
          element.getBoundingClientRect().height > 0,
      );
      const firstContent = bodyChildren[0];
      const lastContent = bodyChildren[bodyChildren.length - 1];

      if (!firstContent || !lastContent) {
        throw new Error('Conteúdo do corpo do modal de ferramenta não encontrado.');
      }

      const footerBefore = rect(footer);

      body.scrollTop = 0;
      await nextFrame();

      const firstReachable = rect(firstContent);

      body.scrollTop = body.scrollHeight;
      await nextFrame();

      const lastReachable = rect(lastContent);
      const scrolled = body.scrollTop;

      return {
        viewport: {
          width: document.documentElement.clientWidth,
          height: window.innerHeight,
        },
        documentScrollWidth: document.documentElement.scrollWidth,
        open: modal.open,
        dialog: {
          ...rect(modal),
          display: getComputedStyle(modal).display,
          overflowY: getComputedStyle(modal).overflowY,
        },
        header: {
          ...rect(header),
          closeInteractive: hitTest(closeButton),
        },
        body: {
          ...rect(body),
          overflowY: getComputedStyle(body).overflowY,
          minHeight: getComputedStyle(body).minHeight,
          clientHeight: body.clientHeight,
          scrollHeight: body.scrollHeight,
          scrolled,
        },
        content: {
          first: firstReachable,
          last: lastReachable,
        },
        fields: [
          'crud-next-maintenance',
          'crud-notes',
          'crud-code',
          'crud-category',
          'crud-name',
        ].map((id) => {
          const element = document.getElementById(id);

          if (!(element instanceof HTMLElement)) {
            throw new Error(
              'Campo obrigatório da ferramenta não encontrado: ' + id,
            );
          }

          return {
            id,
            ...rect(element),
          };
        }),
        previewExists:
          document.getElementById('crud-image-preview') instanceof
          HTMLImageElement,
        manualInputExists:
          document.getElementById('crud-manual') instanceof HTMLInputElement,
        imageInputExists:
          document.getElementById('crud-image') instanceof HTMLInputElement,
        saveButtonExists:
          document.getElementById('btn-save-tool') instanceof HTMLElement,
        footer: {
          before: footerBefore,
          after: rect(footer),
        },
        buttons: buttons.map((button) => ({
          ...rect(button),
          text: (button.textContent || '').trim(),
          interactive: hitTest(button),
        })),
      };
    });

    const context =
      'Projeto: ' +
      testInfo.project.name +
      '\nViewport: ' +
      result.viewport.width +
      ' x ' +
      result.viewport.height;

    expect(result.open, context).toBe(true);
    expect(result.dialog.display, context).not.toBe('none');
    expect(result.dialog.overflowY, context).toBe('hidden');
    expect(result.body.overflowY, context).toBe('auto');
    expect(result.body.minHeight, context).toBe('0px');
    expect(result.body.bottom - result.body.top, context).toBeGreaterThan(150);
    expect(result.body.scrollHeight, context).toBeGreaterThanOrEqual(
      result.body.clientHeight,
    );
    expect(result.header.closeInteractive, context).toBe(true);
    expect(result.previewExists, context).toBe(true);
    expect(result.manualInputExists, context).toBe(true);
    expect(result.imageInputExists, context).toBe(true);
    expect(result.saveButtonExists, context).toBe(true);
    expect(result.buttons, context).toHaveLength(2);

    if (result.body.scrollHeight > result.body.clientHeight) {
      expect(result.body.scrolled, context).toBeGreaterThan(0);
    }

    for (const field of result.fields) {
      expect(
        field.bottom - field.top,
        context + '\nCampo: ' + field.id,
      ).toBeGreaterThanOrEqual(38);
      expect(
        field.right,
        context + '\nCampo: ' + field.id,
      ).toBeLessThanOrEqual(result.viewport.width + 1);
    }

    expect(result.dialog.left, context).toBeGreaterThanOrEqual(-1);
    expect(result.dialog.right, context).toBeLessThanOrEqual(
      result.viewport.width + 1,
    );
    expect(result.dialog.top, context).toBeGreaterThanOrEqual(-1);
    expect(result.dialog.bottom, context).toBeLessThanOrEqual(
      result.viewport.height + 1,
    );

    expect(result.documentScrollWidth, context).toBeLessThanOrEqual(
      result.viewport.width + 1,
    );

    expect(result.content.first.top, context).toBeGreaterThanOrEqual(
      result.body.top - 1,
    );
    expect(result.content.first.bottom, context).toBeLessThanOrEqual(
      result.body.bottom + 1,
    );
    expect(result.content.last.bottom, context).toBeLessThanOrEqual(
      result.body.bottom + 1,
    );
    expect(result.content.last.bottom, context).toBeGreaterThan(
      result.body.top,
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
      expect(button.interactive, context + '\nBotão: ' + button.text).toBe(
        true,
      );
    }
  });
});
