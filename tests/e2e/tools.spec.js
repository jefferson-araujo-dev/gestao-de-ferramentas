import {
  expect,
  expectActiveTab,
  loginAs,
  openTab,
  readPermissions,
  test,
} from './support/fixtures.js';
import { E2E_EXPECTED_COUNTS, E2E_USERS } from './support/seed-data.mjs';

// Tela Ferramentas (Gate 1-F2). Roda no Firebase Emulator, com os dados sintéticos do seed.
// Estes testes NÃO alteram dados: estados vazio/erro/carregando são simulados só no cliente e a troca
// de status por menu é conferida por espião (a escrita real fica em tools.destructive.spec.js).
const ORDER_NAME_ASC = [
  'Chave de Fenda',
  'Esmerilhadeira',
  'Furadeira de Impacto',
  'Martelo',
  'Nível a Laser',
  'Parafusadeira',
  'Serra Circular',
  'Trena',
];

const list = (page) => page.locator('#crud-list');
const row = (page, name) => page.locator('#crud-list tr.tools-row', { hasText: name });
const names = (page) => page.locator('#crud-list .tools-tool__name').allTextContents();
const chip = (page, label) =>
  page.locator('#tools-filters').getByRole('button', { name: new RegExp(`^${label}\\s*\\d+`) });
const countText = (page) => page.locator('#inventory-result-count');
const sortSelect = (page) => page.locator('#inventory-sort');
const categorySelect = (page) => page.locator('#inventory-category-filter');

// A busca tem debounce (300 ms) e a lista re-renderiza depois: sempre com polling.
async function expectNames(page, expected, { sorted = false } = {}) {
  await expect
    .poll(async () => {
      const found = await names(page);

      return sorted ? [...found].sort() : found;
    })
    .toEqual(sorted ? [...expected].sort() : expected);
}

// Tablet (768-1023): a navegação é um drawer aberto pelo botão da barra superior.
async function openTools(page, user = E2E_USERS.admin) {
  await loginAs(page, user);

  const width = page.viewportSize().width;

  if (width >= 768 && width < 1024) {
    await page.locator('#btn-sidebar-toggle').click();
    await page.locator('#nav-tools').click();
  } else {
    await openTab(page, 'management');
  }

  await expectActiveTab(page, 'management');
  await expect(list(page)).toContainText('Furadeira de Impacto');
  await expect(countText(page)).toHaveText('Mostrando 8 de 8 ferramentas');
}

test.describe('ADMIN — Ferramentas: estrutura e leitura', () => {
  test.beforeEach(async ({ page }) => {
    await openTools(page);
  });

  test('rota, título, região da lista e tabela semântica com status em texto', async ({ page }) => {
    await expect(page).toHaveURL(/#\/ferramentas$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ferramentas');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Lista de ferramentas' })
    ).toBeAttached();

    const table = page.getByRole('table', { name: 'Lista de ferramentas' });

    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader')).toHaveText([
      'Ferramenta',
      'Status',
      'Responsável',
      'Última ação',
      'Ações',
    ]);
    await expect(table.getByRole('row')).toHaveCount(E2E_EXPECTED_COUNTS.tools + 1);
    await expectNames(page, ORDER_NAME_ASC);

    // Nome da ferramenta é o cabeçalho da linha; patrimônio e categoria ficam junto.
    await expect(table.getByRole('rowheader', { name: /Chave de Fenda/ })).toContainText(
      'T-E2E-005 · Manual'
    );

    // Status sempre em texto (cor é reforço), com alerta de prazo em palavras.
    await expect(row(page, 'Chave de Fenda')).toContainText('Disponível');
    await expect(row(page, 'Serra Circular')).toContainText('Manutenção');
    await expect(row(page, 'Esmerilhadeira')).toContainText('Emprestada');
    await expect(row(page, 'Esmerilhadeira')).toContainText(/Atrasada \(\d+d\)/);
    await expect(row(page, 'Esmerilhadeira')).toContainText('Colaborador Beta');

    // Estrutura antiga substituída: nada de cartões legados nem contadores duplicados.
    await expect(page.locator('#crud-list .tool-card')).toHaveCount(0);
    await expect(page.locator('#inventory-stats, #inventory-quick-filters')).toHaveCount(0);
  });

  test('uma única ação primária no contexto principal (Nova); Exportar e Importar são secundárias', async ({
    page,
  }) => {
    const bar = page.getByRole('group', { name: 'Ações do inventário' });

    await expect(bar.getByRole('button')).toHaveText(['Exportar', 'Importar', 'Nova']);
    await expect(page.locator('#tab-management .ui-btn--primary:visible')).toHaveCount(1);
    await expect(page.locator('#tools-action-new')).toHaveClass(/ui-btn--primary/);
    await expect(page.locator('#tools-action-export')).toHaveClass(/ui-btn--secondary/);
  });

  test('filtros de status trazem as contagens do seed e são grupo rotulado', async ({ page }) => {
    const group = page.getByRole('group', { name: 'Filtrar por status' });

    await expect(group.getByRole('button')).toHaveCount(6);
    await expect(chip(page, 'Todas')).toContainText(String(E2E_EXPECTED_COUNTS.tools));
    await expect(chip(page, 'Disponíveis')).toContainText(String(E2E_EXPECTED_COUNTS.available));
    await expect(chip(page, 'Emprestadas')).toContainText(String(E2E_EXPECTED_COUNTS.borrowed));
    await expect(chip(page, 'Manutenção')).toContainText(String(E2E_EXPECTED_COUNTS.maintenance));
    await expect(chip(page, 'Em atraso')).toContainText('2');
    await expect(chip(page, 'Revisão vencida')).toContainText('0');
    await expect(chip(page, 'Todas')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, 'Disponíveis')).toHaveAttribute('aria-pressed', 'false');
  });

  test('o filtro de categoria lista as categorias reais do inventário', async ({ page }) => {
    // Antes do redesign as opções eram lidas no boot, antes dos dados: só existia "Todas".
    await expect(page.locator('#inventory-category-filter option')).toHaveText([
      'Todas as categorias',
      'Elétrica',
      'Manual',
      'Medição',
    ]);
    await expect(categorySelect(page)).toHaveAccessibleName('Filtrar por categoria');
    await expect(sortSelect(page)).toHaveAccessibleName('Ordenar por');
    await expect(categorySelect(page)).toBeVisible();
    await expect(sortSelect(page)).toBeVisible();
  });
});

test.describe('ADMIN — Ferramentas: busca, filtros e ordenação', () => {
  test.beforeEach(async ({ page }) => {
    await openTools(page);
  });

  test('busca: campo com nome acessível; ignora acentos; por nome, patrimônio e categoria', async ({
    page,
  }) => {
    const search = page.getByRole('searchbox', {
      name: 'Buscar por nome, patrimônio ou categoria',
    });

    await expect(search).toBeVisible();

    await search.fill('nivel');
    await expect(countText(page)).toHaveText('Mostrando 1 de 1 ferramenta');
    await expectNames(page, ['Nível a Laser']);

    await search.fill('t-e2e-004');
    await expectNames(page, ['Serra Circular']);

    await search.fill('medicao');
    await expect(countText(page)).toHaveText('Mostrando 2 de 2 ferramentas');
    await expectNames(page, ['Nível a Laser', 'Trena']);

    // Limpar a busca volta ao inventário completo (o campo é type=search: tem o "x" nativo).
    await search.fill('');
    await expect(countText(page)).toHaveText('Mostrando 8 de 8 ferramentas');
  });

  test('sem resultados é distinto de vazio e oferece "Limpar filtros" (foco vai à busca)', async ({
    page,
  }) => {
    await page.getByRole('searchbox').fill('zzzz-inexistente');

    await expect(list(page)).toContainText('Nenhuma ferramenta encontrada');
    await expect(list(page)).not.toContainText('Nenhuma ferramenta cadastrada');
    await expect(countText(page)).toHaveText('Mostrando 0 de 0 ferramentas');
    await expect(page.locator('#tools-active-filters')).toHaveText('1 filtro ativo');

    await list(page).getByRole('button', { name: 'Limpar filtros' }).click();

    await expect(page.getByRole('searchbox')).toHaveValue('');
    await expect(page.getByRole('searchbox')).toBeFocused();
    await expect(countText(page)).toHaveText('Mostrando 8 de 8 ferramentas');
  });

  test('filtros de status: estado pressionado, contagem e indicação de filtro ativo', async ({
    page,
  }) => {
    const clear = page.locator('#tools-clear-filters');

    await expect(clear).toBeHidden();
    await expect(page.locator('#tools-active-filters')).toHaveText('');

    await chip(page, 'Disponíveis').click();
    await expect(chip(page, 'Disponíveis')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, 'Todas')).toHaveAttribute('aria-pressed', 'false');
    await expect(countText(page)).toHaveText('Mostrando 4 de 4 ferramentas');
    await expect(page.locator('#tools-active-filters')).toHaveText('1 filtro ativo');
    await expect(clear).toBeVisible();
    await expectNames(
      page,
      ['Chave de Fenda', 'Furadeira de Impacto', 'Martelo', 'Nível a Laser'],
      { sorted: true }
    );

    await chip(page, 'Emprestadas').click();
    await expectNames(page, ['Esmerilhadeira', 'Parafusadeira'], { sorted: true });

    await chip(page, 'Manutenção').click();
    await expectNames(page, ['Serra Circular', 'Trena'], { sorted: true });

    await chip(page, 'Em atraso').click();
    await expectNames(page, ['Esmerilhadeira', 'Parafusadeira'], { sorted: true });

    // Nenhuma revisão vencida no seed: sem resultados, com saída clara.
    await chip(page, 'Revisão vencida').click();
    await expect(list(page)).toContainText('Nenhuma ferramenta encontrada');
    await expect(list(page).getByRole('button', { name: 'Limpar filtros' })).toBeVisible();

    await chip(page, 'Todas').click();
    await expect(countText(page)).toHaveText('Mostrando 8 de 8 ferramentas');
    await expect(clear).toBeHidden();
  });

  test('filtros combinados (status + categoria + busca) e Limpar filtros restaura tudo', async ({
    page,
  }) => {
    await chip(page, 'Disponíveis').click();
    await categorySelect(page).selectOption('Manual');
    await expect(countText(page)).toHaveText('Mostrando 2 de 2 ferramentas');
    await expect(page.locator('#tools-active-filters')).toHaveText('2 filtros ativos');
    await expectNames(page, ['Chave de Fenda', 'Martelo'], { sorted: true });

    await page.getByRole('searchbox').fill('mart');
    await expect(countText(page)).toHaveText('Mostrando 1 de 1 ferramenta');
    await expect(page.locator('#tools-active-filters')).toHaveText('3 filtros ativos');
    await expectNames(page, ['Martelo']);

    await page.locator('#tools-clear-filters').click();

    await expect(page.getByRole('searchbox')).toHaveValue('');
    await expect(categorySelect(page)).toHaveValue('all');
    await expect(chip(page, 'Todas')).toHaveAttribute('aria-pressed', 'true');
    await expect(countText(page)).toHaveText('Mostrando 8 de 8 ferramentas');
    await expect(page.locator('#tools-clear-filters')).toBeHidden();
    // A ordenação não é filtro: permanece como estava.
    await expect(sortSelect(page)).toHaveValue('name-asc');
  });

  test('ordenação: nome A-Z / Z-A, patrimônio e categoria (mesmo conjunto, só a ordem muda)', async ({
    page,
  }) => {
    const sort = sortSelect(page);

    await sort.selectOption('name-desc');
    await expectNames(page, [...ORDER_NAME_ASC].reverse());

    await sort.selectOption('patrimony');
    await expectNames(page, [
      'Furadeira de Impacto',
      'Parafusadeira',
      'Martelo',
      'Serra Circular',
      'Chave de Fenda',
      'Esmerilhadeira',
      'Nível a Laser',
      'Trena',
    ]);

    await sort.selectOption('category');
    const categories = (await page.locator('#crud-list .tools-tool__meta').allTextContents()).map(
      (text) => text.split(' · ')[1]
    );

    expect(categories).toEqual([
      'Elétrica',
      'Elétrica',
      'Elétrica',
      'Elétrica',
      'Manual',
      'Manual',
      'Medição',
      'Medição',
    ]);

    await sort.selectOption('status');
    const statuses = await page
      .locator('#crud-list .ui-badge--status')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.status));

    expect(statuses).toEqual([...statuses].sort());
    expect((await names(page)).length).toBe(E2E_EXPECTED_COUNTS.tools);
  });
});

test.describe('ADMIN — Ferramentas: ações por ferramenta', () => {
  test.beforeEach(async ({ page }) => {
    await openTools(page);
  });

  test('ação principal por status: Emprestar (disponível), Devolver (emprestada), nenhuma (manutenção)', async ({
    page,
  }) => {
    await expect(
      row(page, 'Chave de Fenda').getByRole('button', { name: 'Emprestar Chave de Fenda' })
    ).toBeVisible();
    await expect(
      row(page, 'Esmerilhadeira').getByRole('button', { name: 'Devolver Esmerilhadeira' })
    ).toBeVisible();
    await expect(
      row(page, 'Serra Circular').getByRole('button', { name: /Emprestar|Devolver/ })
    ).toHaveCount(0);
  });

  test('menu de ações: só as opções válidas para cada status; ações destrutivas inexistentes', async ({
    page,
  }) => {
    const items = async (name) => {
      const trigger = row(page, name).getByRole('button', { name: `Mais ações de ${name}` });

      await trigger.click();
      const labels = await row(page, name).getByRole('menuitem').allTextContents();

      await page.keyboard.press('Escape');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      return labels;
    };

    expect(await items('Chave de Fenda')).toEqual([
      'Editar',
      'Registrar manutenção',
      'Histórico',
      'Marcar como emprestada',
      'Marcar como em manutenção',
    ]);
    // Emprestada: sem manutenção nem troca de status (regra existente do quickStatusUpdate).
    expect(await items('Esmerilhadeira')).toEqual(['Editar', 'Histórico']);
    expect(await items('Serra Circular')).toEqual([
      'Editar',
      'Registrar manutenção',
      'Histórico',
      'Marcar como disponível',
      'Marcar como emprestada',
    ]);
  });

  test('menu por teclado: ↓ abre e foca o primeiro; ↑↓ navegam; Esc fecha e devolve o foco', async ({
    page,
  }) => {
    const line = row(page, 'Martelo');
    const trigger = line.getByRole('button', { name: 'Mais ações de Martelo' });

    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await trigger.focus();
    await page.keyboard.press('ArrowDown');

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(line.getByRole('menu', { name: 'Ações de Martelo' })).toBeVisible();
    await expect(line.getByRole('menuitem', { name: 'Editar' })).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(line.getByRole('menuitem', { name: 'Registrar manutenção' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(line.getByRole('menuitem', { name: 'Marcar como em manutenção' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  });

  test('Histórico pelo menu abre o modal e o foco volta ao gatilho ao fechar', async ({ page }) => {
    const trigger = row(page, 'Furadeira de Impacto').getByRole('button', {
      name: 'Mais ações de Furadeira de Impacto',
    });

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Histórico' }).click();

    await expect(page.locator('#tool-history-modal')).toBeVisible();
    await expect(page.locator('#tool-history-name')).toContainText('Furadeira de Impacto');
    await page.keyboard.press('Escape');
    await expect(page.locator('#tool-history-modal')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Editar e Registrar manutenção pelo menu abrem os formulários existentes', async ({
    page,
  }) => {
    const line = row(page, 'Chave de Fenda');

    await line.getByRole('button', { name: 'Mais ações de Chave de Fenda' }).click();
    await page.getByRole('menuitem', { name: 'Editar' }).click();
    await expect(page.locator('#modal-title')).toHaveText('Editar Ferramenta');
    await expect(page.locator('#crud-code')).toHaveValue('T-E2E-005');
    await expect(page.locator('#crud-code')).toBeDisabled();
    await expect(page.locator('#crud-name')).toHaveValue('Chave de Fenda');
    await page.locator('#crud-modal').getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('#crud-modal')).toBeHidden();

    await line.getByRole('button', { name: 'Mais ações de Chave de Fenda' }).click();
    await page.getByRole('menuitem', { name: 'Registrar manutenção' }).click();
    await expect(page.locator('#tool-maintenance-modal')).toBeVisible();
    await expect(page.locator('#tool-maintenance-name')).toContainText(
      'Chave de Fenda (T-E2E-005)'
    );
  });

  test('Nova abre o cadastro vazio; Importar aciona o seletor de planilha', async ({ page }) => {
    await page.locator('#tools-action-new').click();
    await expect(page.locator('#modal-title')).toHaveText('Nova Ferramenta');
    await expect(page.locator('#crud-code')).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#crud-modal')).toBeHidden();

    const chooser = page.waitForEvent('filechooser');

    await page.locator('#tools-action-import').click();
    await expect(await chooser).toBeTruthy();
  });

  test('trocar status pelo menu chama quickStatusUpdate com o id e o status certos', async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__statusCalls = [];
      window.App.CRUDTools.quickStatusUpdate = (...args) => window.__statusCalls.push(args);
    });

    const line = row(page, 'Chave de Fenda');

    await line.getByRole('button', { name: 'Mais ações de Chave de Fenda' }).click();
    await page.getByRole('menuitem', { name: 'Marcar como em manutenção' }).click();

    expect(await page.evaluate(() => window.__statusCalls)).toEqual([['T-E2E-005', 'maintenance']]);
  });

  test('miniatura com imagem abre o visualizador; sem imagem é apenas decorativa', async ({
    page,
  }) => {
    await expect(row(page, 'Martelo').locator('button.tools-thumb')).toHaveCount(0);

    await page.evaluate(() => {
      const tool = window.App.Data.tools.find((item) => item.code === 'T-E2E-003');

      tool.imageUrl =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      window.App.CRUDTools.render();
    });

    await row(page, 'Martelo').getByRole('button', { name: 'Ampliar imagem de Martelo' }).click();
    await expect(page.locator('#image-lightbox')).toBeVisible();
    await expect(page.locator('#lightbox-caption')).toHaveText('Martelo');
  });

  test('atualização de dados com o menu aberto espera o menu fechar e devolve o foco', async ({
    page,
  }) => {
    const trigger = row(page, 'Trena').getByRole('button', { name: 'Mais ações de Trena' });

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const same = () =>
      page.evaluate(() => {
        const current = [
          ...document.querySelectorAll('#crud-list [data-tools-menu-trigger]'),
        ].pop();

        return current === window.__lastTrigger;
      });

    await page.evaluate(() => {
      window.__lastTrigger = [
        ...document.querySelectorAll('#crud-list [data-tools-menu-trigger]'),
      ].pop();
      window.App.CRUDTools.render();
    });

    // Renderização adiada: o menu continua aberto, no mesmo elemento.
    expect(await same()).toBe(true);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');

    // Ao fechar, a lista foi atualizada (elemento novo) e o foco está no gatilho novo da linha.
    expect(await same()).toBe(false);
    await expect(
      row(page, 'Trena').getByRole('button', { name: 'Mais ações de Trena' })
    ).toBeFocused();
  });

  test('re-renderizar a lista não acumula listeners de clique no documento', async ({ page }) => {
    // Instrumenta add/removeEventListener('click') do document a partir daqui.
    await page.evaluate(() => {
      window.__clicks = { added: 0, removed: 0 };

      const add = document.addEventListener.bind(document);
      const remove = document.removeEventListener.bind(document);

      document.addEventListener = (type, ...rest) => {
        if (type === 'click') {
          window.__clicks.added += 1;
        }

        return add(type, ...rest);
      };
      document.removeEventListener = (type, ...rest) => {
        if (type === 'click') {
          window.__clicks.removed += 1;
        }

        return remove(type, ...rest);
      };
    });

    await page.evaluate(() => {
      for (let index = 0; index < 5; index += 1) {
        window.App.CRUDTools.render();
      }
    });

    const { added, removed } = await page.evaluate(() => window.__clicks);
    const rows = E2E_EXPECTED_COUNTS.tools;

    // Cada render cria um menu por linha e descarta (dispose) os do render anterior: nada acumula.
    expect(added).toBe(5 * rows);
    expect(removed).toBe(5 * rows);
  });
});

test.describe('ADMIN — Ferramentas: exportação preservada', () => {
  test('Exportar gera a mesma planilha de antes (colunas, linhas e nome do arquivo)', async ({
    page,
  }) => {
    // O motor de planilhas real vem de um CDN (bloqueado no E2E): substituído por um espião.
    await page.addInitScript(() => {
      window.__sheet = {};
      window.XLSX = {
        utils: {
          json_to_sheet: (rows) => {
            window.__sheet.rows = rows;
            return {};
          },
          book_new: () => ({}),
          book_append_sheet: (book, sheet, name) => {
            window.__sheet.name = name;
          },
        },
        writeFile: (book, file) => {
          window.__sheet.file = file;
        },
      };
    });

    await openTools(page);
    await page.locator('#tools-action-export').click();

    const sheet = await page.evaluate(() => window.__sheet);

    expect(sheet.name).toBe('Inventário');
    expect(sheet.file).toMatch(/^inventario_completo_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(sheet.rows).toHaveLength(E2E_EXPECTED_COUNTS.tools);
    expect(Object.keys(sheet.rows[0])).toEqual([
      'Patrimônio',
      'Descrição',
      'Categoria',
      'Status',
      'Responsável',
      'Última Ação',
    ]);
    expect(sheet.rows.map((item) => item.Status).sort()).toEqual([
      'Disponível',
      'Disponível',
      'Disponível',
      'Disponível',
      'Emprestada',
      'Emprestada',
      'Manutenção',
      'Manutenção',
    ]);
    await expect(
      page.locator('.toast-item').filter({ hasText: '8 ferramenta(s) exportada(s).' })
    ).toBeVisible();
  });
});

test.describe('ADMIN — Ferramentas: estados da interface', () => {
  test.beforeEach(async ({ page }) => {
    await openTools(page);
  });

  test('CARREGANDO: skeleton, aria-busy e nunca "nenhuma ferramenta"', async ({ page }) => {
    await page.evaluate(() => {
      window.App.Data.toolsLoaded = false;
      window.App.CRUDTools.render();
    });

    await expect(list(page)).toHaveAttribute('aria-busy', 'true');
    await expect(list(page).locator('.ui-skeleton-card')).toHaveCount(6);
    await expect(list(page)).not.toContainText('Nenhuma ferramenta');
    await expect(countText(page)).toHaveText('Carregando ferramentas...');
    await expect(page.locator('#crud-load-more')).toBeHidden();

    await page.evaluate(() => {
      window.App.Data.toolsLoaded = true;
      window.App.CRUDTools.render();
    });

    await expect(list(page)).not.toHaveAttribute('aria-busy', 'true');
    await expect(list(page)).toContainText('Furadeira de Impacto');
  });

  test('VAZIO: inventário sem ferramentas, com ação de cadastro para quem pode', async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.App.Data.tools = [];
      window.App.CRUDTools.render();
    });

    await expect(list(page)).toContainText('Nenhuma ferramenta cadastrada');
    await expect(list(page)).not.toContainText('Nenhuma ferramenta encontrada');
    await expect(list(page).getByRole('button', { name: 'Nova ferramenta' })).toBeVisible();

    await list(page).getByRole('button', { name: 'Nova ferramenta' }).click();
    await expect(page.locator('#modal-title')).toHaveText('Nova Ferramenta');
  });

  test('ERRO: aviso persistente compreensível, sem detalhes internos e sem parecer "vazio"', async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.App.Data.tools = [];
      window.App.Data.toolsError = true;
      window.App.CRUDTools.render();
    });

    const alert = page.locator('#tools-feedback').getByRole('alert');

    await expect(alert).toContainText('Não foi possível carregar as ferramentas');
    await expect(alert).toContainText('recarregue a página');
    await expect(alert).not.toContainText(/firebase|firestore|permission|api\//i);
    await expect(list(page)).not.toContainText('Nenhuma ferramenta cadastrada');
    await expect(page.locator('#crud-load-more')).toBeHidden();

    await page.evaluate(() => {
      window.App.Data.toolsError = false;
    });
  });

  test('"Carregar mais" só aparece com mais itens que o limite e amplia a lista', async ({
    page,
  }) => {
    await expect(page.locator('#crud-load-more')).toBeHidden();

    await page.evaluate(() => {
      window.App.Data.crudLimit = 3;
      window.App.CRUDTools.render();
    });

    await expect(countText(page)).toHaveText('Mostrando 3 de 8 ferramentas');
    await expect(page.locator('#crud-list tr.tools-row')).toHaveCount(3);
    await expect(page.locator('#crud-load-more')).toBeVisible();

    await page.locator('#crud-load-more').click();
    await expect(page.locator('#crud-list tr.tools-row')).toHaveCount(8);
    await expect(page.locator('#crud-load-more')).toBeHidden();
  });
});

for (const profile of ['standard', 'restricted']) {
  test.describe(`${profile.toUpperCase()} — Ferramentas somente leitura`, () => {
    test.beforeEach(async ({ page }) => {
      await openTools(page, E2E_USERS[profile]);
    });

    test('vê o inventário, sem ações de gestão (nem coluna, nem menu, nem barra)', async ({
      page,
    }) => {
      expect((await readPermissions(page)).canManageTools).toBe(false);
      await expectNames(page, ORDER_NAME_ASC);

      await expect(page.getByRole('table').getByRole('columnheader')).toHaveText([
        'Ferramenta',
        'Status',
        'Responsável',
        'Última ação',
      ]);
      await expect(page.locator('[data-tools-menu-trigger]')).toHaveCount(0);
      await expect(page.locator('#crud-list').getByRole('button')).toHaveCount(0);
      await expect(page.locator('#tools-action-new')).toBeHidden();
      await expect(page.locator('#tools-action-import')).toBeHidden();
      await expect(page.locator('#tools-action-export')).toBeHidden();
      await expect(page.locator('.tools-header')).toBeHidden();
      await expect(page.locator('#tab-management .ui-btn--primary:visible')).toHaveCount(0);

      // Busca e filtros continuam disponíveis para leitura.
      await page.getByRole('searchbox').fill('serra');
      await expectNames(page, ['Serra Circular']);
    });

    test('as ações continuam recusadas pela função (não depende de esconder botão)', async ({
      page,
    }) => {
      const result = await page.evaluate(() => {
        window.App.CRUDTools.quickStatusUpdate('T-E2E-005', 'maintenance');
        window.App.CRUDTools.openModal();
        window.App.CRUDTools.openMaintenanceModal('T-E2E-005');

        return {
          status: window.App.Data.tools.find((tool) => tool.firebaseId === 'T-E2E-005').status,
          crudOpen: document.getElementById('crud-modal').open,
          maintenanceOpen: document.getElementById('tool-maintenance-modal').open,
        };
      });

      expect(result).toEqual({ status: 'available', crudOpen: false, maintenanceOpen: false });
      await expect(
        page
          .locator('.toast-item')
          .filter({ hasText: 'Acesso restrito a administradores.' })
          .first()
      ).toBeVisible();
    });

    test('estado vazio não oferece cadastro', async ({ page }) => {
      await page.evaluate(() => {
        window.App.Data.tools = [];
        window.App.CRUDTools.render();
      });

      await expect(list(page)).toContainText('Nenhuma ferramenta cadastrada');
      await expect(list(page).getByRole('button')).toHaveCount(0);
    });
  });
}

test.describe('RESTRITO — Ferramentas não lê colaboradores', () => {
  test('a tela não carrega nem consulta colaboradores para o perfil restrito', async ({ page }) => {
    await openTools(page, E2E_USERS.restricted);

    const state = await page.evaluate(() => ({
      collaborators: window.App.Data.collaborators.length,
      listeners: window.App.Data.listeners.length,
      permissions: {
        read: window.App.Auth.permissions.canReadCollaborators,
        manage: window.App.Auth.permissions.canManageCollaborators,
      },
    }));

    // Só o listener de ferramentas (mesmo contrato do auth-restricted): nenhum de colaboradores.
    expect(state).toEqual({
      collaborators: 0,
      listeners: 1,
      permissions: { read: false, manage: false },
    });
    // O responsável mostrado vem do próprio documento da ferramenta (currentUser), não de consulta.
    await expect(row(page, 'Esmerilhadeira')).toContainText('Colaborador Beta');
  });
});

// Responsividade: a lista é tabela a partir de 1024 e cartões abaixo, com os mesmos dados.
const WIDTHS = [320, 375, 390, 430, 767, 768, 1024, 1280, 1440, 1536];

for (const width of WIDTHS) {
  test(`LAYOUT ${width}px: sem rolagem horizontal, controles dentro da tela, nomes longos tratados`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    await openTools(page);

    const table = width >= 1024;

    await expect(page.locator('#crud-list table.tools-table')).toHaveCount(table ? 1 : 0);
    await expect(page.locator('#crud-list ul.tools-cards')).toHaveCount(table ? 0 : 1);

    const measure = () =>
      page.evaluate(() => {
        const issues = [];
        const inside = (rect) =>
          rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.width > 0;
        const scroll = document.getElementById('main-content-scroll');

        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
          issues.push('rolagem horizontal na página');
        }

        if (scroll.scrollWidth > scroll.clientWidth + 1) {
          issues.push('rolagem horizontal na área principal');
        }

        for (const element of document.querySelectorAll(
          '#tab-management .ui-btn, #tab-management .ui-control, #tab-management .ui-icon-btn, #tab-management .ui-badge'
        )) {
          if (element.offsetParent === null) {
            continue;
          }

          const rect = element.getBoundingClientRect();
          const name = (element.textContent || element.getAttribute('aria-label') || '')
            .trim()
            .slice(0, 30);

          if (!inside(rect)) {
            issues.push(
              `"${name}" fora da tela (${Math.round(rect.left)}..${Math.round(rect.right)})`
            );
          }
        }

        return issues;
      });

    expect(await measure(), `${width}px: tela`).toEqual([]);

    // Nome e patrimônio muito longos (sem espaços) quebram dentro do item em vez de estourar a tela.
    await page.evaluate(() => {
      window.App.Data.tools = [
        ...window.App.Data.tools,
        {
          firebaseId: 'T-LONGA',
          code: 'PATRIMONIO-COM-CODIGO-EXTREMAMENTE-LONGO-SEM-ESPACOS-0123456789',
          name: 'Ferramenta-com-nome-extremamente-longo-sem-espacos-para-testar-a-quebra-de-linha',
          category: 'Categoria-igualmente-comprida-para-o-teste',
          status: 'borrowed',
          currentUser: 'Colaborador-com-nome-muito-comprido-sem-espacos-nenhum-mesmo',
          lastAction: '2026-08-12T13:00:00.000Z',
        },
      ];
      window.App.CRUDTools.render();
    });
    await expect(list(page)).toContainText('Ferramenta-com-nome-extremamente-longo');
    expect(await measure(), `${width}px: nomes longos`).toEqual([]);

    // Busca e filtros utilizáveis: o campo e os chips ficam visíveis e acionáveis.
    await expect(page.getByRole('searchbox')).toBeVisible();
    await chip(page, 'Emprestadas').click();
    await expect(chip(page, 'Emprestadas')).toHaveAttribute('aria-pressed', 'true');
  });
}

test.describe('ADMIN — Ferramentas no tema escuro usa os tokens', () => {
  test('cores da lista, do status e do filtro ativo vêm dos tokens', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openTools(page);
    await expect(page.locator('html')).toHaveClass(/dark/);

    await chip(page, 'Disponíveis').click();
    // O botão anima a cor (150 ms): espera o estado final antes de comparar com os tokens.
    await expect(chip(page, 'Disponíveis')).toHaveCSS('color', 'rgb(147, 197, 253)');

    const colors = await page.evaluate(() => {
      const css = (selector, property) =>
        getComputedStyle(document.querySelector(selector))[property];
      const token = (name) => {
        const probe = document.createElement('span');

        probe.style.color = `var(${name})`;
        document.body.appendChild(probe);

        const value = getComputedStyle(probe).color;

        probe.remove();
        return value;
      };

      return {
        surface: [css('#crud-list .tools-table-wrap', 'backgroundColor'), token('--color-surface')],
        header: [
          css('#crud-list .tools-table thead th', 'backgroundColor'),
          token('--color-surface-muted'),
        ],
        name: [css('#crud-list .tools-tool__name', 'color'), token('--color-text-primary')],
        meta: [css('#crud-list .tools-tool__meta', 'color'), token('--color-text-secondary')],
        success: [css('#crud-list .ui-badge--success', 'color'), token('--color-success')],
        chip: [css('.tools-chip[aria-pressed="true"]', 'color'), token('--color-accent-text')],
        chipBg: [
          css('.tools-chip[aria-pressed="true"]', 'backgroundColor'),
          token('--color-accent-subtle'),
        ],
      };
    });

    for (const [name, [actual, expected]] of Object.entries(colors)) {
      expect(actual, `token ${name}`).toBe(expected);
    }
  });
});
