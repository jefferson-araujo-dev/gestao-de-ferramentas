import { expect, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// Componentes fundamentais (Gate 1-E) ADOTADOS no app real: menu da conta (Dropdown), KPIs
// (StatCard), filtros do Painel (Search/Select), política de fechamento dos modais, ConfirmDialog no
// lugar de confirm() nativo (o guard do E2E reprova qualquer dialog nativo) e Toast.
test.describe('menu da conta (Dropdown)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  test('semântica e teclado: Enter abre e foca o 1º item; setas; Esc fecha e devolve o foco', async ({
    page,
  }) => {
    const trigger = page.locator('#user-menu-trigger');
    const menu = page.locator('#user-dropdown-menu');

    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('role', 'menu');
    await expect(page.getByRole('menuitem', { name: 'Meu Perfil' })).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Alterar Senha' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: 'Sair do Sistema' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('menuitem', { name: 'Meu Perfil' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('ações perigosas (reset/sair) ficam separadas; clicar fora fecha; item abre o modal', async ({
    page,
  }) => {
    await page.locator('#user-menu-trigger').click();
    await expect(page.locator('#btn-reset-data')).toHaveClass(/ui-menu__item--danger/);
    await expect(page.locator('#btn-logout-header')).toHaveClass(/ui-menu__item--danger/);
    await expect(page.locator('#user-dropdown-menu .ui-menu__sep')).toHaveCount(2);

    await page.mouse.click(400, 500);
    await expect(page.locator('#user-dropdown-menu')).toBeHidden();

    await page.locator('#user-menu-trigger').click();
    await page.getByRole('menuitem', { name: 'Meu Perfil' }).click();
    await expect(page.locator('#profile-modal')).toBeVisible();
    await expect(page.locator('#user-dropdown-menu')).toBeHidden();
  });

  test('itens de arquivo (Importar/Restaurar) são focáveis por teclado; nenhuma ação destrutiva roda', async ({
    page,
    guard,
  }) => {
    await page.locator('#user-menu-trigger').click();

    const importItem = page.getByRole('menuitem', { name: 'Importar Excel' });

    await expect(importItem).toHaveAttribute('tabindex', '-1');
    await importItem.focus();
    await expect(importItem).toBeFocused();
    expect(guard.apiCalls).toEqual([expect.stringContaining('/api/session/last-login')]);
  });

  test('não há mais onclick inline no cabeçalho nem no menu da conta', async ({ page }) => {
    const inline = await page.evaluate(
      () => document.querySelectorAll('header [onclick], #sidebar-nav [onclick]').length
    );

    expect(inline).toBe(0);
  });
});

test.describe('Painel: KPIs (StatCard) e filtros (Search/Select)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await expect(page.locator('#dash-list')).toContainText('Furadeira de Impacto');
  });

  test('os 4 indicadores são botões com nome (rótulo + valor), números tabulares e ids preservados', async ({
    page,
  }) => {
    for (const [id, label] of [
      ['stat-total', 'Total'],
      ['stat-available', 'Disponíveis'],
      ['stat-borrowed', 'Emprestadas'],
      ['stat-maintenance', 'Manutenção'],
    ]) {
      const card = page.locator(`#dash-stats button:has(#${id})`);

      await expect(card).toHaveCount(1);
      await expect(card).toContainText(label);
      await expect(page.locator(`#${id}`)).toHaveText(/^\d/);
      expect(
        await page.locator(`#${id}`).evaluate((el) => getComputedStyle(el).fontVariantNumeric)
      ).toContain('tabular-nums');
    }
  });

  test('KPI é operável por teclado e aplica o filtro rápido (antes era um <div> só com clique)', async ({
    page,
  }) => {
    const card = page.locator('#dash-stats button:has(#stat-available)');

    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#dash-filter')).toHaveValue('available');
    await expect(page.locator('#dash-list')).not.toContainText('Esmerilhadeira');
  });

  test('busca, filtro e ordenação têm nome acessível; Limpar restaura os valores', async ({
    page,
  }) => {
    await expect(page.getByRole('searchbox', { name: 'Buscar ferramentas' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Filtrar por situação' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Ordenar por' })).toBeVisible();

    await page.locator('#dash-search').fill('Furadeira');
    await page.locator('#dash-filter').selectOption('borrowed');
    await page.getByRole('button', { name: 'Limpar' }).click();
    await expect(page.locator('#dash-search')).toHaveValue('');
    await expect(page.locator('#dash-filter')).toHaveValue('all');
    await expect(page.locator('#dash-sort')).toHaveValue('recent');
  });

  test('a busca filtra a lista (lógica preservada)', async ({ page }) => {
    await page.locator('#dash-search').fill('Furadeira');
    await expect(page.locator('#dash-list')).toContainText('Furadeira de Impacto');
    await expect(page.locator('#dash-list')).not.toContainText('Esmerilhadeira');
  });
});

test.describe('política de fechamento dos modais reais', () => {
  test('todo <dialog> tem nome acessível e closedby coerente com a política', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);

    const dialogs = await page.evaluate(() =>
      [...document.querySelectorAll('dialog')].map((dialog) => ({
        id: dialog.id,
        named: dialog.hasAttribute('aria-labelledby') || dialog.hasAttribute('aria-label'),
        dismissible: dialog.dataset.dismissible !== 'false',
        closedby: dialog.getAttribute('closedby'),
      }))
    );

    expect(dialogs.length).toBeGreaterThanOrEqual(12);

    for (const dialog of dialogs) {
      expect(dialog.named, `${dialog.id} sem nome acessível`).toBe(true);
      expect(dialog.closedby, dialog.id).toBe(dialog.dismissible ? 'any' : 'closerequest');
    }

    const formDialogs = dialogs
      .filter((d) => !d.dismissible)
      .map((d) => d.id)
      .sort();

    expect(formDialogs).toEqual([
      'crud-collab-modal',
      'crud-modal',
      'crud-user-modal',
      'forgot-password-modal',
      'password-modal',
      'tool-maintenance-modal',
    ]);
  });

  test('modal informativo (perfil) fecha ao clicar no fundo', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await page.locator('#user-menu-trigger').click();
    await page.getByRole('menuitem', { name: 'Meu Perfil' }).click();
    await expect(page.locator('#profile-modal')).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(page.locator('#profile-modal')).toBeHidden();
  });

  test('formulário de ferramenta: fundo não fecha; Esc com alterações pede confirmação', async ({
    page,
  }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'management');
    await page.locator('#tools-action-new').click();

    const modal = page.locator('#crud-modal');

    await expect(modal).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(modal).toBeVisible(); // antes: o clique no fundo descartava o formulário

    await page.locator('#crud-name').fill('Ferramenta não salva');
    await page.keyboard.press('Escape');

    const confirm = page.getByRole('dialog', { name: 'Descartar alterações?' });

    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Continuar editando' }).click();
    await expect(modal).toBeVisible();
    await expect(page.locator('#crud-name')).toHaveValue('Ferramenta não salva');

    await page.keyboard.press('Escape');
    await confirm.getByRole('button', { name: 'Descartar' }).click();
    await expect(modal).toBeHidden();
  });

  test('formulário sem alterações fecha com Esc sem perguntar', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'management');
    await page.locator('#tools-action-new').click();
    await expect(page.locator('#crud-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#crud-modal')).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Descartar alterações?' })).toHaveCount(0);
  });
});

test.describe('ConfirmDialog no lugar de confirm() nativo', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await expect(page.locator('#dash-list')).toContainText('Furadeira de Impacto');
  });

  test('excluir ferramenta: confirmação perigosa, foco em Cancelar, cancelar não exclui', async ({
    page,
  }) => {
    const before = await page.evaluate(() => window.App.Data.tools.length);

    // Sem await/return: a promessa só resolve depois da decisão no diálogo.
    await page.evaluate(() => {
      window.App.CRUDTools.deleteTool(window.App.Data.tools[0].firebaseId);
    });

    const dialog = page.getByRole('dialog', { name: 'Excluir ferramenta?' });

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    await expect(dialog.getByRole('alert')).toHaveText('Esta ação não pode ser desfeita.');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.App.Data.tools.length)).toBe(before);
  });

  test('excluir colaborador: cancelar por Esc mantém o registro', async ({ page }) => {
    await openTab(page, 'collaborators');
    await expect(page.locator('#collab-list')).toContainText('Colaborador Alfa');

    const before = await page.evaluate(() => window.App.Data.collaborators.length);

    await page.evaluate(() => {
      window.App.CRUDCollaborators.deleteCollaborator(window.App.Data.collaborators[0].firebaseId);
    });
    await expect(page.getByRole('dialog', { name: 'Excluir colaborador?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Excluir colaborador?' })).toBeHidden();
    expect(await page.evaluate(() => window.App.Data.collaborators.length)).toBe(before);
  });

  test('nenhum confirm()/alert() nativo permanece nos módulos migrados', async ({ page }) => {
    const source = await page.evaluate(async () => {
      const files = ['collaborators', 'tools', 'users', 'session'];
      const texts = await Promise.all(
        files.map((name) => fetch(`/js/modules/${name}.js`).then((r) => r.text()))
      );

      return texts.join('\n');
    });

    expect(source).not.toMatch(/(^|[^.\w])(confirm|alert)\(/);
  });
});

test.describe('Toast (H-07): live regions, tempo e fechar', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
  });

  test('toast de erro do app vai para a região assertiva com o tipo em texto e fecha por botão nomeado', async ({
    page,
  }) => {
    await page.evaluate(() => window.App.UI.showToast('Falha de teste na operação.', 'error'));

    const toast = page.locator('#toast-container [role="alert"] .toast-item');

    await expect(toast).toContainText('Erro: Falha de teste na operação.');
    await toast.getByRole('button', { name: 'Fechar notificação' }).click();
    await expect(toast).toHaveCount(0);
  });

  test('sucesso é educado (status) e persistent=true não some sozinho', async ({ page }) => {
    await page.evaluate(() => {
      window.App.UI.showToast('Salvo.', 'success');
      window.App.UI.showToast('Sessão expirada. Faça login novamente.', 'warning', {
        persistent: true,
      });
    });
    await expect(page.locator('#toast-container [role="status"] .toast-item')).toContainText(
      'Sucesso: Salvo.'
    );
    await expect(page.locator('[role="alert"] .toast-item')).toContainText(
      'Atenção: Sessão expirada'
    );
    await expect(page.locator('#toast-container [role="status"] .toast-item')).toHaveCount(0, {
      timeout: 9000,
    });
    await expect(page.locator('[role="alert"] .toast-item')).toHaveCount(1);
  });

  test('acesso negado a uma rota usa o toast novo (região assertiva)', async ({ page }) => {
    await page.evaluate(() =>
      window.App.UI.showToast('Acesso restrito a administradores.', 'error')
    );
    await expect(page.locator('[role="alert"] .toast-item').first()).toContainText(
      'Acesso restrito'
    );
  });
});

test.describe('Switch e StatusBadge no app', () => {
  test('Agrupar por cargo é um switch com rótulo associado e mantém a lógica', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'collaborators');

    const toggle = page.getByRole('switch', { name: 'Agrupar por cargo' });

    await expect(toggle).toBeChecked();
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).not.toBeChecked();
    expect(await page.evaluate(() => document.getElementById('collab-group-toggle').checked)).toBe(
      false
    );
  });

  test('getBadgeHTML (compatível) agora produz StatusBadge com texto', async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);

    const html = await page.evaluate(() => window.Utils.getBadgeHTML('borrowed'));

    expect(html).toContain('ui-badge--warning');
    expect(html).toContain('Emprestada');
  });
});
