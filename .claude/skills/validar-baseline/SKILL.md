---
name: "validar-baseline"
description: "Executa a suíte Playwright completa em ambiente isolado e compara o resultado com a baseline vigente do projeto (397 passou, 0 falhou, 88 pulados; total 485), com evidência de comando. Uso manual ao final de Gates que alterem código ou markup. Nunca corrige falhas."
disable-model-invocation: true
allowed-tools: Bash(npx playwright test *) Bash(npx playwright --version) Bash(node --version) Bash(cat package.json)
---

# validar-baseline — Validação de regressão Playwright contra a baseline (Gestão de Ferramentas)

Nível: sênior. Produz evidência de TESTES AUTOMATIZADOS para a revisão de um Gate. Observa e reporta; não corrige, não ajusta testes, não atualiza snapshots, não muda a baseline.

## 1. Invocação e quem executa
- Skill de INVOCAÇÃO EXPLÍCITA: só executar quando o usuário ou o Gate pedir (ex.: "validar baseline", critério de aceitação do Gate). Não executar por iniciativa própria.
- Executor: Claude Code, no repositório oficial. O Cowork não executa esta skill (não tem o repositório local); ele REVISA o resultado (seção 11).
- Executar ao FINAL de Gates que alterem código ou markup. Quando a baseline vigente não tiver evidência recente no HEAD inicial e o Gate exigir, executar também na ABERTURA (antes de qualquer alteração), para distinguir falha pré-existente de regressão introduzida pelo Gate.

## 2. Baseline e sua autoridade
- Baseline vigente (valor registrado nesta skill): 397 passou / 0 falhou / 88 pulados / 0 flaky (total 485), configuração `playwright.config.js`. Os 88 pulados são `test.skip()` intencionais condicionados a viewport: 11 em `tests/responsive/sidebar-mobile.spec.js` (viewport >= 1024px) e 77 em `tests/responsive/scanner-layout.spec.js` (3 condições de viewport: fora de `CORE_VIEWPORTS`, fora de `EXTRA_STATE_VIEWPORTS` e fora de `TARGET_SIZE_VIEWPORTS`); não são falha.
- Procedência: declarada pelo usuário em 2026-10-07 (opção A), medida/derivada no HEAD 012e205.
  - Derivação: 330 − 30 (`metrics-modal.spec.js` removido) + 30×(1+2+3) (shell-layout +1, components-layout +2, scanner-layout +3 por viewport) + 5 (network-guard, projeto próprio) = 485.
  - Specs de `tests/e2e/` usam `playwright.auth.config.js` (Emulator) e não entram nesta contagem.
  - Histórico: 319/0/11 (total 330) vem do commit 71027a7 (2026-08-14) e valeu até 2026-09-20.
  - Observação: execução real em 2026-10-07 deu 396 passou / 1 flaky / 88 pulados. Baseline confirmada em 2026-10-07, HEAD 160083d, execução única (397 passou / 0 falhou / 88 pulados / 0 flaky; total 485).
  - Identidade dos 88 pulados medida em execução dedicada dos dois specs: 11 em `sidebar-mobile.spec.js` + 77 em `scanner-layout.spec.js`.
  - Instabilidade conhecida: `shell-layout.spec.js:32` [desktop-1280x800] já falhou em execução anterior (timeout de `page.goto`; passou na re-execução única) e NÃO reapareceu na execução confirmatória. Hipótese não verificada: `waitForTimeout(350)` sob 4 workers. Não declarar como resolvido; tratar pela regra da seção 4 (uma re-execução, reportar como desvio flaky).
- Autoridade para comparar (maior para menor): baseline esperada declarada no Gate vigente; baseline aprovada por decisão posterior do usuário; valor desta skill.
- A baseline só muda por decisão explícita (Gate que adiciona, remove ou reclassifica testes deve declarar a nova baseline esperada). NUNCA atualizar o número silenciosamente porque a execução deu outro resultado. Mudança de baseline aprovada é refletida propondo atualização desta skill.

## 3. Pré-condições (verificar ANTES de rodar)
1. Estado Git: executar `auditar-git` (ou equivalente) e registrar branch, HEAD e working tree. Working tree suja é permitida somente se for a do Gate; registrar o que está sujo.
2. Identificar COMO a suite é executada, lendo (não editando) `package.json` e as configurações do Playwright. O repositório tem mais de um arquivo de configuração Playwright (confirmar quais). Registrar: script npm usado, arquivo de config usado, projetos (ex.: viewports), `retries`, `workers`, `baseURL`/`webServer`.
3. NÃO assumir que `npm test` ou `npx playwright test` são a suite correspondente à baseline. `npm test` pode executar outra coisa (ex.: testes de Emulator, unit). Usar o script/config que o Gate ou a documentação do repositório associam à baseline; se não houver associação comprovada, registrar "CONFIGURAÇÃO DA BASELINE NÃO DETERMINADA" e executar a configuração padrão rotulando o resultado como possivelmente não comparável.
4. Isolamento do ambiente (obrigatório, duplo): confirmar que a aplicação E todos os serviços que ela chama (Firebase Auth/Firestore, funções/API) apontam para ambiente isolado (Firebase Emulator e servidor local). Verificar `baseURL`, `webServer`, variáveis de ambiente relevantes e a configuração do cliente Firebase. NÃO imprimir valores de .env nem chaves. Se qualquer parte apontar para produção, para o projeto legado ou para um domínio Vercel (Preview/Production), PARAR (condição de interrupção). Projeto de teste remoto (3f8f1) com escrita só se o Gate autorizar explicitamente; por padrão, apenas Emulator.
5. Dependências e navegadores: se `node_modules` ou os navegadores do Playwright estiverem ausentes, NÃO instalar por conta própria (`npm install` pode alterar lockfile; instalar navegadores usa rede e disco). Reportar BLOCKED e pedir autorização/Gate.
6. Serviços dependentes: se a suite exigir Emulator ou servidor de desenvolvimento e eles não estiverem ativos nem forem iniciados pelo próprio script (ex.: `webServer`, wrapper de emulators), só iniciá-los pelo comando documentado do repositório e se o Gate permitir; caso contrário, BLOCKED.
7. Registrar versões: Node, Playwright (`npx playwright --version`), sistema operacional (Windows) e horário de início/fim.

## 4. Execução
- Rodar a suite COMPLETA, uma vez, com o comando identificado na seção 3, usando relatório que liste cada teste e seu resultado (ex.: `--reporter=list`; o reporter `line` esconde a lista de pulados). Exemplo de formato (ajustar ao script/config reais): `npx playwright test --reporter=list`.
- Capturar: código de saída real, totais (passou, falhou, pulado, flaky, interrompido/did not run), duração, lista dos testes pulados e dos que falharam.
- Comando pode demorar: respeitar timeout do ambiente; se for interrompido por timeout, a execução é INCOMPLETA (seção 7), nunca "passou".
- PROIBIDO nesta skill: `--update-snapshots` ou `-u`; `--grep`/`--grep-invert`/arquivos específicos quando o objetivo for comparar com a baseline completa; `--shard`; `--max-failures`/`-x` (interrompe cedo e invalida contagem); `--last-failed`; alterar `retries`, `workers` ou timeouts para obter resultado; editar testes ou configuração; `test.only`/`test.skip` temporários; `npm install`, `npm ci`, `npx playwright install` sem Gate.
- Execução parcial (por filtro) é permitida para investigação somente se o Gate pedir, e deve ser rotulada "PARCIAL — NÃO COMPARÁVEL COM A BASELINE".
- Não repetir a suite até "ficar verde". Exceção: uma única re-execução dos testes que falharam, SOMENTE para classificar flakiness, reportando as duas execuções; passar na re-execução não transforma a primeira falha em sucesso, e o teste flaky é reportado como desvio.

## 5. Comparação
Comparar total, passou, falhou, pulado e flaky contra a baseline vigente (seção 2):
1. SEM DESVIO: passou = 397, falhou = 0, pulado = 88, flaky = 0, total = 485, código de saída 0, execução completa, ambiente isolado confirmado.
2. Pulados: além da contagem, verificar a IDENTIDADE: os 88 pulados devem ser os 11 de `tests/responsive/sidebar-mobile.spec.js` (viewport ≥ 1024px) mais os 77 de `tests/responsive/scanner-layout.spec.js`. 88 pulados em outros testes não são a baseline, mesmo com a mesma contagem. Quando mudar projeto/viewport da configuração, o número de pulados muda; registrar.
3. Qualquer diferença é DESVIO, inclusive a aparentemente positiva (mais passou, menos pulados, total diferente). Desvio com origem declarada no Gate (testes adicionados ou removidos) é comparado com a baseline esperada do Gate; sem declaração, é DESVIO NÃO EXPLICADO e exige análise.
4. Integridade aritmética: passou + falhou + pulado + flaky + não executado deve igualar o total; se não, a execução é suspeita (classificar INCOMPLETA).
5. Execução INCOMPLETA: saída interrompida, timeout, falha de setup global/Emulator/webServer, ou contagem sem sentido. Reportar BLOCKED ou INCOMPLETA, nunca PASS.

## 6. Reporte de falhas e desvios (sem corrigir)
Para cada falha: arquivo, linha, título do teste, projeto/viewport, tipo (asserção, timeout, erro de setup/conexão com Emulator, erro de navegador) e as primeiras linhas da mensagem (máximo ~20 linhas). Explicitamente:
- Separar FATO (saída do comando) de HIPÓTESE (causa provável). Se citar causa, marcar como hipótese.
- Relacionar com o diff do Gate apenas como correlação ou hipótese, não como conclusão, salvo comparação com execução na abertura do Gate (se houver, dizer "falha pré-existente" ou "nova no Gate" com base nela).
- Corrigir falha, ajustar teste, relaxar asserção, aumentar timeout ou atualizar snapshot está FORA do escopo; é decisão de Gate próprio.

## 7. Classificação
Esta skill fornece evidência para a campo AUTOMATED_TESTS; a classificação final do Gate pertence ao revisor.
- SEM_DESVIO: critério 1 da seção 5 atendido.
- DESVIO: lista detalhada (seção 6), com origem declarada ou NÃO EXPLICADO.
- INCOMPLETA/BLOCKED: motivo literal.
- Nunca emitir "PASS" de Gate a partir apenas desta skill, e nunca tratar "SEM DESVIO" como prova de que o comportamento está correto (a suite cobre o que cobre). Cobertura não exercida pela suite fica como PENDÊNCIA/NÃO DETERMINADO.
- AI_VISUAL_REVIEW e HUMAN_VISUAL_REVIEW não são substituídos por esta skill; testes Playwright não são revisão humana.

## 8. Outras suítes (fora desta baseline)
Esta skill cobre APENAS a suite Playwright. Testes de Firestore Rules, de API com Emulator ou unit tests têm seus próprios resultados e NÃO possuem baseline registrada aqui (NÃO DETERMINADO). Quando o Gate toca `api/`, `server/` ou `firestore.rules`, essas suítes devem ser executadas conforme o Gate e as skills correspondentes (`firebase-admin-vercel-api`, `firebase-client-security`, `tool-loan-integrity`); reportar separadamente, sem somar aos números da baseline Playwright.

## 9. Efeitos colaterais, artefatos e privacidade
- A execução não deve alterar arquivos rastreados. Após rodar, executar `auditar-git` novamente: diferenças no working tree causadas pela suite (snapshots reescritos, arquivos gerados rastreados) são achado a reportar; não reverter por conta própria.
- Artefatos (test-results, playwright-report, traces, screenshots, vídeos, storage state) podem conter dados pessoais ou sessões. Não commitar, não anexar ao REPORT, não transcrever conteúdo de tokens, cookies, e-mails ou crachás vistos em mensagens de erro ou DOM. Confirmar que os diretórios de artefatos estão ignorados pelo Git; se não estiverem, reportar como pendência.
- Mensagens de erro podem conter URLs com credenciais ou trechos de resposta de API: redigir antes de reportar (ver `secret-pii-hygiene`).
- Dados de teste devem ser sintéticos; encontrar dado que pareça real em artefato é condição de interrupção.

## 10. Condições de interrupção
Parar e pedir decisão se: ambiente não isolado ou aponta para produção, legado ou Vercel; dependência, navegador ou Emulator ausente e sua instalação não autorizada; script de teste ambiguo ou diferente da baseline sem como determinar; working tree sujo de forma inesperada após a execução; segredo ou dado pessoal real em saída ou artefato; execução que escreva em serviço remoto não autorizado; qualquer necessidade de alterar teste, configuração ou dependência para prosseguir.

## 11. Revisão pelo Cowork (conferir o REPORT)
- Existe comando exato, código de saída e saída literal dos totais? Sem isso, NÃO VERIFICADO.
- Soma aritmética fecha com o total? Pulados são os esperados (identidade)?
- Config/script usado é o associado à baseline? Isolamento duplo foi comprovado, não presumido?
- Execução foi completa e única (sem repetição até passar)? Houve flaky?
- Working tree depois da execução está como esperado?
- Desvios têm origem declarada no Gate? Se a baseline mudou, há decisão registrada?

## 12. Formato de saída (REPORT)
```
AUTOMATED_TESTS (Playwright)
  COMMAND_EXECUTED: comando literal
  CONFIG_AND_PROJECTS: arquivo de config; projetos/viewports; retries; workers
  EXIT_CODE: n
  ENVIRONMENT_ISOLATION_CONFIRMED: SIM (evidência) | NAO | NAO_DETERMINADO
  GIT_BEFORE: branch, HEAD, working tree
  GIT_AFTER: working tree (alterado pela suite: SIM|NAO)
  VERSIONS: node, playwright, SO
  RESULT: passou N / falhou N / pulado N / flaky N / total N
  ARITHMETIC_CLOSES: SIM|NAO
  SKIPPED_IDENTITY: conforme baseline (sidebar-mobile 11 + scanner-layout 77, condicionados a viewport) | DIVERGE (lista)
  RUN_COMPLETENESS: COMPLETA | INCOMPLETA (motivo) | PARCIAL_NAO_COMPARAVEL
  BASELINE_REFERENCE: valor e fonte (Gate | decisão | skill); commit de origem: CONHECIDO|NAO_DETERMINADO
  COMPARISON: SEM_DESVIO | DESVIO (origem declarada no Gate | NAO_EXPLICADO) | BLOCKED
  FAILURES: lista (arquivo:linha, título, tipo, mensagem redigida) | NENHUMA
  FLAKY: lista | NENHUM
  FIXES_ATTEMPTED: NENHUMA (obrigatório)
  ARTIFACTS_COMMITTED_OR_ATTACHED: NAO
  SENSITIVE_DATA_SEEN: NAO | SIM (sem reproduzir)
  PRODUCTION_OR_LEGACY_TOUCHED: NAO (obrigatório)
  NOT_DETERMINED: lista
```
Separar ao final FATOS CONFIRMADOS, HIPÓTESES e PENDÊNCIAS.