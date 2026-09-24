import { expect, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// Regressões do Gate 1-F3.3B (redesign de UX do Scanner). O contrato de Movement/Rules já é
// coberto por movementEmulator.test.mjs, firestoreRulesEmulator.test.mjs e restricted-loan.spec.js;
// aqui cobrimos os estados operacionais e a acessibilidade introduzidos por este gate.
//
// A função Vercel /api/tools/movement não existe no servidor de desenvolvimento do E2E: como em
// restricted-loan.spec.js, ela é substituída por um stub na página que responde como o servidor
// real (o servidor de verdade é coberto por tests/integration/movementEmulator.test.mjs).
const json = (status, payload) => ({ status, payload });

async function stubMovement(page, respond) {
  await page.route('**/api/tools/movement', async (route) => {
    const { status, payload } = respond(route.request().postDataJSON());
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
  });
}

function allowDenial(guard, status) {
  guard.badResponses = guard.badResponses.filter((entry) => entry !== `${status} /api/tools/movement`);
  guard.consoleErrors = guard.consoleErrors.filter(
    (entry) => !new RegExp(`status of ${status}`).test(entry)
  );
}
test.describe('SCANNER — redesign de UX (Gate 1-F3.3B)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'scanner');
    await expect
      .poll(() => page.evaluate(() => window.App.Data.toolsLoaded && window.App.Data.tools.length))
      .toBeGreaterThan(0);
  });

  async function scan(page, code) {
    await page.locator('#manual-scan-input').fill(code);
    await page.locator('#manual-scan-input').press('Enter');
    await expect(page.locator('#res-code')).toHaveText(code);
  }

  test('categoria exibida corretamente no elemento real (regressão P1-01)', async ({ page }) => {
    await scan(page, 'T-E2E-001');
    await expect(page.locator('#res-category')).toHaveText('Elétrica');
  });

  test('available mostra somente o fluxo de empréstimo', async ({ page }) => {
    await scan(page, 'T-E2E-001');
    await expect(page.locator('#scanner-checkout')).toBeVisible();
    await expect(page.locator('#scanner-return')).toBeHidden();
    await expect(page.locator('#scanner-blocked')).toBeHidden();
    await expect(page.locator('#checkout-user-badge')).toBeFocused();
  });

  test('borrowed mostra somente o fluxo de devolução, com responsável e foco no botão real', async ({
    page,
  }) => {
    await scan(page, 'T-E2E-002');
    await expect(page.locator('#scanner-return')).toBeVisible();
    await expect(page.locator('#scanner-checkout')).toBeHidden();
    await expect(page.locator('#return-user-info')).toContainText('Colaborador Alfa');
    await expect(page.locator('#btn-return-confirm')).toBeFocused();
  });

  test('maintenance mostra estado bloqueado persistente, sem ação de empréstimo/devolução', async ({
    page,
  }) => {
    await scan(page, 'T-E2E-004');
    await expect(page.locator('#scanner-blocked')).toBeVisible();
    await expect(page.locator('#scanner-blocked-message')).toHaveText(
      'Esta ferramenta está em manutenção.'
    );
    await expect(page.locator('#scanner-checkout')).toBeHidden();
    await expect(page.locator('#scanner-return')).toBeHidden();

    await page.locator('#btn-new-operation').click();
    await expect(page.locator('#scanner-waiting')).toBeVisible();
    await expect(page.locator('#scanner-blocked')).toBeHidden();
  });

  test('crachá inválido: erro local, aria-invalid e foco de volta no campo', async ({
    page,
    guard,
  }) => {
    await stubMovement(page, () =>
      json(404, { success: false, message: 'Colaborador não encontrado.', code: 'BADGE_NOT_FOUND' })
    );
    await scan(page, 'T-E2E-001');
    const badgeInput = page.locator('#checkout-user-badge');
    await badgeInput.fill('E2E-999');
    await page.locator('#btn-checkout-confirm').click();

    await expect(page.locator('#checkout-badge-error')).toBeVisible();
    await expect(page.locator('#checkout-badge-error')).toHaveText('Colaborador não encontrado.');
    await expect(badgeInput).toHaveAttribute('aria-invalid', 'true');
    await expect(badgeInput).toBeFocused();
    await expect(badgeInput).toHaveValue('E2E-999');
    allowDenial(guard, 404);

    // Nova tentativa (digitação) limpa o erro anterior.
    await badgeInput.fill('E2E-001');
    await expect(page.locator('#checkout-badge-error')).toBeHidden();
    await expect(badgeInput).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('empréstimo bem-sucedido: painel persistente (sem auto-reset) e Nova Operação', async ({
    page,
  }) => {
    await stubMovement(page, () =>
      json(200, {
        success: true,
        message: 'Empréstimo registrado.',
        data: { collaborator: { name: 'Colaborador Alfa', role: 'Operador' } },
      })
    );
    await scan(page, 'T-E2E-003');
    await page.locator('#checkout-user-badge').fill('E2E-001');
    await page.locator('#btn-checkout-confirm').click();

    await expect(page.locator('#scanner-status-box')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#scanner-success-actions')).toBeVisible();

    // Não deve voltar sozinho ao estado inicial (auto-reset removido).
    await page.waitForTimeout(3_500);
    await expect(page.locator('#scanner-status-box')).toBeVisible();
    await expect(page.locator('#scanner-waiting')).toBeHidden();

    await page.locator('#btn-new-operation').click();
    await expect(page.locator('#scanner-waiting')).toBeVisible();
    await expect(page.locator('#scanner-result')).toBeHidden();
  });

  test('devolução bem-sucedida: painel persistente (sem auto-reset) e Nova Operação', async ({
    page,
  }) => {
    await stubMovement(page, (body) =>
      json(200, {
        success: true,
        message: 'Devolução registrada.',
        data: { action: body.action, tool: { id: body.toolId, status: 'available' } },
      })
    );
    await scan(page, 'T-E2E-006');
    await page.locator('#btn-return-confirm').click();

    await expect(page.locator('#scanner-status-box')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#scanner-success-actions')).toBeVisible();

    await page.waitForTimeout(2_500);
    await expect(page.locator('#scanner-status-box')).toBeVisible();

    await page.locator('#btn-new-operation').click();
    await expect(page.locator('#scanner-waiting')).toBeVisible();
  });

  test('botões de modo expõem aria-pressed sincronizado', async ({ page }) => {
    await expect(page.locator('#btn-mode-usb')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#btn-mode-cam')).toHaveAttribute('aria-pressed', 'false');

    await page.locator('#btn-mode-cam').click();
    await expect(page.locator('#btn-mode-cam')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#btn-mode-usb')).toHaveAttribute('aria-pressed', 'false');
  });

  test('câmera: torch e fechar têm alvo mínimo de 44x44 CSS px e rótulos acessíveis', async ({
    page,
  }) => {
    await page.locator('#btn-mode-cam').click();
    await expect(page.locator('#mode-cam-container')).toBeVisible();

    const torch = page.locator('#btn-toggle-torch');
    const close = page.locator('#btn-close-camera');
    await expect(torch).toHaveAttribute('aria-label', 'Ligar lanterna');
    await expect(close).toHaveAttribute('aria-label', 'Fechar câmera');

    const torchBox = await torch.boundingBox();
    const closeBox = await close.boundingBox();
    expect(torchBox.width).toBeGreaterThanOrEqual(44);
    expect(torchBox.height).toBeGreaterThanOrEqual(44);
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);

    await close.click();
    await expect(page.locator('#mode-cam-container')).toBeHidden();
  });

  test('trocar USB -> câmera limpa a ferramenta e o crachá em digitação', async ({ page }) => {
    await scan(page, 'T-E2E-001');
    await page.locator('#checkout-user-badge').fill('crachá abandonado');

    await page.locator('#btn-mode-cam').click();
    expect(await page.evaluate(() => window.App.Scanner.currentTool)).toBeNull();
    await expect(page.locator('#scanner-result')).toBeHidden();

    await page.locator('#btn-mode-usb').click();
    await expect(page.locator('#checkout-user-badge')).toHaveValue('');
  });
});

// Navegação exclusivamente por teclado (Addendum 1-F3.3B.1, Fase 2): nenhuma interação usa
// .click()/.fill() — apenas Tab/Shift+Tab, digitação via keyboard.type() e ativação por
// Enter/Espaço. `.focus()` só estabelece o ponto de partida de cada cenário (o campo em que um
// usuário de teclado já pousaria após ler o patrimônio), nunca substitui uma ativação.
test.describe('SCANNER — navegação exclusivamente por teclado (Addendum 1-F3.3B.1)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'scanner');
    await expect
      .poll(() => page.evaluate(() => window.App.Data.toolsLoaded && window.App.Data.tools.length))
      .toBeGreaterThan(0);
  });

  test('teclado: inicial -> empréstimo -> sucesso -> nova operação, sem mouse', async ({ page }) => {
    await stubMovement(page, () =>
      json(200, {
        success: true,
        message: 'Empréstimo registrado.',
        data: { collaborator: { name: 'Colaborador Teclado', role: 'Operador' } },
      })
    );

    // Estado inicial: leitura manual via teclado (Tab até o campo + digitação + Enter).
    await page.locator('#manual-scan-input').focus();
    await page.keyboard.type('T-E2E-003');
    await page.keyboard.press('Enter');
    await expect(page.locator('#res-code')).toHaveText('T-E2E-003');

    // Empréstimo: o foco já está no crachá (gerenciado pelo app); Tab deve levar ao botão real.
    await expect(page.locator('#checkout-user-badge')).toBeFocused();
    await page.keyboard.type('E2E-001');
    await page.keyboard.press('Tab');
    await expect(page.locator('#btn-checkout-confirm')).toBeFocused();
    await page.keyboard.press('Enter');

    // Sucesso: painel persistente; Tab a partir dele deve alcançar "Nova operação".
    await expect(page.locator('#scanner-status-box')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#scanner-status-box')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#btn-new-operation')).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('#scanner-waiting')).toBeVisible();
  });

  test('teclado: crachá inválido — Enter no botão focado mostra erro e devolve o foco ao campo', async ({
    page,
    guard,
  }) => {
    await stubMovement(page, () =>
      json(404, { success: false, message: 'Colaborador não encontrado.', code: 'BADGE_NOT_FOUND' })
    );

    await page.locator('#manual-scan-input').focus();
    await page.keyboard.type('T-E2E-001');
    await page.keyboard.press('Enter');

    await expect(page.locator('#checkout-user-badge')).toBeFocused();
    await page.keyboard.type('E2E-999');
    await page.keyboard.press('Tab');
    await expect(page.locator('#btn-checkout-confirm')).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('#checkout-badge-error')).toBeVisible();
    await expect(page.locator('#checkout-user-badge')).toBeFocused();
    allowDenial(guard, 404);

    // Uma nova tentativa continua possível só com teclado.
    await page.keyboard.press('Control+A');
    await page.keyboard.type('E2E-001');
    await expect(page.locator('#checkout-badge-error')).toBeHidden();
  });

  test('teclado: devolução — Enter no botão de devolução já focado automaticamente', async ({
    page,
  }) => {
    await stubMovement(page, (body) =>
      json(200, {
        success: true,
        message: 'Devolução registrada.',
        data: { action: body.action, tool: { id: body.toolId, status: 'available' } },
      })
    );

    await page.locator('#manual-scan-input').focus();
    await page.keyboard.type('T-E2E-006');
    await page.keyboard.press('Enter');

    await expect(page.locator('#btn-return-confirm')).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('#scanner-status-box')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#scanner-status-box')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#btn-new-operation')).toBeFocused();
  });
});
