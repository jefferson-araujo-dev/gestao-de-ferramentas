import { expect, test } from '@playwright/test';

test.describe('Responsividade do modal de métricas', () => {
  test('@metrics-modal mantém cabeçalho e ações acessíveis', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      const login = document.getElementById('login-screen');
      const app = document.getElementById('main-app');
      const modal = document.getElementById('metrics-modal');
      const content = document.getElementById('metrics-modal-content');

      if (!login || !app || !(modal instanceof HTMLDialogElement)) {
        throw new Error('Estrutura do modal de métricas não encontrada.');
      }

      if (!(content instanceof HTMLElement)) {
        throw new Error('Container #metrics-modal-content não encontrado.');
      }

      login.classList.add('hidden');
      app.classList.remove('hidden');

      // Conteúdo temporário apenas em memória, para exercitar altura realista.
      // Nada é gravado, nem enviado ao Firebase.
      const originalContent = content.innerHTML;

      const stub = document.createElement('div');
      stub.dataset.testStub = 'metrics';
      stub.className = 'flex flex-col gap-3';

      for (let index = 0; index < 12; index += 1) {
        const card = document.createElement('div');
        card.className =
          'p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800';
        card.textContent = 'Métrica simulada ' + (index + 1);
        stub.appendChild(card);
      }

      content.replaceChildren(stub);

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
        content.innerHTML = originalContent;
        throw new Error(
          'Estrutura inesperada do modal: ' + parts.length + ' blocos.',
        );
      }

      const [header, body, footer] = parts;

      if (body !== content) {
        content.innerHTML = originalContent;
        throw new Error(
          'O corpo do modal de métricas não é #metrics-modal-content.',
        );
      }

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
        content.innerHTML = originalContent;
        throw new Error('Botão de fechar das métricas não encontrado.');
      }

      const cards = [...stub.children].filter(
        (element) => element instanceof HTMLElement,
      );
      const firstCard = cards[0];
      const lastCard = cards[cards.length - 1];

      const footerBefore = rect(footer);

      body.scrollTop = 0;
      await nextFrame();

      const firstReachable = rect(firstCard);

      body.scrollTop = body.scrollHeight;
      await nextFrame();

      const lastReachable = rect(lastCard);
      const scrolled = body.scrollTop;

      const payload = {
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
          cards: cards.length,
        },
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

      modal.close();
      content.innerHTML = originalContent;

      return payload;
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
    expect(result.body.bottom - result.body.top, context).toBeGreaterThan(120);
    expect(result.body.scrollHeight, context).toBeGreaterThanOrEqual(
      result.body.clientHeight,
    );
    expect(result.header.closeInteractive, context).toBe(true);
    expect(result.content.cards, context).toBe(12);
    expect(result.buttons, context).toHaveLength(1);

    if (result.body.scrollHeight > result.body.clientHeight) {
      expect(result.body.scrolled, context).toBeGreaterThan(0);
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
