import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { BREAKPOINTS, modeForWidth } from '../../src/js/config/breakpoints.js';

// Contrato de breakpoints do app shell (Gate 1-D): mobile <768, tablet 768-1023, notebook
// 1024-1279, desktop >=1280. Uma fonte JS, os mesmos números em tokens.css (md/lg/xl) e shell.css.
const read = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('breakpoints do shell', () => {
  test('valores oficiais', () => {
    assert.deepEqual({ ...BREAKPOINTS }, { tablet: 768, notebook: 1024, desktop: 1280 });
  });

  const modes = [
    [280, 'mobile'],
    [320, 'mobile'],
    [375, 'mobile'],
    [390, 'mobile'],
    [430, 'mobile'],
    [767, 'mobile'],
    [767.5, 'mobile'],
    [768, 'tablet'],
    [820, 'tablet'],
    [1023, 'tablet'],
    [1024, 'notebook'],
    [1100, 'notebook'],
    [1279, 'notebook'],
    [1280, 'desktop'],
    [1440, 'desktop'],
    [3440, 'desktop'],
  ];

  for (const [width, mode] of modes) {
    test(`${width}px => ${mode}`, () => {
      assert.equal(modeForWidth(width), mode);
    });
  }

  test('tokens.css declara md/lg/xl com os mesmos valores (fonte conferida contra o JS)', () => {
    const tokens = stripComments(read('css/tokens.css'));
    const px = (name) => {
      const rem = new RegExp(`--breakpoint-${name}:\\s*([\\d.]+)rem`).exec(tokens)?.[1];

      return Math.round(parseFloat(rem) * 16);
    };

    assert.equal(px('md'), BREAKPOINTS.tablet);
    assert.equal(px('lg'), BREAKPOINTS.notebook);
    assert.equal(px('xl'), BREAKPOINTS.desktop);
  });

  test('shell.css só usa os limites do contrato (768/1024/1280 e o complemento 767.98)', () => {
    const css = stripComments(read('css/shell.css'));
    const queries = [...css.matchAll(/@media\s*\(\s*(min|max)-width:\s*([\d.]+)px\s*\)/g)];

    assert.ok(queries.length > 0);

    for (const [, kind, value] of queries) {
      const allowed = kind === 'min' ? [768, 1024, 1280] : [767.98];

      assert.ok(allowed.includes(Number(value)), `${kind}-width: ${value}px fora do contrato`);
    }
  });

  test('consumidores do shell não leem window.innerWidth (usam matchMedia via breakpoints.js)', () => {
    for (const file of [
      'js/modules/shell.js',
      'js/modules/ui.js',
      'js/core/Router.js',
      'js/config/navigation.js',
    ]) {
      assert.doesNotMatch(read(file), /innerWidth/, file);
    }

    assert.match(read('js/config/breakpoints.js'), /matchMedia/);
  });

  test('ResponsiveManager não manipula mais a sidebar do shell', () => {
    const manager = read('js/core/ResponsiveManager.js');

    assert.doesNotMatch(
      manager,
      /sidebar-overlay|-translate-x-full|syncResponsiveLayout|setMobileSidebarState/
    );
  });
});
