import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';

// Baseline de acessibilidade PRÉ-REDESIGN. Objetivo: registrar o estado atual e detectar
// REGRESSÕES (regra nova, impacto maior ou mais nós afetados). Não zera violações e a ausência
// de violações do axe NÃO comprova conformidade WCAG: o axe detecta só parte dos problemas.
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
export const IMPACT_RANK = { minor: 1, moderate: 2, serious: 3, critical: 4 };
export const UPDATE_BASELINE = process.env.UPDATE_AXE_BASELINE === '1';

const BASELINE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'baselines');

export const baselineFile = (projectName) =>
  path.join(BASELINE_DIR, `axe-baseline.${projectName}.json`);

export function loadBaseline(projectName) {
  const file = baselineFile(projectName);

  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { screens: {} };
}

export function saveBaseline(projectName, screens, axeVersion) {
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(
    baselineFile(projectName),
    `${JSON.stringify({ axeCore: axeVersion, tags: AXE_TAGS, screens }, null, 2)}\n`,
    'utf8'
  );
}

// Congela animações/transições apenas durante o scan: evita cálculo de contraste com
// opacidade intermediária (resultado não determinístico).
export async function freezeMotion(page) {
  await page.addStyleTag({
    content: '*,*::before,*::after{animation:none!important;transition:none!important}',
  });
}

export async function scan(page) {
  await page.waitForTimeout(150);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const violations = {};

  for (const violation of results.violations) {
    violations[violation.id] = { impact: violation.impact, nodes: violation.nodes.length };
  }

  return { violations, axeVersion: results.testEngine.version };
}

export function findRegressions(baselineScreen, current) {
  const regressions = [];

  for (const [rule, now] of Object.entries(current)) {
    const before = baselineScreen?.[rule];

    if (!before) {
      regressions.push(`regra nova: ${rule} (${now.impact}, ${now.nodes} nó(s))`);
    } else if (IMPACT_RANK[now.impact] > IMPACT_RANK[before.impact]) {
      regressions.push(`impacto maior: ${rule} ${before.impact} -> ${now.impact}`);
    } else if (now.nodes > before.nodes) {
      regressions.push(`mais nós: ${rule} ${before.nodes} -> ${now.nodes}`);
    }
  }

  return regressions;
}

export function summarize(screens) {
  const perImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const uniqueRules = {};

  for (const violations of Object.values(screens)) {
    for (const [rule, info] of Object.entries(violations)) {
      perImpact[info.impact] += 1;
      uniqueRules[rule] = info.impact;
    }
  }

  const uniqueByImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };

  for (const impact of Object.values(uniqueRules)) {
    uniqueByImpact[impact] += 1;
  }

  return { perImpact, uniqueByImpact, uniqueRules };
}
