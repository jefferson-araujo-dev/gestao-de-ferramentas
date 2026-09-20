import { expect, test } from './support/network-guard.js';

const interactive = 'button,a[href],input,select,textarea,[role=button]';

test('@global-layout mantém controles dentro da viewport', async ({ page }, testInfo) => {
  const browserErrors = [];

  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  const result = await page.evaluate(async ({ selector }) => {
    const issues = [];
    const login = document.getElementById('login-screen');
    const app = document.getElementById('main-app');

    if (!login || !app) throw new Error('Estrutura principal não encontrada.');

    login.classList.add('hidden');
    app.classList.remove('hidden');

    const frame = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );

    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const box = (element) => {
      const rect = element.getBoundingClientRect();

      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    };

    const horizontallyClipped = (rect) =>
      rect.left < -1 ||
      rect.right > document.documentElement.clientWidth + 1;

    const fullyOutsideViewport = (rect) =>
      rect.right <= 0 ||
      rect.left >= document.documentElement.clientWidth ||
      rect.bottom <= 0 ||
      rect.top >= window.innerHeight;

    const inspect = (element, type, scope, options = {}) => {
      if (!visible(element)) return;

      const rect = box(element);

      if (
        options.skipWhenOutside === true &&
        fullyOutsideViewport(rect)
      ) {
        return;
      }

      const isClipped =
        horizontallyClipped(rect) ||
        (options.checkVertical === true &&
          (rect.top < -1 ||
            rect.bottom > window.innerHeight + 1));

      if (isClipped) {
        issues.push({
          type,
          scope,
          label: String(element.textContent || '').replace(/\s+/g, ' ').trim(),
          rect,
        });
      }

      const style = getComputedStyle(element);

      if (
        element.clientWidth > 0 &&
        element.scrollWidth > element.clientWidth + 1 &&
        !['auto', 'scroll'].includes(style.overflowX)
      ) {
        issues.push({
          type: 'interactive-text-overflow',
          scope,
          label: String(element.textContent || '').replace(/\s+/g, ' ').trim(),
        });
      }
    };

    const sections = [...document.querySelectorAll('.tab-content')];

    for (const section of sections) {
      for (const candidate of sections) {
        candidate.classList.toggle('hidden', candidate !== section);
      }

      for (
        let current = section;
        current && current !== document.documentElement;
        current = current.parentElement
      ) {
        current.classList.remove('hidden');
      }

      for (const bar of section.querySelectorAll('.responsive-action-bar')) {
        for (const action of bar.querySelectorAll('button,a')) {
          action.classList.remove('hidden');
          action.style.removeProperty('display');
          if (getComputedStyle(action).display === 'none') {
            action.style.display = 'inline-flex';
          }
        }
      }

      await frame();

      const scope =
        section.id ||
        section.querySelector('h1,h2,h3')?.textContent?.trim() ||
        'section';

      if (
        Math.max(
          document.documentElement.scrollWidth,
          document.body?.scrollWidth || 0,
        ) >
        document.documentElement.clientWidth + 1
      ) {
        issues.push({ type: 'page-horizontal-scroll', scope });
      }

      for (const bar of section.querySelectorAll('.responsive-action-bar')) {
        if (visible(bar) && bar.scrollWidth > bar.clientWidth + 1) {
          issues.push({ type: 'action-bar-horizontal-scroll', scope });
        }
      }

      for (const element of section.querySelectorAll(selector)) {
        inspect(element, 'interactive-control-clipped', scope);
      }
    }

    for (const element of document.querySelectorAll('aside button,aside a[href]')) {
      inspect(element, 'sidebar-control-clipped', 'sidebar', {
        skipWhenOutside: true,
      });
    }

    const dialogs = [...document.querySelectorAll('dialog')];

    for (const dialog of dialogs) {
      if (dialog.open) dialog.close();
      dialog.classList.remove('hidden');

      try {
        dialog.showModal();
      } catch {
        continue;
      }

      await frame();

      const scope = dialog.id || 'dialog';
      const dialogRect = box(dialog);

      if (
        horizontallyClipped(dialogRect) ||
        dialogRect.top < -1 ||
        dialogRect.bottom > window.innerHeight + 1
      ) {
        issues.push({ type: 'dialog-clipped', scope, rect: dialogRect });
      }

      for (const action of dialog.querySelectorAll('button,a[href]')) {
        inspect(action, 'dialog-key-action-clipped', scope, {
          checkVertical: true,
        });
      }

      dialog.close();
    }

    return {
      issues,
      sections: sections.length,
      dialogs: dialogs.length,
    };
  }, { selector: interactive });

  await testInfo.attach('global-layout-report', {
    body: Buffer.from(
      JSON.stringify({ ...result, browserErrors }, null, 2),
    ),
    contentType: 'application/json',
  });

  expect(browserErrors, testInfo.project.name).toEqual([]);
  expect(result.issues, testInfo.project.name).toEqual([]);
});
