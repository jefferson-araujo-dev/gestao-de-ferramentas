import { expect, test } from './support/network-guard.js';

const HORIZONTAL_TOLERANCE_PX = 1;

const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role="button"]'
].join(', ');

test.describe('Responsividade da tela inicial', () => {
  test('mantém conteúdo e controles dentro da viewport', async ({
    page
  }, testInfo) => {
    await page.goto('/', {
      waitUntil: 'domcontentloaded'
    });

    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    });

    await page.waitForTimeout(500);

    const loginScreen = page.locator('#login-screen');
    const emailField = page.locator('#login-email');
    const passwordField = page.locator('#login-password');
    const mainApp = page.locator('#main-app');

    await expect(loginScreen).toBeVisible();
    await expect(emailField).toBeVisible();
    await expect(passwordField).toBeVisible();

    await expect(mainApp).toHaveClass(/(^|\s)hidden(\s|$)/);
    await expect(mainApp).toBeHidden();

    const authenticatedOnlySelectors = [
      '#main-sidebar',
      '#nav-dashboard',
      '#nav-scanner',
      '#nav-collaborators',
      '#nav-tools',
      '#btn-logout-sidebar'
    ];

    for (const selector of authenticatedOnlySelectors) {
      await expect(page.locator(selector)).toBeHidden();
    }

    const diagnostics = await page.evaluate(
      ({ interactiveSelector, tolerance }) => {
        const documentElement = document.documentElement;
        const body = document.body;
        const viewportWidth = documentElement.clientWidth;

        const pageScrollWidth = Math.max(
          documentElement.scrollWidth,
          body?.scrollWidth || 0
        );

        const isRelevantForHorizontalClipping = (element) => {
          const style = window.getComputedStyle(element);
          const rectangle = element.getBoundingClientRect();

          const intersectsVerticalViewport =
            rectangle.bottom > 0 &&
            rectangle.top < window.innerHeight;

          const intersectsHorizontalViewport =
            rectangle.right > 0 &&
            rectangle.left < viewportWidth;

          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 &&
            rectangle.width > 0 &&
            rectangle.height > 0 &&
            intersectsVerticalViewport &&
            intersectsHorizontalViewport
          );
        };

        const getElementLabel = (element) => {
          const rawLabel =
            element.getAttribute('aria-label') ||
            element.getAttribute('title') ||
            element.id ||
            element.getAttribute('name') ||
            element.textContent ||
            element.tagName.toLowerCase();

          return String(rawLabel)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 100);
        };

        const horizontalOffenders = Array.from(
          document.querySelectorAll(interactiveSelector)
        )
          .filter(isRelevantForHorizontalClipping)
          .map((element) => {
            const rectangle = element.getBoundingClientRect();

            return {
              element: element.tagName.toLowerCase(),
              label: getElementLabel(element),
              left: Math.round(rectangle.left * 100) / 100,
              right: Math.round(rectangle.right * 100) / 100,
              width: Math.round(rectangle.width * 100) / 100
            };
          })
          .filter(
            ({ left, right }) =>
              left < -tolerance ||
              right > viewportWidth + tolerance
          );

        return {
          viewportWidth,
          pageScrollWidth,
          horizontalOffenders
        };
      },
      {
        interactiveSelector: INTERACTIVE_SELECTOR,
        tolerance: HORIZONTAL_TOLERANCE_PX
      }
    );

    expect(
      diagnostics.pageScrollWidth,
      [
        `Projeto: ${testInfo.project.name}`,
        `Viewport: ${diagnostics.viewportWidth}px`,
        `Largura rolável: ${diagnostics.pageScrollWidth}px`,
        'A página possui rolagem horizontal inesperada.'
      ].join('\n')
    ).toBeLessThanOrEqual(
      diagnostics.viewportWidth + HORIZONTAL_TOLERANCE_PX
    );

    expect(
      diagnostics.horizontalOffenders,
      [
        `Projeto: ${testInfo.project.name}`,
        'Existem controles visíveis cortados horizontalmente:',
        JSON.stringify(
          diagnostics.horizontalOffenders,
          null,
          2
        )
      ].join('\n')
    ).toEqual([]);
  });
});

test.describe('Responsividade do modal de manutencao', () => {
  test('@maintenance-modal mantem formulario e acoes acessiveis', async ({
    page
  }, testInfo) => {
    await page.goto('/', {
      waitUntil: 'domcontentloaded'
    });

    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    });

    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const loginScreen =
        document.getElementById('login-screen');

      const mainApp =
        document.getElementById('main-app');

      const modal =
        document.getElementById('tool-maintenance-modal');

      const toolName =
        document.getElementById('tool-maintenance-name');

      const toolId =
        document.getElementById('tool-maintenance-id');

      const performedAt =
        document.getElementById(
          'tool-maintenance-performed-at'
        );

      const nextMaintenance =
        document.getElementById('tool-maintenance-next');

      const notes =
        document.getElementById('tool-maintenance-notes');

      if (
        !loginScreen ||
        !mainApp ||
        !(modal instanceof HTMLDialogElement) ||
        !toolName ||
        !toolId ||
        !performedAt ||
        !nextMaintenance ||
        !notes
      ) {
        throw new Error(
          'Estrutura obrigatoria do modal nao encontrada.'
        );
      }

      loginScreen.classList.add('hidden');
      mainApp.classList.remove('hidden');

      toolName.textContent =
        'Furadeira de Teste (PAT-001)';

      toolId.value = 'playwright-tool-id';
      performedAt.value = '2026-08-04';
      nextMaintenance.value = '2026-09-04';

      notes.value =
        'Revisao preventiva, limpeza, lubrificacao e teste operacional.';

      modal.showModal();
    });

    const modal =
      page.locator('#tool-maintenance-modal');

    const form =
      page.locator('#tool-maintenance-form');

    const closeButton =
      modal.getByRole('button', {
        name: 'Fechar'
      });

    const performedAt =
      page.locator('#tool-maintenance-performed-at');

    const nextMaintenance =
      page.locator('#tool-maintenance-next');

    const notes =
      page.locator('#tool-maintenance-notes');

    const submitButton =
      page.locator('#tool-maintenance-submit');

    await expect(modal).toBeVisible();
    await expect(form).toBeVisible();
    await expect(closeButton).toBeVisible();
    await expect(performedAt).toBeVisible();
    await expect(nextMaintenance).toBeVisible();
    await expect(submitButton).toBeVisible();

    await expect(closeButton).toBeInViewport();
    await expect(submitButton).toBeInViewport();

    const diagnostics = await page.evaluate(() => {
      const modalElement =
        document.getElementById('tool-maintenance-modal');

      const formElement =
        document.getElementById('tool-maintenance-form');

      const hiddenId =
        document.getElementById('tool-maintenance-id');

      const scrollArea =
        hiddenId?.parentElement || null;

      const submit =
        document.getElementById('tool-maintenance-submit');

      const footer =
        submit?.parentElement || null;

      const close =
        modalElement?.querySelector(
          'button[aria-label="Fechar"]'
        );

      const getRectangle = (element) => {
        if (!element) {
          return null;
        }

        const rectangle =
          element.getBoundingClientRect();

        return {
          left: rectangle.left,
          right: rectangle.right,
          top: rectangle.top,
          bottom: rectangle.bottom,
          width: rectangle.width,
          height: rectangle.height
        };
      };

      const getDimensions = (element) => {
        if (!element) {
          return null;
        }

        return {
          clientWidth: element.clientWidth,
          clientHeight: element.clientHeight,
          scrollWidth: element.scrollWidth,
          scrollHeight: element.scrollHeight
        };
      };

      const modalStyle = modalElement
        ? window.getComputedStyle(modalElement)
        : null;

      const formStyle = formElement
        ? window.getComputedStyle(formElement)
        : null;

      const scrollAreaStyle = scrollArea
        ? window.getComputedStyle(scrollArea)
        : null;

      const footerStyle = footer
        ? window.getComputedStyle(footer)
        : null;

      const documentElement =
        document.documentElement;

      return {
        viewport: {
          width: documentElement.clientWidth,
          height: window.innerHeight
        },

        page: {
          scrollWidth: Math.max(
            documentElement.scrollWidth,
            document.body?.scrollWidth || 0
          )
        },

        modal: {
          exists: Boolean(modalElement),
          open: Boolean(modalElement?.open),
          rectangle: getRectangle(modalElement),
          dimensions: getDimensions(modalElement),
          display: modalStyle?.display || null
        },

        form: {
          exists: Boolean(formElement),
          rectangle: getRectangle(formElement),
          dimensions: getDimensions(formElement),
          display: formStyle?.display || null,
          flexDirection:
            formStyle?.flexDirection || null
        },

        scrollArea: {
          exists: Boolean(scrollArea),
          rectangle: getRectangle(scrollArea),
          dimensions: getDimensions(scrollArea),
          overflowY:
            scrollAreaStyle?.overflowY || null,
          minHeight:
            scrollAreaStyle?.minHeight || null
        },

        footer: {
          exists: Boolean(footer),
          rectangle: getRectangle(footer),
          flexShrink:
            footerStyle?.flexShrink || null
        },

        submit: {
          exists: Boolean(submit),
          rectangle: getRectangle(submit)
        },

        close: {
          exists: Boolean(close),
          rectangle: getRectangle(close)
        }
      };
    });

    const context =
      `Projeto: ${testInfo.project.name}\n` +
      `Viewport: ${diagnostics.viewport.width} x ` +
      `${diagnostics.viewport.height}`;

    expect(
      diagnostics.modal.exists,
      context
    ).toBe(true);

    expect(
      diagnostics.modal.open,
      context
    ).toBe(true);

    expect(
      diagnostics.modal.display,
      context
    ).toBe('flex');

    expect(
      diagnostics.form.display,
      context
    ).toBe('flex');

    expect(
      diagnostics.form.flexDirection,
      context
    ).toBe('column');

    expect(
      diagnostics.scrollArea.overflowY,
      context
    ).toBe('auto');

    expect(
      diagnostics.scrollArea.minHeight,
      context
    ).toBe('0px');

    expect(
      diagnostics.footer.flexShrink,
      context
    ).toBe('0');

    expect(
      diagnostics.modal.rectangle.left,
      context
    ).toBeGreaterThanOrEqual(-1);

    expect(
      diagnostics.modal.rectangle.right,
      context
    ).toBeLessThanOrEqual(
      diagnostics.viewport.width + 1
    );

    expect(
      diagnostics.modal.rectangle.top,
      context
    ).toBeGreaterThanOrEqual(-1);

    expect(
      diagnostics.modal.rectangle.bottom,
      context
    ).toBeLessThanOrEqual(
      diagnostics.viewport.height + 1
    );

    expect(
      diagnostics.page.scrollWidth,
      context
    ).toBeLessThanOrEqual(
      diagnostics.viewport.width + 1
    );

    expect(
      diagnostics.modal.dimensions.scrollWidth,
      context
    ).toBeLessThanOrEqual(
      diagnostics.modal.dimensions.clientWidth + 1
    );

    expect(
      diagnostics.form.dimensions.scrollWidth,
      context
    ).toBeLessThanOrEqual(
      diagnostics.form.dimensions.clientWidth + 1
    );

    expect(
      diagnostics.scrollArea.dimensions.scrollWidth,
      context
    ).toBeLessThanOrEqual(
      diagnostics.scrollArea.dimensions.clientWidth + 1
    );

    expect(
      diagnostics.footer.rectangle.bottom,
      context
    ).toBeLessThanOrEqual(
      diagnostics.viewport.height + 1
    );

    expect(
      diagnostics.submit.rectangle.bottom,
      context
    ).toBeLessThanOrEqual(
      diagnostics.viewport.height + 1
    );

    expect(
      diagnostics.close.rectangle.top,
      context
    ).toBeGreaterThanOrEqual(-1);

    await notes.scrollIntoViewIfNeeded();

    await expect(notes).toBeInViewport();
    await expect(submitButton).toBeInViewport();
    await expect(closeButton).toBeInViewport();
  });
});
