---
name: "firebase-client-security"
description: "Revisão de segurança do Firebase Client SDK, Firestore Rules, perfis Admin/Padrão/Restrito e compatibilidade cliente/Rules. Usar em Gates com firestore.rules, listeners, queries, testes no Emulator ou publicação de Rules."
---

# Segurança do cliente Firebase — Rules e perfis

## 1. Objetivo

Garantir que o acesso feito pelo Firebase Client SDK respeite:

- autenticação;
- autorização por perfil;
- princípio do menor privilégio;
- isolamento entre Admin, Padrão e Restrito;
- invariantes de negócio;
- proteção contra acesso direto indevido;
- compatibilidade entre cliente e Rules;
- ausência de contato acidental com Firebase real durante testes;
- rastreabilidade da versão das Rules publicadas.

Esta skill trata exclusivamente da superfície controlada pelas
Firestore Security Rules e pelo Firebase Client SDK.

Ela NÃO substitui a revisão server-side.

Firebase Admin SDK ignora Firestore Security Rules.

Quando uma funcionalidade também passar por Vercel Functions/Admin SDK,
acionar adicionalmente:

`firebase-admin-vercel-api`

Quando houver dados pessoais, tokens, logs ou credenciais, acionar:

`secret-pii-hygiene`

---

# 2. Fonte de verdade

Antes de afirmar qualquer comportamento, reler o código atual.

No mínimo, quando aplicável:

- `firestore.rules`
- `src/js/config/constants.js`
- módulos cliente que criam listeners ou queries
- módulos de autenticação/perfil
- módulos de ferramentas
- módulos de colaboradores
- Scanner
- testes de Rules
- configuração do Firebase Emulator

Não assumir que esta skill descreve para sempre o estado do código.

Toda revisão deve distinguir:

`CONFIRMADO_NO_CODIGO`

`CONFIRMADO_POR_TESTE`

`DECISAO_DE_PROJETO`

`INFERIDO`

`NAO_DETERMINADO`

---

# 3. Modelo atual de perfis

Confirmar novamente antes de usar como evidência.

## Admin

Nas Rules atuais, Admin é identificado por:

`accessLevel == 'Administrador'`

e perfil ativo.

Um Admin com:

`isRestricted == true`

continua sendo tratado como Admin pelas Rules atuais.

Portanto:

`isRestricted=true`

não deve, por si só, ser interpretado como restrição de um Administrador.

Não alterar essa precedência sem Gate próprio.

---

## Padrão

Perfil ativo não Administrador e não Restrito.

O perfil legado que não possui o campo:

`isRestricted`

é atualmente interpretado como não restrito porque a Rule utiliza valor
default `false`.

Esse comportamento deve possuir teste de regressão.

---

## Restrito

Perfil não Administrador com:

`isRestricted == true`

e status ativo.

Pela decisão B1:

- não lê `tools` diretamente pelo cliente;
- não lê `collaborators` diretamente pelo cliente;
- consulta ferramenta através de:
  `POST /api/tools/status`;
- movimentações passam por API server-side.

Não tentar "corrigir" permission-denied do Restrito tornando a Rule mais
permissiva.

Primeiro verificar se o cliente está tentando realizar uma leitura que não
deveria existir.

---

## Inativo

Não assumir que "inativo não acessa absolutamente nada".

Verificar cada match individualmente.

As Rules atuais possuem contratos diferentes para:

- `users`;
- `tools`;
- `collaborators`;
- `history`.

Por exemplo, o acesso ao próprio documento em `users` deve ser auditado
separadamente do acesso às coleções operacionais.

---

## Anônimo

Nenhum acesso deve ser presumido.

Confirmar por coleção e operação.

---

## Frescor do perfil nas Rules

As Rules leem o documento de perfil no momento de cada requisição (via
`get()`). Isso significa que alterar `status`, `accessLevel` ou `isRestricted`
no perfil tem efeito imediato nas Rules, independentemente de o ID token do
usuário ainda estar válido. Isso difere do servidor (`verifyIdToken` sem
verificação de revogação, a confirmar no código). Ao revisar desativação de
conta, avaliar as duas camadas separadamente e registrar a diferença.

---

# 4. Matriz de autorização

Toda alteração de Rules deve produzir ou atualizar uma matriz explícita.

Para cada combinação:

- perfil;
- coleção;
- operação;

registrar:

`ALLOW`

`DENY`

`NAO_APLICAVEL`

`NAO_DETERMINADO`

Perfis mínimos:

- Admin ativo;
- Admin ativo com `isRestricted=true`;
- Padrão ativo;
- Padrão legado sem `isRestricted`;
- Restrito ativo;
- Restrito inativo;
- anônimo.

Operações mínimas:

- get;
- list/query;
- create;
- update;
- delete.

Coleções mínimas:

- users;
- tools;
- collaborators;
- history;
- qualquer nova coleção adicionada ao namespace operacional.

Não declarar segurança de uma coleção que não foi incluída na matriz.

---

# 5. Estado atual relevante das Rules

Confirmar novamente antes de cada Gate.

## users

Auditar separadamente:

- leitura do próprio perfil;
- leitura de perfil alheio;
- listagem;
- create;
- update;
- delete.

Não inferir que `hasActiveProfile()` é usado em todos os casos apenas porque
a função existe.

### Escalonamento de privilégio (obrigatório)

A coleção `users` é o ponto mais sensível: quem escreve nela altera a
autorização de todas as outras. Para qualquer alteração de Rules ou revisão de
segurança, testar e registrar:

- Padrão e Restrito NÃO conseguem atualizar o próprio `accessLevel`,
  `isRestricted` ou `status`;
- nenhum perfil não Admin consegue CRIAR o próprio documento de perfil com
  `accessLevel` de Administrador;
- nenhum perfil não Admin consegue deletar ou recriar o próprio perfil para
  contornar restrições;
- usuário autenticado sem documento de perfil não acessa dados operacionais;
- um Admin não consegue, por cliente, deixar o sistema sem Admin ativo (se esse
  invariante existir no contrato; caso contrário registrar NAO_DETERMINADO).

Se o contrato atual delegar essas escritas ao servidor (Admin SDK), o teste
correto é o DENY pelo cliente. Registrar qual caminho está em vigor.

---

## tools

A política atual possui dois controles distintos:

### Leitura

A leitura utiliza atualmente:

`canReadCollaborators()`

apesar de a função também ser usada para `tools`.

O nome é semanticamente impreciso.

Isso é dívida estética/refatoração.

NÃO renomear como parte de outro Gate sem autorização.

### Escrita

Admin ainda possui determinadas escritas via cliente.

Não afirmar:

"toda escrita em tools passa pela API".

O contrato atual diferencia:

- manutenção/metadados permitidos em certas condições;
- criação de ferramenta `borrowed` negada;
- transição direta para `borrowed` negada;
- campos de empréstimo congelados enquanto borrowed;
- delete de borrowed negado.

Movimentação oficial de empréstimo/devolução passa pela API/Admin SDK.

---

## collaborators

Leitura:

- Admin ativo: permitida;
- Padrão ativo: permitida;
- legado ativo: permitida;
- Restrito: negada.

Escrita atual por cliente deve ser verificada no código vigente antes de
afirmar; atualmente Admin possui permissão.

---

## history

Não presumir acesso pelo cliente para qualquer perfil.

Verificar especificamente leitura e escrita de Admin e negação dos demais.

---

# 6. Regra default-deny

O namespace deve manter política final equivalente a:

`allow read, write: if false`

para caminhos não explicitamente autorizados.

Ao adicionar nova coleção:

não depender apenas do fallback como documentação suficiente.

Adicionar teste explícito para a nova superfície.

---

# 7. Firestore Rules não são filtros

Regra fundamental:

**Security Rules não filtram resultados de query.**

Uma query precisa ser compatível com as condições de autorização aplicáveis ao
conjunto potencial de documentos.

Por isso testar separadamente:

- get por ID;
- list;
- query com where;
- query com limit;
- collectionGroup;
- documento existente;
- documento inexistente.

Não considerar um `get()` autorizado como prova de que uma query também está
autorizada.

---

# 8. Funções compartilhadas de Rules

Antes de alterar qualquer função usada em Rules:

1. localizar TODAS as chamadas;
2. listar matches afetados;
3. construir mapa antes/depois;
4. revisar efeito por perfil;
5. executar testes de todas as coleções afetadas.

Exemplos atuais:

- `signedIn()`
- `userProfilePath()`
- `hasActiveProfile()`
- `isAdmin()`
- `canReadCollaborators()`
- `isBorrowed()`

Uma alteração aparentemente local em:

`canReadCollaborators()`

pode modificar simultaneamente:

- collaborators;
- tools.

Nunca revisar apenas o match que motivou a alteração.

---

# 9. Missing fields e compatibilidade legada

Firestore Rules precisam tratar explicitamente documentos antigos.

Quando um campo de autorização puder faltar:

verificar comportamento de ausência.

Exemplo atual:

`isRestricted`

possui compatibilidade com perfil legado através de valor default.

Antes de tornar um campo obrigatório:

- verificar dados existentes;
- atualizar fixtures;
- testar documento sem o campo;
- avaliar rollout.

Não converter ausência de campo em deny/allow sem decisão consciente.

---

# 10. Separação entre perfil e dados fornecidos pelo cliente

Nunca confiar para autorização em campo enviado pelo navegador como:

- accessLevel;
- isRestricted;
- isAdmin;
- role;
- status do usuário.

A decisão de Rules deve utilizar:

- `request.auth`;
- documento de perfil confiável;
- estado persistido autorizado.

UI ocultando uma tela não é mecanismo de segurança.

---

# 11. Escritas e invariantes

Para cada escrita autorizada pelo cliente, revisar:

- quem pode escrever;
- quais campos podem mudar;
- quais campos devem permanecer imutáveis;
- estado anterior;
- estado posterior;
- transições válidas.

Avaliar uso de:

`request.resource.data`

`resource.data`

e, quando apropriado:

`diff().affectedKeys()`

Não introduzir allowlist de campos ou `diff()` automaticamente fora do Gate.

Validar também tipo e formato do que é gravado (por exemplo, `is string`,
`is timestamp`, limites de tamanho) quando o contrato exigir; ausência dessas
validações é um achado a registrar, não a corrigir fora do Gate.

---

# 12. Integridade de empréstimo

Preservar como contrato de segurança:

- cliente não cria ferramenta já `borrowed`;
- cliente não move ferramenta diretamente para `borrowed`;
- campos operacionais do empréstimo ficam congelados enquanto borrowed;
- delete de borrowed é negado;
- fluxo oficial de empréstimo/devolução ocorre via API/Admin SDK.

Campos atualmente protegidos devem ser confirmados no arquivo de Rules.

Não adicionar/remover campo dessa lista sem análise de invariantes.

---

# 13. Admin SDK não é testado pelas Rules

Quando um teste usar Admin SDK para seed ou para simular operação oficial:

registrar explicitamente:

`ADMIN_SDK_BYPASSES_RULES=SIM`

Um write realizado com Admin SDK não demonstra que a Rule permite a operação.

Testes precisam distinguir:

- seed administrativo;
- acesso real do cliente;
- simulação de backend oficial.

No harness de testes de Rules (`@firebase/rules-unit-testing`), o mesmo vale
para o contexto com Rules desativadas (`withSecurityRulesDisabled`): é para
seed, nunca para provar autorização.

---

# 14. Client-side capability gating

Rules e cliente precisam permanecer coerentes.

Antes de restringir leitura:

localizar no cliente:

- listeners;
- `getDoc`;
- `getDocs`;
- queries;
- collectionGroup;
- retries;
- preload;
- dashboard;
- Scanner;
- caches.

Se o cliente ainda tenta abrir listener proibido:

a alteração está incompleta mesmo que a Rule esteja correta.

Registrar:

`CLIENT_RULES_COMPATIBILITY=<PASS | FAIL | NAO_DETERMINADO>`

---

# 15. Perfil Restrito e B1

Para o Restrito:

não deve existir listener persistente de:

- tools;
- collaborators;

quando B1 estiver ativo.

O fluxo deve usar a superfície server-side autorizada.

Ao revisar:

1. identificar como `isRestricted` chega ao estado do cliente;
2. verificar condicionais que impedem listeners;
3. verificar Scanner;
4. verificar logout/troca de perfil;
5. verificar fallback de erro;
6. verificar cache/local state residual.

Não alterar B1 sem decisão explícita.

---

# 16. `permission-denied`

Nunca tratar automaticamente:

`permission-denied`

como bug das Rules.

Diagnóstico obrigatório:

1. qual perfil?
2. qual operação?
3. qual caminho?
4. Rule esperava allow ou deny?
5. cliente deveria estar fazendo essa chamada?
6. cliente está desatualizado?
7. projeto Firebase correto?
8. Rules publicadas correspondem ao código?

Somente depois classificar:

`RULE_BUG`

`CLIENT_BUG`

`STALE_CLIENT`

`WRONG_FIREBASE_TARGET`

`EXPECTED_DENY`

`NAO_DETERMINADO`

---

# 17. PWA e clientes desatualizados

Este projeto possui PWA/Service Worker.

Mudança de Rules pode atingir cliente ainda executando código anterior.

Antes de publicar Rule mais restritiva:

avaliar:

- listeners do cliente antigo;
- chamadas API antigas;
- cache;
- versão do service worker;
- comportamento de atualização;
- risco de retry em loop;
- mensagens ao usuário.

Não assumir que atualizar Rules e fazer refresh garante imediatamente código
novo.

Quando necessário, Gate deve definir estratégia de compatibilidade.

---

# 18. Testes exclusivamente no Emulator

Testes mutáveis de Rules devem utilizar:

- Firestore Emulator;
- Auth Emulator;
- dados sintéticos.

Nunca usar projeto Firebase real para provar allow/deny.

Registrar:

`REAL_FIREBASE_CONTACTS=0`

somente quando houver evidência real da execução.

A simples intenção de usar emulator não é suficiente.

---

# 19. Matriz mínima de testes

Cobrir pelo menos:

### Admin ativo

- get/list permitido onde previsto;
- writes permitidos onde previsto;
- writes proibidos por invariantes;
- history conforme contrato.

### Admin com isRestricted=true

Confirmar que continua com semântica de Admin.

### Padrão ativo

- leituras previstas;
- nenhuma escrita administrativa;
- sem acesso a history quando não previsto;
- sem listagem administrativa de users;
- sem escalonamento de privilégio em `users` (seção 5).

### Padrão legado

Documento sem `isRestricted`.

Deve preservar contrato aprovado.

### Restrito ativo

Confirmar deny de:

- tools get;
- tools list;
- collaborators get;
- collaborators list;
- query por crachá;
- query por nome;
- collectionGroup;
- history;
- perfil alheio;
- client writes;
- auto-promoção em `users`.

E confirmar somente acessos explicitamente permitidos.

### Restrito inativo

Testar cada coleção relevante.

Não resumir como "tudo negado" sem teste correspondente.

### Anônimo

Testar cada superfície relevante.

### Autenticado sem perfil

Usuário autenticado sem documento em `users`: deve ter deny nas coleções
operacionais.

---

# 20. Testes negativos

Todo allow relevante precisa de pelo menos um deny complementar quando isso
representar fronteira de segurança.

Exemplo:

- Admin pode;
- Padrão não pode.

ou:

- Padrão pode ler;
- Restrito não pode.

Não testar apenas happy path.

Um deny só prova algo se falhar pelo motivo certo. Ao usar `assertFails`,
confirmar que o erro é `permission-denied` e não outro (documento mal formado,
query inválida, índice ausente, erro de rede/emulador). Um teste de negação
que passa por erro irrelevante é falso positivo.

---

# 21. Teste de sensibilidade da alteração

Para mudança de autorização relevante, exigir evidência de que o teste realmente
detecta a diferença.

Quando tecnicamente viável:

1. executar contra Rule nova → PASS;
2. executar cenário de regressão contra Rule anterior ou variante revertida;
3. confirmar que o teste relevante FALHA.

Isso evita teste que passa independentemente da mudança.

Não modificar a Rule publicada para realizar esse teste.

Usar somente ambiente local/emulador.

Como evidência complementar, o Firestore Emulator pode gerar relatório de
cobertura das Rules (linhas e expressões avaliadas) após a suíte. É indício de
lacuna, não prova de segurança: cobertura alta não substitui a matriz da
seção 4.

Registrar:

`REGRESSION_SENSITIVITY_TEST=<PASS | NAO_EXECUTADO | NAO_APLICAVEL>`

---

# 22. Cobertura de congelamento

Preservar testes de integridade de ferramenta emprestada.

No mínimo verificar:

- create borrowed negado;
- available -> borrowed direto negado;
- borrowed -> available direto negado quando fluxo oficial deve ser API;
- borrowed -> maintenance negado quando aplicável;
- campos operacionais congelados;
- metadados autorizados permanecem editáveis se esse for o contrato;
- delete borrowed negado;
- Standard não escreve;
- Restrito não escreve.

Não reduzir esses testes para simplificar nova Rule.

---

# 23. Test isolation

Cada teste deve evitar depender de estado residual de outro teste.

Quando compartilhar fixtures por performance:

- documentar;
- restaurar estado mutado;
- utilizar `try/finally` quando necessário;
- evitar ordem implícita.

Usar limpeza do emulador entre cenários quando o harness oferecer
(por exemplo, `clearFirestore`).

Falha intermediária não deve contaminar cenário seguinte.

---

# 24. Contato de rede

O harness deve monitorar tentativa de conexão não local quando possível.

Ao final:

`REAL_FIREBASE_CONTACTS=0`

é requisito para testes classificados como puramente emulador.

Qualquer contato remoto inesperado:

`STATUS=BLOCKED`

Não continuar para publicação.

---

# 25. Target Firebase

Antes de qualquer execução ou publicação, confirmar:

- projeto lógico esperado;
- `.firebaserc`;
- `firebase.json`;
- CLI target;
- argumento `--project`;
- namespace hardcoded nas Rules.

Não confiar apenas no projeto default da CLI.

---

# 26. Namespace hardcoded e futuro multiempresa

As Rules atuais contêm namespace associado ao ambiente atual.

Isso cria acoplamento entre:

- Rules;
- projeto;
- caminho dos documentos.

Para futuro Firebase de produção:

não assumir que o mesmo arquivo pode simplesmente ser publicado sem revisão.

Registrar:

`RULES_NAMESPACE_ALIGNMENT=<PASS | FAIL | NAO_DETERMINADO>`

Não generalizar ou substituir caminhos automaticamente.

Se o produto evoluir para múltiplas empresas no mesmo projeto, o modelo atual
(namespace único e perfis globais) NÃO oferece isolamento entre empresas. Isso
exige decisão arquitetural própria (ADR), reescrita de Rules com identificador
de empresa e testes de negação entre empresas. Até lá, o isolamento é por
projeto Firebase separado.

---

# 27. Mudança de Rules

Qualquer mudança em `firestore.rules` exige Gate próprio ou autorização
explicitamente incluída no Gate ativo.

Antes de editar:

- registrar hash atual;
- registrar Git status;
- registrar branch/HEAD;
- confirmar target;
- identificar funções e matches afetados.

Depois de editar:

- revisar diff;
- confirmar que somente mudanças autorizadas ocorreram;
- executar testes do Emulator;
- confirmar `REAL_FIREBASE_CONTACTS=0`.

---

# 28. Publicação por ambiente

Não classificar toda publicação de Rules como Production.

Classificar primeiro:

`RULES_TARGET_ENV=<TESTE | LEGADO | PRODUCAO | NAO_DETERMINADO>`

## Ambiente de testes

`gestao-de-ferramentas-3f8f1`

é ambiente de testes com dados fictícios.

Publicação de Rules nele:

- é mudança mutável de infraestrutura;
- exige Gate/autorização explícita;
- exige projeto explícito;
- não é deploy de Production.

## Legado

O projeto Firebase legado (nome informado no Gate)

permanece intocado.

Não publicar Rules.

## Produção futura

Qualquer futuro projeto Firebase real de produção exige Gate de Production.

---

# 29. Comando de publicação

Quando explicitamente autorizado:

usar projeto explícito.

Exemplo estrutural:

`firebase deploy --only firestore:rules --project <PROJETO_AUTORIZADO>`

Nunca executar:

`firebase deploy`

genérico quando somente Rules estiverem autorizadas.

Em PowerShell, se política de execução impedir `firebase.ps1`, usar
`firebase.cmd`.

Não alterar política de execução do Windows para contornar isso.

A publicação é executada pelo usuário com a própria autenticação da CLI; o
Claude Code prepara os comandos, não publica.

---

# 30. Preflight obrigatório de publicação

Antes de publicar:

`GIT_STATUS_CLEAN_OR_EXPLAINED`

`RULES_LOCAL_HASH=<hash>`

`RULES_DIFF_REVIEW=PASS`

`RULES_TESTS=PASS`

`REGRESSION_SENSITIVITY_TEST=<PASS | NAO_APLICAVEL>`

`REAL_FIREBASE_CONTACTS=0`

`RULES_TARGET_ENV=<ambiente>`

`RULES_TARGET_PROJECT=<identificador sanitizado conforme política do projeto>`

`CLIENT_RULES_COMPATIBILITY=PASS`

Qualquer item crítico não confirmado:

não publicar.

---

# 31. Evidência da Rule anterior

Antes da publicação autorizada:

registrar identificação da versão atualmente publicada.

Preferir:

- ruleset/release identificável;
- timestamp;
- referência administrativa disponível;
- hash do texto anterior obtido do arquivo versionado correspondente.

Isso é ponto de rollback.

Não sobrescrever a única evidência da versão anterior.

---

# 32. Pós-publicação

Depois de publicação autorizada:

1. confirmar resultado do comando;
2. confirmar target correto;
3. reler a Rule efetivamente publicada;
4. comparar com o arquivo esperado;
5. registrar versão/release publicada;
6. manter referência à versão anterior.

Não declarar igualdade apenas porque o deploy retornou sucesso.

A propagação das Rules não é necessariamente instantânea: se a verificação
funcional imediata falhar, repetir após um intervalo curto antes de concluir
que a publicação falhou. Clientes com listeners abertos podem receber erro de
permissão no momento da troca.

---

# 33. Comparação de hash pós-publicação

Hash byte a byte só é válido quando o conteúdo recuperado preserva exatamente
os mesmos bytes.

Se Console/API normalizar:

- line endings;
- whitespace;
- encoding;

não declarar hash divergente como Rule divergente sem investigar.

Preferir:

1. hash do artefato local exato;
2. comparação textual normalizada quando necessário;
3. diff semântico/manual;
4. identificação do ruleset publicado.

Registrar qual método foi usado.

---

# 34. Rollback

Rollback de Rules também é alteração mutável.

Não executar automaticamente.

Quando Gate exigir plano de rollback, registrar:

- versão anterior;
- artefato anterior;
- target;
- comando planejado;
- condição objetiva de rollback;
- autoridade que pode acioná-lo.

A existência do plano não autoriza execução.

---

# 35. Listener lifecycle

Ao mudar autorização de leitura, verificar:

- criação do listener;
- unsubscribe;
- mudança de perfil;
- logout;
- re-login;
- navegação;
- reconnect de rede.

Listener proibido que permanece ativo pode produzir:

- permission-denied;
- retries;
- erro de UI;
- leak de estado antigo;
- comportamento inconsistente.

---

# 36. Offline persistence e cache local

Firestore/PWA podem manter estado no cliente.

Revisar quando relevante:

- IndexedDB;
- memória;
- CacheStorage;
- estado global;
- dados renderizados antes da troca de perfil.

Rules impedem nova leitura remota, mas não devem ser tratadas como mecanismo
único para apagar dados já presentes no dispositivo.

Mudança de perfil precisa considerar limpeza de estado sensível.

---

# 37. Security Rules como boundary, não UX

Rules são controle de segurança.

Não utilizar Rules para substituir:

- mensagem de UX;
- esconder componente;
- feature flag;
- validação de formulário.

Da mesma forma, UX não substitui Rules.

Ambos precisam estar coerentes.

A configuração Firebase Web do cliente (incluindo a API key) é pública por
desenho e não é autorização. A fronteira de segurança do cliente são as Rules.
Restrições da API key no Google Cloud e App Check são camadas de endurecimento
adicionais; verificar o estado atual é NAO_DETERMINADO até leitura do console,
e alterá-las exige Gate.

---

# 38. Custos e access calls

Funções com:

`exists()`

e:

`get()`

podem gerar document access calls das Rules.

Há limite de chamadas de acesso a documentos por avaliação de requisição (da
ordem de 10 para leituras e queries de documento único e 20 para leituras
múltiplas, transações e escritas em lote; confirmar os valores na
documentação vigente). Estourar o limite faz a requisição falhar com
`permission-denied`, o que pode ser confundido com bug de regra.

Ao aumentar complexidade:

- avaliar número de acessos;
- evitar chamadas redundantes desnecessárias;
- respeitar limites do Firestore Rules engine.

Não fazer micro-otimização sem evidência de problema.

Segurança tem prioridade sobre economia prematura.

---

# 39. Performance não justifica afrouxar autorização

Não tornar Rule mais permissiva para:

- evitar erro de query;
- reduzir access call;
- simplificar listener;
- melhorar tempo de carregamento.

Se segurança e performance entrarem em conflito:

registrar trade-off e pedir decisão.

---

# 40. Condições de interrupção

Interromper o Gate quando ocorrer:

- target Firebase inesperado;
- contato com Firebase real em teste de Emulator;
- Rule permitir acesso que deveria ser negado;
- teste crítico deixar de detectar regressão;
- cliente ainda abrir listener proibido;
- necessidade de publicar no legado;
- necessidade de publicar em Production sem autorização;
- dados reais no ambiente de testes;
- namespace incompatível;
- comportamento diferente do modelo de perfis aprovado;
- mudança compartilhada com impacto não analisado;
- possível escalonamento de privilégio em `users`;
- dúvida se deny é esperado ou regressão.

Registrar:

`STATUS=BLOCKED`

e pedir decisão.

---

# 41. REPORT obrigatório

Quando esta skill participar de um Gate, registrar quando aplicável:

`RULES_REVIEW=<PASS | FAIL | PARTIAL | NAO_APLICAVEL>`

`RULES_TARGET_ENV=<TESTE | LEGADO | PRODUCAO | NAO_DETERMINADO>`

`RULES_NAMESPACE_ALIGNMENT=<PASS | FAIL | NAO_DETERMINADO>`

`PROFILE_MATRIX_REVIEW=<PASS | FAIL | PARTIAL>`

`ADMIN_PROFILE=<PASS | FAIL | NAO_DETERMINADO>`

`STANDARD_PROFILE=<PASS | FAIL | NAO_DETERMINADO>`

`LEGACY_PROFILE=<PASS | FAIL | NAO_DETERMINADO>`

`RESTRICTED_PROFILE=<PASS | FAIL | NAO_DETERMINADO>`

`INACTIVE_PROFILE=<PASS | FAIL | NAO_DETERMINADO>`

`ANONYMOUS_PROFILE=<PASS | FAIL | NAO_DETERMINADO>`

`PRIVILEGE_ESCALATION_TESTS=<PASS | FAIL | NAO_EXECUTADO | NAO_APLICAVEL>`

`CLIENT_RULES_COMPATIBILITY=<PASS | FAIL | NAO_DETERMINADO>`

`LOAN_FREEZE_RULES=<PASS | FAIL | NAO_APLICAVEL>`

`CLIENT_WRITE_BOUNDARIES=<PASS | FAIL | NAO_DETERMINADO>`

`EMULATOR_TESTS=<PASS | FAIL | NAO_EXECUTADO>`

`REGRESSION_SENSITIVITY_TEST=<PASS | FAIL | NAO_EXECUTADO | NAO_APLICAVEL>`

`REAL_FIREBASE_CONTACTS=<numero | NAO_DETERMINADO>`

`RULES_PUBLISHED=<SIM | NAO>`

`RULES_PREVIOUS_VERSION_RECORDED=<SIM | NAO | NAO_APLICAVEL>`

`RULES_POST_DEPLOY_VERIFIED=<SIM | NAO | NAO_APLICAVEL>`

`PRODUCTION_TOUCHED=<SIM | NAO>`

`NAO_DETERMINADOS=<lista | NENHUM>`

---

# 42. Critério de PASS

Não declarar PASS apenas porque:

- sintaxe das Rules está válida;
- Emulator iniciou;
- um teste passou;
- Admin consegue acessar;
- deploy retornou sucesso.

PASS exige evidência suficiente de:

- matriz de perfis;
- allow e deny (com deny pelo motivo correto);
- queries;
- writes;
- ausência de escalonamento de privilégio em `users`;
- integridade de empréstimo;
- compatibilidade cliente/Rules;
- target correto;
- isolamento do Emulator;
- ausência de contato real;
- ausência de regressões relevantes.

Tudo que não foi efetivamente lido ou testado permanece:

`NAO_DETERMINADO`.