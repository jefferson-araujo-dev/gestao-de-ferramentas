import AxeBuilder from '@axe-core/playwright';

import { AXE_TAGS, freezeMotion } from './support/axe.js';
import { expect, loginAs, test } from './support/fixtures.js';
import { E2E_EXPECTED_COUNTS, E2E_USERS } from './support/seed-data.mjs';

// Tela Usuários (Gate 1-F4.D1). Roda no Firebase Emulator, com os dados sintéticos do seed.
// Estes testes NÃO alteram dados: carregando/vazio/erro são simulados só no cliente e nenhuma
// ação que chama /api/users/* é acionada (o guard reprovaria a chamada).
// Os testes "invariante:" descrevem o comportamento que o redesign não pode mudar e passam
// igual antes e depois da migração visual.
const list = (page) => page.locator('#user-management-body');
const card = (page, name) => list(page).locator(':scope > *', { hasText: name });
const ALL_NAMES = Object.values(E2E_USERS)
  .map((user) => user.name)
  .sort();

async function expectNames(page, expected) {
  await expect
    .poll(async () => (await list(page).locator('h3').allTextContents()).map((t) => t.trim()).sort())
    .toEqual([...expected].sort());
}

async function openUsers(page) {
  await loginAs(page, E2E_USERS.admin, { hash: '#/usuarios' });
  await expect(page.locator('#tab-users')).toBeVisible();
  await expectNames(page, ALL_NAMES);
}

const filterButton = (page, value) => page.locator(`#users-filters [data-filter="${value}"]`);

test.describe('Usuários: invariantes de comportamento', () => {
  test('invariante: lista e contadores do seed', async ({ page }) => {
    await openUsers(page);

    await expect(page.locator('#count-total')).toHaveText(String(E2E_EXPECTED_COUNTS.users));
    await expect(page.locator('#count-active')).toHaveText('3');
    await expect(page.locator('#count-admins')).toHaveText('1');
    await expect(page.locator('#count-users')).toHaveText('2');
  });

  test('invariante: filtros de acesso, inclusive "Usuários Padrão" (mostra todos, comportamento atual)', async ({
    page,
  }) => {
    await openUsers(page);

    await filterButton(page, 'Administrador').click();
    await expectNames(page, [E2E_USERS.admin.name]);

    // O botão passa 'Usuario Padrao' (sem acento) e o filtro compara 'Usuário Padrão': hoje nenhum
    // usuário é removido. Preservado de propósito (Gate 1-F4.D1, D3); correção em Gate próprio.
    await filterButton(page, 'Usuario Padrao').click();
    await expectNames(page, ALL_NAMES);

    await filterButton(page, 'Inativo').click();
    await expect(list(page)).toContainText('Nenhum usuário encontrado');

    await filterButton(page, 'all').click();
    await expectNames(page, ALL_NAMES);
  });

  test('invariante: busca por nome, sem resultado e Limpar Filtros', async ({ page }) => {
    await openUsers(page);

    await page.locator('#users-search').fill('paulo');
    await expectNames(page, [E2E_USERS.standard.name]);

    await page.locator('#users-search').fill('zzzz');
    await expect(list(page)).toContainText('Nenhum usuário encontrado');
    await list(page).getByRole('button', { name: 'Limpar Filtros' }).click();
    await expectNames(page, ALL_NAMES);
  });

  test('invariante: a própria conta não tem as ações de nível, status e exclusão', async ({ page }) => {
    await openUsers(page);

    const own = card(page, E2E_USERS.admin.name);
    const other = card(page, E2E_USERS.standard.name);

    for (const action of ['toggleRole', 'toggleStatus', 'deleteUser']) {
      await expect(own.locator(`button[onclick*="${action}("]`)).toBeDisabled();
      await expect(other.locator(`button[onclick*="${action}("]`)).toBeEnabled();
    }

    await expect(own.locator('button[onclick*="openModal("]')).toBeEnabled();
  });

  test('invariante: Editar abre o formulário preenchido e Cancelar fecha', async ({ page }) => {
    await openUsers(page);

    await card(page, E2E_USERS.standard.name).locator('button[onclick*="openModal("]').click();

    const modal = page.locator('#crud-user-modal');

    await expect(modal).toBeVisible();
    await expect(page.locator('#user-modal-title')).toHaveText('Editar Usuário');
    await expect(page.locator('#crud-user-name')).toHaveValue(E2E_USERS.standard.name);
    await expect(page.locator('#crud-user-email')).toHaveValue(E2E_USERS.standard.email);
    await expect(page.locator('#crud-user-access')).toHaveValue('Usuário Padrão');
    await expect(page.locator('#btn-save-user-text')).toHaveText('Salvar');

    await modal.getByRole('button', { name: 'Cancelar' }).click();
    await expect(modal).toBeHidden();
  });
});

test.describe('Usuários: estados da lista', () => {
  test('carregando: skeleton com aria-busy, nunca "nenhum usuário"', async ({ page }) => {
    await openUsers(page);

    await page.evaluate(() => {
      window.App.Data.usersLoaded = false;
      window.App.CRUDUsers.render();
    });

    await expect(list(page)).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#user-management-body .ui-skeleton-card')).toHaveCount(6);
    await expect(list(page)).not.toContainText('Nenhum usuário');
  });

  test('vazio (nenhum cadastro) é diferente de sem resultados', async ({ page }) => {
    await openUsers(page);

    await page.evaluate(() => {
      window.App.Data.users = [];
      window.App.CRUDUsers.render();
    });

    await expect(list(page)).not.toHaveAttribute('aria-busy', 'true');
    await expect(list(page)).toContainText('Nenhum usuário cadastrado');
    await expect(list(page).getByRole('button', { name: 'Cadastrar Primeiro Usuário' })).toBeVisible();
  });

  test('erro ao carregar: aviso persistente, sem detalhes internos e sem lista vazia enganosa', async ({
    page,
  }) => {
    await openUsers(page);

    await page.evaluate(() => {
      window.App.Data.usersError = true;
      window.App.CRUDUsers.render();
    });

    const alert = page.locator('#users-feedback').getByRole('alert');

    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Não foi possível carregar os usuários');
    await expect(alert).not.toContainText(/firebase|firestore|permission/i);
    await expect(list(page)).not.toContainText('Nenhum usuário cadastrado');

    await page.evaluate(() => {
      window.App.Data.usersError = false;
      window.App.CRUDUsers.render();
    });
    await expect(page.locator('#users-feedback')).toBeEmpty();
    await expectNames(page, ALL_NAMES);
  });

  // Varredura restrita à tela (sem o cabeçalho do shell), lista preenchida e formulário aberto.
  test('axe restrito à tela e ao formulário: nenhuma violação', async ({ page }) => {
    await openUsers(page);
    await freezeMotion(page);

    const violationsOf = async (selector) =>
      (await new AxeBuilder({ page }).include(selector).withTags(AXE_TAGS).analyze()).violations.map(
        (violation) => `${violation.id}: ${violation.nodes.length} nó(s)`
      );

    const screen = await violationsOf('#tab-users');

    await page.locator('#tab-users button[onclick="App.CRUDUsers.openModal()"]').click();
    await expect(page.locator('#crud-user-modal')).toBeVisible();

    const form = await violationsOf('#crud-user-modal');

    console.log(`EVIDENCE USERS_AXE_SCREEN=${JSON.stringify(screen)}`);
    console.log(`EVIDENCE USERS_AXE_FORM=${JSON.stringify(form)}`);
    expect({ screen, form }).toEqual({ screen: [], form: [] });
  });

  test('ações dos cartões têm nome acessível', async ({ page }) => {
    await openUsers(page);

    const other = card(page, E2E_USERS.standard.name);

    await expect(other.getByRole('button', { name: 'Editar dados do usuário' })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Alterar permissão de acesso' })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Desativar conta' })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Excluir permanentemente' })).toBeVisible();
  });
});
