---
name: "tool-loan-integrity"
description: "Use ao alterar emprestimo, devolucao, status, manutencao, cracha, historico ou rate limit de ferramentas no Gestao de Ferramentas; garante integridade transacional, privacidade do Restrito e rastreabilidade."
---

# tool-loan-integrity — Integridade do ciclo de ferramentas (Gestão de Ferramentas)

Nível: sênior. Aplicar a qualquer Gate que toque `api/tools/movement.js`, `api/tools/status.js`, `api/tools/maintenance.js`, `server/admin-authorization.js`, `server/app-version.js`, o fluxo de scanner/crachá no cliente, as coleções `tools`, `collaborators`, `history`, `badgeRateLimits`, ou regras do Firestore relacionadas. Complementa (não substitui) os skills `firebase-admin-vercel-api`, `firebase-client-security` e `secret-pii-hygiene`.

## 1. Princípio de evidência deste skill
Cada afirmação técnica abaixo é CONFIRMADO (lida no código, commit 30a6103), INFERIDO ou CONFIRMAR NO CÓDIGO. O código atual SEMPRE prevalece sobre este texto: antes de basear decisão em qualquer item, reler o arquivo no HEAD vigente. Nunca citar este skill como prova de que o código faz algo.

## 2. Princípio central
A movimentação (empréstimo, devolução, manutenção) é a operação de maior valor de negócio. O servidor é a única autoridade sobre estado, identidade do colaborador, auditoria e horário. O cliente é apenas interface.

## 3. Fatos confirmados — api/tools/movement.js
1. Somente POST; outro método = 405 com `Allow: POST`.
2. Validação estrita de chaves: `hasExactKeys(Object.keys(body), expectedKeysByAction[body.action])`. Chave extra OU ausente é rejeitada. Por ação: `loan` = action, toolId, toolCode, collaboratorBadge, device; `return` = action, toolId, device, collaboratorBadge; `return_admin` = action, toolId, device, reason.
3. Perfil Restrito: `isRestrictedOperator(profile)` = `profile.isRestricted === true && profile.accessLevel !== 'Administrador'`.
4. O crachá é resolvido no SERVIDOR, dentro da transação; o cliente nunca informa collaboratorId decidido.
5. Erros genéricos para Restrito (não revelam existência de crachá, dono ou estado interno).
6. Resposta fechada via `buildToolResponse`: `{id, status, lastAction}`.
7. Rate limit de crachá: `BADGE_RATE_LIMIT_MAX_ATTEMPTS = 5` por `BADGE_RATE_LIMIT_WINDOW_MS = 60*1000`, estado em `badgeRateLimits/{uid}`.
8. Conflito de transação => 409.
9. Histórico criado na MESMA transação da mudança de status, `returnMethod` = `badge_verified` ou `administrative`.
10. `return_admin` é proibido para Restrito.
11. O servidor compara o instante exato de `nextMaintenance` para bloquear empréstimo de ferramenta com manutenção vencida (conforme comentário em status.js; confirmar a condição exata no código antes de alterá-la).

## 4. Fatos confirmados — api/tools/status.js (consulta por código)
1. Somente POST, deliberadamente: o service worker cacheia todo GET same-origin, inclusive `/api/*`, e o CacheStorage é compartilhado entre usuários do mesmo navegador. NUNCA converter para GET. O cliente envia `cache: 'no-store'`.
2. Autoriza com `requireActiveUser` (qualquer perfil ativo, incluindo Restrito). Resposta idêntica para qualquer perfil.
3. Lê apenas `body.code` (string, trim, máx. 128). NÃO usa exact-keys: chaves extras são ignoradas (diferente de movement/maintenance). Registrar como característica conhecida, não como defeito; mudar exige decisão.
4. Resposta fechada, campo a campo (nunca por remoção): `{id, code, name, category, status, imageUrl, nextMaintenance}`; não-string vira `null`; `nextMaintenance` Timestamp vira 'AAAA-MM-DD' (dia UTC). Nunca retornar currentUser, currentCollaboratorId, lastMaintenanceBy ou dados de pessoa.
5. Rate limit de consultas sem resultado: 10 falhas por 60 s por uid, documento `badgeRateLimits/tool-status:{uid}`; só 404 e 409 contam; sucesso não grava. Só uid, contagem e janela; nunca o código consultado. Resposta 429 com `code: 'TOOL_LOOKUP_RATE_LIMITED'`.
6. 404 = não encontrada; 409 = patrimônio duplicado; `status` não textual no documento => 500 genérico e log apenas com o id do documento.
7. A verificação do rate limit (`assertLookupRateLimit`) lê fora de transação e `registerLookupFailure` grava em transação: sob concorrência pode haver pequena folga acima do limite. Aceito como característica atual; endurecer exige decisão.

## 5. Fatos confirmados — api/tools/maintenance.js
1. Somente POST; `requireActiveAdmin` (somente Administrador).
2. Exact-keys: toolId, performedAt, nextMaintenance, notes, device.
3. Datas 'AAAA-MM-DD' validadas por calendário; `performedAt` não pode ser futura (fuso America/Sao_Paulo); `nextMaintenance` não pode ser anterior a `performedAt`; notes até 1000; device até 160.
4. Transação: ferramenta inexistente 404; ferramenta com status 'borrowed' => 409 (não registra manutenção de ferramenta emprestada); atualiza ferramenta para `available`, zera currentUser/currentCollaboratorId e registra `history` type 'maintenance' com operatorUid/operatorEmail, ip e device na mesma transação.
5. IP vem de `x-forwarded-for` (primeiro valor) ou `x-real-ip`, sem caracteres de controle, máx. 128. É informativo, nunca base de autorização. Dado pessoal em auditoria (S1).
6. `parseRequestBody` aceita string JSON; outros endpoints podem divergir.

Não verificado (CONFIRMAR NO CÓDIGO): `api/session/last-login.js`, `api/users/*`, `api/backup/*` (método HTTP aceito); regras de campos congelados em `firestore.rules`; tratamento de 409/429 no scanner do cliente; testes de emulador existentes.

## 6. Invariantes obrigatórios
Qualquer alteração deve preservá-los. Se não puder, interromper (seção 25).
1. Atomicidade: leitura do estado, validação, escrita do status e criação do histórico na mesma transação Firestore. Proibido dividir em escritas sequenciais.
2. Máquina de estados explícita. Estados conhecidos pelo código: `available`, `borrowed` (confirmar demais no código). Transições válidas: loan somente de disponível; return somente de emprestada; manutenção somente de não emprestada. Transição inválida = erro sem nenhuma escrita. Novo estado exige tabela de transições e decisão.
3. Devolução por crachá: o crachá resolve para o MESMO colaborador que detém a ferramenta; divergência = erro genérico + conta no rate limit.
4. Idempotência: repetição (clique duplo, retry de rede) não gera dois históricos nem corrompe estado; a defesa é reler o estado atual dentro da transação.
5. Histórico append-only: nenhum endpoint de movimentação edita ou apaga `history` (criação com `transaction.create`, que falha se já existir).
6. Rate limit falha fechado: erro ao consultar o contador nega a operação, nunca libera.
7. Restrito nunca recebe nome de colaborador, dados de outras ferramentas, existência de crachá ou campos extras.
8. Autorização encadeada: verifyIdToken, perfil em `users/{uid}`, status 'Ativo', e-mail conferido (ver `firebase-admin-vercel-api`).
9. Auditoria preenchida pelo servidor (uid, e-mail, instante `new Date()` do servidor, ip, método); do cliente aceita-se apenas `device` informativo, com limite de tamanho.
10. Contratos de resposta fechados e construídos campo a campo; campo novo em `tools` não pode vazar por omissão de filtro.
11. Mensagens de erro ao cliente são estáticas; exceções internas só em log do servidor, sem PII.
12. Fuso: datas de negócio em America/Sao_Paulo; comparação de manutenção consistente entre status.js (UTC date), maintenance.js (Sao_Paulo) e movement.js (instante). Qualquer mudança em referência de data exige teste de fronteira (virada de dia, 21h-03h).

## 7. Modelo de dados (conforme código)
Caminho base hardcoded `artifacts/gestao-de-ferramentas-3f8f1/public/data/{tools,collaborators,users,history,badgeRateLimits}` no cliente e no servidor. Mudar caminho/projeto exige decisão e atualização coordenada de cliente, servidor, regras e testes. Campos conhecidos em `tools`: code, name, category, status, imageUrl, currentUser, currentCollaboratorId, lastAction, lastMaintenance, nextMaintenance, lastMaintenanceNotes, lastMaintenanceBy. `imageUrl` é data URL JPEG (tamanho do documento Firestore é limite prático: 1 MiB; confirmar compressão no cliente).

## 8. Padrões de risco a investigar em toda mudança
- Dupla escrita fora de transação.
- Resposta ou mensagem que permita enumerar crachás ou patrimônios (oráculo).
- Rate limit contornável por trocar de uid, endpoint, ou reiniciar janela; contador compartilhado indevidamente entre endpoints (hoje distintos por prefixo de chave).
- Uso de relógio do cliente.
- Endpoint novo sem `Allow`, sem exact-keys, ou aceitando GET (cache do SW).
- Retorno administrativo sem `reason` auditado.
- Mudança de formato do histórico quebrando relatórios/exportações/backup.
- Atualização do documento da ferramenta que quebre a regra do Firestore (campos congelados) ou o listener do cliente.
- Documento de colaborador com crachá duplicado (ambiguidade): definir comportamento seguro (negar) e testar.
- Ferramenta com código duplicado (409 em status.js): fluxo de movimentação deve tratar de forma coerente.
- Perfis legados sem `isRestricted` tratados como Padrão: preservar.

## 9. Privacidade e dados
- Crachá, nome, matrícula, IP e e-mail são dados pessoais (S1). Nunca em REPORT, commit, teste, screenshot, log. Testes usam dados fictícios gerados.
- Logs: apenas ids técnicos de documento e códigos de erro; nunca corpo da requisição, crachá ou nome.
- O projeto 3f8f1 é ambiente de teste com dados fictícios; produção real não existe ainda; o projeto Firebase legado (nome informado no Gate) intocado.

## 10. Testes mínimos (Emulator, sintéticos; nunca produção)
Para cada alteração relevante, cobrir com assertions sobre o ESTADO no Firestore (não só HTTP):
- loan feliz; loan em ferramenta emprestada; loan com manutenção vencida (bloqueado).
- return feliz com crachá correto; crachá de outro colaborador (erro genérico, rate limit incrementa).
- return_admin por Administrador (ok, `administrative`) e por Restrito (negado).
- corpo com chave extra/ausente em movement e maintenance (400); status.js com chave extra (ignorada, comportamento atual).
- método diferente de POST (405 + Allow) em cada endpoint.
- 6ª tentativa de crachá na janela (bloqueada); após a janela (liberada). 11ª consulta inexistente em status.js (429).
- duas requisições concorrentes na mesma ferramenta: exatamente uma vence e exatamente um histórico.
- manutenção de ferramenta emprestada (409), data futura (400), next anterior a performed (400).
- token inválido, usuário inativo, e-mail divergente, perfil inexistente (negados).
- resposta do Restrito contém somente os campos fechados; inspecionar chaves, não só valores.
- documento de ferramenta com `status` não string (500 genérico sem vazar conteúdo).
- Playwright: fluxo de scanner do Restrito de ponta a ponta com dados fictícios.

## 11. Interação com o cliente
- Cliente envia `X-App-Version` (confirmar) e `cache: 'no-store'` nas chamadas de API. `logOutdatedClientVersion` apenas observa; nunca rejeita. Não transformar em bloqueio sem decisão.
- Alteração de contrato da API (campos, códigos, mensagens) exige compatibilidade com a versão anterior do cliente durante a janela de atualização do PWA (ver `pwa-release-safety`).
- O cliente não deve ser o único bloqueio de regra de negócio; toda regra deve ser reforçada no servidor.

## 12. Escopo e governança
- Mudança de regra de negócio (quem pode emprestar, prazos, bloqueios por manutenção, estados), de modelo de dados, de semântica do Restrito ou de contratos de resposta exige decisão explícita do usuário ANTES do Gate.
- Não ampliar respostas, não afrouxar validação, não remover rate limit, não mover lógica para o cliente.
- Descobertas fora do Gate viram PENDÊNCIA com evidência (arquivo, linha, comportamento).
- Anti-overengineering: correção localizada; sem frameworks de validação ou camadas novas sem benefício demonstrado.
- Plano, REPORT e este skill não autorizam execução; só Gate explícito.

## 13. Operações sobre dados
- Nenhuma escrita em produção ou no legado. Seed/reset/restore apenas com Gate específico e no Emulator ou no 3f8f1 conforme decisão vigente.
- Correção de dados inconsistentes (ex.: ferramenta emprestada sem colaborador) é migração: Gate próprio, dry-run, backup lógico, reversão definida.

## 14. Condições de interrupção
Parar a parte afetada e pedir decisão se: a correção exigir separar transação; mudar contrato de resposta; permitir Restrito ler tools/collaborators por cliente; divergir firestore.rules e API; teste invalidar premissa do modelo; ser necessário tocar produção, legado, regras ou autenticação; aparecer dado pessoal real ou segredo; encontrar GET autenticado em `/api/`.

## 15. Chaves do REPORT
TRANSACTION_ATOMICITY: PASS|FAIL|NAO_VERIFICADO
STATE_MACHINE_VALIDATED: SIM|NAO
IDEMPOTENCY_CONCURRENCY_TESTED: SIM|NAO
EXACT_KEYS_VALIDATION_PRESERVED: SIM|NAO (listar endpoints)
RESPONSE_CONTRACT_UNCHANGED: SIM|NAO (se NAO, citar decisão)
RATE_LIMITS_PRESERVED: SIM|NAO
RESTRICTED_NO_LEAK: PASS|FAIL|NAO_VERIFICADO
HISTORY_APPEND_ONLY: SIM|NAO
SERVER_AUTHORITATIVE_AUDIT_FIELDS: SIM|NAO
POST_ONLY_PRESERVED: SIM|NAO
DATE_BOUNDARY_TESTED: SIM|NAO|NAO_APLICAVEL
PII_IN_LOGS_OR_REPORT: NAO|SIM
SYNTHETIC_DATA_ONLY: SIM|NAO
PRODUCTION_TOUCHED: NAO (obrigatório)
LEGACY_PROJECT_TOUCHED: NAO (obrigatório)

## 16. Critério de PASS
PASS exige todos os invariantes da seção 6 comprovados por teste em Emulator com assertions de estado, evidência de saída real dos testes, produção e legado intocados e nenhum dado pessoal no REPORT. Qualquer invariante não comprovado limita a classificação a PASS COM RESSALVAS ou PARTIAL, com PENDÊNCIA registrada. Revisão por IA nunca é apresentada como revisão humana.