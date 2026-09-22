import { expect, test } from './support/network-guard.js';

/**
 * Responsividade do Scanner redesenhado (Gate 1-F3.3B). Sem login/backend: revela o app e
 * manipula o estado interno diretamente (mesmo padrão de sidebar-mobile.spec.js e do modal de
 * manutenção em initial-layout.spec.js), evitando qualquer chamada de rede real.
 */
const CORE_VIEWPORTS = new Set([
  '1536x864',
  '1440x900',
  '1366x768',
  '1024x768',
  '768x1024',
  '430x932',
  '390x844',
  '360x800',
]);

const EXTRA_STATE_VIEWPORTS = new Set(['1440x900', '390x844']);
const TARGET_SIZE_VIEWPORTS = new Set(['430x932', '390x844', '360x800']);

const SYNTHETIC_TOOLS = [
  {
    firebaseId: 'resp-available-1',
    code: 'RESP-001',
    name: 'Furadeira Responsiva',
    category: 'Elétrica',
    status: 'available',
    imageUrl: null,
    currentUser: null,
  },
  {
    firebaseId: 'resp-borrowed-1',
    code: 'RESP-002',
    name: 'Parafusadeira Responsiva',
    category: 'Elétrica',
    status: 'borrowed',
    imageUrl: null,
    currentUser: 'Colaborador Responsivo',
  },
];

async function revealScannerTab(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });
  await page.waitForTimeout(300);

  await page.evaluate((tools) => {
    const login = document.getElementById('login-screen');
    const app = document.getElementById('main-app');

    if (!login || !app) {
      throw new Error('Estrutura principal da aplicação não encontrada.');
    }

    login.classList.add('hidden');
    app.classList.remove('hidden');

    document.querySelectorAll('.tab-content').forEach((el) => el.classList.add('hidden'));
    document.getElementById('tab-scanner')?.classList.remove('hidden');

    window.App.Data.tools = tools;
    window.App.Data.toolsLoaded = true;
  }, SYNTHETIC_TOOLS);

  await page.waitForTimeout(200);
}

function scrollWidthDiagnostics(page) {
  return page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
  }));
}

async function assertNoHorizontalOverflow(page, testInfo, label) {
  const { viewportWidth, scrollWidth } = await scrollWidthDiagnostics(page);
  expect(
    scrollWidth,
    `Projeto: ${testInfo.project.name} — estado: ${label}\nViewport: ${viewportWidth}px, scrollWidth: ${scrollWidth}px`
  ).toBeLessThanOrEqual(viewportWidth + 1);
}

test.describe('Responsividade do Scanner (Gate 1-F3.3B)', () => {
  test('@scanner-responsive initial / loan / return sem rolagem horizontal', async ({
    page,
  }, testInfo) => {
    const viewport = page.viewportSize();
    const key = viewport ? `${viewport.width}x${viewport.height}` : '';

    test.skip(!CORE_VIEWPORTS.has(key), 'Fora do conjunto de viewports obrigatório deste gate.');

    await revealScannerTab(page);

    // initial
    await expect(page.locator('#scanner-waiting')).toBeVisible();
    await assertNoHorizontalOverflow(page, testInfo, 'initial');

    // loan
    await page.evaluate(() => window.App.Scanner.processCode('RESP-001'));
    await expect(page.locator('#scanner-checkout')).toBeVisible();
    await assertNoHorizontalOverflow(page, testInfo, 'loan');

    // return
    await page.evaluate(() => window.App.Scanner.reset());
    await page.evaluate(() => window.App.Scanner.processCode('RESP-002'));
    await expect(page.locator('#scanner-return')).toBeVisible();
    await assertNoHorizontalOverflow(page, testInfo, 'return');
  });

  test('@scanner-responsive error / success / camera sem rolagem horizontal', async ({
    page,
  }, testInfo) => {
    const viewport = page.viewportSize();
    const key = viewport ? `${viewport.width}x${viewport.height}` : '';

    test.skip(!EXTRA_STATE_VIEWPORTS.has(key), 'Restrito a 1440x900 e 390x844 (seção 39 do gate).');

    await revealScannerTab(page);

    // error (patrimônio não localizado)
    await page.evaluate(() => window.App.Scanner.processCode('CODIGO-INEXISTENTE'));
    await assertNoHorizontalOverflow(page, testInfo, 'error');

    // success (persistente, sem depender de rede: injeta o estado final diretamente)
    await page.evaluate(() => window.App.Scanner.processCode('RESP-001'));
    await page.evaluate(() => {
      document.getElementById('scanner-checkout')?.classList.add('hidden');
      const box = document.getElementById('scanner-status-box');
      box.innerHTML =
        '<div class="text-amber-900 bg-amber-50 p-6 rounded-2xl text-center"><p class="font-black text-xl">Responsabilidade Transferida</p></div>';
      box.classList.remove('hidden');
      document.getElementById('scanner-success-actions')?.classList.remove('hidden');
    });
    await expect(page.locator('#scanner-status-box')).toBeVisible();
    await assertNoHorizontalOverflow(page, testInfo, 'success');

    // camera: só o layout do overlay (sem hardware real — a suíte responsiva não usa
    // --use-fake-device-for-media-stream; o ciclo de vida real da câmera é coberto por
    // tests/e2e/scanner.spec.js contra o Chromium com dispositivo falso).
    await page.evaluate(() => window.App.Scanner.reset());
    await page.evaluate(() => {
      const el = document.getElementById('mode-cam-container');
      el.classList.remove('hidden');
      el.classList.add('flex');
    });
    await expect(page.locator('#mode-cam-container')).toBeVisible();
    await assertNoHorizontalOverflow(page, testInfo, 'camera');
  });

  test('@scanner-responsive RESP-02/RESP-03: alvos ≥44px e sem sobreposição com a barra inferior', async ({
    page,
  }, testInfo) => {
    const viewport = page.viewportSize();
    const key = viewport ? `${viewport.width}x${viewport.height}` : '';

    test.skip(!TARGET_SIZE_VIEWPORTS.has(key), 'Restrito aos viewports mobile da seção 41/42.');

    await revealScannerTab(page);

    // Empréstimo: Confirmar Empréstimo
    await page.evaluate(() => window.App.Scanner.processCode('RESP-001'));
    await assertMinTargetSize(page, '#btn-checkout-confirm', testInfo);
    await assertNoBottomNavOverlap(page, '#btn-checkout-confirm', testInfo);

    // Devolução: Cancelar e Devolver
    await page.evaluate(() => window.App.Scanner.reset());
    await page.evaluate(() => window.App.Scanner.processCode('RESP-002'));
    await assertMinTargetSize(page, '#btn-return-confirm', testInfo);
    await assertNoBottomNavOverlap(page, '#btn-return-confirm', testInfo);
    await assertMinTargetSize(page, '#scanner-return button:has-text("Cancelar")', testInfo);

    // Nova operação (via painel de sucesso injetado, sem rede)
    await page.evaluate(() => {
      document.getElementById('scanner-return')?.classList.add('hidden');
      document.getElementById('scanner-success-actions')?.classList.remove('hidden');
    });
    await assertMinTargetSize(page, '#btn-new-operation', testInfo);
    await assertNoBottomNavOverlap(page, '#btn-new-operation', testInfo);

    // Câmera: torch e fechar
    await page.evaluate(() => window.App.Scanner.reset());
    await page.evaluate(() => {
      const el = document.getElementById('mode-cam-container');
      el.classList.remove('hidden');
      el.classList.add('flex');
    });
    await assertMinTargetSize(page, '#btn-toggle-torch', testInfo);
    await assertMinTargetSize(page, '#btn-close-camera', testInfo);
  });
});

const MIN_TARGET_PX = 44;

async function assertMinTargetSize(page, selector, testInfo) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${selector} deveria estar visível (${testInfo.project.name})`).not.toBeNull();
  expect(box.height, `${selector} altura mínima 44px (${testInfo.project.name})`).toBeGreaterThanOrEqual(
    MIN_TARGET_PX - 1
  );
}

async function assertNoBottomNavOverlap(page, selector, testInfo) {
  const ctaBox = await page.locator(selector).first().boundingBox();
  const navBox = await page.locator('#bottom-nav').boundingBox();

  if (!navBox || navBox.height === 0) {
    return; // barra inferior não renderizada neste estado (ex.: viewport acima do breakpoint mobile)
  }

  const overlaps = ctaBox.y + ctaBox.height > navBox.y && ctaBox.y < navBox.y + navBox.height;
  expect(
    overlaps,
    `${selector} não pode ficar coberto pela barra inferior (${testInfo.project.name})\n` +
      `CTA: ${JSON.stringify(ctaBox)}\nNav: ${JSON.stringify(navBox)}`
  ).toBe(false);
}
