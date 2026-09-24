import { expect, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_USERS } from './support/seed-data.mjs';

// Addendum 1-F3.3B.3: no mobile, o toast e o botão flutuante "voltar ao topo" disputavam o mesmo
// canto inferior direito (#toast-container e #back-to-top ficavam a apenas 0.5rem de distância um
// do outro, abaixo de 768px). Corrigido em src/css/shell.css subindo o piso do toast para acima do
// topo do botão. Este teste prova geometricamente, em viewports reais e com navegação inferior
// autenticada de verdade, que os três elementos (toast, botão flutuante, navegação inferior) nunca
// se sobrepõem.
// A correção deste addendum está em `@media (max-width: 767.98px)` (src/css/shell.css): só se aplica
// abaixo de 768px. Em 1440x900 o teste confirma que o toast continua corretamente posicionado (sem
// regressão do que já existia), mas NÃO afirma ausência de sobreposição com #back-to-top: a
// investigação desta responsabilidade encontrou, por medição geométrica real, que o toast e o botão
// "voltar ao topo" também podem se sobrepor em desktop quando ambos ficam visíveis ao mesmo tempo —
// um problema PRÉ-EXISTENTE, fora do escopo autorizado aqui (só a media query mobile foi alterada) e
// registrado separadamente no REPORT deste addendum para decisão do Cowork, não mascarado aqui.
const VIEWPORTS = [
  { width: 390, height: 844, hasBottomNav: true, checkFloatingOverlap: true },
  { width: 360, height: 800, hasBottomNav: true, checkFloatingOverlap: true },
  { width: 430, height: 932, hasBottomNav: true, checkFloatingOverlap: true },
  { width: 1440, height: 900, hasBottomNav: false, checkFloatingOverlap: false },
];

function intersects(a, b) {
  if (!a || !b) {
    return false;
  }
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

for (const { width, height, hasBottomNav, checkFloatingOverlap } of VIEWPORTS) {
  test.describe(`Toast x voltar-ao-topo x navegação inferior — ${width}x${height}`, () => {
    test('toast fica dentro da viewport, com botão de fechar visível, sem sobrepor os controles flutuantes', async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await loginAs(page, E2E_USERS.admin);
      await openTab(page, 'scanner');
      await expect
        .poll(() => page.evaluate(() => window.App.Data.toolsLoaded && window.App.Data.tools.length))
        .toBeGreaterThan(0);

      // Força o botão "voltar ao topo" visível, como um usuário que rolou a tela veria (evita
      // depender de haver conteúdo suficiente para rolar de verdade nesta tela específica).
      await page.evaluate(() => {
        const btn = document.getElementById('back-to-top');
        btn.classList.remove('opacity-0', 'pointer-events-none');
        btn.classList.add('opacity-100', 'pointer-events-auto');
      });

      await page.locator('#manual-scan-input').fill('CODIGO-INEXISTENTE');
      await page.locator('#manual-scan-input').press('Enter');
      await page.waitForTimeout(600); // aguarda a transição de entrada do toast (300ms) + folga

      const geometry = await page.evaluate(() => {
        const rect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        const nav = document.getElementById('bottom-nav');
        const navVisible = nav && nav.childElementCount > 0 && nav.getBoundingClientRect().height > 1;

        return {
          viewportWidth: window.innerWidth,
          toast: rect(document.querySelector('.ui-toast')),
          closeBtn: rect(document.querySelector('.ui-toast [data-dismiss]')),
          backToTop: rect(document.getElementById('back-to-top')),
          bottomNav: navVisible ? rect(nav) : null,
        };
      });

      expect(geometry.toast, 'toast deveria estar visível').not.toBeNull();
      expect(geometry.closeBtn, 'botão de fechar do toast deveria estar visível').not.toBeNull();

      // Toast inteiramente dentro da viewport (com folga de 1px para arredondamento).
      expect(geometry.toast.left).toBeGreaterThanOrEqual(-1);
      expect(geometry.toast.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);

      // Botão de fechar inteiramente dentro da viewport e dentro do próprio toast.
      expect(geometry.closeBtn.left).toBeGreaterThanOrEqual(geometry.toast.left - 1);
      expect(geometry.closeBtn.right).toBeLessThanOrEqual(geometry.toast.right + 1);
      expect(geometry.closeBtn.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);

      if (checkFloatingOverlap) {
        // Sem interseção entre o toast e o botão flutuante "voltar ao topo" (correção deste addendum,
        // válida abaixo de 768px).
        expect(
          intersects(geometry.toast, geometry.backToTop),
          `toast e voltar-ao-topo não podem se sobrepor\n${JSON.stringify(geometry, null, 2)}`
        ).toBe(false);
      }

      if (hasBottomNav) {
        expect(geometry.bottomNav, 'navegação inferior deveria estar renderizada (autenticado, <768px)').not.toBeNull();

        // Sem interseção entre o toast e a navegação inferior, nem entre voltar-ao-topo e a navegação.
        expect(
          intersects(geometry.toast, geometry.bottomNav),
          `toast e navegação inferior não podem se sobrepor\n${JSON.stringify(geometry, null, 2)}`
        ).toBe(false);
        expect(
          intersects(geometry.backToTop, geometry.bottomNav),
          `voltar-ao-topo e navegação inferior não podem se sobrepor\n${JSON.stringify(geometry, null, 2)}`
        ).toBe(false);
      } else {
        expect(geometry.bottomNav, 'navegação inferior não deveria renderizar em desktop').toBeNull();
      }
    });
  });
}
