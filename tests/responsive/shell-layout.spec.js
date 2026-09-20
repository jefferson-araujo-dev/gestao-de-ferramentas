import { modeForWidth } from '../../src/js/config/breakpoints.js';
import { expect, test } from './support/network-guard.js';

// Contrato do app shell em TODOS os viewports do gate responsivo (Gate 1-D):
//   mobile < 768 (barra inferior) | tablet 768-1023 (drawer) | notebook 1024-1279 (rail 72px)
//   | desktop >= 1280 (sidebar 256px).
// O modo esperado vem da MESMA fonte que o app usa (src/js/config/breakpoints.js).
const SIDEBAR = 256;
const RAIL = 72;
const ALL_PERMISSIONS = {
  canAccessDashboard: true,
  canAccessScanner: true,
  canReadTools: true,
  canReadCollaborators: true,
  canAccessUsers: true,
  canAccessHistory: true,
};

async function revealShell(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  await page.evaluate((permissions) => {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    window.App.Shell.applyPermissions(permissions);
  }, ALL_PERMISSIONS);

  await page.waitForTimeout(350); // transições de largura/posição
}

test('@shell-layout o shell do viewport segue o contrato de breakpoints', async ({
  page,
}, testInfo) => {
  const viewport = page.viewportSize();
  const mode = modeForWidth(viewport.width);
  const context = `${testInfo.project.name} (${mode})`;

  await revealShell(page);
  await expect(page.locator('html'), context).toHaveAttribute('data-shell-mode', mode);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(overflow.scrollWidth, `${context}: rolagem horizontal`).toBeLessThanOrEqual(
    overflow.clientWidth + 1
  );

  const sidebar = page.locator('#main-sidebar');
  const bottomNav = page.locator('#bottom-nav');
  const toggle = page.locator('#btn-sidebar-toggle');
  const mainLeft = async () =>
    Math.round((await page.locator('#main-content-scroll').boundingBox()).x);

  if (mode === 'mobile') {
    await expect(sidebar, context).toBeHidden();
    await expect(toggle, context).toBeHidden();
    await expect(bottomNav, context).toBeVisible();

    const items = bottomNav.locator('a[data-nav-id], #bnav-more');

    await expect(items, context).toHaveCount(5);

    const report = await items.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const label = node.querySelector('.shell-bnav-label');

        return {
          name: label.textContent.trim(),
          height: rect.height,
          left: rect.left,
          right: rect.right,
          labelWidth: label.getBoundingClientRect().width,
          clipped: node.scrollWidth > node.clientWidth + 1,
        };
      })
    );

    for (const item of report) {
      expect(item.labelWidth, `${context}: rótulo "${item.name}" invisível`).toBeGreaterThan(0);
      expect(item.height, `${context}: alvo "${item.name}"`).toBeGreaterThanOrEqual(44);
      expect(item.clipped, `${context}: "${item.name}" com texto cortado`).toBe(false);
      expect(item.left, `${context}: "${item.name}" fora da tela`).toBeGreaterThanOrEqual(-1);
      expect(item.right, `${context}: "${item.name}" fora da tela`).toBeLessThanOrEqual(
        viewport.width + 1
      );
    }

    const layout = await page.evaluate(() => ({
      navHeight: document.getElementById('bottom-nav').getBoundingClientRect().height,
      padding: parseFloat(
        getComputedStyle(document.querySelector('.main-content-wrapper')).paddingBottom
      ),
    }));

    expect(layout.padding, `${context}: conteúdo sob a barra inferior`).toBeGreaterThanOrEqual(
      layout.navHeight
    );

    // "Mais" cabe na viewport e lista os destinos restantes do perfil completo.
    await page.locator('#bnav-more').click();

    const sheet = page.locator('#more-sheet');

    await expect(sheet, context).toBeVisible();
    await expect(sheet.locator('#more-nav [data-nav-id]'), context).toHaveText([
      'Auditoria',
      'Usuários e acessos',
    ]);

    const box = await sheet.boundingBox();

    expect(box.x, `${context}: folha "Mais"`).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `${context}: folha "Mais"`).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y, `${context}: folha "Mais"`).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height, `${context}: folha "Mais"`).toBeLessThanOrEqual(viewport.height + 1);
    await page.keyboard.press('Escape');
    await expect(sheet, context).toBeHidden();
    return;
  }

  await expect(bottomNav, context).toBeHidden();

  if (mode === 'tablet') {
    await expect(sidebar, context).toBeHidden();
    await expect(toggle, context).toBeVisible();
    expect(await mainLeft(), `${context}: sem sidebar persistente`).toBe(0);

    await toggle.click();
    await expect(sidebar, context).toBeVisible();
    await page.waitForTimeout(350);

    const box = await sidebar.boundingBox();

    expect(Math.round(box.width), context).toBe(SIDEBAR);
    expect(box.x, context).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, context).toBeLessThanOrEqual(viewport.width + 1);
    await expect(page.locator('#nav-scanner .shell-nav-label'), context).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sidebar, context).toBeHidden();
    return;
  }

  await expect(sidebar, context).toBeVisible();
  await expect(toggle, context).toBeVisible();

  const width = Math.round((await sidebar.boundingBox()).width);

  if (mode === 'notebook') {
    expect(width, `${context}: rail`).toBe(RAIL);
    expect(await mainLeft(), `${context}: conteúdo ao lado do rail`).toBe(RAIL);
  } else {
    expect(width, `${context}: sidebar`).toBe(SIDEBAR);
    expect(await mainLeft(), `${context}: conteúdo ao lado da sidebar`).toBe(SIDEBAR);
  }
});
