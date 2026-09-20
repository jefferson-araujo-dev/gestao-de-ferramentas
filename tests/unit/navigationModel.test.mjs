import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  DEFAULT_ROUTE,
  MOBILE_PRIMARY_MAX,
  NAV_GROUPS,
  NAV_ITEMS,
  getAllowedItems,
  getGroupedItems,
  getItemByRoute,
  getItemByTab,
  hashForRoute,
  isItemAllowed,
  routeFromHash,
  splitForMobile,
} from '../../src/js/config/navigation.js';

// Modelo único de navegação (Gate 1-D): consistência do modelo, visibilidade por perfil e
// não-drift com as permissões reais de App.Auth. Sem navegador.
const read = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');

// Perfis conforme AppAuth._setPermissions (conferido por teste de drift abaixo).
const ALL_FALSE = {
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
    ...ALL_FALSE,
    canAccessDashboard: true,
    canAccessScanner: true,
    canReadTools: true,
    canReadCollaborators: true,
    canAccessUsers: true,
    canAccessHistory: true,
    canBackupData: true,
  },
  standard: {
    ...ALL_FALSE,
    canAccessDashboard: true,
    canAccessScanner: true,
    canReadTools: true,
    canReadCollaborators: true,
  },
  restricted: {
    ...ALL_FALSE,
    canAccessDashboard: true,
    canAccessScanner: true,
    canReadTools: true,
  },
};

const ids = (items) => items.map((item) => item.id);

describe('modelo de navegação: consistência', () => {
  test('ids, rotas e telas são únicos', () => {
    for (const key of ['id', 'route', 'tab']) {
      const values = NAV_ITEMS.map((item) => item[key]);

      assert.equal(new Set(values).size, values.length, `${key} duplicado`);
    }
  });

  test('cada item tem grupo existente, rota simples e rótulo', () => {
    const groups = new Set(NAV_GROUPS.map((group) => group.id));

    for (const item of NAV_ITEMS) {
      assert.ok(groups.has(item.group), `${item.id}: grupo inexistente`);
      assert.match(item.route, /^[a-z]+$/, `${item.id}: rota`);
      assert.ok(item.label.trim() && item.title.trim(), `${item.id}: rótulo/título`);
      assert.equal(typeof item.permission, 'string');
    }
  });

  test('rotas mínimas do contrato existem', () => {
    assert.deepEqual(NAV_ITEMS.map((item) => item.route).sort(), [
      'auditoria',
      'colaboradores',
      'dados',
      'ferramentas',
      'painel',
      'scanner',
      'usuarios',
    ]);
    assert.equal(DEFAULT_ROUTE, 'painel');
  });

  test('todo ícone do modelo existe no sprite SVG', () => {
    const sprite = read('partials/layout/icon-sprite.html');

    for (const item of NAV_ITEMS) {
      assert.ok(sprite.includes(`id="${item.icon}"`), `${item.id}: ${item.icon} ausente no sprite`);
    }
  });

  test('toda tela do modelo tem o painel #tab-* no HTML', () => {
    const html = NAV_ITEMS.map((item) => item.tab).map((tab) =>
      read(`partials/tabs/tab-${tab}.html`).includes(`id="tab-${tab}"`)
    );

    assert.ok(html.every(Boolean));
  });

  test('drift: toda permissão usada pelo modelo existe em AppAuth._setPermissions', () => {
    const auth = read('js/modules/auth.js');

    for (const item of NAV_ITEMS) {
      assert.match(
        auth,
        new RegExp(`this\\.permissions\\.${item.permission}\\s*=`),
        item.permission
      );
    }
  });

  test('a regra de perfil não é duplicada no ui.js (só o modelo + permissões)', () => {
    const ui = read('js/modules/ui.js');

    assert.doesNotMatch(
      ui,
      /adminTabPermissions|canAccessUsers|canAccessHistory|canReadCollaborators/
    );
  });
});

describe('modelo de navegação: visibilidade por perfil', () => {
  test('falha fechado: flag ausente ou não-booleano não autoriza', () => {
    const item = getItemByRoute('auditoria');

    assert.equal(isItemAllowed(item, undefined), false);
    assert.equal(isItemAllowed(item, null), false);
    assert.equal(isItemAllowed(item, {}), false);
    assert.equal(isItemAllowed(item, { canAccessHistory: 'true' }), false);
    assert.equal(isItemAllowed(item, { canAccessHistory: 1 }), false);
    assert.equal(isItemAllowed(item, { canAccessHistory: true }), true);
  });

  test('sem permissões nada é exibido', () => {
    assert.deepEqual(getAllowedItems(null), []);
    assert.deepEqual(getGroupedItems(ALL_FALSE), []);
  });

  test('admin vê os 7 destinos; padrão não vê Auditoria/Usuários; restrito também não vê Colaboradores', () => {
    assert.deepEqual(ids(getAllowedItems(PROFILES.admin)), [
      'dashboard',
      'scanner',
      'tools',
      'collaborators',
      'history',
      'users',
      'data',
    ]);
    assert.deepEqual(ids(getAllowedItems(PROFILES.standard)), [
      'dashboard',
      'scanner',
      'tools',
      'collaborators',
    ]);
    assert.deepEqual(ids(getAllowedItems(PROFILES.restricted)), ['dashboard', 'scanner', 'tools']);
  });

  test('Dados e backup: rota #/dados, grupo Administração, só com canBackupData', () => {
    const item = getItemByRoute('dados');

    assert.equal(item.id, 'data');
    assert.equal(item.tab, 'data');
    assert.equal(item.label, 'Dados e backup');
    assert.equal(item.group, 'admin');
    assert.equal(item.permission, 'canBackupData');
    assert.equal(item.mobilePrimary, false);
    assert.equal(isItemAllowed(item, PROFILES.admin), true);
    assert.equal(isItemAllowed(item, PROFILES.standard), false);
    assert.equal(isItemAllowed(item, PROFILES.restricted), false);
    // Falha fechado: o outro flag administrativo (usuários) não basta.
    assert.equal(isItemAllowed(item, { ...ALL_FALSE, canAccessUsers: true }), false);
    assert.equal(isItemAllowed(item, { canBackupData: 'true' }), false);
  });

  test('grupos seguem a IA aprovada e grupos vazios não aparecem', () => {
    const summary = (permissions) =>
      getGroupedItems(permissions).map(({ group, items }) => `${group.id}:${ids(items).join(',')}`);

    assert.deepEqual(summary(PROFILES.admin), [
      'overview:dashboard',
      'operation:scanner,tools',
      'people:collaborators',
      'control:history',
      'admin:users,data',
    ]);
    assert.deepEqual(summary(PROFILES.restricted), [
      'overview:dashboard',
      'operation:scanner,tools',
    ]);
  });

  test('mobile: no máximo 4 destinos primários e "Mais" com os restantes autorizados', () => {
    const split = (profile) => {
      const { primary, more } = splitForMobile(PROFILES[profile]);

      return { primary: ids(primary), more: ids(more) };
    };

    assert.deepEqual(split('admin'), {
      primary: ['dashboard', 'scanner', 'tools', 'collaborators'],
      more: ['history', 'users', 'data'],
    });
    assert.deepEqual(split('standard'), {
      primary: ['dashboard', 'scanner', 'tools', 'collaborators'],
      more: [],
    });
    assert.deepEqual(split('restricted'), { primary: ['dashboard', 'scanner', 'tools'], more: [] });

    for (const profile of Object.keys(PROFILES)) {
      assert.ok(splitForMobile(PROFILES[profile]).primary.length <= MOBILE_PRIMARY_MAX);
    }

    assert.equal(MOBILE_PRIMARY_MAX, 4);
  });

  test('"Mais" nunca expõe destino não autorizado', () => {
    const { primary, more } = splitForMobile(PROFILES.restricted);

    for (const item of [...primary, ...more]) {
      assert.equal(isItemAllowed(item, PROFILES.restricted), true, item.id);
    }
  });
});

describe('roteamento: rotas e hash', () => {
  test('rota <-> hash <-> item', () => {
    assert.equal(hashForRoute('ferramentas'), '#/ferramentas');
    assert.equal(getItemByRoute('ferramentas').tab, 'management');
    assert.equal(getItemByTab('management').route, 'ferramentas');
    assert.equal(getItemByRoute('inexistente'), null);
    assert.equal(getItemByTab('inexistente'), null);
  });

  const cases = [
    ['#/painel', 'painel'],
    ['#/ferramentas', 'ferramentas'],
    ['#/ferramentas?x=1', 'ferramentas'],
    ['#/scanner/extra', 'scanner'],
    ['#/', ''],
    ['#', ''],
    ['', ''],
    ['#painel', ''],
    ['painel', ''],
    [undefined, ''],
    [null, ''],
    ['#/%E0%A4%A', ''],
    ['#/PAINEL', 'PAINEL'],
  ];

  for (const [hash, route] of cases) {
    test(`routeFromHash(${JSON.stringify(hash)}) = ${JSON.stringify(route)}`, () => {
      assert.equal(routeFromHash(hash), route);
    });
  }

  test('rota em maiúsculas não casa (rota desconhecida cai no Painel)', () => {
    assert.equal(getItemByRoute(routeFromHash('#/PAINEL')), null);
  });
});
