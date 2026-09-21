import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

// Tela Ferramentas (Gate 1-F2): verificações estáticas do que não precisa de navegador. O
// comportamento (busca, filtros, menu, estados, permissões) é coberto por tests/e2e/tools*.spec.js.
const read = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const css = read('css/tools.css');
const tokens = read('css/tokens.css');
const tools = read('js/modules/tools.js');
const partial = read('partials/tabs/tab-management.html');
const ui = read('js/modules/ui.js');

describe('tela Ferramentas: só tokens do design system (claro/escuro sem dark: ad hoc)', () => {
  test('sem dark:, sem !important, sem cor literal e sem onclick inline nos arquivos da tela', () => {
    assert.doesNotMatch(css, /\bdark:/);
    assert.doesNotMatch(partial, /\bdark:/, 'tab-management.html: dark: ad hoc');
    assert.doesNotMatch(partial, /onclick=|onchange=/, 'tab-management.html: handler inline');

    const code = stripComments(css);

    assert.doesNotMatch(code, /!important/);
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'cor literal no CSS da tela');
  });

  test('a lista renderizada por tools.js não usa handlers inline nem classes utilitárias de cor', () => {
    const start = tools.indexOf('mountControls: function');
    const end = tools.indexOf('openModal: function');
    const screen = tools.slice(start, end);

    assert.ok(screen.length > 2000);
    assert.doesNotMatch(screen, /onclick=|onchange=/, 'handler inline na lista');
    assert.doesNotMatch(
      screen,
      /\bdark:|bg-(slate|white|rose|amber|emerald)|text-(slate|rose|amber)/
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

  test('toda classe tools-* usada por tools.js e pelo HTML tem regra no CSS', () => {
    const classes = new Set(
      [...`${tools}${partial}`.matchAll(/class="([^"]*tools-[^"]*)"/g)]
        .flatMap((match) => match[1].split(/\s+/))
        .filter((name) => name.startsWith('tools-'))
    );

    assert.ok(classes.size >= 15, `só ${classes.size} classes encontradas`);

    for (const name of classes) {
      assert.ok(css.includes(`.${name}`), `${name} sem regra em tools.css`);
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

    assert.match(tools, /BREAKPOINTS\.notebook/);
    assert.doesNotMatch(tools, /innerWidth/);
  });
});

describe('tela Ferramentas: contratos preservados', () => {
  test('ids com consumidores (auth, scanner, testes, dados) continuam existindo', () => {
    for (const id of [
      'tab-management',
      'crud-list',
      'crud-load-more',
      'tools-action-export',
      'tools-action-import',
      'tools-action-new',
      'crud-import-input-tool',
      'inventory-result-count'
    ]) {
      assert.ok(partial.includes(`id="${id}"`), `${id} sumiu de tab-management.html`);
    }

    // Montados por mountControls (Search/Select): o scanner e o filtro dependem destes ids.
    for (const id of ['tools-search', 'inventory-category-filter', 'inventory-sort']) {
      assert.ok(tools.includes(`id: '${id}'`), `${id} sumiu de mountControls`);
    }

    // auth.js mostra/oculta as ações de gestão por estes ids.
    const auth = read('js/modules/auth.js');

    for (const id of ['tools-action-export', 'tools-action-import', 'tools-action-new']) {
      assert.ok(auth.includes(`'${id}'`), `${id} sem referência em auth.js`);
    }

    // A busca do Scanner ("ver detalhes") preenche #tools-search e dispara input.
    assert.match(read('js/modules/scanner.js'), /getElementById\('tools-search'\)/);
  });

  test('a classe responsive-action-bar continua na barra de ações (contrato dos testes responsivos)', () => {
    assert.match(partial, /class="responsive-action-bar tools-actions"/);
  });

  test('a busca e a ordenação seguem os mesmos valores e o mesmo algoritmo', () => {
    for (const value of ['name-asc', 'name-desc', 'category', 'status', 'recent', 'patrimony']) {
      assert.ok(tools.includes(`value: '${value}'`), `ordenação ${value} sumiu`);
    }

    for (const value of [
      'all',
      'available',
      'borrowed',
      'maintenance',
      'late',
      'maintenance-due'
    ]) {
      assert.ok(tools.includes(`value: '${value}'`), `filtro ${value} sumiu`);
    }

    // Busca: sem acento, por nome, patrimônio e categoria (mesmo trio de campos de antes).
    const search = tools.slice(tools.indexOf('if (q) {'), tools.indexOf('filtered.sort('));

    assert.match(search, /removeAccents\(String\(t\.name/);
    assert.match(search, /removeAccents\(String\(t\.code/);
    assert.match(search, /removeAccents\(String\(t\.category/);
    assert.doesNotMatch(search, /currentUser/);
  });

  test('as ações continuam validando a permissão dentro da função (não só escondendo botão)', () => {
    for (const name of [
      'quickExport',
      'bulkAction',
      'quickStatusUpdate',
      'openMaintenanceModal',
      'saveMaintenance',
      'openModal',
      'saveTool',
      'deleteTool',
      'importFile'
    ]) {
      const start = tools.indexOf(`${name}: `);

      assert.ok(start > 0, `${name} não encontrada`);
      assert.match(
        tools.slice(start, start + 260),
        /canManageTools\(\)/,
        `${name} sem verificação de canManageTools`
      );
    }
  });

  test('a tela não consulta colaboradores nem o backend (só a UI mudou)', () => {
    const start = tools.indexOf('mountControls: function');
    const end = tools.indexOf('openModal: function');
    const screen = tools.slice(start, end);

    assert.doesNotMatch(screen, /collaborators|COLLABORATORS|getDocs|onSnapshot|fetch\(/i);
  });

  test('estados da interface: carregando, erro, vazio e sem resultados são distintos', () => {
    assert.match(tools, /toolsLoaded\)\s*\{[\s\S]*aria-busy/);
    assert.match(tools, /toolsError/);
    assert.match(tools, /Nenhuma ferramenta cadastrada/);
    assert.match(tools, /Nenhuma ferramenta encontrada/);

    const data = read('js/modules/data.js');

    assert.match(data, /toolsError = true/);
    assert.match(data, /toolsError = false/);
  });

  test('ui.js não repete mais os listeners/opções de categoria e ordenação (agora em mountControls)', () => {
    assert.doesNotMatch(ui, /getElementById\('inventory-sort'\)\?\.addEventListener/);
    assert.doesNotMatch(ui, /getElementById\('inventory-category-filter'\)\?\.addEventListener/);
    assert.match(ui, /CRUDTools\.mountControls\(\)/);
  });

  test('nenhum diálogo nativo na tela (confirm/alert/prompt)', () => {
    assert.doesNotMatch(tools, /(^|[^.\w])(confirm|alert|prompt)\(/m);
  });
});

describe('Dropdown: libera o listener do documento (menus por linha re-renderizados)', () => {
  const overlays = read('js/components/overlays.js');

  test('dispose remove o listener de clique fora e onClose informa restoreFocus', () => {
    assert.match(
      overlays,
      /dispose\(\)\s*\{\s*document\.removeEventListener\('click', this\._onDocumentClick\)/
    );
    assert.match(overlays, /document\.addEventListener\('click', this\._onDocumentClick\)/);
    assert.match(overlays, /this\.onClose\?\.\(\{ restoreFocus \}\)/);
  });

  test('onOpen do Dropdown existe e tools.js isola o resto da tela enquanto um menu de linha está aberto', () => {
    assert.ok(overlays.includes('constructor({ trigger, panel, onOpen, onClose }'));
    assert.ok(overlays.includes('this.onOpen?.();'));
    assert.ok(tools.includes('onOpen: () => this._setBackgroundInert('));
    assert.ok(tools.includes('this._setBackgroundInert(null)'));
    assert.ok(tools.includes('element.inert = Boolean(activeRow) && element !== activeRow'));
  });

  test('os testes de axe não usam exclusão (nada de conteúdo escondido da varredura)', () => {
    const tests = new URL('../e2e/', import.meta.url);

    for (const file of ['support/axe.js', 'a11y-baseline.spec.js', 'baseline.mobile.spec.js']) {
      const source = readFileSync(new URL(file, tests), 'utf8');

      assert.ok(
        !source.includes('.exclude(') && !source.includes('exclude:'),
        `${file}: exclusão no axe`
      );
    }
  });

  test('tools.js descarta os menus antes de cada renderização', () => {
    const render = tools.slice(
      tools.indexOf('render: function'),
      tools.indexOf('_syncChips: function')
    );

    assert.match(render, /this\._disposeMenus\(\)/);
    assert.ok(
      render.indexOf('_disposeMenus()') < render.indexOf('list.innerHTML'),
      'menus antigos devem ser descartados antes de substituir a lista'
    );
  });
});
