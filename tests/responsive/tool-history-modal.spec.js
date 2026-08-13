import { expect, test } from '@playwright/test';

// Prefixos de hostname reconhecidos como deployments/aliases do projeto
// Gestão de Ferramentas. Cada redeploy gera uma URL nova, por isso nenhuma
// URL específica é fixada aqui.
const PROJECT_PREVIEW_HOST_PREFIXES = ['gestao-de-ferramentas-', 'gestao-de-ferram-git-'];

const externalBaseUrl = String(process.env.PLAYWRIGHT_BASE_URL || '').trim();

const automationBypassSecret = String(
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET || ''
).trim();

// Classifica o alvo apenas a partir da URL. Não lê, não valida e não expõe
// nenhum segredo. Não lança nada em tempo de import, para que a descoberta de
// testes (`--list`) continue funcionando em qualquer ambiente.
function resolveTarget(rawBaseUrl) {
  if (!rawBaseUrl) {
    return { kind: 'local' };
  }

  let parsed = null;

  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    return { kind: 'invalid' };
  }

  const isVercelHost = parsed.protocol === 'https:' && parsed.hostname.endsWith('.vercel.app');

  if (!isVercelHost) {
    return { kind: 'external', origin: parsed.origin };
  }

  const belongsToProject = PROJECT_PREVIEW_HOST_PREFIXES.some((prefix) =>
    parsed.hostname.startsWith(prefix)
  );

  if (!belongsToProject) {
    return { kind: 'foreign-vercel', origin: parsed.origin };
  }

  return { kind: 'protected-preview', origin: parsed.origin };
}

const target = resolveTarget(externalBaseUrl);

// O trace do Playwright registra headers de request. Como o bypass viaja em
// header, o trace é desativado somente neste spec — playwright.config.js
// permanece intocado e os demais testes seguem com 'retain-on-failure'.
test.use({ trace: 'off' });

test.describe('Responsividade do modal de histórico da ferramenta', () => {
  test('@tool-history-modal mantém cabeçalho, rolagem e ações acessíveis', async (
    { page },
    testInfo
  ) => {
    if (target.kind === 'invalid') {
      throw new Error('PLAYWRIGHT_BASE_URL não é uma URL válida.');
    }

    if (target.kind === 'foreign-vercel') {
      throw new Error(
        'PLAYWRIGHT_BASE_URL aponta para um deployment Vercel fora do projeto Gestão de Ferramentas.'
      );
    }

    if (target.kind === 'protected-preview') {
      if (!automationBypassSecret) {
        throw new Error(
          'VERCEL_AUTOMATION_BYPASS_SECRET is required for protected Vercel Preview tests.'
        );
      }

      const previewOrigin = target.origin;

      // Match estrito por origin: requests para Firebase, Google APIs, fontes
      // ou qualquer CDN externa não casam com o predicado e portanto nunca
      // chegam a este handler nem recebem o header de bypass.
      //
      // route.fetch com maxRedirects: 0 é obrigatório. Os headers passados a
      // route.continue() seriam reaplicados pelo Playwright aos redirects
      // daquela request, o que poderia levar o bypass a um origin diferente.
      // Aqui o redirect volta ao navegador como resposta, e a request seguinte
      // é reavaliada pelo predicado de origin acima.
      await page.route(
        (url) => url.origin === previewOrigin,
        async (route) => {
          const headers = {
            ...route.request().headers(),
            'x-vercel-protection-bypass': automationBypassSecret,
          };

          const response = await route.fetch({
            headers,
            maxRedirects: 0,
          });

          await route.fulfill({ response });
        }
      );
    }

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      const login = document.getElementById('login-screen');
      const app = document.getElementById('main-app');
      const modal = document.getElementById('tool-history-modal');
      const list = document.getElementById('tool-history-list');
      const nameLabel = document.getElementById('tool-history-name');

      if (!login || !app || !(modal instanceof HTMLDialogElement)) {
        throw new Error('Estrutura do modal de histórico não encontrada.');
      }

      if (!(list instanceof HTMLElement) || !(nameLabel instanceof HTMLElement)) {
        throw new Error('Containers #tool-history-list e #tool-history-name não encontrados.');
      }

      login.classList.add('hidden');
      app.classList.remove('hidden');

      // Conteúdo temporário apenas em memória, para exercitar altura realista.
      // Nada é gravado, nem enviado ao Firebase.
      const originalList = list.innerHTML;
      const originalName = nameLabel.textContent;

      const restore = () => {
        if (modal.open) {
          modal.close();
        }

        list.innerHTML = originalList;
        nameLabel.textContent = originalName;
      };

      nameLabel.textContent = 'Furadeira de Teste (PAT-001)';

      const acoes = ['Retirado por', 'Devolvido por', 'Manutenção registrada por'];
      const usuarios = ['Ana Souza', 'Bruno Lima', 'Carla Dias'];

      const stub = document.createElement('div');
      stub.dataset.testStub = 'tool-history';
      stub.className = 'flex flex-col gap-3';

      for (let index = 0; index < 12; index += 1) {
        const card = document.createElement('div');
        card.className =
          'bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700 shadow-sm';

        const acao = document.createElement('p');
        acao.className = 'text-sm font-bold text-slate-900 dark:text-white';
        acao.textContent = acoes[index % acoes.length] + ' ' + usuarios[index % usuarios.length];

        const data = document.createElement('p');
        data.className = 'text-[10px] font-bold text-slate-400 mt-1';
        data.textContent = '0' + ((index % 9) + 1) + '/08/2026 09:30';

        const observacao = document.createElement('p');
        observacao.className = 'mt-2 text-xs text-slate-600 dark:text-slate-300';
        observacao.textContent = 'Revisao preventiva com limpeza e lubrificacao do equipamento.';

        card.append(acao, data, observacao);
        stub.appendChild(card);
      }

      list.replaceChildren(stub);

      if (modal.open) {
        modal.close();
      }

      modal.showModal();

      const nextFrame = () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });

      await nextFrame();

      const parts = [...modal.children].filter((element) => element instanceof HTMLElement);

      if (parts.length !== 3) {
        restore();
        throw new Error('Estrutura inesperada do modal: ' + parts.length + ' blocos.');
      }

      const [header, body, footer] = parts;

      if (body !== list.parentElement) {
        restore();
        throw new Error('O corpo rolável do modal não é o container de #tool-history-list.');
      }

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
        const hit = document.elementFromPoint(x, y);

        return Boolean(hit && element.contains(hit));
      };

      const closeIcon = header.querySelector('button');
      const closeButton = footer.querySelector('button');

      if (!(closeIcon instanceof HTMLElement) || !(closeButton instanceof HTMLElement)) {
        restore();
        throw new Error('Botões de fechar do histórico não encontrados.');
      }

      const cards = [...stub.children].filter((element) => element instanceof HTMLElement);
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
          flexDirection: getComputedStyle(modal).flexDirection,
          overflowY: getComputedStyle(modal).overflowY,
        },
        header: {
          ...rect(header),
          closeIconInteractive: hitTest(closeIcon),
        },
        body: {
          ...rect(body),
          overflowY: getComputedStyle(body).overflowY,
          clientHeight: body.clientHeight,
          scrollHeight: body.scrollHeight,
          clientWidth: body.clientWidth,
          scrollWidth: body.scrollWidth,
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
          buttonText: (closeButton.textContent || '').trim(),
          buttonRect: rect(closeButton),
          buttonInteractive: hitTest(closeButton),
        },
      };

      modal.close();
      payload.openAfterClose = modal.open;

      list.innerHTML = originalList;
      nameLabel.textContent = originalName;

      payload.domRestored =
        list.innerHTML === originalList && nameLabel.textContent === originalName;

      return payload;
    });

    const context =
      'Projeto: ' +
      testInfo.project.name +
      '\nViewport: ' +
      result.viewport.width +
      ' x ' +
      result.viewport.height;

    // Estado e estrutura do dialog.
    expect(result.open, context).toBe(true);
    expect(result.dialog.display, context).toBe('flex');
    expect(result.dialog.flexDirection, context).toBe('column');
    expect(result.dialog.overflowY, context).toBe('hidden');
    expect(result.content.cards, context).toBe(12);

    // H-01: o modal inteiro precisa caber dentro da viewport visível.
    expect(result.dialog.top, context).toBeGreaterThanOrEqual(-1);
    expect(result.dialog.bottom, context).toBeLessThanOrEqual(result.viewport.height + 1);
    expect(result.dialog.left, context).toBeGreaterThanOrEqual(-1);
    expect(result.dialog.right, context).toBeLessThanOrEqual(result.viewport.width + 1);

    // Header permanece visível e o X é realmente clicável.
    expect(result.header.top, context).toBeGreaterThanOrEqual(result.dialog.top - 1);
    expect(result.header.bottom, context).toBeLessThanOrEqual(result.viewport.height + 1);
    expect(result.header.closeIconInteractive, context).toBe(true);

    // Footer fixo, dentro da viewport e estável durante a rolagem do body.
    expect(result.footer.buttonText, context).toBe('Fechar');
    expect(result.footer.buttonInteractive, context).toBe(true);
    expect(result.footer.buttonRect.top, context).toBeGreaterThanOrEqual(-1);
    expect(result.footer.buttonRect.bottom, context).toBeLessThanOrEqual(
      result.viewport.height + 1
    );
    expect(result.footer.buttonRect.left, context).toBeGreaterThanOrEqual(-1);
    expect(result.footer.buttonRect.right, context).toBeLessThanOrEqual(result.viewport.width + 1);
    expect(
      Math.abs(result.footer.after.top - result.footer.before.top),
      context
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(result.footer.after.bottom - result.footer.before.bottom),
      context
    ).toBeLessThanOrEqual(1);
    expect(result.footer.after.bottom, context).toBeLessThanOrEqual(result.viewport.height + 1);

    // Body é a única área rolável.
    expect(result.body.overflowY, context).toBe('auto');
    expect(result.body.bottom - result.body.top, context).toBeGreaterThan(120);
    expect(result.body.scrollHeight, context).toBeGreaterThanOrEqual(result.body.clientHeight);

    if (result.body.scrollHeight > result.body.clientHeight) {
      expect(result.body.scrolled, context).toBeGreaterThan(0);
    }

    // Primeiro e último registro alcançáveis dentro do body.
    expect(result.content.first.top, context).toBeGreaterThanOrEqual(result.body.top - 1);
    expect(result.content.first.bottom, context).toBeLessThanOrEqual(result.body.bottom + 1);
    expect(result.content.last.bottom, context).toBeLessThanOrEqual(result.body.bottom + 1);
    expect(result.content.last.bottom, context).toBeGreaterThan(result.body.top);

    // Ausência de overflow horizontal com conteúdo sintético normal.
    expect(result.documentScrollWidth, context).toBeLessThanOrEqual(result.viewport.width + 1);
    expect(result.body.scrollWidth, context).toBeLessThanOrEqual(result.body.clientWidth + 1);

    // Fechamento e restauração do DOM.
    expect(result.openAfterClose, context).toBe(false);
    expect(result.domRestored, context).toBe(true);
  });
});
