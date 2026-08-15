---
name: validar-baseline
description: Executa a suíte Playwright completa e compara o resultado contra a baseline conhecida deste projeto (319 passou / 0 falhou / 11 pulados). Use ao final de qualquer gate que altere código ou markup, para confirmar ausência de regressão — nunca para corrigir falhas automaticamente.
disable-model-invocation: true
allowed-tools: Bash(npx playwright test *) Bash(cat package.json)
---

## Baseline conhecida deste projeto

319 passou / 0 falhou / 11 pulados (os 11 pulados são `test.skip()` intencional em `tests/responsive/sidebar-mobile.spec.js`, condicionado a viewport ≥1024px — não é falha).

## Comando

Antes de rodar, confira se `package.json` define um script `test`; se sim, use-o. Caso não exista, rode diretamente:

!`npx playwright test --reporter=line`

## Instruções

Compare o resultado (total / passou / falhou / pulado) contra a baseline acima. Se bater exatamente, relate "sem desvio da baseline". Se houver qualquer diferença — mais falhas, menos pulados, total diferente — relate os detalhes (arquivo, linha, mensagem de erro) sem tentar corrigir. Corrigir falhas de teste está fora do escopo desta Skill; é decisão de um gate próprio.
