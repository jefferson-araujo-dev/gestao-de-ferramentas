import { freezeMotion } from './support/axe.js';
import { assertEmulatorConnected, expect, loginAs, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// Gate 1-C: prova, no navegador, que a fundação de tokens/foco/movimento chega ao app real e
// que as regras legadas migradas para tokens mantêm EXATAMENTE os valores anteriores.
// Valores esperados abaixo são literais (os mesmos das regras removidas), não derivados dos tokens.
const RGB = {
  white: 'rgb(255, 255, 255)',
  slate50: 'rgb(248, 250, 252)',
  slate200: 'rgb(226, 232, 240)',
  slate600: 'rgb(71, 85, 105)',
  slate900: 'rgb(15, 23, 42)',
  slate950: 'rgb(2, 6, 23)',
  slate100: 'rgb(241, 245, 249)',
  slate700: 'rgb(51, 65, 85)',
  slate300: 'rgb(203, 213, 225)',
  brand600: 'rgb(29, 78, 216)',
  brand300: 'rgb(147, 197, 253)',
};

// Resolve um token via um elemento-sonda: valida a cadeia completa (Tailwind -> :root/.dark -> var()).
const tokenColor = (page, token) =>
  page.evaluate((name) => {
    const probe = document.createElement('div');

    probe.style.backgroundColor = `var(--color-${name})`;
    document.body.appendChild(probe);

    const value = getComputedStyle(probe).backgroundColor;

    probe.remove();
    return value;
  }, token);

// A paleta slate do Tailwind v4 é oklch; o token usa o hex equivalente. A diferença medida é de
// no máximo 1 unidade por canal RGB (imperceptível) e é a única não idêntica desta migração.
const channels = (rgb) => rgb.match(/\d+/g).slice(0, 3).map(Number);
const expectRgbWithin = (actual, expected, tolerance = 1) => {
  const [got, want] = [channels(actual), channels(expected)];

  expect(
    got.every((value, index) => Math.abs(value - want[index]) <= tolerance),
    `${actual} deveria estar a no máximo ${tolerance} de ${expected}`
  ).toBe(true);
};

const setDark = (page, dark) =>
  page.evaluate((on) => {
    document.documentElement.classList.toggle('dark', on);
    document.documentElement.classList.toggle('light', !on);
  }, dark);

const styleOf = (locator, props) =>
  locator.evaluate(
    (element, names) =>
      Object.fromEntries(names.map((name) => [name, getComputedStyle(element)[name]])),
    props
  );

test.describe('FUNDAÇÃO 1-C — tela de login (sem autenticação)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await assertEmulatorConnected(page);
    await expect(page.locator('#login-screen')).toBeVisible();
    await freezeMotion(page);
  });

  test('tokens resolvem em LIGHT e são redefinidos por .dark', async ({ page }) => {
    await setDark(page, false);
    expect(await tokenColor(page, 'background')).toBe(RGB.slate50);
    expect(await tokenColor(page, 'surface')).toBe(RGB.white);
    expect(await tokenColor(page, 'text-primary')).toBe(RGB.slate900);
    expect(await tokenColor(page, 'accent')).toBe(RGB.brand600);
    expect(await tokenColor(page, 'focus-ring')).toBe(RGB.brand600);

    await setDark(page, true);
    expect(await tokenColor(page, 'background')).toBe(RGB.slate950);
    expect(await tokenColor(page, 'surface')).toBe(RGB.slate900);
    expect(await tokenColor(page, 'text-primary')).toBe(RGB.slate100);
    expect(await tokenColor(page, 'focus-ring')).toBe(RGB.brand300);
  });

  test('corpo: cor de texto por token fica a no máximo 1/255 das antigas classes slate-900 / slate-100', async ({
    page,
  }) => {
    await setDark(page, false);
    expectRgbWithin((await styleOf(page.locator('body'), ['color'])).color, RGB.slate900);

    await setDark(page, true);
    expectRgbWithin((await styleOf(page.locator('body'), ['color'])).color, RGB.slate100);
  });

  test('fonte do corpo vem do token e mantém o fallback anterior', async ({ page }) => {
    const { fontFamily } = await styleOf(page.locator('body'), ['fontFamily']);

    expect(fontFamily).toBe('Inter, sans-serif');
  });

  test('campo com outline-none e ring fraco recebe contorno sólido de 2px ao focar', async ({
    page,
  }) => {
    await setDark(page, false);
    await page.locator('#login-email').focus();
    await expect(page.locator('#login-email')).toBeFocused();

    expect(
      await styleOf(page.locator('#login-email'), ['outlineStyle', 'outlineWidth', 'outlineColor'])
    ).toEqual({ outlineStyle: 'solid', outlineWidth: '2px', outlineColor: RGB.brand600 });
  });

  test('botão .btn focado por Tab usa o contorno global (ring de baixa opacidade removido do .btn)', async ({
    page,
  }) => {
    await setDark(page, false);
    await page.locator('#login-password').focus();

    for (let step = 0; step < 4; step += 1) {
      if (await page.locator('#btn-login').evaluate((el) => el === document.activeElement)) {
        break;
      }

      await page.keyboard.press('Tab');
    }

    await expect(page.locator('#btn-login')).toBeFocused();
    expect(
      await styleOf(page.locator('#btn-login'), ['outlineStyle', 'outlineWidth', 'outlineColor'])
    ).toEqual({ outlineStyle: 'solid', outlineWidth: '2px', outlineColor: RGB.brand600 });
  });

  test('foco por teclado no dark usa a cor de foco clara do tema', async ({ page }) => {
    await setDark(page, true);
    await page.locator('#login-email').focus();
    await expect(page.locator('#login-email')).toBeFocused();

    expect((await styleOf(page.locator('#login-email'), ['outlineColor'])).outlineColor).toBe(
      RGB.brand300
    );
  });

  test('prefers-reduced-motion: reduce encerra transições e animações', async ({ page }) => {
    // Sem freezeMotion neste teste: o navegador aplica a regra real.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertEmulatorConnected(page);

    const normal = await styleOf(page.locator('body'), ['transitionDuration']);

    expect(normal.transitionDuration).toBe('0.3s');

    await page.emulateMedia({ reducedMotion: 'reduce' });

    const reduced = await styleOf(page.locator('body'), ['transitionDuration']);

    expect(Number.parseFloat(reduced.transitionDuration)).toBeLessThan(0.001);
  });
});

test.describe('FUNDAÇÃO 1-C — telas autenticadas (ADMIN)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_USERS.admin);
    await expect(page.locator('#dash-list')).toContainText('Furadeira de Impacto');
    await freezeMotion(page);
  });

  test('fundo do conteúdo principal por token fica a no máximo 1/255 de slate-50 / slate-950', async ({
    page,
  }) => {
    const main = page.locator('#main-content-scroll');

    await setDark(page, false);
    expectRgbWithin((await styleOf(main, ['backgroundColor'])).backgroundColor, RGB.slate50);

    await setDark(page, true);
    expectRgbWithin((await styleOf(main, ['backgroundColor'])).backgroundColor, RGB.slate950);
  });

  test('regras legadas migradas para tokens mantêm os valores anteriores (LIGHT e DARK)', async ({
    page,
  }) => {
    const exportButton = page.locator("#btn-export-dashboard.btn[class*='bg-emerald-600']");
    const quickFilter = page.locator('#quick-filters .quick-filter-btn:not(.active)').first();
    const props = ['backgroundColor', 'borderTopColor', 'color'];

    await setDark(page, false);

    for (const locator of [exportButton, quickFilter]) {
      expect(await styleOf(locator, props)).toEqual({
        backgroundColor: RGB.white,
        borderTopColor: RGB.slate200,
        color: RGB.slate600,
      });
    }

    await setDark(page, true);

    for (const locator of [exportButton, quickFilter]) {
      expect(await styleOf(locator, props)).toEqual({
        backgroundColor: RGB.slate900,
        borderTopColor: RGB.slate700,
        color: RGB.slate300,
      });
    }
  });

  test('KPIs do dashboard usam números tabulares', async ({ page }) => {
    const numbers = page.locator('#tab-dashboard .stat-number');

    expect(await numbers.count()).toBeGreaterThan(0);
    expect((await styleOf(numbers.first(), ['fontVariantNumeric'])).fontVariantNumeric).toBe(
      'tabular-nums'
    );
  });
});
