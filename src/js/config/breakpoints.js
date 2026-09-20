/**
 * Contrato ÚNICO de breakpoints do app shell (Gate 1-D).
 *
 * mobile   < 768        navegação inferior
 * tablet   768–1023     drawer
 * notebook 1024–1279    rail de 72px (expande sobre o conteúdo)
 * desktop  >= 1280      sidebar de 256px (recolhe para 72px)
 *
 * Os valores coincidem com md/lg/xl do Tailwind (declarados em src/css/tokens.css e conferidos por
 * tests/unit/breakpointsContract.test.mjs). O CSS do shell (src/css/shell.css) usa os mesmos números.
 * Somente o shell consome este módulo; media queries históricas das telas internas seguem à parte.
 */
export const BREAKPOINTS = Object.freeze({
  tablet: 768,
  notebook: 1024,
  desktop: 1280
});

export const SHELL_MODES = Object.freeze(['mobile', 'tablet', 'notebook', 'desktop']);

const query = (px) => `(min-width: ${px}px)`;

// Função pura (testável sem navegador): modo do shell para uma largura em px.
export function modeForWidth(width) {
  if (width >= BREAKPOINTS.desktop) {
    return 'desktop';
  }

  if (width >= BREAKPOINTS.notebook) {
    return 'notebook';
  }

  return width >= BREAKPOINTS.tablet ? 'tablet' : 'mobile';
}

// Observa os três limites via matchMedia. Retorna { mode(), dispose() }.
export function watchShellMode(onChange, win = window) {
  const lists = Object.values(BREAKPOINTS).map((px) => win.matchMedia(query(px)));
  const mode = () => {
    if (lists[2].matches) {
      return 'desktop';
    }

    if (lists[1].matches) {
      return 'notebook';
    }

    return lists[0].matches ? 'tablet' : 'mobile';
  };
  const handler = () => onChange(mode());

  lists.forEach((list) => list.addEventListener('change', handler));

  return {
    mode,
    dispose: () => lists.forEach((list) => list.removeEventListener('change', handler))
  };
}
