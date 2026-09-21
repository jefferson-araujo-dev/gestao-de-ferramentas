import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

// Tela Colaboradores (Gate 1-F3): verificações estáticas do que não precisa de navegador. O
// comportamento (busca, filtros, menu, estados, permissões) é coberto por tests/e2e/collaborators*.
const read = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const css = read('css/collaborators.css');
const tokens = read('css/tokens.css');
const collaborators = read('js/modules/collaborators.js');
const partial = read('partials/tabs/tab-collaborators.html');
const formModal = read('partials/modals/collaborator-modal.html');
const historyModal = read('partials/modals/collab-history-modal.html');
const ui = read('js/modules/ui.js');

describe('tela Colaboradores: só tokens do design system (claro/escuro sem dark: ad hoc)', () => {
  test('sem dark:, sem !important, sem cor literal e sem onclick inline nos arquivos da tela', () => {
    assert.doesNotMatch(css, /\bdark:/);

    for (const [name, html] of [
      ['tab-collaborators.html', partial],
      ['collaborator-modal.html', formModal],
      ['collab-history-modal.html', historyModal]
    ]) {
      assert.doesNotMatch(html, /\bdark:/, `${name}: dark: ad hoc`);
      assert.doesNotMatch(html, /onclick=|onchange=/, `${name}: handler inline`);
    }

    const code = stripComments(css);

    assert.doesNotMatch(code, /!important/);
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'cor literal no CSS da tela');
  });

  test('a lista renderizada por collaborators.js não usa handlers inline nem classes de cor', () => {
    const start = collaborators.indexOf('mountControls: function');
    const end = collaborators.indexOf('loadMore: function');
    const screen = collaborators.slice(start, end);

    assert.ok(screen.length > 2000);
    assert.doesNotMatch(screen, /onclick=|onchange=/, 'handler inline na lista');
    assert.doesNotMatch(
      screen,
      /\bdark:|bg-(slate|white|rose|amber|emerald|indigo)|text-(slate|rose|amber|indigo)/
    );
  });

  test('todo var(--token) usado existe em tokens.css', () => {
    const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]))];

    assert.ok(used.length > 10);

    for (const name of used) {
      // --ui-control-h é do components.css (componentes do Gate 1-E).
      if (name === '--ui-control-h') {
        continue;
      }

      assert.ok(tokens.includes(`${name}:`), `${name} ausente em tokens.css`);
    }
  });

  test('toda classe collab-* usada pelo JS e pelo HTML tem regra no CSS', () => {
    const classes = new Set(
      [...`${collaborators}${partial}${formModal}${historyModal}`.matchAll(/class="([^"]*collab-[^"]*)"/g)]
        .flatMap((match) => match[1].split(/\s+/))
        .filter((name) => name.startsWith('collab-'))
    );

    assert.ok(classes.size >= 15, `só ${classes.size} classes encontradas`);

    for (const name of classes) {
      assert.ok(css.includes(`.${name}`), `${name} sem regra em collaborators.css`);
    }
  });

  test('breakpoints só do contrato do shell (767.98 / 768) e a tabela usa o de notebook em JS', () => {
    const queries = [
      ...stripComments(css).matchAll(/@media\s*\(\s*(min|max)-width:\s*([\d.]+)px\s*\)/g)
    ];

    assert.ok(queries.length > 0);

    for (const [, kind, value] of queries) {
      const allowed = kind === 'min' ? [768, 1024, 1280] : [767.98];

      assert.ok(allowed.includes(Number(value)), `${kind}-width: ${value}px fora do contrato`);
    }

    assert.match(collaborators, /BREAKPOINTS\.notebook/);
    assert.doesNotMatch(collaborators, /innerWidth/);
  });
});

describe('tela Colaboradores: contratos preservados', () => {
  test('ids com consumidores (auth, testes, dados) continuam existindo', () => {
    for (const id of [
      'tab-collaborators',
      'collab-list',
      'collab-load-more',
      'collab-result-count',
      'collab-group-toggle',
      'btn-collaborators-export',
      'btn-collaborators-import',
      'btn-collaborators-new',
      'crud-import-input-collab'
    ]) {
      assert.ok(partial.includes(`id="${id}"`), `${id} sumiu de tab-collaborators.html`);
    }

    // Montados por mountControls (Search/Select): o debounce de ui.js depende destes ids.
    for (const id of ['collab-search', 'collab-role-filter', 'collab-sort']) {
      assert.ok(collaborators.includes(`id: '${id}'`), `${id} sumiu de mountControls`);
    }

    // O formulário e o histórico mantêm os ids lidos por collaborators.js e pelos testes.
    for (const id of [
      'crud-collab-id',
      'crud-collab-badge',
      'crud-collab-name',
      'crud-collab-role',
      'crud-collab-phone',
      'crud-collab-image',
      'crud-collab-image-preview',
      'collab-image-icon',
      'btn-save-collab'
    ]) {
      assert.ok(formModal.includes(`id="${id}"`), `${id} sumiu de collaborator-modal.html`);
    }

    for (const id of ['collab-history-modal', 'collab-history-list', 'collab-history-name']) {
      assert.ok(historyModal.includes(`id="${id}"`), `${id} sumiu de collab-history-modal.html`);
    }

    // auth.js mostra/oculta as ações de gestão por estes ids.
    const auth = read('js/modules/auth.js');

    for (const id of [
      'btn-collaborators-export',
      'btn-collaborators-import',
      'btn-collaborators-new'
    ]) {
      assert.ok(auth.includes(`'${id}'`), `${id} sem referência em auth.js`);
    }
  });

  test('a classe responsive-action-bar continua na barra de ações (contrato dos testes responsivos)', () => {
    assert.match(partial, /class="responsive-action-bar collab-actions"/);
  });

  test('o formulário mantém 3 blocos e 2 ações no rodapé (contrato do teste responsivo)', () => {
    const children = [...formModal.matchAll(/^  <div class="ui-modal__(header|body|footer)"/gm)].map(
      (match) => match[1]
    );

    assert.deepEqual(children, ['header', 'body', 'footer']);

    const footer = formModal.slice(formModal.indexOf('ui-modal__footer'));

    assert.equal([...footer.matchAll(/<button/g)].length, 2);
    assert.equal([...formModal.matchAll(/data-dismissible="false"/g)].length, 1);
  });

  test('a busca e a ordenação seguem os mesmos valores e o mesmo algoritmo', () => {
    for (const value of ['name-asc', 'name-desc', 'badge', 'recent']) {
      assert.ok(collaborators.includes(`value: '${value}'`), `ordenação ${value} sumiu`);
    }

    for (const value of ['all', 'active', 'inactive']) {
      assert.ok(collaborators.includes(`value: '${value}'`), `filtro ${value} sumiu`);
    }

    // Busca: sem acento, por nome, crachá e cargo (mesmo trio de campos de antes).
    const search = collaborators.slice(
      collaborators.indexOf('if (q) {'),
      collaborators.indexOf('filtered.sort(')
    );

    assert.match(search, /removeAccents\(String\(u\.name/);
    assert.match(search, /removeAccents\(String\(u\.badge/);
    assert.match(search, /removeAccents\(String\(u\.role/);
  });

  test('as ações continuam validando a permissão dentro da função (não só escondendo botão)', () => {
    for (const [name, permission] of [
      ['exportList', 'canExportData'],
      ['toggleStatus', 'canManageCollaborators'],
      ['openModal', 'canManageCollaborators'],
      ['saveCollaborator', 'canManageCollaborators'],
      ['deleteCollaborator', 'canManageCollaborators'],
      ['importFile', 'canManageCollaborators']
    ]) {
      const start = collaborators.indexOf(`${name}: `);

      assert.ok(start > 0, `${name} não encontrada`);
      assert.match(
        collaborators.slice(start, start + 260),
        new RegExp(`_hasPermission\\('${permission}'\\)`),
        `${name} sem verificação de ${permission}`
      );
    }

    // bulkAction valida os dois caminhos (exportar e excluir) no início da função.
    const bulk = collaborators.slice(
      collaborators.indexOf('bulkAction: '),
      collaborators.indexOf('toggleStatus: ')
    );

    assert.match(bulk, /_hasPermission\('canExportData'\)/);
    assert.match(bulk, /_hasPermission\('canManageCollaborators'\)/);
  });

  test('o crachá e o contrato de gravação do colaborador não mudaram', () => {
    const save = collaborators.slice(
      collaborators.indexOf('saveCollaborator: '),
      collaborators.indexOf('deleteCollaborator: ')
    );

    // Mesma unicidade (sem diferenciar maiúsculas), sem normalizar/transformar o valor digitado.
    assert.match(save, /String\(u\.badge\)\.toLowerCase\(\) === String\(b\)\.toLowerCase\(\)/);
    assert.match(save, /value\.trim\(\)/);
    assert.doesNotMatch(save, /badge:\s*b\.(replace|padStart|toUpperCase|toLowerCase)/);

    // Mesmos campos persistidos, e status 'active' só na criação.
    assert.match(save, /badge: b,\s*name: n,\s*role: r,\s*phone: p,\s*imageUrl: imgUrl,/);
    assert.match(save, /status: 'active',/);
  });

  test('estados da interface: carregando, erro, vazio e sem resultados são distintos', () => {
    assert.match(collaborators, /collaboratorsLoaded\)\s*\{[\s\S]*aria-busy/);
    assert.match(collaborators, /collaboratorsError/);
    assert.match(collaborators, /Nenhum colaborador cadastrado/);
    assert.match(collaborators, /Nenhum colaborador encontrado/);

    const data = read('js/modules/data.js');

    assert.match(data, /collaboratorsError = true/);
    assert.match(data, /collaboratorsError = false/);
  });

  test('ui.js não repete mais os listeners de cargo/ordenação/agrupamento (agora em mountControls)', () => {
    assert.doesNotMatch(ui, /'collab-role-filter', 'collab-sort'/);
    assert.doesNotMatch(ui, /getElementById\('collab-group-toggle'\)\?\.addEventListener/);
    assert.match(ui, /CRUDCollaborators\.mountControls\(\)/);
    // A busca continua no debounce compartilhado de ui.js (montada antes dos listeners).
    assert.match(ui, /'collab-search'/);
  });

  test('nenhum diálogo nativo na tela (confirm/alert/prompt)', () => {
    assert.doesNotMatch(collaborators, /(^|[^.\w])(confirm|alert|prompt)\(/m);
  });
});

describe('Colaboradores: reaproveita o design system e a correção do Dropdown (1-F2.1)', () => {
  test('a situação usa o StatusBadge do design system, sem status novo', () => {
    const display = read('js/components/display.js');

    assert.match(display, /active: \{ label: 'Ativo', tone: 'success' \}/);
    assert.match(display, /inactive: \{ label: 'Inativo', tone: 'neutral' \}/);
    assert.match(collaborators, /StatusBadge\(/);
    // Os valores persistidos continuam sendo os mesmos dois.
    assert.doesNotMatch(collaborators, /status: '(?!active')[a-z]+'/);
  });

  test('o menu de linha isola o restante da tela enquanto está aberto', () => {
    assert.ok(collaborators.includes('onOpen: () => this._setBackgroundInert('));
    assert.ok(collaborators.includes('this._setBackgroundInert(null)'));
    assert.ok(collaborators.includes('element.inert = Boolean(activeRow) && element !== activeRow'));
  });

  test('os menus antigos são descartados antes de cada renderização', () => {
    const render = collaborators.slice(
      collaborators.indexOf('render: function'),
      collaborators.indexOf('_emptyStateHtml: function')
    );

    assert.match(render, /this\._disposeMenus\(\)/);
    assert.ok(
      render.indexOf('_disposeMenus()') < render.indexOf('list.innerHTML'),
      'menus antigos devem ser descartados antes de substituir a lista'
    );
  });

  test('os testes de axe continuam sem exclusão (nada escondido da varredura)', () => {
    const tests = new URL('../e2e/', import.meta.url);

    for (const file of ['support/axe.js', 'a11y-baseline.spec.js', 'baseline.mobile.spec.js']) {
      const source = readFileSync(new URL(file, tests), 'utf8');

      assert.ok(
        !source.includes('.exclude(') && !source.includes('exclude:'),
        `${file}: exclusão no axe`
      );
    }
  });
});
