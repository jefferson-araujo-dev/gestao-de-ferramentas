import { expect, expectActiveTab, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// Ciclo de vida do Scanner, sem hardware real: o Chromium usa câmera falsa
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

    test('trocar de aba limpa a ferramenta identificada e o crachá digitado (Gate 1-F3.2B)', async ({
      page,
    }) => {
      await openTab(page, 'scanner', { isAdmin });
      await expectActiveTab(page, 'scanner', { isAdmin });

      await expect
        .poll(() => page.evaluate(() => window.App.Data.toolsLoaded && window.App.Data.tools.length))
        .toBeGreaterThan(0);

      const code = await page.evaluate(
        () => window.App.Data.tools.find((t) => t.status === 'available')?.code
      );

      await page.locator('#manual-scan-input').fill(code);
      await page.locator('#manual-scan-input').press('Enter');
      await expect(page.locator('#res-code')).toHaveText(code);
      await page.locator('#checkout-user-badge').fill('crachá abandonado antes da troca de aba');
      expect(await page.evaluate(() => window.App.Scanner.currentTool?.code)).toBe(code);

      await openTab(page, 'dashboard', { isAdmin });
      await openTab(page, 'scanner', { isAdmin });
      await expectActiveTab(page, 'scanner', { isAdmin });

      // Nenhuma operação abandonada sobrevive à troca de aba: sem ferramenta identificada, sem
      // crachá residual, aguardando uma nova leitura.
      expect(await page.evaluate(() => window.App.Scanner.currentTool)).toBeNull();
      await expect(page.locator('#scanner-waiting')).toBeVisible();
      await expect(page.locator('#scanner-result')).toBeHidden();
      await expect(page.locator('#checkout-user-badge')).toHaveValue('');
    });
  });
}

// Conta as inicializações reais: App.Scanner.startCamera (nossa camada) e
// Html5Qrcode.start/stop (a câmera de fato).
function installCameraSpies(page) {
  return page.evaluate(() => {
    const counters = { startCamera: 0, cameraStart: 0, cameraStop: 0 };
    const scanner = window.App.Scanner;
    const originalStartCamera = scanner.startCamera.bind(scanner);
    const proto = window.Html5Qrcode.prototype;
    const originalStart = proto.start;
    const originalStop = proto.stop;

    scanner.startCamera = (...args) => {
      counters.startCamera += 1;
      return originalStartCamera(...args);
    };
    proto.start = function start(...args) {
      counters.cameraStart += 1;
      return originalStart.apply(this, args);
    };
    proto.stop = function stop(...args) {
      counters.cameraStop += 1;
      return originalStop.apply(this, args);
    };
    window.__cameraCounters = counters;
  });
}

const readCounters = (page) => page.evaluate(() => ({ ...window.__cameraCounters }));

// O overlay da câmera cobre o painel USB (a entrada manual fica sob o container da câmera).
const usbInputIsCovered = (page) =>
  page.evaluate(() => {
    const rect = document.getElementById('manual-scan-input').getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);

    return Boolean(top?.closest('#mode-cam-container'));
  });

test.describe('SCANNER — modo câmera', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await openTab(page, 'scanner', { isAdmin: true });
    await installCameraSpies(page);
  });

  test('USB -> câmera -> USB: container, status e inicialização única', async ({ page }) => {
    await expect(page.locator('#mode-cam-container')).toBeHidden();
    expect(await usbInputIsCovered(page)).toBe(false);

    await page.locator('#btn-mode-cam').click();
    await expect(page.locator('#mode-cam-container')).toBeVisible();
    await expect(page.locator('#scanner-status-text')).toHaveText('Aguardando leitura via Câmera');
    await expect(page.locator('#reader video')).toHaveCount(1, { timeout: 15_000 });
    expect(await usbInputIsCovered(page)).toBe(true);
    expect(await readCounters(page)).toMatchObject({ startCamera: 1, cameraStart: 1 });

    await page.locator('#btn-mode-usb').click();
    await expect(page.locator('#mode-cam-container')).toBeHidden();
    await expect(page.locator('#scanner-status-text')).toHaveText('Aguardando leitura via USB');
    await expect(page.locator('#reader video')).toHaveCount(0);
    await expect(page.locator('#manual-scan-input')).toBeVisible();
    expect(await usbInputIsCovered(page)).toBe(false);
    expect((await readCounters(page)).cameraStop).toBeGreaterThanOrEqual(1);
  });

  test('sair da aba em modo câmera libera a câmera e reabre em modo USB', async ({ page }) => {
    await page.locator('#btn-mode-cam').click();
    await expect(page.locator('#reader video')).toHaveCount(1, { timeout: 15_000 });

    await openTab(page, 'dashboard', { isAdmin: true });
    await expectActiveTab(page, 'dashboard', { isAdmin: true });
    await expect(page.locator('#reader video')).toHaveCount(0);
    await expect(page.locator('#mode-cam-container')).toBeHidden();
    expect((await readCounters(page)).cameraStop).toBeGreaterThanOrEqual(1);

    await openTab(page, 'scanner', { isAdmin: true });
    await expect(page.locator('#scanner-status-text')).toHaveText('Aguardando leitura via USB');
    await expect(page.locator('#mode-cam-container')).toBeHidden();
    await expect(page.locator('#reader video')).toHaveCount(0);
  });

  test('atalho "Emprestar" do card abre o Scanner já em modo câmera', async ({ page }) => {
    await openTab(page, 'management', { isAdmin: true });
    await page.locator('#crud-list').getByRole('button', { name: 'Emprestar' }).first().click();

    await expectActiveTab(page, 'scanner', { isAdmin: true });
    await expect(page.locator('#mode-cam-container')).toBeVisible();
    await expect(page.locator('#reader video')).toHaveCount(1, { timeout: 15_000 });
  });
});
