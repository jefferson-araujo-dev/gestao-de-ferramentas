// Gate 1-F4.C4, Decisão 2(a): comportamento de AppUI.switchTab/applyRoute com o destino padrão
// por perfil (getDefaultItem). Executa os métodos reais de src/js/modules/ui.js sob stubs mínimos de
// navegador; o lifecycle da tela (_activateTab) e o toast são substituídos por registradores.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

globalThis.window = globalThis;
globalThis.document = {
  getElementById: () => null,
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  documentElement: {},
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { AppUI } = await import('../../src/js/modules/ui.js');

const NONE = {
  canAccessDashboard: false,
  canAccessScanner: false,
  canReadTools: false,
  canReadCollaborators: false,
  canAccessUsers: false,
  canAccessHistory: false,
  canBackupData: false,
};
const PROFILES = {
  admin: {
    ...NONE,
    canAccessDashboard: true,
    canAccessScanner: true,
    canReadTools: true,
    canReadCollaborators: true,
    canAccessUsers: true,
    canAccessHistory: true,
    canBackupData: true,
  },
  standard: {
    ...NONE,
    canAccessDashboard: true,
    canAccessScanner: true,
    canReadTools: true,
    canReadCollaborators: true,
  },
  restricted: { ...NONE, canAccessScanner: true },
};

function harness(permissions) {
  window.App = { Auth: { permissions } };

  const calls = { activated: [], toasts: [] };
  const ui = Object.create(AppUI);

  ui._routingActive = false;
  ui._activateTab = (item) => calls.activated.push(item.tab);
  ui.showToast = (message, type) => calls.toasts.push(type);

  return { ui, calls };
}

describe('switchTab/applyRoute com o destino padrão do perfil', () => {
  test('Restrito: tela não autorizada (inclusive Painel e Ferramentas) cai no Scanner, com aviso', () => {
    for (const tab of ['dashboard', 'management', 'users', 'collaborators', 'history', 'data']) {
      const { ui, calls } = harness(PROFILES.restricted);

      ui.switchTab(tab);

      assert.deepEqual(calls.activated, ['scanner'], tab);
      assert.deepEqual(calls.toasts, ['error'], tab);
    }
  });

  test('Restrito: rota desconhecida ou vazia cai no Scanner sem aviso; rota do Painel é recusada', () => {
    for (const route of [null, '', 'rota-inexistente']) {
      const { ui, calls } = harness(PROFILES.restricted);

      ui.applyRoute(route);

      assert.deepEqual(calls.activated, ['scanner'], String(route));
      assert.deepEqual(calls.toasts, [], String(route));
    }

    const { ui, calls } = harness(PROFILES.restricted);

    ui.applyRoute('painel');
    assert.deepEqual(calls.activated, ['scanner']);
    assert.deepEqual(calls.toasts, ['error']);
  });

  test('Admin e Padrão: destino padrão continua o Painel (sem regressão)', () => {
    for (const profile of ['admin', 'standard']) {
      const unknown = harness(PROFILES[profile]);

      unknown.ui.applyRoute('rota-inexistente');
      assert.deepEqual(unknown.calls.activated, ['dashboard'], profile);

      const unknownTab = harness(PROFILES[profile]);

      unknownTab.ui.switchTab('tela-inexistente');
      assert.deepEqual(unknownTab.calls.activated, ['dashboard'], profile);
    }

    const { ui, calls } = harness(PROFILES.standard);

    ui.switchTab('users');
    assert.deepEqual(calls.activated, ['dashboard']);
    assert.deepEqual(calls.toasts, ['error']);
  });

  test('sem nenhuma permissão (getDefaultItem = null): nada é ativado, sem aviso e sem recursão', () => {
    for (const permissions of [NONE, null, undefined]) {
      for (const tab of ['dashboard', 'scanner', 'users', 'tela-inexistente']) {
        const { ui, calls } = harness(permissions);

        ui.switchTab(tab);

        assert.deepEqual(calls.activated, [], `${tab} ${JSON.stringify(permissions)}`);
        assert.deepEqual(calls.toasts, [], `${tab} ${JSON.stringify(permissions)}`);
      }

      for (const route of [null, 'painel', 'rota-inexistente']) {
        const { ui, calls } = harness(permissions);

        ui.applyRoute(route);

        assert.deepEqual(calls.activated, [], String(route));
        assert.deepEqual(calls.toasts, [], String(route));
      }
    }
  });
});
