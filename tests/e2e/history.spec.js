import AxeBuilder from '@axe-core/playwright';

import { AXE_TAGS, freezeMotion } from './support/axe.js';
import { expect, loginAs, test } from './support/fixtures.js';
import { E2E_EXPECTED_COUNTS, E2E_USERS } from './support/seed-data.mjs';

// Tela Auditoria (Gate 1-F4.D2). Roda no Firebase Emulator, com os dados sintéticos do seed.
// Nada aqui grava nem apaga dados: os registros extras (inclusive os com operatorEmail e
// operatorUid falsos) são injetados SÓ no cliente, depois de parar o listener do histórico, e
// passam pelo mesmo caminho do app (processAndRenderHistory -> renderHistory). Assim o spec não
// altera as contagens que outras specs conferem. Os estados carregando/erro também são simulados
// só no cliente. Os testes "invariante:" descrevem o comportamento que o redesign não pode mudar.
const list = (page) => page.locator('#history-list');
const cards = (page) => list(page).locator('article');
const card = (page, name) => list(page).locator('article', { hasText: name });

// Ordem esperada do seed (data decrescente): ver E2E_HISTORY em support/seed-data.mjs.
const SEED_TITLES = [
  'Trena',
  'Serra Circular',
  'Esmerilhadeira',
  'Parafusadeira',
  'Furadeira de Impacto',
  'Furadeira de Impacto',
];

const OPERATOR_EMAIL = 'operador.sintetico@emulador.local';
const OPERATOR_UID = 'uid-sintetico-0001';

const synthetic = (overrides = {}) => ({
  type: 'out',
  toolCode: 'T-SINT-001',
  toolName: 'Ferramenta Sintética',
  user: 'Colaborador Sintético',
  ip: '203.0.113.7',
  device: 'Navegador Sintético / Sistema Sintético',
  minutesAgo: 1,
  ...overrides,
});

// Substitui os registros carregados por registros sintéticos, como se viessem do Firestore.
async function useLogs(page, entries) {
  await page.evaluate((specs) => {
    const data = window.App.Data;

    // Para o listener: nada vindo do emulator sobrescreve os registros do teste.
    data.historyUnsub?.();
    data.allHistoryLogs = specs.map(({ minutesAgo, ...entry }, index) => ({
      firebaseId: `synthetic-${index}`,
      date: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      ...entry,
    }));
    data.historyError = false;
    data.processAndRenderHistory();
  }, entries);
}

async function openHistory(page) {
  await loginAs(page, E2E_USERS.admin, { hash: '#/auditoria' });
  await expect(page.locator('#tab-history')).toBeVisible();
  await expect(cards(page)).toHaveCount(E2E_EXPECTED_COUNTS.history);
}

test.describe('Auditoria: invariantes de comportamento', () => {
  test('invariante: lista do seed, mais recente primeiro, só com os campos de hoje', async ({
    page,
  }) => {
    await openHistory(page);

    await expect
      .poll(async () => (await cards(page).locator('h3').allTextContents()).map((t) => t.trim()))
      .toEqual(SEED_TITLES);

    const one = card(page, 'Esmerilhadeira');

    await expect(one.locator('h3')).toHaveText('Esmerilhadeira');
    await expect(one).toContainText('Patrimônio: T-E2E-006');
    // Exatamente os 4 pares rótulo/valor de antes, na mesma ordem.
    await expect(one.locator('dt')).toHaveText(['Movimentação', 'Responsável', 'Data', 'Origem']);
    await expect(one.locator('dd')).toHaveCount(4);
    await expect(one.locator('dd').nth(0)).toHaveText('Retirada');
    await expect(one.locator('dd').nth(1)).toHaveText('Colaborador Beta');
    await expect(one.locator('dd').nth(2)).toContainText('13/08/2026');
    // Origem: IP e só o trecho do dispositivo antes de " / ".
    await expect(one.locator('dd').nth(3)).toContainText('Registrado no servidor');
    await expect(one.locator('dd').nth(3)).toContainText('Chrome');
    await expect(one.locator('dd').nth(3)).not.toContainText('Windows');

    await expect(card(page, 'Serra Circular').locator('dd').nth(0)).toHaveText('Manutenção');
    await expect(card(page, 'Serra Circular').locator('dd').nth(1)).toHaveText('Ana Administradora');
    await expect(page.locator('#history-load-more-container')).toBeHidden();
  });

  test('invariante: operatorEmail e operatorUid não aparecem na tela (D2)', async ({ page }) => {
    await openHistory(page);
    await useLogs(page, [
      synthetic({ operatorEmail: OPERATOR_EMAIL, operatorUid: OPERATOR_UID }),
      synthetic({
        type: 'in',
        toolName: 'Outra Sintética',
        operatorEmail: OPERATOR_EMAIL,
        operatorUid: OPERATOR_UID,
        minutesAgo: 5,
      }),
    ]);
    await expect(cards(page)).toHaveCount(2);

    const tab = page.locator('#tab-history');
    const visibleText = await tab.innerText();
    const markup = await tab.innerHTML();

    for (const secret of [OPERATOR_EMAIL, OPERATOR_UID, 'operatorEmail', 'operatorUid']) {
      expect(visibleText).not.toContain(secret);
      expect(markup).not.toContain(secret);
    }
  });

  test('invariante: busca por ferramenta (sem acento), patrimônio e responsável', async ({ page }) => {
    await openHistory(page);
    await useLogs(page, [
      synthetic({ toolName: 'Serra Elétrica', toolCode: 'T-SINT-010', user: 'Pessoa Um' }),
      synthetic({ toolName: 'Martelo', toolCode: 'T-SINT-020', user: 'Pessoa Dois', minutesAgo: 2 }),
      synthetic({ toolName: 'Trena', toolCode: 'T-SINT-030', user: 'Pessoa Três', minutesAgo: 3 }),
    ]);
    await expect(cards(page)).toHaveCount(3);

    await page.locator('#history-search').fill('eletrica');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first().locator('h3')).toHaveText('Serra Elétrica');

    await page.locator('#history-search').fill('t-sint-020');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first().locator('h3')).toHaveText('Martelo');

    await page.locator('#history-search').fill('pessoa tres');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first().locator('h3')).toHaveText('Trena');

    await page.locator('#history-search').fill('');
    await expect(cards(page)).toHaveCount(3);
  });

  test('invariante: período "Sempre", "Hoje", "Últimos 7 Dias" e "Este Mês"', async ({ page }) => {
    await openHistory(page);
    await useLogs(page, [
      synthetic({ toolName: 'Agora', minutesAgo: 1 }),
      synthetic({ toolName: 'Três dias', minutesAgo: 3 * 24 * 60 }),
      synthetic({ toolName: 'Vinte dias', minutesAgo: 20 * 24 * 60 }),
      synthetic({ toolName: 'Sessenta dias', minutesAgo: 60 * 24 * 60 }),
    ]);

    const period = page.locator('#history-time-filter');

    await expect(period).toHaveValue('all');
    await expect(period.locator('option')).toHaveText([
      'Sempre',
      'Hoje',
      'Últimos 7 Dias',
      'Este Mês',
    ]);
    await expect(cards(page)).toHaveCount(4);

    await period.selectOption('today');
    await expect(cards(page).locator('h3')).toHaveText(['Agora']);

    await period.selectOption('7days');
    await expect(cards(page).locator('h3')).toHaveText(['Agora', 'Três dias']);

    await period.selectOption('30days');
    await expect(cards(page).locator('h3')).toHaveText(['Agora', 'Três dias', 'Vinte dias']);

    await period.selectOption('all');
    await expect(cards(page)).toHaveCount(4);
  });

  test('invariante: limite de 20 por vez e busca só nos registros já carregados (D7)', async ({
    page,
  }) => {
    await openHistory(page);
    await useLogs(page, [
      ...Array.from({ length: 24 }, (_, index) =>
        synthetic({ toolName: `Carregada ${String(index).padStart(2, '0')}`, minutesAgo: index + 1 })
      ),
      synthetic({ toolName: 'Escondida Ainda', minutesAgo: 100 }),
    ]);

    await expect(cards(page)).toHaveCount(20);
    await expect(page.locator('#history-load-more-container')).toBeVisible();

    // Comportamento atual, preservado de propósito: o registro ainda não carregado não é achado.
    await page.locator('#history-search').fill('escondida');
    await expect(list(page)).toContainText('Nenhum log para os critérios.');
    await page.locator('#history-search').fill('');
    await expect(cards(page)).toHaveCount(20);

    await page.getByRole('button', { name: 'Carregar Mais' }).click();
    await expect(cards(page)).toHaveCount(25);
    await expect(page.locator('#history-load-more-container')).toBeHidden();

    await page.locator('#history-search').fill('escondida');
    await expect(cards(page)).toHaveCount(1);
  });

  test('invariante: não existe "Limpar Antigos" na Auditoria (D6: vive em Dados e backup)', async ({
    page,
  }) => {
    await openHistory(page);

    await expect(page.locator('#tab-history').getByRole('button', { name: /limpar antigos/i })).toHaveCount(0);
    expect(await page.locator('#tab-history').innerText()).not.toMatch(/limpar antigos/i);
  });
});

test.describe('Auditoria: acesso por perfil (caracterização do comportamento atual)', () => {
  test('Padrão: sem item de menu, deep link recusado e nenhum registro chega ao cliente', async ({
    page,
  }) => {
    await loginAs(page, E2E_USERS.standard, { hash: '#/auditoria' });

    await expect(page.locator('#topbar-title')).toHaveText('Painel');
    await expect(page.locator('#tab-history')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Auditoria', exact: true })).toHaveCount(0);
    await expect(
      page.locator('.toast-item').filter({ hasText: 'Acesso restrito' }).first()
    ).toBeVisible();

    await page.evaluate(() => window.App.UI.switchTab('history'));
    await expect(page.locator('#tab-history')).toBeHidden();

    // Mesmo revelando o painel via DevTools, não há registros para exibir.
    await page.evaluate(() => document.getElementById('tab-history').classList.remove('hidden'));
    expect(await page.evaluate(() => window.App.Data.allHistoryLogs)).toBeNull();
    await expect(cards(page)).toHaveCount(0);
  });

  test('Restrito: sem item de menu, deep link recusado e nenhum registro chega ao cliente', async ({
    page,
  }) => {
    await loginAs(page, E2E_USERS.restricted, { hash: '#/auditoria' });

    await expect(page.locator('#topbar-title')).toHaveText('Retirar/Devolver');
    await expect(page.locator('#tab-history')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Auditoria', exact: true })).toHaveCount(0);

    await page.evaluate(() => window.App.UI.switchTab('history'));
    await expect(page.locator('#tab-history')).toBeHidden();

    await page.evaluate(() => document.getElementById('tab-history').classList.remove('hidden'));
    expect(await page.evaluate(() => window.App.Data.allHistoryLogs)).toBeNull();
    await expect(cards(page)).toHaveCount(0);
  });
});

test.describe('Auditoria: estados da lista', () => {
  test('carregando: skeleton com aria-busy, nunca "nenhum log"', async ({ page }) => {
    await openHistory(page);

    await page.evaluate(() => {
      window.App.Data.historyUnsub?.();
      window.App.Data.allHistoryLogs = null;
      window.App.UI.renderHistory();
    });

    await expect(list(page)).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#history-list .ui-skeleton-card')).toHaveCount(6);
    await expect(list(page)).not.toContainText('Nenhum log');
    await expect(page.locator('#history-feedback')).toBeEmpty();
  });

  test('vazio: mensagem de hoje, sem "Limpar filtros" quando não há filtro', async ({ page }) => {
    await openHistory(page);
    await useLogs(page, []);

    await expect(list(page)).not.toHaveAttribute('aria-busy', 'true');
    await expect(list(page)).toContainText('Nenhum log para os critérios.');
    await expect(list(page).getByRole('button', { name: 'Limpar filtros' })).toHaveCount(0);
    await expect(cards(page)).toHaveCount(0);
  });

  test('erro: aviso persistente, sem detalhes internos e sem lista vazia enganosa', async ({
    page,
  }) => {
    await openHistory(page);

    await page.evaluate(() => {
      window.App.Data.historyError = true;
      window.App.UI.renderHistory();
    });

    const alert = page.locator('#history-feedback').getByRole('alert');

    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Não foi possível carregar a auditoria');
    await expect(alert).not.toContainText(/firebase|firestore|permission/i);
    await expect(list(page)).not.toContainText('Nenhum log');
    await expect(cards(page)).toHaveCount(0);

    await page.evaluate(() => {
      window.App.Data.historyError = false;
      window.App.UI.renderHistory();
    });
    await expect(page.locator('#history-feedback')).toBeEmpty();
    await expect(cards(page)).toHaveCount(E2E_EXPECTED_COUNTS.history);
  });

  test('precedência: ERRO vence CARREGANDO (falha de carga deixa allHistoryLogs nulo)', async ({
    page,
  }) => {
    await openHistory(page);

    await page.evaluate(() => {
      window.App.Data.historyUnsub?.();
      window.App.Data.allHistoryLogs = null;
      window.App.Data.historyError = true;
      window.App.UI.renderHistory();
    });

    await expect(page.locator('#history-feedback').getByRole('alert')).toBeVisible();
    await expect(list(page)).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#history-list .ui-skeleton-card')).toHaveCount(0);

    // Sem o erro, o mesmo estado volta a ser "carregando".
    await page.evaluate(() => {
      window.App.Data.historyError = false;
      window.App.UI.renderHistory();
    });
    await expect(list(page)).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#history-feedback')).toBeEmpty();
  });

  test('"Limpar filtros" aparece só com filtro ativo e restaura busca e período', async ({
    page,
  }) => {
    await openHistory(page);
    await useLogs(page, [
      synthetic({ toolName: 'Recente', minutesAgo: 1 }),
      synthetic({ toolName: 'Antiga', minutesAgo: 20 * 24 * 60 }),
    ]);
    await expect(cards(page)).toHaveCount(2);

    await page.locator('#history-time-filter').selectOption('7days');
    await expect(cards(page)).toHaveCount(1);
    await page.locator('#history-search').fill('antiga');
    await expect(list(page)).toContainText('Nenhum log para os critérios.');

    await list(page).getByRole('button', { name: 'Limpar filtros' }).click();

    await expect(page.locator('#history-search')).toHaveValue('');
    await expect(page.locator('#history-time-filter')).toHaveValue('all');
    await expect(cards(page).locator('h3')).toHaveText(['Recente', 'Antiga']);
  });
});

test.describe('Auditoria: responsividade e acessibilidade', () => {
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1440, 900],
  ]) {
    test(`sem rolagem horizontal em ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openHistory(page);
      await useLogs(page, [
        synthetic({
          toolName: 'Ferramenta com um nome sintético extremamente longo para forçar a quebra',
          user: 'Colaborador Sintético com um nome muito longo para testar o truncamento',
          device: 'Navegador Sintético com descrição longa / Sistema',
        }),
      ]);
      await expect(cards(page)).toHaveCount(1);

      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        card: (() => {
          const element = document.querySelector('#history-list article');

          return element.scrollWidth - element.clientWidth;
        })(),
      }));

      expect(overflow).toEqual({ page: 0, card: 0 });
    });
  }

  // Varredura restrita à tela (sem o cabeçalho do shell): preenchida, vazia, com erro e no escuro.
  test('axe restrito à tela: nenhuma violação em lista, vazio, erro e tema escuro', async ({
    page,
  }) => {
    await openHistory(page);
    await freezeMotion(page);

    const violationsOf = async (selector) =>
      (await new AxeBuilder({ page }).include(selector).withTags(AXE_TAGS).analyze()).violations.map(
        (violation) => `${violation.id}: ${violation.nodes.length} nó(s)`
      );

    const filled = await violationsOf('#tab-history');

    await page.evaluate(() => document.documentElement.classList.add('dark'));
    const dark = await violationsOf('#tab-history');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));

    await useLogs(page, []);
    await page.locator('#history-search').fill('zzzz');
    await expect(list(page).getByRole('button', { name: 'Limpar filtros' })).toBeVisible();
    const empty = await violationsOf('#tab-history');

    await page.evaluate(() => {
      window.App.Data.historyError = true;
      window.App.UI.renderHistory();
    });
    await expect(page.locator('#history-feedback').getByRole('alert')).toBeVisible();
    const error = await violationsOf('#tab-history');

    console.log(`EVIDENCE HISTORY_AXE=${JSON.stringify({ filled, dark, empty, error })}`);
    expect({ filled, dark, empty, error }).toEqual({ filled: [], dark: [], empty: [], error: [] });
  });
});
