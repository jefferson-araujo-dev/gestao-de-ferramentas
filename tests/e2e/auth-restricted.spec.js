import {
  expect,
  expectActiveTab,
  loginAs,
  logoutViaSidebar,
  openTab,
  openUserMenu,
  readPermissions,
  test,
} from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

const restricted = E2E_USERS.restricted;

// Leitura direta de `collaborators` pelo navegador (mesmo SDK, mesma sessão do app): prova, de
// ponta a ponta, o que as regras do Firestore permitem, sem passar por nenhuma tela.
function readCollaboratorsDirectly(page) {
  return page.evaluate(async () => {
    const { db, DB_BASE_PATH } = await import('/js/app.js');
    const { collection, getDocs } = await import(
      'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js'
    );

    try {
      const snapshot = await getDocs(collection(db, DB_BASE_PATH, 'collaborators'));

      return { ok: true, size: snapshot.size };
    } catch (error) {
      return { ok: false, code: error?.code };
    }
  });
}

test.describe('RESTRITO — login, navegação e ausência de áreas administrativas', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, restricted);
  });

  test('login: perfil Usuário sem privilégios de admin', async ({ page }) => {
    await expect(page.locator('#user-role')).toHaveText('Usuário');
    await expect(page.locator('#user-name')).toHaveText('Rita Restrita');
    await expectActiveTab(page, 'dashboard', { initialLoad: true });

    expect(await readPermissions(page)).toMatchObject({
      isAdm: false,
      canAccessUsers: false,
      canAccessHistory: false,
      canBackupData: false,
      canManageTools: false,
      canManageCollaborators: false,
      canReadCollaborators: false,
    });
  });

  test('navegação: dashboard, scanner e ferramentas; sem Colaboradores', async ({ page }) => {
    const sidebar = page.locator('#main-sidebar');

    await expect(sidebar.getByRole('link', { name: 'Colaboradores', exact: true })).toHaveCount(0);
    await expect(page.locator('#nav-collaborators')).toHaveCount(0);

    for (const tab of ['scanner', 'management', 'dashboard']) {
      await openTab(page, tab);
      await expectActiveTab(page, tab);
    }
  });

  test('ausência das áreas administrativas (nav, menu e ações)', async ({ page }) => {
    const sidebar = page.locator('#main-sidebar');

    for (const name of ['Auditoria', 'Usuários e acessos']) {
      await expect(sidebar.getByRole('link', { name, exact: true })).toHaveCount(0);
    }

    await openUserMenu(page);
    await expect(page.locator('#admin-tools')).toBeHidden();
    await page.keyboard.press('Escape');

    await openTab(page, 'management');
    await expect(page.locator('#tools-action-new')).toBeHidden();
  });

  test('não apenas oculto: telas administrativas recusam navegação programática', async ({
    page,
  }) => {
    for (const tab of ['users', 'history']) {
      await page.evaluate((target) => window.App.UI.switchTab(target), tab);
      await expect(page.locator('#topbar-title')).toHaveText('Painel');
      await expect(page.locator(`#tab-${tab}`)).toBeHidden();
    }
  });

  // Antes do Addendum 1-B1 (achado do Gate 1-B) o perfil restrito só tinha o item de menu oculto:
  // switchTab('collaborators') funcionava e os dados eram carregados. Agora a tela é recusada, o
  // listener não inicia, a lista não existe em memória e as regras do Firestore negam a leitura.
  test('perfil restrito não alcança Colaboradores: navegação programática recusada', async ({
    page,
  }) => {
    await expect(page.locator('#nav-collaborators')).toHaveCount(0);

    for (const attempt of [() => window.App.UI.switchTab('collaborators')]) {
      await page.evaluate(attempt);
      await expect(page.locator('#topbar-title')).toHaveText('Painel');
      await expect(page.locator('#tab-collaborators')).toBeHidden();
      await expect(page.locator('#tab-dashboard')).toBeVisible();
    }

    expect(await page.evaluate(() => window.App.UI.activeTab)).toBe('dashboard');
  });

  test('perfil restrito: coleção de colaboradores não é carregada nem escutada', async ({
    page,
  }) => {
    const state = await page.evaluate(() => ({
      collaborators: window.App.Data.collaborators.length,
      listeners: window.App.Data.listeners.length,
    }));

    // Somente o listener de ferramentas (Scanner/devolução). Sem colaboradores, usuários ou histórico.
    expect(state).toEqual({ collaborators: 0, listeners: 1 });

    // Mesmo após tentar abrir a tela, nada é carregado.
    await page.evaluate(() => window.App.UI.switchTab('collaborators'));
    expect(await page.evaluate(() => window.App.Data.collaborators.length)).toBe(0);
    await expect(page.locator('#collab-list')).not.toContainText('Colaborador Alfa');
  });

  test('perfil restrito: as regras negam leitura direta da coleção pelo navegador', async ({
    page,
  }) => {
    expect(await readCollaboratorsDirectly(page)).toEqual({
      ok: false,
      code: 'permission-denied',
    });
  });

  test('logout: volta para a tela de login', async ({ page }) => {
    await logoutViaSidebar(page);
  });
});

test.describe('PADRÃO — controle: mesma leitura direta é permitida', () => {
  test('perfil padrão lê a coleção de colaboradores (contrato atual preservado)', async ({
    page,
  }) => {
    await loginAs(page, E2E_USERS.standard);

    expect(await readCollaboratorsDirectly(page)).toEqual({ ok: true, size: 5 });
    expect(await page.evaluate(() => window.App.Data.listeners.length)).toBe(2);
  });
});
