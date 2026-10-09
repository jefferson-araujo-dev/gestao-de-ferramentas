import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

// Tela Auditoria (Gate 1-F4.D2): verificações estáticas do que não precisa de navegador. O
// comportamento (campos, estados, busca, período, acesso por perfil) é coberto por
// tests/e2e/history.spec.js.
const read = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');

const partial = read('partials/tabs/tab-history.html');
const ui = read('js/modules/ui.js');
const data = read('js/modules/data.js');
const mainCss = read('css/main.css');

// Fatia entre dois marcadores. Falha se algum não existir ou se a ordem for inválida: uma fatia
// vazia faria as asserções negativas passarem sem verificar nada.
function slice(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end);

  assert.notEqual(from, -1, `marcador inicial não encontrado: ${start}`);
  assert.notEqual(to, -1, `marcador final não encontrado: ${end}`);
  assert.ok(to > from, `marcadores fora de ordem: ${start} / ${end}`);

  const part = source.slice(from, to);

  assert.ok(part.length > 200, `fatia suspeitamente curta para: ${start}`);

  return part;
}

const renderHistory = slice(ui, 'renderHistory: function', 'showImagePreview: function');
const loadHistoryQuery = slice(data, 'loadHistoryQuery: function', 'processAndRenderHistory: function');
const resetInMemoryState = slice(data, 'resetInMemoryState: function', 'init: function (permissions)');
const initFn = slice(data, 'init: function (permissions)', 'loadHistoryQuery: function');

const LEGACY_COLOR = /\b(?:bg|text|border|from|to|ring|shadow)-(?:slate|brand|emerald|sky|rose|purple|white)\b/;

describe('tela Auditoria: só tokens do design system', () => {
  test('partial e template de renderHistory sem dark:, sem cor fixa do Tailwind e sem hex', () => {
    for (const [name, source] of [
      ['tab-history.html', partial],
      ['ui.js (renderHistory)', renderHistory]
    ]) {
      assert.doesNotMatch(source, /\bdark:/, `${name}: dark: ad hoc`);
      assert.doesNotMatch(source, LEGACY_COLOR, `${name}: cor fixa do Tailwind`);
      assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b(?!-)/, `${name}: cor literal`);
    }
  });

  test('usa os componentes da fundação nos estados e no selo de movimentação', () => {
    for (const component of ['Alert(', 'EmptyState(', 'SkeletonCard()', 'StatusBadge(', 'Button(']) {
      assert.ok(renderHistory.includes(component), `renderHistory deve usar ${component}`);
    }

    assert.match(ui, /import \{[^}]*\bAlert\b[^}]*\bEmptyState\b[^}]*\} from '\.\.\/components\/index\.js'/);
    assert.match(ui, /import \{[^}]*\bSkeletonCard\b[^}]*\bStatusBadge\b[^}]*\} from/);
  });

  test('main.css não tem regras da tela de Auditoria (nada a remover, nada a acrescentar)', () => {
    assert.doesNotMatch(mainCss, /#history-|#tab-history/);
  });
});

describe('tela Auditoria: contratos preservados', () => {
  test('ids e seletores usados por data.js, ui.js e testes', () => {
    for (const id of [
      'tab-history',
      'history-time-filter',
      'history-search',
      'history-list',
      'history-feedback',
      'history-load-more-container',
      'history-load-more'
    ]) {
      assert.match(partial, new RegExp(`id="${id}"`), `tab-history.html: #${id}`);
    }

    assert.match(partial, /onclick="App\.Data\.loadMoreHistory\(\)"/);
    assert.match(partial, /id="history-load-more-container" class="hidden"/);
    assert.match(partial, /aria-labelledby="topbar-title"/);
  });

  test('controle de período: mesmas opções e mesmos valores', () => {
    const select = slice(partial, '<select', '</select>');
    const options = [...select.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(
      ([, value, label]) => `${value}=${label}`
    );

    assert.deepEqual(options, [
      'all=Sempre',
      'today=Hoje',
      '7days=Últimos 7 Dias',
      '30days=Este Mês'
    ]);
    assert.match(partial, /<label[^>]*for="history-time-filter"[^>]*>Período<\/label>/);
    assert.match(partial, /<label[^>]*for="history-search"[^>]*>Buscar no histórico<\/label>/);
  });

  test('não recria o botão "Limpar Antigos" (D6: vive em Manutenção de dados)', () => {
    assert.doesNotMatch(partial, /Limpar Antigos/i);
    assert.doesNotMatch(renderHistory, /Limpar Antigos/i);
    assert.doesNotMatch(partial, /clearOld|clearHistory/i);
  });

  test('campos exibidos: exatamente os de antes, e nenhum identificador do operador (D2)', () => {
    for (const field of [
      'log.toolName',
      'log.toolCode',
      'log.user',
      'log.type',
      'log.date',
      'log.ip',
      'log.device'
    ]) {
      assert.ok(renderHistory.includes(field), `renderHistory deve exibir ${field}`);
    }

    for (const label of ['Patrimônio:', 'Movimentação', 'Responsável', 'Data', 'Origem']) {
      assert.ok(renderHistory.includes(label), `rótulo visível preservado: ${label}`);
    }

    assert.match(renderHistory, /split\(' \/ '\)\[0\]/);
    // Nada além dos 7 campos é lido do registro: cada log.<campo> citado está na lista abaixo.
    const read = new Set([...renderHistory.matchAll(/\blog\.([A-Za-z]+)/g)].map(([, name]) => name));

    assert.deepEqual(
      [...read].sort(),
      ['date', 'device', 'ip', 'toolCode', 'toolName', 'type', 'user']
    );
    assert.doesNotMatch(renderHistory, /operator(Email|Uid)/);
    assert.doesNotMatch(partial, /operator(Email|Uid)/);
  });

  test('todo valor do registro passa por escapeHTML antes de ir para o HTML', () => {
    for (const safe of ['safeToolName', 'safeToolCode', 'safeUser', 'safeIp', 'safeDevice']) {
      assert.match(renderHistory, new RegExp(`const ${safe} = window\\.Utils\\.escapeHTML\\(`));
    }
  });

  test('busca e ordem de renderização: mesmo filtro, sem reordenar nem limitar em renderHistory', () => {
    assert.match(renderHistory, /window\.Utils\.removeAccents\(\s*document\.getElementById\('history-search'\)/);

    for (const field of ['toolName', 'toolCode', 'user']) {
      assert.match(renderHistory, new RegExp(`String\\(log\\.${field} \\|\\| ''\\)`));
    }

    assert.doesNotMatch(renderHistory, /\.sort\(|\.slice\(|historyLimit/);
  });
});

describe('tela Auditoria: estados', () => {
  test('precedência ERRO > CARREGANDO > VAZIO > LISTA no código', () => {
    const error = renderHistory.indexOf('window.App.Data.historyError');
    const loading = renderHistory.indexOf('window.App.Data.allHistoryLogs === null');
    const empty = renderHistory.indexOf('if (!filtered.length)');
    const listing = renderHistory.indexOf('list.innerHTML = filtered');

    for (const [name, position] of Object.entries({ error, loading, empty, listing })) {
      assert.notEqual(position, -1, `marcador do estado não encontrado: ${name}`);
    }

    assert.ok(error < loading && loading < empty && empty < listing);
    assert.match(renderHistory, /setAttribute\('aria-busy', 'true'\)/);
    assert.match(renderHistory, /removeAttribute\('aria-busy'\)/);
    assert.match(renderHistory, /Não foi possível carregar a auditoria/);
    assert.match(renderHistory, /Nenhum log para os critérios\./);
    assert.match(renderHistory, /Limpar filtros/);
  });

  test('"Limpar filtros" só restaura os controles e dispara os mesmos eventos', () => {
    assert.match(renderHistory, /getElementById\('history-search'\)/);
    assert.match(renderHistory, /t\.value = 'all'/);
    assert.match(renderHistory, /new Event\('input'/);
    assert.match(renderHistory, /new Event\('change'/);
    assert.doesNotMatch(renderHistory, /App\.Data\.(historyLimit|processAndRenderHistory)/);
  });

  test('historyError em data.js: declarado, zerado nos resets, false no sucesso, true no erro', () => {
    assert.match(data, /^ {2}historyError: false,$/m);
    assert.match(resetInMemoryState, /this\.historyError = false;/);
    assert.match(initFn, /this\.historyError = false;/);

    const success = slice(loadHistoryQuery, '(s) => {', '(err) => {');
    const failure = loadHistoryQuery.slice(loadHistoryQuery.indexOf('(err) => {'));

    assert.notEqual(loadHistoryQuery.indexOf('(err) => {'), -1);
    assert.match(success, /this\.historyError = false;/);
    assert.match(failure, /this\.historyError = true;/);
    assert.match(failure, /window\.Logger\.error\('Erro ao carregar historico\.', err\);/);
    assert.match(failure, /window\.App\.UI\.activeTab === 'history'/);
    assert.match(failure, /window\.App\.UI\.renderHistory\(\)/);
  });

  test('carga do histórico intacta: mesma coleção, sem consulta, limite nem ordenação no listener', () => {
    assert.match(
      loadHistoryQuery,
      /onSnapshot\(\s*collection\(db, DB_BASE_PATH, COLLECTIONS\.HISTORY\),/
    );
    assert.doesNotMatch(loadHistoryQuery, /\b(?:query|where|orderBy|limit)\(/);
    assert.match(data, /^ {2}historyLimit: 20,$/m);
    assert.match(data, /if \(permissions\?\.canAccessHistory === true\) \{\s*this\.loadHistoryQuery\(\);/);
  });
});
