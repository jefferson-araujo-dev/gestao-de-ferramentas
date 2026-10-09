import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

// Tela Usuários (Gate 1-F4.D1): verificações estáticas do que não precisa de navegador. O
// comportamento (lista, filtros, busca, estados, ações da própria conta) é coberto por
// tests/e2e/users.spec.js.
const read = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');

const users = read('js/modules/users.js');
const partial = read('partials/tabs/tab-users.html');
const modal = read('partials/modals/user-modal.html');
const data = read('js/modules/data.js');
const mainCss = read('css/main.css');

// Trechos de users.js que montam HTML (cartões, paginação e estado vazio).
const between = (start, end) => users.slice(users.indexOf(start), users.indexOf(end));
const templates = [
  between('render: function', 'openModal: function'),
  between('getEnhancedEmptyState: function', 'exportExcel: function'),
  between('setAccessFilter: function', 'applyFilters: function')
].join('\n');

const LEGACY_COLOR = /\b(?:bg|text|border|from|to|ring|shadow)-(?:slate|brand|emerald|rose|purple|white)\b/;

describe('tela Usuários: só tokens do design system', () => {
  test('partial, modal e templates sem dark:, sem cor fixa do Tailwind e sem hex', () => {
    for (const [name, source] of [
      ['tab-users.html', partial],
      ['user-modal.html', modal],
      ['users.js (templates)', templates]
    ]) {
      assert.doesNotMatch(source, /\bdark:/, `${name}: dark: ad hoc`);
      assert.doesNotMatch(source, LEGACY_COLOR, `${name}: cor fixa do Tailwind`);
      assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b(?!-)/, `${name}: cor literal`);
    }
  });

  test('main.css não tem mais as regras legadas da tela', () => {
    assert.doesNotMatch(mainCss, /#users-filters \.filter-btn/);
    assert.doesNotMatch(mainCss, /#users-counters > div/);
    assert.doesNotMatch(mainCss, /#user-management-body > div/);
  });
});

describe('tela Usuários: contratos preservados', () => {
  test('ids e seletores usados por users.js, ui.js e testes', () => {
    for (const id of [
      'tab-users',
      'user-management-body',
      'users-search',
      'users-filters',
      'count-total',
      'count-active',
      'count-admins',
      'count-users',
      'crud-import-input-user'
    ]) {
      assert.match(partial, new RegExp(`id="${id}"`), `tab-users.html: #${id}`);
    }

    for (const id of [
      'crud-user-modal',
      'user-modal-title',
      'user-modal-subtitle',
      'crud-user-id',
      'crud-user-name',
      'crud-user-email',
      'crud-user-department',
      'crud-user-access',
      'btn-save-user-text'
    ]) {
      assert.match(modal, new RegExp(`id="${id}"`), `user-modal.html: #${id}`);
    }

    assert.match(modal, /data-dismissible="false"/);
    // Barra de ações: o teste responsivo localiza o botão Novo por este onclick exato.
    assert.match(partial, /class="responsive-action-bar[^"]*"/);
    assert.match(partial, /onclick="App\.CRUDUsers\.openModal\(\)"/);
    assert.equal((partial.match(/class="sort-btn /g) || []).length, 4);
    assert.equal((partial.match(/data-filter="/g) || []).length, 5);
  });

  test('filtro "Usuários Padrão": comportamento atual preservado (Gate 1-F4.D1, D3)', () => {
    // O botão passa o valor sem acento e o filtro compara com acento: hoje ninguém é removido.
    // A correção pertence a um Gate próprio; este teste falha se ela vier junto com o redesign.
    assert.match(partial, /setAccessFilter\('Usuario Padrao'\)/);
    assert.match(users, /this\.currentAccessFilter === 'Usuário Padrão'/);
  });

  test('mesmas chamadas a /api/users/* e mesma proteção da própria conta', () => {
    for (const endpoint of ['create', 'update', 'status', 'delete']) {
      assert.match(users, new RegExp(`'/api/users/${endpoint}'`));
    }

    assert.match(users, /const disabledAttr = isProtected \? 'disabled' : '';/);
    assert.match(users, /window\.event\?\.target\?\.closest\?\.\('button'\)/);
  });
});

describe('tela Usuários: estados da lista', () => {
  test('carregando, erro, vazio e sem resultados são distintos', () => {
    assert.match(users, /usersLoaded\)\s*\{[\s\S]*aria-busy/);
    assert.match(users, /SkeletonCard/);
    assert.match(users, /usersError/);
    assert.match(users, /Não foi possível carregar os usuários/);
    assert.match(users, /Nenhum usuário cadastrado/);
    assert.match(users, /Nenhum usuário encontrado/);

    assert.match(data, /usersError = true/);
    assert.match(data, /usersError = false/);
  });

  test('ações dos cartões têm nome acessível (aria-label) além do title', () => {
    for (const label of [
      'Editar dados do usuário',
      'Alterar permissão de acesso',
      'Excluir permanentemente'
    ]) {
      assert.match(users, new RegExp(`aria-label="${label}"`));
    }
  });
});
