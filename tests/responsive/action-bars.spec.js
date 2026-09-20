import { expect, test } from './support/network-guard.js';

const actionBars = [
  {
    name: 'Ferramentas',
    triggerSelector: '#tools-action-new',
  },
  {
    name: 'Usuários',
    triggerSelector: 'button[onclick="App.CRUDUsers.openModal()"]',
  },
  {
    name: 'Colaboradores',
    triggerSelector: '#btn-collaborators-new',
  },
];

test.describe('Responsividade das barras de ações', () => {
  test(
    '@action-bars mantém todas as ações visíveis',
    async ({ page }, testInfo) => {
      await page.goto('/', {
        waitUntil: 'domcontentloaded',
      });

      await page.waitForTimeout(500);

      const results = await page.evaluate(
        async ({ definitions }) => {
          const loginScreen =
            document.getElementById('login-screen');

          const mainApp =
            document.getElementById('main-app');

          if (!loginScreen || !mainApp) {
            throw new Error(
              'Estrutura principal não encontrada.',
            );
          }

          loginScreen.classList.add('hidden');
          mainApp.classList.remove('hidden');

          const sections = [
            ...document.querySelectorAll('.tab-content'),
          ];

          const nextFrame = () =>
            new Promise((resolve) => {
              requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
              });
            });

          const rectangleOf = (element) => {
            const rectangle =
              element.getBoundingClientRect();

            return {
              left: rectangle.left,
              right: rectangle.right,
              top: rectangle.top,
              bottom: rectangle.bottom,
              width: rectangle.width,
              height: rectangle.height,
            };
          };

          const measurements = [];

          for (const definition of definitions) {
            const trigger =
              document.querySelector(
                definition.triggerSelector,
              );

            if (!(trigger instanceof HTMLElement)) {
              throw new Error(
                `Botão não localizado: ${definition.name}`,
              );
            }

            const section =
              trigger.closest('.tab-content');

            const actionBar =
              trigger.closest('.responsive-action-bar');

            if (
              !(section instanceof HTMLElement) ||
              !(actionBar instanceof HTMLElement)
            ) {
              throw new Error(
                `Barra não localizada: ${definition.name}`,
              );
            }

            for (const candidate of sections) {
              candidate.classList.toggle(
                'hidden',
                candidate !== section,
              );
            }

            for (
              let current = section;
              current &&
              current !== document.documentElement;
              current = current.parentElement
            ) {
              current.classList.remove('hidden');
            }

            const actions = [
              ...actionBar.children,
            ].filter((element) =>
              element.matches('button, a'),
            );

            for (const action of actions) {
              action.classList.remove('hidden');

              action.style.removeProperty('display');
              action.style.removeProperty('visibility');
              action.style.removeProperty('opacity');

              if (
                window
                  .getComputedStyle(action)
                  .display === 'none'
              ) {
                action.style.display = 'inline-flex';
              }
            }

            await nextFrame();

            measurements.push({
              name: definition.name,

              viewport: {
                width:
                  document.documentElement.clientWidth,
                height: window.innerHeight,
              },

              page: {
                clientWidth:
                  document.documentElement.clientWidth,

                scrollWidth: Math.max(
                  document.documentElement.scrollWidth,
                  document.body?.scrollWidth || 0,
                ),
              },

              actionBar: {
                rectangle:
                  rectangleOf(actionBar),

                clientWidth:
                  actionBar.clientWidth,

                scrollWidth:
                  actionBar.scrollWidth,

                flexWrap:
                  window
                    .getComputedStyle(actionBar)
                    .flexWrap,
              },

              actions: actions.map((action) => ({
                label: String(
                  action.textContent || '',
                )
                  .replace(/\s+/g, ' ')
                  .trim(),

                rectangle:
                  rectangleOf(action),
              })),
            });
          }

          return measurements;
        },
        {
          definitions: actionBars,
        },
      );

      for (const result of results) {
        const context =
          `Projeto: ${testInfo.project.name}\n` +
          `Página: ${result.name}\n` +
          `Viewport: ${result.viewport.width} x ` +
          `${result.viewport.height}`;

        expect(
          result.actions,
          context,
        ).toHaveLength(3);

        expect(
          result.actionBar.flexWrap,
          context,
        ).toBe('wrap');

        expect(
          result.actionBar.scrollWidth,
          context,
        ).toBeLessThanOrEqual(
          result.actionBar.clientWidth + 1,
        );

        expect(
          result.page.scrollWidth,
          context,
        ).toBeLessThanOrEqual(
          result.page.clientWidth + 1,
        );

        for (const action of result.actions) {
          const actionContext =
            `${context}\nAção: ${action.label}`;

          expect(
            action.rectangle.left,
            actionContext,
          ).toBeGreaterThanOrEqual(
            result.actionBar.rectangle.left - 1,
          );

          expect(
            action.rectangle.right,
            actionContext,
          ).toBeLessThanOrEqual(
            result.actionBar.rectangle.right + 1,
          );

          expect(
            action.rectangle.left,
            actionContext,
          ).toBeGreaterThanOrEqual(-1);

          expect(
            action.rectangle.right,
            actionContext,
          ).toBeLessThanOrEqual(
            result.viewport.width + 1,
          );
        }
      }
    },
  );
});