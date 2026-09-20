import { freezeMotion, scan } from './support/axe.js';
import { expect, test } from './support/fixtures.js';

// COMPONENTES FUNDAMENTAIS (Gate 1-E) em isolamento: a galeria /components.html (só dev) renderiza
// os componentes REAIS de src/js/components. Sem autenticação, sem Firebase. Foco em COMPORTAMENTO
// (teclado, acessibilidade, política de fechamento, timing), não em detalhes internos.
const openGallery = async (page, { theme = 'light' } = {}) => {
  await page.goto(`/components.html?theme=${theme}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-section="overlays"]')).toBeVisible();
};

const styleOf = (locator, props) =>
  locator.evaluate(
    (element, names) =>
      Object.fromEntries(names.map((name) => [name, getComputedStyle(element)[name]])),
    props
  );

const result = (page) => page.locator('#gallery-result');

test.describe('Button / IconButton', () => {
  test.beforeEach(async ({ page }) => {
    await openGallery(page);
  });

  test('variantes têm nome acessível; desabilitado não recebe foco nem ação', async ({ page }) => {
    for (const name of ['primary', 'secondary', 'ghost', 'danger', 'Com ícone', 'Pequeno']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }

    const disabled = page.getByRole('button', { name: 'Desabilitado', exact: true });

    await expect(disabled).toBeDisabled();
    await page.locator('#btn-icon').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(disabled).not.toBeFocused();
  });

  test('loading: aria-busy, indicador e bloqueio de cliques repetidos; volta ao normal', async ({
    page
  }) => {
    const button = page.locator('#btn-loading');

    await button.click();
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveClass(/is-loading/);
    // O texto permanece (largura estável) e o foco não é perdido.
    await expect(button.locator('.ui-btn__label')).toHaveText('Salvar');
    await expect(button).not.toHaveAttribute('aria-busy', 'true', { timeout: 4000 });
    await expect(button).not.toHaveClass(/is-loading/);
  });

  test('IconButton: todo botão só-ícone tem aria-label, ícone decorativo e alvo >= 40px', async ({
    page
  }) => {
    const buttons = page.locator('.ui-icon-btn');

    expect(await buttons.count()).toBeGreaterThanOrEqual(4);

    for (const name of ['Fechar', 'Buscar', 'Excluir item', 'Indisponível']) {
      const button = page.getByRole('button', { name, exact: true });

      await expect(button).toBeVisible();
      await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true');

      const box = await button.boundingBox();

      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
  });

  test('foco por teclado mostra o contorno da foundation (2px sólido)', async ({ page }) => {
    await page.locator('#btn-primary').focus();
    await page.keyboard.press('Tab');

    const outline = await styleOf(page.locator('#btn-secondary'), ['outlineStyle', 'outlineWidth']);

    expect(outline).toEqual({ outlineStyle: 'solid', outlineWidth: '2px' });
  });

  test('cores vêm dos tokens no claro e no escuro (accent do primary)', async ({ page }) => {
    const primary = page.locator('#btn-primary');

    const background = async () => (await styleOf(primary, ['backgroundColor'])).backgroundColor;

    await expect.poll(background).toBe('rgb(29, 78, 216)');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await expect.poll(background).toBe('rgb(37, 99, 235)');
  });
});

test.describe('Input / Select / Search', () => {
  test.beforeEach(async ({ page }) => {
    await openGallery(page);
  });

  test('rótulos associados programaticamente; ajuda ligada por aria-describedby', async ({
    page
  }) => {
    await expect(page.getByLabel('Nome', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Categoria' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Buscar ferramentas' })).toBeVisible();
    await expect(page.locator('#f-name')).toHaveAttribute('aria-describedby', /f-name-help/);
    await expect(page.getByRole('textbox', { name: 'Nome' })).toHaveAccessibleDescription(
      /Como aparece nos relatórios/
    );
  });

  test('validação só depois da interação: erro oculto ao carregar, visível após sair do campo vazio', async ({
    page
  }) => {
    const field = page.locator('#f-email');
    const error = page.locator('#f-email-error');

    await expect(error).toBeHidden();
    await expect(field).not.toHaveAttribute('aria-invalid', 'true');

    await field.click();
    // Interação real (digitar e apagar): só então :user-invalid passa a valer no Chromium.
    await page.keyboard.type('a');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Tab');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(error).toBeVisible();
    await expect(error).not.toHaveText('');

    await field.fill('pessoa@empresa.com');
    await expect(field).toHaveAttribute('aria-invalid', 'false');
    await expect(error).toBeHidden();
  });

  test('campo com erro declarado expõe aria-invalid, mensagem e borda de erro', async ({
    page
  }) => {
    const field = page.locator('#f-error');

    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#f-error-error')).toHaveText('Informe um valor válido.');
    expect((await styleOf(field, ['borderTopColor'])).borderTopColor).toBe('rgb(190, 18, 60)');
  });

  test('Input, Select e Search compartilham altura, raio e borda de controle (>= 3:1)', async ({
    page
  }) => {
    const controls = [
      page.locator('#f-name'),
      page.locator('#f-select'),
      page.locator('#f-search')
    ];
    const heights = [];

    for (const control of controls) {
      const style = await styleOf(control, ['borderTopColor', 'borderTopLeftRadius']);

      expect(style.borderTopColor).toBe('rgb(116, 130, 150)');
      expect(style.borderTopLeftRadius).toBe('8px');
      heights.push(Math.round((await control.boundingBox()).height));
    }

    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBeGreaterThanOrEqual(40);
  });

  test('desabilitado: não editável e visualmente distinto', async ({ page }) => {
    const field = page.locator('#f-disabled');

    await expect(field).toBeDisabled();
    expect((await styleOf(field, ['cursor'])).cursor).toBe('not-allowed');
  });

  test('mobile: controles usam 16px (sem zoom automático do iOS)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    expect((await styleOf(page.locator('#f-name'), ['fontSize'])).fontSize).toBe('16px');
    await page.setViewportSize({ width: 1024, height: 768 });
    expect((await styleOf(page.locator('#f-name'), ['fontSize'])).fontSize).toBe('14px');
  });
});

test.describe('Checkbox / Switch', () => {
  test.beforeEach(async ({ page }) => {
    await openGallery(page);
  });

  test('switch: role=switch, Espaço alterna, posição do botão muda (não só cor)', async ({
    page
  }) => {
    const toggle = page.getByRole('switch', { name: 'Agrupar por setor' });
    const thumb = page.locator('#s-group ~ .ui-switch__track .ui-switch__thumb');

    await expect(toggle).not.toBeChecked();

    const before = (await thumb.boundingBox()).x;

    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expect.poll(async () => (await thumb.boundingBox()).x).toBeGreaterThan(before + 10);
    await page.keyboard.press('Space');
    await expect(toggle).not.toBeChecked();
  });

  test('switch e checkbox: foco visível, rótulo clicável e desabilitado inoperante', async ({
    page
  }) => {
    await page.getByRole('switch', { name: 'Agrupar por setor' }).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#s-group ~ .ui-switch__track')).toHaveCSS('outline-style', 'solid');

    await page.getByText('Aceito os termos').click();
    await expect(page.getByRole('checkbox', { name: 'Aceito os termos' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Desabilitado' })).toBeDisabled();
    await expect(page.getByRole('switch', { name: 'Desabilitado' })).toBeDisabled();
  });

  test('alvo de toque: linha de checkbox/switch tem >= 40px de altura', async ({ page }) => {
    for (const locator of [page.locator('.ui-check').first(), page.locator('.ui-switch').first()]) {
      expect((await locator.boundingBox()).height).toBeGreaterThanOrEqual(40);
    }
  });
});

test.describe('Badge / StatusBadge / StatCard / Alert / EmptyState / Skeleton', () => {
  test.beforeEach(async ({ page }) => {
    await openGallery(page);
  });

  test('todo status tem texto visível e o desconhecido é escapado (sem HTML injetado)', async ({
    page
  }) => {
    const badges = page.locator('[data-section="badges"] .ui-badge--status');

    await expect(badges).toHaveText([
      'Disponível',
      'Emprestada',
      'Manutenção',
      'Devolução',
      'Retirada',
      'outro <b>&'
    ]);
    await expect(page.locator('[data-section="badges"] b')).toHaveCount(0);
    await expect(badges.first().locator('.ui-badge__dot')).toHaveAttribute('aria-hidden', 'true');
  });

  test('StatCard: números tabulares; o interativo é um <button> com nome legível', async ({
    page
  }) => {
    expect(
      (await styleOf(page.locator('#g-stat-total'), ['fontVariantNumeric'])).fontVariantNumeric
    ).toContain('tabular-nums');

    const stat = page.getByRole('button', { name: /Disponíveis/ });

    await expect(stat).toHaveAccessibleName(/4 \(50%\).*Disponíveis|Disponíveis.*4 \(50%\)/s);
    await stat.focus();
    await expect(stat).toBeFocused();
  });

  test('Alert: roles corretos (alert para aviso/perigo, status para info/sucesso) com ícone e título', async ({
    page
  }) => {
    await expect(page.locator('#alert-danger')).toHaveAttribute('role', 'alert');
    await expect(page.locator('#alert-warning')).toHaveAttribute('role', 'alert');
    await expect(page.locator('#alert-info')).toHaveAttribute('role', 'status');
    await expect(page.locator('#alert-success')).toHaveAttribute('role', 'status');
    await expect(page.locator('#alert-danger .ui-alert__title')).toHaveText('Alerta danger');
    await expect(page.locator('#alert-danger .ui-alert__icon')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });

  test('EmptyState com título, descrição e ação; Skeleton decorativo', async ({ page }) => {
    const empty = page.locator('#g-empty');

    await expect(empty.locator('.ui-empty__title')).toHaveText('Nenhuma ferramenta encontrada');
    await expect(empty.getByRole('button', { name: 'Limpar filtros' })).toBeVisible();
    await expect(page.locator('#g-skeleton .ui-skeleton').first()).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });

  test('Skeleton respeita prefers-reduced-motion (sem animação)', async ({ page }) => {
    const skeleton = page.locator('#g-skeleton .ui-skeleton').first();

    expect((await styleOf(skeleton, ['animationName'])).animationName).not.toBe('none');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect((await styleOf(skeleton, ['animationName'])).animationName).toBe('none');
  });
});

test.describe('Modal — política de fechamento', () => {
  test.beforeEach(async ({ page }) => {
    await openGallery(page);
  });

  test('dismissible=true: clique no fundo, Esc e Fechar fecham; foco volta ao gatilho', async ({
    page
  }) => {
    const dialog = page.locator('#modal-dismissible');
    const opener = page.locator('#open-modal-dismissible');

    await expect(dialog).toHaveAttribute('closedby', 'any');
    await opener.click();
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Modal dispensável' })
    ).toHaveAccessibleDescription(/Esc, clique no fundo/);

    await page.mouse.click(5, 5); // fundo (backdrop)
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();

    await opener.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await opener.click();
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).first().click();
    await expect(dialog).toBeHidden();
  });

  test('dismissible=false: clique no fundo NÃO fecha; sem alterações o Esc fecha', async ({
    page
  }) => {
    const dialog = page.locator('#modal-form');

    await expect(dialog).toHaveAttribute('data-dismissible', 'false');
    await expect(dialog).toHaveAttribute('closedby', 'closerequest');
    await page.locator('#open-modal-form').click();
    await expect(dialog).toBeVisible();

    await page.mouse.click(5, 5);
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('dismissible=false com alterações: Esc pede confirmação (continuar mantém; descartar fecha)', async ({
    page
  }) => {
    const dialog = page.locator('#modal-form');

    await page.locator('#open-modal-form').click();
    await page.locator('#m-name').fill('Furadeira Nova');
    await page.keyboard.press('Escape');

    const confirm = page.getByRole('dialog', { name: 'Descartar alterações?' });

    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Continuar editando' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Continuar editando' }).click();
    await expect(confirm).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(page.locator('#m-name')).toHaveValue('Furadeira Nova');

    await page.keyboard.press('Escape');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Descartar' }).click();
    await expect(dialog).toBeHidden();
  });

  test('mobile: modal cabe na viewport e o rodapé empilha as ações em largura total', async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 640 });
    await page.locator('#open-modal-form').click();

    const box = await page.locator('#modal-form').boundingBox();

    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(640);

    const buttons = page.locator('#modal-form .ui-modal__footer .ui-btn');
    const [a, b] = [await buttons.nth(0).boundingBox(), await buttons.nth(1).boundingBox()];

    expect(Math.abs(a.width - b.width)).toBeLessThan(2);
    expect(a.width).toBeGreaterThan(200);
    expect(a.y).not.toBe(b.y);
  });
});

test.describe('ConfirmDialog', () => {
  test.beforeEach(async ({ page }) => {
    await openGallery(page);
  });

  test('padrão: título e descrição associados; foco no confirmar; resolve true/false', async ({
    page
  }) => {
    await page.locator('#open-confirm').click();

    const dialog = page.getByRole('dialog', { name: 'Salvar alterações?' });

    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription('As alterações serão aplicadas.');
    await expect(dialog.getByRole('button', { name: 'Salvar' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(result(page)).toHaveText('resultado: true');

    await page.locator('#open-confirm').click();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(result(page)).toHaveText('resultado: false');

    await page.locator('#open-confirm').click();
    await page.keyboard.press('Escape');
    await expect(result(page)).toHaveText('resultado: false');
    await expect(dialog).toBeHidden();
  });

  test('perigo: foco inicial seguro em Cancelar, aviso (Alert) e botão perigoso', async ({
    page
  }) => {
    await page.locator('#open-confirm-danger').click();

    const dialog = page.getByRole('dialog', { name: 'Excluir definitivamente?' });

    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    await expect(dialog.getByRole('alert')).toHaveText('Esta ação não pode ser desfeita.');
    await expect(dialog.getByRole('button', { name: 'Excluir' })).toHaveClass(/ui-btn--danger/);

    await page.keyboard.press('Enter'); // Enter no foco inicial = Cancelar
    await expect(result(page)).toHaveText('resultado: false');
    await expect(dialog).toBeHidden();

    await page.locator('#open-confirm-danger').click();
    await dialog.getByRole('button', { name: 'Excluir' }).click();
    await expect(result(page)).toHaveText('resultado: true');
  });

  test('backdrop não cancela nem confirma (ação destrutiva exige escolha explícita)', async ({
    page
  }) => {
    await page.locator('#open-confirm-danger').click();

    const dialog = page.getByRole('dialog', { name: 'Excluir definitivamente?' });

    await page.mouse.click(5, 5);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
  });

  test('reforçada: exige digitar o texto exato antes de confirmar', async ({ page }) => {
    await page.locator('#open-confirm-strong').click();

    const dialog = page.getByRole('dialog', { name: 'Apagar todos os registros?' });
    const input = dialog.getByLabel(/Digite/);

    await expect(input).toBeFocused();
    await dialog.getByRole('button', { name: 'Apagar' }).click();
    await expect(dialog).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.locator('#confirm-dialog-error')).toContainText('APAGAR');

    await input.fill('apagar');
    await dialog.getByRole('button', { name: 'Apagar' }).click();
    await expect(dialog).toBeVisible();

    await input.fill('APAGAR');
    await dialog.getByRole('button', { name: 'Apagar' }).click();
    await expect(result(page)).toHaveText('resultado: true');
  });

  test('onConfirm que falha mantém o diálogo aberto, mostra o erro e libera o botão', async ({
    page
  }) => {
    await page.locator('#open-confirm-fail').click();

    const dialog = page.getByRole('dialog', { name: 'Enviar?' });

    await dialog.getByRole('button', { name: 'Enviar' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Falha simulada.');
    await expect(dialog.getByRole('button', { name: 'Enviar' })).not.toHaveAttribute(
      'aria-busy',
      'true'
    );
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(result(page)).toHaveText('resultado: false');
  });

  test('chamadas simultâneas são enfileiradas: uma confirmação por vez', async ({ page }) => {
    await page.evaluate(() => {
      const { confirmDialog } = window.__gallery;

      window.__queue = [];
      confirmDialog({ title: 'Primeira', description: 'a' }).then((v) =>
        window.__queue.push(['Primeira', v])
      );
      confirmDialog({ title: 'Segunda', description: 'b' }).then((v) =>
        window.__queue.push(['Segunda', v])
      );
    });

    await expect(page.getByRole('dialog', { name: 'Primeira' })).toBeVisible();
    await page.locator('#confirm-dialog-confirm').click();
    await expect(page.getByRole('dialog', { name: 'Segunda' })).toBeVisible();
    await page.locator('#confirm-dialog-cancel').click();
    await expect
      .poll(() => page.evaluate(() => window.__queue))
      .toEqual([
        ['Primeira', true],
        ['Segunda', false]
      ]);
  });
});

test.describe('Toast', () => {
  test.beforeEach(async ({ page }) => {
    await openGallery(page);
  });

  test('regiões vivas persistentes (status/alert) existem antes de qualquer toast', async ({
    page
  }) => {
    const container = page.locator('#toast-container');

    await expect(container).toHaveAttribute('role', 'region');
    await expect(container).toHaveAttribute('aria-label', 'Notificações');
    await expect(container.locator('[role="status"]')).toHaveCount(1);
    await expect(container.locator('[role="alert"]')).toHaveCount(1);
  });

  test('sucesso vai para a região "status"; erro para "alert"; tipo em texto; fechar acessível', async ({
    page
  }) => {
    await page.locator('#toast-success').click();
    await page.locator('#toast-error').click();

    const success = page.locator('[role="status"] .toast-item');
    const error = page.locator('[role="alert"] .toast-item');

    await expect(success).toContainText('Sucesso: Registro salvo com sucesso.');
    await expect(error).toContainText('Erro: Não foi possível salvar o registro.');
    await expect(success.locator('.ui-sr-only')).toHaveText('Sucesso: ');
    await expect(success.getByRole('button', { name: 'Fechar notificação' })).toBeVisible();

    await success.getByRole('button', { name: 'Fechar notificação' }).click();
    await expect(success).toHaveCount(0);
    await expect(error).toHaveCount(1);
  });

  test('aviso também é assertivo (alert) e usa o mesmo formato', async ({ page }) => {
    await page.locator('#toast-warning').click();
    await expect(page.locator('[role="alert"] .toast-item')).toContainText(
      'Atenção: Sessão expira em breve.'
    );
  });

  test('tempo: sucesso some sozinho; erro permanece bem mais tempo', async ({ page }) => {
    await page.locator('#toast-success').click();
    await page.locator('#toast-error').click();
    await expect(page.locator('.toast-item')).toHaveCount(2);

    await expect(page.locator('[role="status"] .toast-item')).toHaveCount(0, { timeout: 8000 });
    await expect(page.locator('[role="alert"] .toast-item')).toHaveCount(1); // erro ainda visível (>= 12s)
  });

  test('hover suspende o fechamento automático e ao sair a contagem retoma', async ({ page }) => {
    await page.locator('#toast-info').click();

    const toast = page.locator('.toast-item');

    await expect(toast).toBeVisible();
    await toast.hover();
    await page.waitForTimeout(6500); // acima dos 5s do "info"
    await expect(toast).toHaveCount(1);

    await page.mouse.move(5, 5);
    await expect(toast).toHaveCount(0, { timeout: 6000 });
  });

  test('mobile: o toast ocupa a largura da viewport sem estourar', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.locator('#toast-error').click();

    await expect(page.locator('.toast-item')).toHaveClass(/show/);
    await expect
      .poll(async () => {
        const box = await page.locator('.toast-item').boundingBox();

        return box.x >= 0 && box.x + box.width <= 320;
      })
      .toBe(true);
  });
});

test.describe('Dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await openGallery(page);
  });

  test('semântica: menu button com aria-haspopup/aria-expanded/aria-controls e itens menuitem', async ({
    page
  }) => {
    const trigger = page.locator('#dd-trigger');

    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toHaveAttribute('aria-controls', 'dd-panel');
    await expect(page.locator('#dd-panel')).toBeHidden();

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem')).toHaveText(['Editar', 'Duplicar', 'Excluir']);
  });

  test('teclado: Enter abre e foca o 1º; setas com volta; Home/End; Esc fecha e devolve o foco', async ({
    page
  }) => {
    const trigger = page.locator('#dd-trigger');

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#dd-edit')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#dd-copy')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#dd-delete')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#dd-edit')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#dd-delete')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('#dd-edit')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator('#dd-delete')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#dd-panel')).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('ArrowUp no gatilho abre no último item; Tab fecha; clique fora fecha', async ({ page }) => {
    const trigger = page.locator('#dd-trigger');

    await trigger.focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#dd-delete')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#dd-panel')).toBeHidden();

    await trigger.click();
    await expect(page.locator('#dd-panel')).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(page.locator('#dd-panel')).toBeHidden();
  });

  test('ativar um item fecha o menu e executa a ação; ação perigosa fica separada visualmente', async ({
    page
  }) => {
    await page.locator('#dd-trigger').click();
    await expect(page.locator('#dd-panel .ui-menu__sep')).toHaveCount(1);
    expect((await styleOf(page.locator('#dd-delete'), ['color'])).color).toBe('rgb(190, 18, 60)');

    await page.locator('#dd-delete').click();
    await expect(result(page)).toHaveText('ação: dd-delete');
    await expect(page.locator('#dd-panel')).toBeHidden();
  });

  test('o painel cabe na viewport estreita (não é cortado)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.locator('#dd-trigger').click();

    const box = await page.locator('#dd-panel').boundingBox();

    expect(box.x + box.width).toBeLessThanOrEqual(320);
  });
});

test.describe('axe nos estados dos componentes (WCAG 2.2 AA detectável)', () => {
  for (const theme of ['light', 'dark']) {
    test(`${theme}: galeria, modal, confirmação, menu e toast sem violações`, async ({ page }) => {
      await openGallery(page, { theme });
      await freezeMotion(page);

      const expectClean = async (state) => {
        const { violations } = await scan(page);

        expect(violations, `${theme} / ${state}`).toEqual({});
      };

      await expectClean('galeria');

      await page.locator('#toast-error').click();
      await page.locator('#toast-success').click();
      await expect(page.locator('.toast-item')).toHaveCount(2);
      await expectClean('toasts');

      await page.locator('#dd-trigger').click();
      await expectClean('menu aberto');
      await page.keyboard.press('Escape');

      await page.locator('#open-modal-form').click();
      await expectClean('modal com formulário');
      await page.keyboard.press('Escape');

      await page.locator('#open-confirm-danger').click();
      await expectClean('confirmação perigosa');
      await page.getByRole('button', { name: 'Cancelar' }).click();

      await page.locator('#open-confirm-strong').click();
      await expectClean('confirmação reforçada');
      await page.keyboard.press('Escape');
    });
  }
});
