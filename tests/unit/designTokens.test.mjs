import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

// Contrato dos tokens de design (Gate 1-C): existência em LIGHT e DARK, paridade entre os temas,
// contraste (WCAG 2.x) e regras de nomenclatura. Lê o CSS-fonte; não depende de navegador.
const read = (file) => readFileSync(new URL(`../../src/css/${file}`, import.meta.url), 'utf8');
const tokensCss = read('tokens.css');
const baseCss = read('base.css');
const mainCss = read('main.css');

// Remove comentários para que blocos e valores documentados não sejam lidos como declarações.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function blocks(css, opener) {
  const found = [];
  let from = 0;

  for (;;) {
    const start = css.indexOf(opener, from);

    if (start === -1) {
      return found;
    }

    const open = css.indexOf('{', start);
    let depth = 0;
    let end = open;

    for (; end < css.length; end += 1) {
      depth += css[end] === '{' ? 1 : css[end] === '}' ? -1 : 0;

      if (depth === 0) {
        break;
      }
    }

    found.push(css.slice(open + 1, end));
    from = end + 1;
  }
}

const declarations = (body) =>
  Object.fromEntries(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
  );

const cleanTokens = stripComments(tokensCss);
const themeVars = declarations(blocks(cleanTokens, '@theme static')[0]);
const darkVars = Object.assign({}, ...blocks(cleanTokens, '.dark ').map(declarations));
const rootVars = declarations(blocks(cleanTokens, ':root ')[0]);

const colorEntries = (vars) =>
  Object.fromEntries(
    Object.entries(vars)
      .filter(([name]) => name.startsWith('--color-'))
      .map(([name, value]) => [name.replace('--color-', ''), value])
  );
const LIGHT = colorEntries(themeVars);
const DARK = colorEntries(darkVars);

const REQUIRED = [
  'background',
  'surface',
  'surface-elevated',
  'surface-muted',
  'border',
  'border-control',
  'text-primary',
  'text-secondary',
  'text-muted',
  'text-inverse',
  'accent',
  'accent-hover',
  'accent-active',
  'success',
  'warning',
  'danger',
  'info',
  'focus-ring',
];
const SURFACES = ['background', 'surface', 'surface-elevated', 'surface-muted'];
const STATUS = ['success', 'warning', 'danger', 'info'];

const channel = (value) => {
  const c = value / 255;

  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map(channel);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};
const hue = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);

  if (delta === 0) {
    return 0;
  }

  const h =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;

  return (h * 60 + 360) % 360;
};

// Sem exceções: todo par abaixo do mínimo reprova o teste.
function assertContrast(theme, tokens, fg, bg, minimum) {
  const ratio = contrast(tokens[fg], tokens[bg]);

  assert.ok(
    ratio >= minimum,
    `${theme}: ${fg} sobre ${bg} = ${ratio.toFixed(2)}:1 (mínimo ${minimum}:1)`
  );
}

const themes = [
  ['light', LIGHT],
  ['dark', DARK],
];

describe('tokens semânticos: contrato', () => {
  for (const [theme, tokens] of themes) {
    test(`${theme}: todos os tokens obrigatórios existem com valor hexadecimal`, () => {
      for (const name of REQUIRED) {
        assert.match(tokens[name] ?? '', /^#[0-9a-f]{6}$/, `${theme}: ${name}`);
      }
    });
  }

  test('.dark redefine exatamente o mesmo conjunto de cores do LIGHT (sem faltar nem sobrar)', () => {
    assert.deepEqual(Object.keys(DARK).sort(), Object.keys(LIGHT).sort());
  });

  test('nomes descrevem função, não aparência', () => {
    const appearance = /(blue|gray|grey|slate|black|white|dark|light|red|green|amber|rose|cyan)/;

    for (const name of Object.keys(LIGHT)) {
      assert.doesNotMatch(name, appearance, name);
    }
  });

  test('todo var(--color-*) usado no CSS do app existe nos tokens', () => {
    const used = new Set(
      [...stripComments(baseCss + mainCss).matchAll(/var\(--color-([\w-]+)\)/g)].map((m) => m[1])
    );

    for (const name of used) {
      // brand-* é a paleta de marca (main.css), não um token semântico.
      if (!name.startsWith('brand-')) {
        assert.ok(name in LIGHT, `token inexistente: --color-${name}`);
      }
    }
  });
});

describe('tokens semânticos: contraste (piso arquitetural)', () => {
  for (const [theme, tokens] of themes) {
    test(`${theme}: texto normal >= 4.5:1 sobre todas as superfícies`, () => {
      for (const surface of SURFACES) {
        for (const text of ['text-primary', 'text-secondary', 'text-muted']) {
          assertContrast(theme, tokens, text, surface, 4.5);
        }
      }
    });

    test(`${theme}: borda de controle e foco >= 3:1 sobre as superfícies`, () => {
      for (const surface of SURFACES) {
        assertContrast(theme, tokens, 'border-control', surface, 3);
      }

      for (const surface of [...SURFACES, 'accent-subtle']) {
        assertContrast(theme, tokens, 'focus-ring', surface, 3);
      }
    });

    test(`${theme}: texto sobre accent, accent como texto e texto inverso >= 4.5:1`, () => {
      for (const fill of ['accent', 'accent-hover', 'accent-active']) {
        assertContrast(theme, tokens, 'on-accent', fill, 4.5);
      }

      for (const surface of [...SURFACES, 'accent-subtle']) {
        assertContrast(theme, tokens, 'accent-text', surface, 4.5);
      }

      assertContrast(theme, tokens, 'text-inverse', 'text-primary', 4.5);
    });

    test(`${theme}: estados semânticos >= 4.5:1 sobre superfícies e sobre o próprio fundo suave`, () => {
      for (const status of STATUS) {
        for (const surface of [...SURFACES, `${status}-subtle`]) {
          assertContrast(theme, tokens, status, surface, 4.5);
        }
      }
    });
  }

  for (const [theme, tokens] of themes) {
    test(`${theme}: a hierarquia primary > secondary > muted se mantém em todas as superfícies`, () => {
      for (const surface of SURFACES) {
        const [primary, secondary, muted] = ['text-primary', 'text-secondary', 'text-muted'].map(
          (text) => contrast(tokens[text], tokens[surface])
        );

        assert.ok(primary > secondary, `${theme}/${surface}: primary <= secondary`);
        assert.ok(secondary > muted + 1, `${theme}/${surface}: secondary e muted muito próximos`);
      }
    });
  }
});

describe('tokens semânticos: accent e estados', () => {
  test('accent claro é o azul da marca (brand-600) e o dark preserva o mesmo matiz', () => {
    const brand600 = /--color-brand-600:\s*(#[0-9a-f]{6})/i.exec(mainCss)[1].toLowerCase();

    assert.equal(LIGHT.accent, brand600);
    assert.ok(Math.abs(hue(DARK.accent) - hue(LIGHT.accent)) < 10);
  });

  for (const [theme, tokens] of themes) {
    test(`${theme}: success/warning/danger não são azuis e info se distingue do accent`, () => {
      for (const status of ['success', 'warning', 'danger']) {
        const h = hue(tokens[status]);

        assert.ok(h < 200 || h > 260, `${theme}: ${status} com matiz azul (${h.toFixed(0)}°)`);
      }

      const gap = Math.abs(hue(tokens.info) - hue(tokens.accent));

      assert.ok(gap >= 25, `${theme}: info muito próximo do accent (${gap.toFixed(0)}°)`);
    });
  }
});

describe('escalas: tipografia, espaçamento, raio, sombra e movimento', () => {
  const px = (rem) => Math.round(parseFloat(rem) * 16);

  test('escala tipográfica', () => {
    const scale = [
      ['display', 30, 36, '700'],
      ['heading-lg', 24, 32, '600'],
      ['heading-md', 20, 28, '600'],
      ['body', 14, 20, undefined],
      ['label', 12, 16, '500'],
      ['caption', 12, 16, undefined],
    ];

    for (const [name, size, line, weight] of scale) {
      assert.equal(px(themeVars[`--text-${name}`]), size, `${name}: tamanho`);
      assert.equal(px(themeVars[`--text-${name}--line-height`]), line, `${name}: altura de linha`);
      assert.equal(themeVars[`--text-${name}--font-weight`], weight, `${name}: peso`);
    }
  });

  test('escala de espaçamento preferencial (px)', () => {
    const steps = [1, 2, 3, 4, 6, 8, 12, 16];

    assert.deepEqual(
      steps.map((step) => px(rootVars[`--space-${step}`])),
      [4, 8, 12, 16, 24, 32, 48, 64]
    );
  });

  test('raio: sm=6, md=8, lg=12 e full', () => {
    assert.deepEqual(
      ['sm', 'md', 'lg'].map((name) => parseInt(themeVars[`--radius-ui-${name}`], 10)),
      [6, 8, 12]
    );
    assert.equal(themeVars['--radius-ui-full'], '9999px');
  });

  test('sombras existem em LIGHT e DARK e são neutras (sem cor)', () => {
    for (const size of ['sm', 'md', 'lg']) {
      for (const vars of [rootVars, darkVars]) {
        const shadow = vars[`--shadow-ui-${size}`];

        assert.ok(shadow, `--shadow-ui-${size}`);
        assert.ok(
          [...shadow.matchAll(/rgb\(([^)]*)\)/g)].every((m) => m[1].startsWith('0 0 0 /')),
          `sombra colorida: ${shadow}`
        );
      }
    }
  });

  test('movimento: tokens de duração e curva', () => {
    for (const name of ['fast', 'base', 'slow']) {
      assert.match(rootVars[`--motion-duration-${name}`], /^\d+ms$/);
    }

    assert.match(rootVars['--motion-ease-standard'], /^cubic-bezier\(/);
  });
});

describe('base: foco visível e movimento reduzido', () => {
  const base = stripComments(baseCss);

  test(':focus-visible global usa o token de foco e mantém contorno visível', () => {
    const focus = blocks(base, ':focus-visible ')[0];

    assert.match(focus, /outline:\s*2px solid var\(--color-focus-ring\)/);
    assert.doesNotMatch(base, /:focus-visible[^{]*\{[^}]*outline:\s*(none|0)\b/);
  });

  test('prefers-reduced-motion: reduce encerra animações e transições', () => {
    const reduced = blocks(base, '@media (prefers-reduced-motion: reduce)')[0];

    assert.match(reduced, /animation-duration:\s*0\.01ms !important/);
    assert.match(reduced, /transition-duration:\s*0\.01ms !important/);
    assert.match(reduced, /animation-iteration-count:\s*1 !important/);
  });

  test('.btn não depende de ring de baixa opacidade nem remove o outline', () => {
    const btn = blocks(stripComments(mainCss), '.btn {')[0];

    assert.match(btn, /@apply inline-flex/);
    assert.doesNotMatch(btn, /focus:ring|focus:outline-none/);
  });

  test('KPIs usam números tabulares', () => {
    assert.match(blocks(base, '.stat-number')[0], /font-variant-numeric:\s*tabular-nums/);
  });
});
