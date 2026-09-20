import { expect, expectActiveTab, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// Ciclo de vida mínimo do Scanner, sem hardware real: o Chromium usa câmera falsa
// (--use-fake-device-for-media-stream) e nenhuma ferramenta é emprestada/devolvida.
for (const [label, user, isAdmin] of [
  ['ADMIN', E2E_USERS.admin, true],
  ['PADRÃO', E2E_USERS.standard, false],
]) {
  test.describe(`SCANNER — ciclo de vida (${label})`, () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, user);
    });

    test('entra na aba, mostra os controles, volta ao USB e sai sem erros', async ({ page }) => {
      await openTab(page, 'scanner', { isAdmin });
      await expectActiveTab(page, 'scanner', { isAdmin });

      await expect(page.locator('#btn-mode-usb')).toBeVisible();
      await expect(page.locator('#btn-mode-cam')).toBeVisible();
      await expect(page.locator('#manual-scan-input')).toBeVisible();
      await expect(page.locator('#scanner-status-text')).toHaveText('Aguardando leitura via USB');

      await page.locator('#btn-mode-usb').click();
      await expect(page.locator('#mode-cam-container')).toBeHidden();
      await expect(page.locator('#reader video')).toHaveCount(0);

      await openTab(page, 'dashboard', { isAdmin });
      await expectActiveTab(page, 'dashboard', { isAdmin });
      await expect(page.locator('#tab-scanner')).toBeHidden();
      await expect(page.locator('#reader video')).toHaveCount(0);
    });
  });
}

test.describe('SCANNER — modo câmera (contrato desejado)', () => {
  // ACHADO DO GATE 1-B (defeito pré-existente, presente também em main): #mode-cam-container
  // nasce com a classe "hidden-tab" (display:none !important, main.css) e Scanner.setMode('cam')
  // só alterna "hidden"/"flex". O container nunca aparece, startCamera() detecta
  // "Container da câmera não está visível." e volta ao modo USB. O modo câmera não funciona.
  // test.fail() avisa quando for corrigido (remover então o test.fail).
  test('câmera falsa inicia e é liberada ao sair da aba', async ({ page }) => {
    test.fail(true, 'ACHADO: modo câmera nunca exibe o container (hidden-tab !important).');

    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'scanner', { isAdmin: true });
    await page.locator('#btn-mode-cam').click();
    await expect(page.locator('#mode-cam-container')).toBeVisible();
    await expect(page.locator('#reader video')).toHaveCount(1, { timeout: 15_000 });

    await openTab(page, 'dashboard', { isAdmin: true });
    await expect(page.locator('#reader video')).toHaveCount(0);
  });
});
