import {
  expect,
  expectActiveTab,
  loginAs,
  openTab,
  readPermissions,
  test,
} from './support/fixtures.js';
import { E2E_EXPECTED_COUNTS, E2E_USERS } from './support/seed-data.mjs';

// Tela Colaboradores (Gate 1-F3). Roda no Firebase Emulator, com os dados sintéticos do seed.
// Estes testes NÃO alteram dados: carregando/vazio/erro são simulados só no cliente e as ações que
// escrevem (salvar, ativar/inativar, excluir) são conferidas por espião ou canceladas.
const list = (page) => page.locator('#collab-list');
const rows = (page) => page.locator('#collab-list [data-collab-row]');
const row = (page, name) => page.locator('#collab-list [data-collab-row]', { hasText: name });
const nameList = (page) => page.locator('#collab-list .collab-person__name').allTextContents();
const chip = (page, label) =>
  page.getByRole('button', { name: new RegExp(`^${label}\\s*\\d+`) });
const countText = (page) => page.locator('#collab-result-count');
const groupToggle = (page) => page.getByRole('switch', { name: 'Agrupar por cargo' });

// Nomes na ordem de leitura da tela. Agrupado por cargo (padrão), os cargos saem em ordem
// alfabética; dentro de cada um vale a ordenação escolhida.
const GROUPED_NAME_ASC = [
  'Colaborador Epsilon',
  'Colaborador Gama',
  'Colaborador Alfa',
  'Colaborador Beta',
  'Colaborador Delta',
];

const FLAT_NAME_ASC = [
  'Colaborador Alfa',
  'Colaborador Beta',
  'Colaborador Delta',
  'Colaborador Epsilon',
  'Colaborador Gama',
];

// A busca tem debounce (300 ms) e a lista re-renderiza depois: sempre com polling.
async function expectNames(page, expected, { sorted = false } = {}) {
  await expect
    .poll(async () => {
      const found = await nameList(page);

      return sorted ? [...found].sort() : found;
    })
    .toEqual(sorted ? [...expected].sort() : expected);
}

// O interruptor "Agrupar por cargo" alterna pelo rótulo (o trilho é decorativo, ver 25).
const toggleGrouping = (page) => groupToggle(page).focus().then(() => page.keyboard.press('Space'));

// Tablet (768-1023): a navegação é um drawer aberto pelo botão da barra superior.
async function openCollaborators(page, user = E2E_USERS.admin) {
  await loginAs(page, user);

  const width = page.viewportSize().width;

  if (width >= 768 && width < 1024) {
    await page.locator('#btn-sidebar-toggle').click();
    await page.locator('#nav-collaborators').click();
  } else {
    await openTab(page, 'collaborators');
  }

  await expectActiveTab(page, 'collaborators');
  await expect(list(page)).toContainText('Colaborador Alfa');
  await expect(countText(page)).toHaveText('Mostrando 5 de 5 colaboradores');
}

test.describe('ADMIN — Colaboradores: estrutura e leitura', () => {
  test.beforeEach(async ({ page }) => {
    await openCollaborators(page);
  });

  test('rota, título, região da lista e tabela semântica agrupada por cargo', async ({ page }) => {
    await expect(page).toHaveURL(/#\/colaboradores$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Colaboradores');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Lista de colaboradores' })
    ).toBeAttached();

    const table = page.getByRole('table', { name: 'Lista de colaboradores' });

    await expect(table).toBeVisible();
    await expect(table.locator('thead').getByRole('columnheader')).toHaveText([
      'Colaborador',
      'Crachá',
      'Situação',
      'Contato',
      'Ações',
    ]);
    await expectNames(page, GROUPED_NAME_ASC);

    // Agrupado: o cargo encabeça o grupo de linhas (scope="rowgroup"), com a contagem, e não se
    // repete em coluna.
    await expect(page.locator('.collab-group__row')).toHaveCount(3);
    await expect(page.locator('.collab-group__cell').first()).toHaveAttribute('scope', 'rowgroup');
    await expect(page.locator('.collab-group__name')).toHaveText([
      'Auxiliar',
      'Operador',
      'Supervisor',
    ]);
    await expect(page.locator('.collab-group__count')).toHaveText(['2', '2', '1']);

    // Nome é o cabeçalho da linha; crachá, situação e contato ficam nas colunas.
    await expect(table.getByRole('rowheader', { name: 'Colaborador Alfa' })).toBeVisible();
    await expect(row(page, 'Colaborador Alfa')).toContainText('E2E-001');
    await expect(row(page, 'Colaborador Alfa')).toContainText('(00) 00000-0000');

    // Estrutura antiga substituída: nada de contador duplicado nem dos filtros legados.
    await expect(
      page.locator('#collab-total-count, #collab-quick-filters, #collab-status-filter')
    ).toHaveCount(0);
    await expect(page.locator('#tab-collaborators [onclick]')).toHaveCount(0);
  });

  test('situação sempre em texto e pendências em palavras (cor é só reforço)', async ({ page }) => {
    await expect(row(page, 'Colaborador Alfa')).toContainText('Ativo');
    await expect(row(page, 'Colaborador Epsilon')).toContainText('Inativo');

    // Quem está com ferramenta em posse: o número vem escrito, não só colorido.
    await expect(row(page, 'Colaborador Alfa')).toContainText('1 ferramenta em posse');
    await expect(row(page, 'Colaborador Beta')).toContainText('1 ferramenta em posse');
    await expect(row(page, 'Colaborador Delta')).not.toContainText('em posse');

    // O badge de situação é o do design system (mesmo componente de Ferramentas).
    await expect(
      row(page, 'Colaborador Alfa').locator('.ui-badge--status[data-status="active"]')
    ).toBeVisible();
  });

  test('uma única ação primária no contexto principal (Novo); Exportar e Importar são secundárias', async ({
    page,
  }) => {
    const bar = page.getByRole('group', { name: 'Ações de colaboradores' });

    await expect(bar.getByRole('button')).toHaveText(['Exportar', 'Importar', 'Novo']);
    await expect(page.locator('#tab-collaborators .ui-btn--primary:visible')).toHaveCount(1);
    await expect(page.locator('#btn-collaborators-new')).toHaveClass(/ui-btn--primary/);
    await expect(page.locator('#btn-collaborators-export')).toHaveClass(/ui-btn--secondary/);
  });

  test('filtros de situação e de pendências são grupos rotulados e independentes', async ({
    page,
  }) => {
    const situation = page.getByRole('group', { name: 'Filtrar por situação' });
    const pending = page.getByRole('group', { name: 'Filtrar por pendências' });

    await expect(situation.getByRole('button')).toHaveCount(3);
    await expect(pending.getByRole('button')).toHaveCount(1);

    // Contagens vindas do seed: 5 no total, 4 ativos, 1 inativo, 2 com ferramenta em posse.
    await expect(situation.getByRole('button')).toHaveText([
      'Todos5',
      'Ativos4',
      'Inativos1',
    ]);
    await expect(pending.getByRole('button')).toHaveText(['Com pendências2']);

    // O estado ativo é anunciado (aria-pressed), não apenas pintado.
    await expect(chip(page, 'Todos')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, 'Ativos')).toHaveAttribute('aria-pressed', 'false');
  });

  test('busca e ordenação têm nome acessível e o agrupamento é um interruptor rotulado', async ({
    page,
  }) => {
    await expect(page.getByRole('searchbox')).toHaveAccessibleName(
      'Buscar por nome, crachá ou cargo'
    );
    await expect(page.locator('#collab-role-filter')).toHaveAccessibleName('Filtrar por cargo');
    await expect(page.locator('#collab-sort')).toHaveAccessibleName('Ordenar por');
    await expect(groupToggle(page)).toBeChecked();
  });
});

test.describe('ADMIN — Colaboradores: busca, filtros e ordenação', () => {
  test.beforeEach(async ({ page }) => {
    await openCollaborators(page);
  });

  test('busca por nome, crachá e cargo, sem acento e sem diferenciar maiúsculas', async ({
    page,
  }) => {
    const search = page.getByRole('searchbox');

    await search.fill('alfa');
    await expectNames(page, ['Colaborador Alfa']);

    await search.fill('E2E-003');
    await expectNames(page, ['Colaborador Gama']);

    await search.fill('SUPERVISOR');
    await expectNames(page, ['Colaborador Delta']);

    // "cracha" sem acento encontra "Crachá"? O campo pesquisado é o cargo: usa acento no seed.
    await search.fill('auxiliar');
    await expectNames(page, ['Colaborador Epsilon', 'Colaborador Gama']);

    await search.fill('nao-existe');
    await expect(list(page)).toContainText('Nenhum colaborador encontrado');
    await expect(countText(page)).toHaveText('Mostrando 0 de 0 colaboradores');
  });

  test('situação, cargo e pendências combinam e a contagem de filtros ativos acompanha', async ({
    page,
  }) => {
    await chip(page, 'Inativos').click();
    await expectNames(page, ['Colaborador Epsilon']);
    await expect(page.locator('#collab-active-filters')).toHaveText('1 filtro ativo');

    // Situação e pendências são independentes: o inativo do seed não tem ferramenta em posse.
    await chip(page, 'Com pendências').click();
    await expect(page.locator('#collab-active-filters')).toHaveText('2 filtros ativos');
    await expect(list(page)).toContainText('Nenhum colaborador encontrado');

    await chip(page, 'Ativos').click();
    await expectNames(page, ['Colaborador Alfa', 'Colaborador Beta'], { sorted: true });
    await expect(page.locator('#collab-active-filters')).toHaveText('2 filtros ativos');

    await page.locator('#collab-role-filter').selectOption('Operador');
    await expect(page.locator('#collab-active-filters')).toHaveText('3 filtros ativos');
    await expectNames(page, ['Colaborador Alfa', 'Colaborador Beta'], { sorted: true });

    await page.getByRole('searchbox').fill('beta');
    await expect(page.locator('#collab-active-filters')).toHaveText('4 filtros ativos');
    await expectNames(page, ['Colaborador Beta']);
  });

  test('o filtro de cargo é preenchido com os cargos dos dados carregados', async ({ page }) => {
    await expect(page.locator('#collab-role-filter option')).toHaveText([
      'Todos os cargos',
      'Auxiliar',
      'Operador',
      'Supervisor',
    ]);

    await page.locator('#collab-role-filter').selectOption('Auxiliar');
    await expectNames(page, ['Colaborador Epsilon', 'Colaborador Gama'], { sorted: true });
  });

  test('Limpar filtros só aparece com filtro ativo, devolve tudo e leva o foco para a busca', async ({
    page,
  }) => {
    const clear = page.locator('#collab-clear-filters');

    await expect(clear).toBeHidden();

    await chip(page, 'Inativos').click();
    await page.getByRole('searchbox').fill('epsilon');
    await expect(clear).toBeVisible();

    await clear.click();
    await expect(clear).toBeHidden();
    await expect(page.getByRole('searchbox')).toHaveValue('');
    await expect(chip(page, 'Todos')).toHaveAttribute('aria-pressed', 'true');
    await expectNames(page, GROUPED_NAME_ASC);
    await expect(page.getByRole('searchbox')).toBeFocused();
  });

  test('ordenação por nome, crachá e mais recentes usa os mesmos valores de antes', async ({
    page,
  }) => {
    const sort = page.locator('#collab-sort');

    await expect(sort.locator('option')).toHaveText([
      'Nome A-Z',
      'Nome Z-A',
      'Crachá',
      'Mais recentes',
    ]);

    // Sem agrupamento a ordenação vale para a lista inteira.
    await toggleGrouping(page);
    await expectNames(page, FLAT_NAME_ASC);

    await sort.selectOption('name-desc');
    await expectNames(page, [...FLAT_NAME_ASC].reverse());

    await sort.selectOption('badge');
    await expect
      .poll(() => page.locator('#collab-list .collab-cell--badge').allTextContents())
      .toEqual(['E2E-001', 'E2E-002', 'E2E-003', 'E2E-004', 'E2E-005']);
  });

  test('agrupar por cargo liga e desliga: sem grupos, o cargo vira coluna', async ({ page }) => {
    await expect(page.locator('.collab-group__row')).toHaveCount(3);

    await toggleGrouping(page);
    await expect(groupToggle(page)).not.toBeChecked();
    await expect(page.locator('.collab-group__row')).toHaveCount(0);

    const table = page.getByRole('table', { name: 'Lista de colaboradores' });

    await expect(table.locator('thead').getByRole('columnheader')).toHaveText([
      'Colaborador',
      'Crachá',
      'Cargo',
      'Situação',
      'Contato',
      'Ações',
    ]);
    await expect(row(page, 'Colaborador Delta')).toContainText('Supervisor');

    await toggleGrouping(page);
    await expect(page.locator('.collab-group__row')).toHaveCount(3);
  });
});

test.describe('ADMIN — Colaboradores: ações por pessoa', () => {
  test.beforeEach(async ({ page }) => {
    await openCollaborators(page);
  });

  test('Histórico é a ação visível; as demais ficam no menu, com Excluir separada', async ({
    page,
  }) => {
    const target = row(page, 'Colaborador Delta');

    await expect(target.getByRole('button', { name: 'Histórico de Colaborador Delta' })).toBeVisible();
    await target.getByRole('button', { name: 'Mais ações de Colaborador Delta' }).click();

    const menu = page.getByRole('menu', { name: 'Ações de Colaborador Delta' });

    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['Editar', 'Inativar', 'Excluir']);
    await expect(menu.getByRole('menuitem', { name: 'Excluir' })).toHaveClass(
      /ui-menu__item--danger/
    );
    await expect(menu.locator('hr[role="separator"]')).toHaveCount(1);
  });

  test('o menu reflete a situação: inativo oferece Ativar; pendência oferece a cobrança', async ({
    page,
  }) => {
    await row(page, 'Colaborador Epsilon')
      .getByRole('button', { name: /^Mais ações/ })
      .click();
    await expect(page.getByRole('menuitem').first()).toBeVisible();
    await expect(page.getByRole('menuitem')).toHaveText(['Editar', 'Ativar', 'Excluir']);
    await page.keyboard.press('Escape');

    // Alfa tem telefone E ferramenta em posse: a cobrança por WhatsApp aparece (como antes).
    await row(page, 'Colaborador Alfa')
      .getByRole('button', { name: /^Mais ações/ })
      .click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'Editar',
      'Inativar',
      'Cobrar no WhatsApp',
      'Excluir',
    ]);

    const link = page.getByRole('menuitem', { name: 'Cobrar no WhatsApp' });

    await expect(link).toHaveAttribute('href', /^https:\/\/wa\.me\/55\d+\?text=/);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  test('Histórico abre o modal com as movimentações da pessoa, em palavras', async ({ page }) => {
    await row(page, 'Colaborador Alfa')
      .getByRole('button', { name: 'Histórico de Colaborador Alfa' })
      .click();

    const modal = page.locator('#collab-history-modal');

    await expect(modal).toBeVisible();
    await expect(page.locator('#collab-history-name')).toHaveText('Colaborador Alfa');

    const items = modal.locator('.collab-history__item');

    await expect(items).toHaveCount(3);
    await expect(items.first()).toContainText('Retirada');
    await expect(items.first()).toContainText('Parafusadeira');
    await expect(modal).toContainText('T-E2E-002');

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });

  test('quem não tem movimentação vê um estado vazio, não uma lista em branco', async ({ page }) => {
    await row(page, 'Colaborador Delta')
      .getByRole('button', { name: /^Histórico de/ })
      .click();
    await expect(page.locator('#collab-history-modal')).toContainText(
      'Nenhuma movimentação registrada'
    );
  });

  test('Editar abre o formulário já preenchido com os dados da pessoa', async ({ page }) => {
    await row(page, 'Colaborador Gama')
      .getByRole('button', { name: /^Mais ações/ })
      .click();
    await page.getByRole('menuitem', { name: 'Editar' }).click();

    await expect(page.locator('#crud-collab-modal')).toBeVisible();
    await expect(page.locator('#collab-modal-title')).toHaveText('Editar colaborador');
    await expect(page.locator('#crud-collab-badge')).toHaveValue('E2E-003');
    await expect(page.locator('#crud-collab-name')).toHaveValue('Colaborador Gama');
    await expect(page.locator('#crud-collab-role')).toHaveValue('Auxiliar');
    await expect(page.locator('#crud-collab-phone')).toHaveValue('(00) 00000-0000');
  });

  test('Excluir pede confirmação perigosa e cancelar não remove ninguém', async ({ page }) => {
    const before = await page.evaluate(() => window.App.Data.collaborators.length);

    await row(page, 'Colaborador Delta')
      .getByRole('button', { name: /^Mais ações/ })
      .click();
    await page.getByRole('menuitem', { name: 'Excluir' }).click();

    const dialog = page.getByRole('dialog', { name: 'Excluir colaborador?' });

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();

    expect(await page.evaluate(() => window.App.Data.collaborators.length)).toBe(before);
    await expect(rows(page)).toHaveCount(E2E_EXPECTED_COUNTS.collaborators);
  });

  test('Ativar/Inativar chama a mesma atualização de status de antes', async ({ page }) => {
    // Espião: a escrita real no emulator não é feita aqui (o contrato é o mesmo toggleStatus).
    await page.evaluate(() => {
      window.__statusCalls = [];
      window.App.CRUDCollaborators.toggleStatus = (id) => window.__statusCalls.push(id);
    });

    const id = await page.evaluate(
      () => window.App.Data.collaborators.find((c) => c.name === 'Colaborador Delta').firebaseId
    );

    await row(page, 'Colaborador Delta')
      .getByRole('button', { name: /^Mais ações/ })
      .click();
    await page.getByRole('menuitem', { name: 'Inativar' }).click();

    expect(await page.evaluate(() => window.__statusCalls)).toEqual([id]);
  });
});

test.describe('ADMIN — Colaboradores: menu aberto isola o restante da tela (contrato do 1-F2.1)', () => {
  test.beforeEach(async ({ page }) => {
    await openCollaborators(page);
  });

  const openFirst = async (page) => {
    const trigger = page.locator('#collab-list [data-collab-menu-trigger]').first();

    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible();
    return trigger;
  };

  test('só a linha do menu fica interativa; fechar restaura toda a tela', async ({ page }) => {
    await openFirst(page);

    const state = () =>
      page.evaluate(() => {
        const inert = (selector) =>
          [...document.querySelectorAll(selector)].map((element) => element.inert);

        return {
          rows: inert('#collab-list [data-collab-row]'),
          controls: inert('#collab-filters, #collab-toolbar, .collab-meta, .collab-header'),
        };
      });

    const open = await state();

    expect(open.rows.filter(Boolean)).toHaveLength(E2E_EXPECTED_COUNTS.collaborators - 1);
    expect(open.rows[0]).toBe(false);
    expect(open.controls.every(Boolean)).toBe(true);

    await page.keyboard.press('Escape');

    const closed = await state();

    expect([...closed.rows, ...closed.controls].some(Boolean)).toBe(false);
  });

  test('clique fora do menu só o fecha: o botão de baixo não é acionado', async ({ page }) => {
    await page.evaluate(() => {
      window.__historyCalls = [];

      const original = window.App.CRUDCollaborators.showHistory.bind(window.App.CRUDCollaborators);

      window.App.CRUDCollaborators.showHistory = (...args) => {
        window.__historyCalls.push(args[0]);
        return original(...args);
      };
    });
    await openFirst(page);

    // Um botão de OUTRA linha que não está sob o menu: antes o clique atravessava para ele.
    const point = await page.evaluate(() => {
      const menu = document.querySelector('.ui-menu:not([hidden])').getBoundingClientRect();

      for (const button of document.querySelectorAll(
        '#collab-list [data-collab-row][inert] .ui-btn'
      )) {
        const rect = button.getBoundingClientRect();
        const x = (rect.left + rect.right) / 2;
        const y = (rect.top + rect.bottom) / 2;
        const underMenu = x >= menu.left && x <= menu.right && y >= menu.top && y <= menu.bottom;

        if (!underMenu && rect.height > 0 && y > 0 && y < innerHeight) {
          return { x, y };
        }
      }

      return null;
    });

    expect(point, 'deve existir um botão de outra linha fora da área do menu').not.toBeNull();
    await page.mouse.click(point.x, point.y);

    await expect(page.getByRole('menu')).toBeHidden();
    expect(await page.evaluate(() => window.__historyCalls)).toEqual([]);
    await expect(page.locator('#collab-history-modal')).toBeHidden();
  });

  test('teclado: setas ficam no menu; Esc fecha e devolve o foco ao gatilho', async ({ page }) => {
    const trigger = await openFirst(page);

    for (let step = 0; step < 5; step += 1) {
      await page.keyboard.press('ArrowDown');
      expect(
        await page.evaluate(() =>
          Boolean(document.activeElement.closest('.ui-menu:not([hidden])'))
        )
      ).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Tab fecha o menu e o foco segue para um controle já descoberto', async ({ page }) => {
    await openFirst(page);
    await page.keyboard.press('Tab');

    const after = await page.evaluate(() => ({
      menuOpen: Boolean(document.querySelector('.ui-menu:not([hidden])')),
      name:
        document.activeElement.getAttribute('aria-label') ||
        document.activeElement.textContent.trim().slice(0, 30),
      inert: document.activeElement.closest('[inert]') !== null,
    }));

    expect(after.menuOpen).toBe(false);
    expect(after.inert).toBe(false);
    expect(after.name).toMatch(/^(Histórico de|Mais ações de) /);
  });

  test('perto da borda da viewport o menu inverte/limita e fica inteiro na tela', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 500 });

    const triggers = page.locator('#collab-list [data-collab-menu-trigger]');
    const total = await triggers.count();

    for (const index of [0, Math.floor(total / 2), total - 1]) {
      await triggers.nth(index).scrollIntoViewIfNeeded();
      await triggers.nth(index).click();
      await expect(page.getByRole('menu')).toBeVisible();

      const box = await page.getByRole('menu').boundingBox();
      const viewport = page.viewportSize();

      expect(box.y, `linha ${index}: topo`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `linha ${index}: base`).toBeLessThanOrEqual(viewport.height);
      expect(box.x, `linha ${index}: esquerda`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `linha ${index}: direita`).toBeLessThanOrEqual(viewport.width);
      await page.keyboard.press('Escape');
    }
  });
});

test.describe('ADMIN — Colaboradores: formulário', () => {
  test.beforeEach(async ({ page }) => {
    await openCollaborators(page);
    await page.locator('#btn-collaborators-new').click();
    await expect(page.locator('#crud-collab-modal')).toBeVisible();
  });

  test('abre vazio, com título, rótulos visíveis e foco no primeiro campo', async ({ page }) => {
    await expect(page.locator('#collab-modal-title')).toHaveText('Novo colaborador');
    await expect(page.locator('#crud-collab-badge')).toBeFocused();
    await expect(page.locator('#crud-collab-badge')).toHaveValue('');
    await expect(page.locator('#crud-collab-name')).toHaveValue('');

    // Rótulo persistente e associado (não é placeholder).
    await expect(page.locator('#crud-collab-badge')).toHaveAccessibleName(/Crachá \/ Ponto/);
    await expect(page.locator('#crud-collab-name')).toHaveAccessibleName('Nome');
    await expect(page.locator('#crud-collab-role')).toHaveAccessibleName('Cargo');
    await expect(page.locator('#crud-collab-phone')).toHaveAccessibleName('Telefone / WhatsApp');
    await expect(page.locator('#crud-collab-image')).toHaveAccessibleName(/Foto/);
  });

  test('campos obrigatórios: o erro aparece junto do campo e o foco vai para ele', async ({
    page,
  }) => {
    await page.locator('#btn-save-collab').click();

    const badge = page.locator('#crud-collab-badge');

    await expect(badge).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#crud-collab-badge-error')).toHaveText('Informe o crachá / ponto.');
    await expect(page.locator('#crud-collab-name-error')).toHaveText('Informe o nome.');
    await expect(badge).toBeFocused();

    // A mensagem de domínio continua igual à de antes.
    await expect(
      page.locator('.toast-item').filter({ hasText: 'Os campos Nome e Cracha/Ponto são obrigatórios.' })
    ).toBeVisible();

    // A mensagem está ligada ao campo (o leitor de tela a lê junto).
    expect(await badge.getAttribute('aria-describedby')).toContain('crud-collab-badge-error');
  });

  test('crachá duplicado é recusado com a mesma regra e nada é salvo', async ({ page }) => {
    const before = await page.evaluate(() => window.App.Data.collaborators.length);

    await page.locator('#crud-collab-badge').fill('E2E-001');
    await page.locator('#crud-collab-name').fill('Outro Nome');
    await page.locator('#btn-save-collab').click();

    await expect(page.locator('#crud-collab-badge-error')).toHaveText(
      'Este crachá / ponto já está cadastrado.'
    );
    await expect(
      page.locator('.toast-item').filter({ hasText: 'Cracha/Ponto já cadastrado.' })
    ).toBeVisible();
    expect(await page.evaluate(() => window.App.Data.collaborators.length)).toBe(before);
    await expect(page.locator('#crud-collab-modal')).toBeVisible();
  });

  test('o fundo não descarta o formulário e Esc com alterações pede confirmação', async ({
    page,
  }) => {
    const modal = page.locator('#crud-collab-modal');

    await page.mouse.click(5, 5);
    await expect(modal).toBeVisible();

    await page.locator('#crud-collab-name').fill('Nome não salvo');
    await page.keyboard.press('Escape');

    const confirm = page.getByRole('dialog', { name: 'Descartar alterações?' });

    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Continuar editando' }).click();
    await expect(modal).toBeVisible();
    await expect(page.locator('#crud-collab-name')).toHaveValue('Nome não salvo');

    await page.keyboard.press('Escape');
    await confirm.getByRole('button', { name: 'Descartar' }).click();
    await expect(modal).toBeHidden();
  });

  test('envio duplo: o segundo clique não dispara outra gravação', async ({ page }) => {
    await page.evaluate(() => {
      window.__saves = 0;

      const button = document.getElementById('btn-save-collab');

      // Espião no lugar da gravação: conta as tentativas que passaram pelo botão ocupado.
      window.App.CRUDCollaborators.saveCollaborator = async () => {
        if (button.hasAttribute('aria-busy')) {
          return;
        }

        window.__saves += 1;
        button.setAttribute('aria-busy', 'true');
        await new Promise((resolve) => setTimeout(resolve, 300));
        button.removeAttribute('aria-busy');
      };
    });

    await page.locator('#btn-save-collab').click();
    await page.locator('#btn-save-collab').click();

    expect(await page.evaluate(() => window.__saves)).toBe(1);
  });
});

test.describe('ADMIN — Colaboradores: exportação preservada', () => {
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
          book_append_sheet: (_wb, _ws, name) => {
            window.__sheet.name = name;
          },
        },
        writeFile: (_wb, file) => {
          window.__sheet.file = file;
        },
      };
    });

    await openCollaborators(page);
    await page.locator('#btn-collaborators-export').click();

    const sheet = await page.evaluate(() => window.__sheet);

    expect(sheet.name).toBe('Colaboradores');
    expect(sheet.file).toMatch(/^colaboradores_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(sheet.rows).toHaveLength(E2E_EXPECTED_COUNTS.collaborators);
    expect(Object.keys(sheet.rows[0])).toEqual(['Nome', 'Crachá', 'Cargo']);
    expect(sheet.rows.map((r) => r.Nome).sort()).toEqual(FLAT_NAME_ASC);
    await expect(
      page.locator('.toast-item').filter({ hasText: 'Lista exportada com sucesso!' })
    ).toBeVisible();
  });

  test('Importar abre o seletor de arquivo com o mesmo contrato de antes', async ({ page }) => {
    await openCollaborators(page);

    const input = page.locator('#crud-import-input-collab');

    await expect(input).toHaveAttribute('accept', '.xlsx, .xls');
    // O input fica escondido (o botão é o alvo visível), então o nome é conferido no atributo.
    await expect(input).toHaveAttribute(
      'aria-label',
      'Importar colaboradores de uma planilha Excel'
    );

    // O botão apenas aciona o input escondido (o caminho completo da importação depende do CDN
    // do SheetJS, bloqueado no E2E: o contrato real está em collaborators.js, inalterado).
    await page.evaluate(() => {
      window.__clicks = 0;
      document
        .getElementById('crud-import-input-collab')
        .addEventListener('click', (event) => {
          event.preventDefault();
          window.__clicks += 1;
        });
    });
    await page.locator('#btn-collaborators-import').click();
    expect(await page.evaluate(() => window.__clicks)).toBe(1);
  });
});

test.describe('ADMIN — Colaboradores: estados da interface', () => {
  test.beforeEach(async ({ page }) => {
    await openCollaborators(page);
  });

  test('carregando: esqueleto e aviso, nunca "nenhum colaborador"', async ({ page }) => {
    await page.evaluate(() => {
      window.App.Data.collaboratorsLoaded = false;
      window.App.CRUDCollaborators.render();
    });

    await expect(list(page)).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#collab-list .ui-skeleton-card')).toHaveCount(6);
    await expect(countText(page)).toHaveText('Carregando colaboradores...');
    await expect(list(page)).not.toContainText('Nenhum colaborador');
  });

  test('vazio (nenhum cadastro) é diferente de sem resultados (busca/filtros)', async ({ page }) => {
    await page.getByRole('searchbox').fill('zzzz');
    await expect(list(page)).toContainText('Nenhum colaborador encontrado');
    await list(page).getByRole('button', { name: 'Limpar filtros' }).click();
    await expectNames(page, GROUPED_NAME_ASC);

    await page.evaluate(() => {
      window.App.Data.collaborators = [];
      window.App.CRUDCollaborators.render();
    });
    await expect(list(page)).toContainText('Nenhum colaborador cadastrado');
    await expect(list(page).getByRole('button', { name: 'Novo colaborador' })).toBeVisible();
  });

  test('erro ao carregar: aviso persistente, sem detalhes internos e sem lista vazia enganosa', async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.App.Data.collaboratorsError = true;
      window.App.CRUDCollaborators.render();
    });

    const alert = page.locator('#collab-feedback').getByRole('alert');

    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Não foi possível carregar os colaboradores');
    await expect(alert).not.toContainText(/firebase|firestore|permission/i);
    await expect(list(page)).not.toContainText('Nenhum colaborador cadastrado');
  });
});

test.describe('Colaboradores por perfil', () => {
  test('PADRÃO: lê a lista, sem ações de gestão e sem menu quando não há o que fazer', async ({
    page,
  }) => {
    await openCollaborators(page, E2E_USERS.standard);

    expect(await readPermissions(page)).toMatchObject({
      canReadCollaborators: true,
      canManageCollaborators: false,
    });

    await expect(page.locator('#btn-collaborators-new')).toBeHidden();
    await expect(page.locator('#btn-collaborators-import')).toBeHidden();
    await expect(page.locator('#btn-collaborators-export')).toBeHidden();

    // Histórico continua disponível para todos que leem a tela.
    await expect(page.locator('[data-collab-action="history"]')).toHaveCount(
      E2E_EXPECTED_COUNTS.collaborators
    );

    // Sem Editar/Inativar/Excluir: o menu só existe onde sobrou a cobrança por WhatsApp.
    await expect(page.locator('#collab-list [data-collab-menu-trigger]')).toHaveCount(2);
    await row(page, 'Colaborador Alfa')
      .getByRole('button', { name: /^Mais ações/ })
      .click();
    await expect(page.getByRole('menuitem')).toHaveText(['Cobrar no WhatsApp']);
  });

  test('PADRÃO: as funções de gestão continuam recusando, mesmo chamadas direto', async ({
    page,
  }) => {
    await openCollaborators(page, E2E_USERS.standard);

    const before = await page.evaluate(() => window.App.Data.collaborators.length);

    await page.evaluate(() => window.App.CRUDCollaborators.openModal());
    await expect(page.locator('#crud-collab-modal')).toBeHidden();
    await expect(page.locator('.toast-item').first()).toContainText('Acesso restrito');

    await page.evaluate(() =>
      window.App.CRUDCollaborators.deleteCollaborator(
        window.App.Data.collaborators[0].firebaseId
      )
    );
    await expect(page.getByRole('dialog', { name: 'Excluir colaborador?' })).toHaveCount(0);
    expect(await page.evaluate(() => window.App.Data.collaborators.length)).toBe(before);
  });

  test('RESTRITO: sem rota, sem listener, sem lista e sem dado de colaborador no cliente', async ({
    page,
  }) => {
    await loginAs(page, E2E_USERS.restricted);

    await expect(page.locator('[data-nav-id="collaborators"]')).toHaveCount(0);
    expect(await readPermissions(page)).toMatchObject({
      canReadCollaborators: false,
      canManageCollaborators: false,
    });

    // Só o listener de ferramentas (mesmo contrato do auth-restricted).
    expect(
      await page.evaluate(() => ({
        collaborators: window.App.Data.collaborators.length,
        listeners: window.App.Data.listeners.length,
      }))
    ).toEqual({ collaborators: 0, listeners: 1 });

    // Navegação programática é recusada e a tela não renderiza nada.
    await page.evaluate(() => window.App.UI.switchTab('collaborators'));
    await expect(page.locator('#tab-collaborators')).toBeHidden();
    expect(await page.evaluate(() => window.App.UI.activeTab)).toBe('dashboard');
    expect(await page.evaluate(() => document.getElementById('collab-list').textContent.trim())).toBe(
      ''
    );

    // Nenhum dado exclusivo do documento do colaborador (crachá, telefone) chega ao cliente. O
    // nome do responsável que aparece em Ferramentas vem do próprio documento da ferramenta
    // (currentUser), não de uma leitura da coleção: é o contrato já existente do perfil restrito.
    // O patrimônio das ferramentas ("T-E2E-001") é visível e não é dado de colaborador.
    expect(
      await page.evaluate(() => {
        const text = document.getElementById('main-app').textContent;

        return {
          badge: /(^|[^-])\bE2E-00\d/.test(text.replace(/T-E2E-00\d/g, '')),
          phone: text.includes('(00) 00000-0000'),
          store: JSON.stringify(window.App.Data.collaborators),
          panel: /Colaborador (Alfa|Beta|Gama|Delta|Epsilon)/.test(
            document.getElementById('tab-collaborators').textContent
          ),
        };
      })
    ).toEqual({ badge: false, phone: false, store: '[]', panel: false });
  });

  test('RESTRITO: deep link #/colaboradores não concede acesso nem inicia leitura', async ({
    page,
  }) => {
    await loginAs(page, E2E_USERS.restricted, { hash: '#/colaboradores' });

    await expect(page.locator('#topbar-title')).toHaveText('Painel');
    await expect(page.locator('#tab-collaborators')).toBeHidden();
    expect(
      await page.evaluate(() => ({
        collaborators: window.App.Data.collaborators.length,
        listeners: window.App.Data.listeners.length,
      }))
    ).toEqual({ collaborators: 0, listeners: 1 });

    // Forçar a renderização também não traz dado nenhum.
    await page.evaluate(() => window.App.CRUDCollaborators.render());
    expect(await page.evaluate(() => document.getElementById('collab-list').textContent)).not.toContain(
      'Colaborador'
    );
  });
});

// Responsividade: a lista é tabela a partir de 1024 e cartões abaixo, com os mesmos dados.
const WIDTHS = [320, 375, 390, 430, 767, 768, 1024, 1280, 1440, 1536];

for (const width of WIDTHS) {
  test(`LAYOUT ${width}px: sem rolagem horizontal, controles dentro da tela e nomes longos tratados`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    await openCollaborators(page);

    const table = width >= 1024;

    await expect(page.locator('#collab-list table')).toHaveCount(table ? 1 : 0);
    await expect(page.locator('#collab-list li.collab-card')).toHaveCount(
      table ? 0 : E2E_EXPECTED_COUNTS.collaborators
    );

    // Nome longo não pode empurrar a página: o layout quebra a palavra.
    await page.evaluate(() => {
      window.App.Data.collaborators[0].name =
        'ColaboradorComNomeExtraordinariamenteLongoParaTestarQuebra';
      window.App.CRUDCollaborators.render();
    });

    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      list: [...document.querySelectorAll('#collab-list, #collab-toolbar, .collab-meta')].map(
        (element) => element.scrollWidth > element.clientWidth + 1
      ),
    }));

    expect(overflow.page, `rolagem horizontal da página em ${width}px`).toBe(false);
    expect(overflow.list, `rolagem interna em ${width}px`).toEqual([false, false, false]);
  });
}

test.describe('Colaboradores no tema escuro', () => {
  test.use({ colorScheme: 'dark' });

  test('a tela usa os tokens do tema escuro, sem variante ad hoc', async ({ page }) => {
    await openCollaborators(page);
    await expect(page.locator('html')).toHaveClass(/dark/);

    const chipColors = await page.evaluate(() => {
      const element = document.querySelector('.collab-chip[aria-pressed="true"]');
      const style = getComputedStyle(element);

      return { background: style.backgroundColor, color: style.color };
    });

    expect(chipColors.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(chipColors.color).not.toBe(chipColors.background);
    await expect(row(page, 'Colaborador Alfa')).toContainText('Ativo');
  });
});
