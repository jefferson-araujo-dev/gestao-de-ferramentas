---
name: "firebase-admin-vercel-api"
description: "Revisão e implementação de Vercel Functions que usam Firebase Admin no Gestão de Ferramentas: autenticação, autorização, IAM, validação, transações, minimização de dados, isolamento Preview/Production e testes com Emulator. Usar em Gates com api/, server/, Admin SDK ou variáveis Firebase na Vercel."
---

# Firebase Admin SDK em Vercel Functions — Gestão de Ferramentas

## 1. Objetivo

Garantir que Vercel Functions que usam Firebase Admin:

- operem no Firebase correto;
- autentiquem e autorizem explicitamente;
- utilizem privilégio mínimo;
- validem entrada e saída;
- preservem invariantes de negócio;
- não dependam das Firestore Rules como controle server-side;
- não exponham dados pessoais ou credenciais;
- falhem de forma segura (fail closed) diante de erro, ausência de
  configuração ou dúvida de identidade;
- sejam testadas em ambiente isolado;
- não provoquem mudança em Production sem Gate específico.

Esta skill é um controle técnico complementar.

Ela NÃO constitui autorização para:

- deploy;
- Redeploy;
- Promote;
- Rollback;
- alteração de Environment Variables;
- mudança de IAM;
- publicação de Rules;
- escrita em Firebase real;
- restore;
- reset;
- migração;
- merge ou push em branch de produção.

O Gate ativo continua sendo a única fonte de autorização.

Skills relacionadas:

- `firebase-client-security` — Rules, perfis e Client SDK;
- `secret-pii-hygiene` — segredos, credenciais e dados pessoais em qualquer
  superfície.

---

# 2. Fonte de verdade

Antes de afirmar qualquer propriedade da arquitetura, reler o código atual.

No mínimo, quando aplicável:

- `server/firebase-admin.js`
- `server/admin-authorization.js`
- `src/js/config/constants.js`
- endpoint em `api/` sob revisão
- helpers chamados pelo endpoint
- testes correspondentes
- configuração Vercel/Firebase disponível em modo somente leitura

Não assumir comportamento com base nesta skill quando o código tiver mudado.

Classificar sempre:

`FATO`
`INFERENCIA`
`RISCO`
`NAO_DETERMINADO`
`RECOMENDACAO`

Não converter intenção arquitetural em fato de implementação.

---

# 3. Arquitetura atual conhecida

Confirmar novamente antes de usar como evidência.

## Firebase Admin

A implementação atual de `server/firebase-admin.js`:

- utiliza `firebase-admin`;
- inicializa credencial com `cert()`;
- depende de:
  - `FIREBASE_PROJECT_ID`;
  - `FIREBASE_CLIENT_EMAIL`;
  - `FIREBASE_PRIVATE_KEY`;
- normaliza as quebras de linha escapadas da private key;
- falha quando variável obrigatória está ausente;
- reutiliza app já inicializado através de `getApps()/getApp()`.

Nunca imprimir os valores dessas variáveis.

---

## Autenticação e autorização

A implementação atual de `server/admin-authorization.js`:

- extrai Bearer Token;
- chama `verifyIdToken(token)`;
- NÃO utiliza atualmente `checkRevoked=true`;
- carrega o perfil Firestore pelo `uid`;
- exige perfil existente;
- exige `status === 'Ativo'`;
- confere o e-mail do perfil com o e-mail do token;
- possui fluxo separado para Administrador.

A ausência de `checkRevoked` é um FATO da implementação atual.

Não alterá-la automaticamente.

Como o perfil é lido a cada requisição e o `status` é exigido, a desativação
do perfil tem efeito imediato na camada da API mesmo com ID token ainda
válido (INFERENCIA a confirmar no código). O que `checkRevoked` acrescentaria
é a invalidação de sessão após revogação de refresh tokens ou desativação da
conta no Authentication.

Se um Gate envolver:

- revogação de sessão;
- comprometimento de conta;
- desativação imediata;
- invalidação de token;

avaliar explicitamente se o modelo atual é suficiente.

Qualquer mudança para verificação de revogação é alteração comportamental e
exige Gate apropriado e testes.

---

# 4. Invariante crítico de alinhamento Firebase

Existem três dimensões que precisam ser coerentes:

1. projeto Firebase usado pelo cliente;
2. projeto Firebase associado às credenciais do Admin SDK;
3. namespace/path de dados utilizado pelo código server-side.

Não verificar apenas uma delas.

Registrar:

`CLIENT_FIREBASE_PROJECT=<TESTE | LEGADO | PRODUCAO | OUTRO | NAO_DETERMINADO>`

`ADMIN_FIREBASE_PROJECT=<TESTE | LEGADO | PRODUCAO | OUTRO | NAO_DETERMINADO>`

`SERVER_DATA_NAMESPACE=<TESTE | LEGADO | PRODUCAO | OUTRO | NAO_DETERMINADO>`

`FIREBASE_TARGET_ALIGNMENT=<PASS | FAIL | NAO_DETERMINADO>`

Nunca registrar credenciais para determinar esses valores.

---

## Split-brain

Classificar como risco crítico quando:

`CLIENT_FIREBASE_PROJECT != ADMIN_FIREBASE_PROJECT`

ou quando:

`ADMIN_FIREBASE_PROJECT != SERVER_DATA_NAMESPACE`

Consequências possíveis incluem:

- rejeição de ID Token por projeto/audience incompatível;
- leitura ou escrita no projeto errado;
- perfil não encontrado;
- comportamento diferente entre cliente e API;
- dados aparentemente ausentes;
- inconsistência operacional;
- autenticação válida em uma camada e dados acessados em outra.

Não tentar corrigir automaticamente mudando Environment Variables.

Parar e reportar.

RECOMENDACAO (não autorizada; exige Gate): uma verificação na inicialização
que compare o projeto das credenciais com o projeto esperado para o ambiente
e recuse operar em caso de divergência (fail closed) eliminaria uma classe
inteira de incidentes de alinhamento. Registrar como pendência, não
implementar fora de Gate.

---

# 5. Vercel Environment Variables

Ao revisar variáveis:

NUNCA ler ou reproduzir valores.

Registrar somente:

- nome;
- escopo;
- branch;
- existência;
- data de atualização quando relevante.

Validar separadamente:

- Production;
- Preview;
- Development;
- branch-specific Preview.

Preferir variável de Preview limitada à branch necessária quando o Gate assim
definir.

Duplicatas em:

`All Preview Branches`

devem ser identificadas e reportadas quando existir configuração mais
restritiva aplicável.

Não remover duplicatas automaticamente.

Variáveis antigas de branches já encerradas permanecem como superfície de
risco: reportar como higiene pendente, não remover sem Gate.

---

## Deployment immutability e Redeploy

Não assumir sem evidência atual da Vercel qual configuração será aplicada a:

- novo deployment;
- Redeploy;
- Promote;
- Rollback.

FATO operacional observado no projeto: valores novos de variável valem para
novos deployments; um Redeploy cria novo deployment a partir do código do
deployment de origem com a configuração atual do projeto. Confirmar sempre no
painel quando a decisão depender disso.

Quando essa distinção afetar segurança ou Firebase target:

1. conferir a configuração atual somente leitura;
2. conferir documentação/interface disponível;
3. registrar o resultado;
4. usar `NAO_DETERMINADO` quando não houver evidência suficiente.

Nunca testar essa semântica executando Redeploy de Production.

---

# 6. Production Freeze

Quando `PRODUCTION_FREEZE=ATIVA`:

proibidos sem nova decisão:

- deploy Production;
- Redeploy Production;
- Promote;
- Rollback;
- alteração de Production Environment Variables;
- alteração de Production Branch;
- merge/push que possa acionar Production;
- publicação de Firebase Rules;
- mudança de Firebase target de Production.

A existência de um problema de segurança não concede autorização implícita
para modificar Production.

Reportar e pedir decisão.

O projeto Firebase de testes (`gestao-de-ferramentas-3f8f1`) não é Production,
mas mudanças mutáveis nele continuam exigindo Gate autorizado e dados
fictícios.

---

# 7. IAM do runtime

Princípio:

**menor privilégio compatível com a função realmente executada**

Usar conta de serviço dedicada por finalidade e ambiente.

Não reutilizar automaticamente:

- conta de Production;
- conta administrativa ampla;
- `firebase-adminsdk` genérica/ampla;
- Owner;
- Editor.

Para o ambiente autorizado pelo Gate ENV-PREVIEW-1, o baseline aprovado foi:

- `roles/datastore.user`
- `roles/firebaseauth.admin`

Tratar isso como:

`IAM_BASELINE_APROVADO`

e não como prova matemática de privilégio mínimo para qualquer arquitetura
futura.

Se a aplicação mudar, reavaliar.

Observação de risco: `roles/firebaseauth.admin` é um papel poderoso (gerencia
contas de usuário). Por isso a chave dessa conta deve ter ciclo de vida curto
e revogação registrada (ver `secret-pii-hygiene`).

---

## Falha por permissão

Se uma função retornar permission denied:

NÃO:

- adicionar role;
- trocar para Editor;
- trocar para Owner;
- adicionar Firebase Admin;
- criar custom role;
- mudar IAM por tentativa e erro.

Procedimento:

1. identificar a operação exata que falhou;
2. identificar a permissão exigida;
3. verificar se ela pertence ao escopo funcional autorizado;
4. registrar a lacuna;
5. parar;
6. solicitar decisão.

---

# 8. Firestore Rules NÃO protegem Admin SDK

Firebase Admin opera fora das Firestore Security Rules.

Portanto:

`RULES_VALIDAS != API_SEGURA`

Cada endpoint server-side precisa garantir sua própria:

- autenticação;
- autorização;
- validação;
- controle de objeto;
- minimização de resposta;
- integridade transacional.

Nunca justificar acesso de uma Vercel Function dizendo:

"as Rules bloqueiam".

Para Admin SDK, essa premissa é inválida.

---

# 9. Processo de revisão de endpoint

Para cada endpoint, produzir uma matriz:

`HTTP_METHOD`

`AUTHENTICATION`

`AUTHORIZATION`

`INPUT_SCHEMA`

`OBJECT_AUTHORIZATION`

`STATE_INVARIANTS`

`TRANSACTIONALITY`

`OUTPUT_SCHEMA`

`PII_EXPOSURE`

`ENUMERATION_RISK`

`RATE_LIMIT`

`ERROR_HANDLING`

`LOGGING`

`CACHE_BEHAVIOR`

`TEST_COVERAGE`

Cada item deve ser:

`PASS`
`FAIL`
`NAO_APLICAVEL`
`NAO_DETERMINADO`

Não declarar PASS sem evidência no código ou teste.

---

# 10. Método HTTP

O endpoint deve aceitar apenas os métodos necessários.

Para método não permitido:

- retornar 405;
- declarar `Allow` quando aplicável;
- não executar lógica de negócio antes da rejeição.

Operação mutável não deve ser transformada em GET.

Revisar também impacto do Service Worker/PWA sobre caching de GETs.

Respostas autenticadas ou com dados de usuário devem declarar
`Cache-Control: no-store` (ou equivalente), para que nem CDN, nem navegador,
nem Service Worker as reutilizem entre usuários ou perfis.

---

# 11. Contrato de entrada

Validar:

- existência do body;
- tipo;
- tamanho;
- campos obrigatórios;
- tipos dos campos;
- limites;
- enumerações;
- identificadores;
- normalização;
- campos inesperados.

Preferir contrato fechado para operações sensíveis.

Quando o código atual aceitar campos extras:

NÃO afirmar que existe rejeição estrita.

Registrar:

`UNEXPECTED_FIELDS_REJECTED=NAO`

se esse for o comportamento real.

Não corrigir fora do Gate.

Validar identificadores usados em caminhos de documento: um valor vindo do
cliente nunca deve compor caminho Firestore sem checagem de formato (evitar
barras, pontos relativos e IDs vazios) e sem verificar que o documento
resultante pertence ao namespace esperado.

---

# 12. Autenticação

Endpoints autenticados devem validar Bearer Token server-side.

Nunca confiar em:

- UID enviado no body;
- accessLevel enviado pelo cliente;
- `isRestricted` enviado pelo cliente;
- e-mail enviado pelo cliente;
- flags de autorização vindas da UI.

Claims ou perfil usados para autorização devem vir de fonte server-side
confiável.

O UID efetivo da operação é SEMPRE o derivado do token verificado, nunca um
valor fornecido pelo cliente.

Falha de autenticação: 401 sem detalhar o motivo interno (token ausente,
expirado, de outro projeto). Perfil ausente, inativo ou divergente: negar sem
revelar qual condição falhou, para não permitir sondagem de contas.

---

# 13. Autorização

Separar:

**autenticação**

"quem está chamando?"

de:

**autorização**

"essa identidade pode executar esta ação sobre este recurso?"

Revisar explicitamente:

- usuário ativo;
- perfil;
- nível de acesso;
- perfil Restrito;
- operação administrativa;
- ownership quando aplicável;
- alvo da operação;
- proteção contra autoalterações críticas.

Nunca considerar ocultação de botão na UI como autorização.

Proteção contra autoalteração crítica, a verificar no contrato vigente de
cada endpoint administrativo:

- Admin não desativa, rebaixa ou exclui a si mesmo;
- o sistema não pode ficar sem Admin ativo;
- um perfil não eleva o próprio nível de acesso por nenhum endpoint.

Se o contrato não cobrir esses casos, registrar `NAO_DETERMINADO` ou `FAIL`,
não corrigir fora do Gate.

---

# 14. Perfil Restrito e minimização de resposta

Para qualquer endpoint acessível ao Restrito:

usar política de resposta por ALLOWLIST, nunca por denylist.

Preferir:

```text
campo permitido explicitamente -> incluído na resposta
campo não listado             -> omitido
```

em vez de:

```text
objeto completo do documento menos campos proibidos
```

Por quê: um campo novo adicionado ao documento no futuro passa a vazar
automaticamente em uma denylist; em uma allowlist ele permanece fora até ser
autorizado de propósito.

Revisar, para cada endpoint do Restrito:

- quais campos são devolvidos;
- se há dados de colaborador (nome, função, crachá) na resposta;
- se mensagens de erro diferenciam casos de modo a permitir enumeração;
- se o Restrito consegue inferir dados que não pode ler (por exemplo, pela
  diferença entre "não encontrado" e "sem permissão");
- se o tempo de resposta ou o tamanho da resposta revelam existência de
  registro.

Registrar:

`RESTRICTED_RESPONSE_ALLOWLIST=<PASS | FAIL | NAO_DETERMINADO>`

Não alterar o contrato de resposta do Restrito sem decisão explícita.

---

# 15. Dados pessoais e logs

O servidor lida com dados potencialmente pessoais (colaboradores, crachás,
e-mails, UIDs).

Nunca registrar em log:

- Authorization header ou token;
- corpo completo de requisição ou resposta;
- crachá, nome ou e-mail de colaborador;
- stack trace com dados do payload.

Logar identificadores técnicos mínimos e códigos de resultado (por exemplo,
endpoint, status HTTP, categoria do erro). Mensagens de erro ao cliente são
genéricas; o detalhe técnico fica restrito ao log sanitizado.

Seguir `secret-pii-hygiene` para classificação e redaction.

---

# 16. Integridade transacional

Operações que dependem do estado anterior (empréstimo, devolução, mudança de
status de ferramenta) devem ser ATÔMICAS.

Revisar:

- leitura do estado e escrita ocorrem na MESMA transação;
- todas as leituras da transação acontecem antes das escritas;
- a transação revalida o estado atual (por exemplo, ferramenta já emprestada
  rejeita novo empréstimo; devolução confere o colaborador do empréstimo em
  curso);
- a operação completa grava juntos o estado da ferramenta e o registro de
  histórico, ou ambos falham;
- não existe janela entre "verificar" e "gravar" fora da transação (TOCTOU);
- retentativas automáticas da transação não duplicam efeitos externos;
- os limites vigentes de tamanho e quantidade de escritas por transação são
  respeitados (confirmar na documentação atual).

Sinais de risco no código:

- `get()` seguido de `set()/update()` fora de `runTransaction`;
- verificação de disponibilidade feita no cliente e não repetida no servidor;
- gravação do histórico separada da gravação do estado;
- contadores ou status calculados no cliente.

Registrar:

`LOAN_TRANSACTIONALITY=<PASS | FAIL | NAO_APLICAVEL | NAO_DETERMINADO>`

---

# 17. Idempotência e envio duplicado

Toque duplo, retry de rede e reenvio pelo Service Worker podem repetir a
mesma requisição.

Para cada operação mutável avaliar:

- o que acontece se a mesma requisição chegar duas vezes;
- se a segunda é rejeitada de forma segura pela validação de estado (por
  exemplo, ferramenta já devolvida) ou duplica o efeito;
- se há identificador de operação que permita deduplicar quando o estado
  sozinho não basta;
- se a resposta de erro da repetição é distinguível de uma falha real, para o
  cliente não exibir erro enganoso.

Não introduzir chave de idempotência fora de Gate. Registrar a lacuna.

---

# 18. Operações administrativas de usuário (Authentication)

Endpoints como criação, atualização, mudança de status e exclusão de usuário
tocam DUAS fontes: Firebase Authentication e o documento de perfil no
Firestore.

Revisar:

- ordem das operações e o que acontece se a segunda falhar (usuário criado no
  Authentication sem perfil; perfil sem conta);
- compensação ou reconciliação documentada para falha parcial;
- unicidade de e-mail e normalização (caixa, espaços);
- credenciais iniciais: nunca devolvidas em resposta nem registradas em log;
- desativação: efeito no perfil (`status`), no Authentication e nas sessões
  existentes;
- exclusão: destrutiva e irreversível, tratada na seção 19;
- que somente Admin ativo executa a operação (seção 13).

Registrar:

`USER_ADMIN_PARTIAL_FAILURE_HANDLING=<PASS | FAIL | NAO_DETERMINADO>`

---

# 19. Operações destrutivas

São destrutivas ou de alto impacto:

- backup/restore;
- reset;
- exclusão de usuário;
- manutenção em massa;
- qualquer escrita em lote sem confirmação.

Regras:

- NUNCA executar em testes sem autorização específica do Gate;
- NUNCA contra projeto real, legado ou Production durante validação;
- exigir confirmação explícita no contrato (por exemplo, campo de
  confirmação) e restrição a Admin ativo;
- restore/reset devem ter alvo explícito e verificável; não pode operar
  silenciosamente no projeto errado (seção 4);
- registrar o que seria afetado antes de qualquer execução autorizada;
- ter plano de recuperação antes da execução autorizada.

Quando um Preview passa a ter credenciais Admin, esses endpoints passam a
funcionar nele. Isso é risco aceito e documentado do ambiente de testes, não
autorização para usá-los.

---

# 20. Rate limit e enumeração

Endpoints que recebem crachá, e-mail ou identificador consultável são
superfície de enumeração.

Revisar:

- existência de limite por identidade e por origem (o projeto possui coleção
  de controle de taxa; confirmar o uso real no código);
- se o limite depende apenas de dado controlado pelo cliente;
- se a contagem é atômica ou admite corrida;
- se o bloqueio gera resposta distinguível e útil ao atacante;
- se a janela e o limite fazem sentido para o uso legítimo (leitor de crachá
  em ritmo normal não pode ser bloqueado).

Registrar:

`RATE_LIMIT_REVIEW=<PASS | FAIL | NAO_APLICAVEL | NAO_DETERMINADO>`

Não ajustar limites fora de Gate.

---

# 21. Erros e códigos HTTP

Usar códigos coerentes:

- 400 entrada inválida;
- 401 não autenticado;
- 403 autenticado sem permissão;
- 404 recurso inexistente (cuidado com enumeração para o Restrito);
- 405 método não permitido;
- 409 conflito de estado (por exemplo, ferramenta já emprestada);
- 429 limite de taxa;
- 500 falha interna sem detalhes ao cliente.

Caminhos de erro devem sempre responder e nunca deixar a requisição pendurada.
Exceções não tratadas devem resultar em 500 genérico. O cliente usa o código
para decidir mensagem e retentativa: um 500 enganoso para um conflito de
estado leva a retries inúteis.

Falha de inicialização por variável ausente é erro de configuração: deve
resultar em falha explícita e segura, sem tentar operar com credencial
parcial.

---

# 22. Cache, CORS e PWA

- Respostas autenticadas: `no-store` (seção 10).
- CORS: restringir origens ao necessário. Evitar origem curinga em endpoints
  autenticados. Previews têm URLs variáveis: tratar com cuidado e registrar
  qualquer exceção como decisão, nunca abrir geral por conveniência.
- O Service Worker não deve cachear respostas de `api/` nem reenviar
  mutações de forma não controlada.
- Tokens vão no header, nunca na URL ou query string (URLs vão para logs e
  histórico).

Registrar:

`API_CACHE_AND_CORS_REVIEW=<PASS | FAIL | NAO_DETERMINADO>`

---

# 23. Runtime da Vercel Function

Verificar na configuração e na documentação vigentes, sem presumir:

- inicialização do Admin SDK fora do handler, com reaproveitamento do app
  (evita reinicialização a cada invocação);
- tempo máximo de execução e memória do plano em uso;
- região da função em relação à região do banco (latência de transações);
- cold start sobre operações em tempo de leitura de crachá;
- limite de tamanho de corpo da requisição.

O plano Hobby é de uso pessoal e não comercial. Antes de qualquer cliente real
é necessário rever plano, limites e termos (decisão do usuário).

Registrar limites como `NAO_DETERMINADO` até leitura da configuração real.

---

# 24. Testes com Emulator e proteção contra Firebase real

O Admin SDK conecta ao emulador apenas quando as variáveis de ambiente do
emulador estão definidas (Firestore e Authentication). SEM elas, o Admin SDK
fala com o Firebase REAL que as credenciais apontam.

Portanto, em qualquer teste de API:

- confirmar que as variáveis do emulador estão definidas no processo de teste
  ANTES de importar ou inicializar o Admin SDK;
- usar projectId sintético de teste;
- não ter credenciais reais carregadas no ambiente de teste;
- abortar o teste se detectar ausência das variáveis do emulador;
- monitorar tentativa de conexão externa quando possível.

Registrar:

`REAL_FIREBASE_CONTACTS=<numero | NAO_DETERMINADO>`

somente com evidência da execução.

Contato remoto inesperado:

`STATUS=BLOCKED`

---

# 25. Matriz mínima de testes de API

Para cada endpoint relevante, cobrir:

- método não permitido → 405;
- sem token → 401;
- token inválido ou de outro projeto → 401;
- usuário autenticado sem perfil → negado;
- perfil inativo → negado;
- e-mail do perfil divergente do token → negado;
- Padrão tentando operação administrativa → 403;
- Restrito com resposta restrita à allowlist;
- campos inesperados no body (documentar o comportamento real);
- tipos inválidos e limites;
- estado inválido (ferramenta já emprestada, já devolvida) → 409 ou
  equivalente;
- envio duplicado da mesma operação;
- falha parcial em operação administrativa de usuário;
- limite de taxa.

Testes devem distinguir:

- o que o endpoint garante por si;
- o que depende de seed administrativo (Admin SDK ignora Rules);
- o que é Rule do cliente (testado em `firebase-client-security`).

Um teste negativo só vale se falhar pelo motivo certo: verificar o código HTTP
e a causa esperada, não apenas "não deu 200".

---

# 26. Sensibilidade dos testes

Para mudança de autorização ou de invariante, exigir evidência de que o teste
realmente detecta a regressão.

Quando viável, em ambiente local:

1. executar a suíte com a verificação presente → PASS;
2. neutralizar temporariamente a verificação em cópia de trabalho (por
   exemplo, remover a checagem de perfil ativo);
3. confirmar que o teste relevante FALHA;
4. restaurar o estado original e confirmar por diff.

Não fazer isso em arquivo versionado sem restaurar, nem em ambiente real.

Registrar:

`REGRESSION_SENSITIVITY_TEST=<PASS | NAO_EXECUTADO | NAO_APLICAVEL>`

---

# 27. Dependências e cadeia de suprimentos

- `firebase-admin` e dependências transitivas devem estar com versão
  conhecida e lockfile versionado.
- Não adicionar nem atualizar dependência sem Gate.
- Auditoria de vulnerabilidades (por exemplo, `npm audit`) é leitura e pode
  ser reportada; correção que altere dependências exige Gate.
- Não instalar pacote para executar verificação pontual em arquivo
  versionado.

Registrar:

`DEPENDENCY_REVIEW=<PASS | FAIL | NAO_EXECUTADO | NAO_APLICAVEL>`

---

# 28. Observabilidade sem vazamento

Para diagnosticar falhas sem expor dados:

- usar logs de runtime da Vercel em modo somente leitura;
- relatar mensagens de erro sanitizadas, código HTTP, horário e endpoint;
- logs vazios NÃO provam ausência de erro (podem não registrar requisições
  bem-sucedidas, ou a janela pode estar vazia);
- sucesso funcional comprovado por teste é evidência mais forte que a
  ausência de log;
- não ativar logging adicional em Production sem autorização.

Proposta de melhoria (não autorizada): registrar resultado estruturado e
sanitizado das operações de movimentação, para trilha de auditoria mínima.

---

# 29. Verificação de Preview/Production (somente leitura)

Antes de declarar um ambiente apto:

1. confirmar o deployment correto (branch, commit, ambiente);
2. confirmar escopo e nome das variáveis, sem valores;
3. confirmar que o deployment é posterior à criação das variáveis;
4. confirmar o alinhamento da seção 4;
5. executar teste funcional com dados fictícios, quando o Gate autorizar;
6. registrar o que NÃO foi verificado.

Preview protegido por login da Vercel reduz a exposição das APIs, mas não é
garantia absoluta.

---

# 30. Condições de interrupção

Interromper o Gate e reportar quando ocorrer:

- split-brain de projeto Firebase;
- necessidade de papel IAM não aprovado;
- suspeita de exposição de credencial;
- teste prestes a rodar sem variáveis do emulador;
- contato com Firebase real durante teste de Emulator;
- endpoint destrutivo exigido sem autorização;
- endpoint que permita escalonamento de privilégio;
- resposta do Restrito com dado fora da allowlist;
- necessidade de alterar Production, Rules ou segredo de Production;
- dados reais no ambiente de testes;
- dúvida se a operação atinge projeto real.

Registrar:

`STATUS=BLOCKED`

e pedir decisão.

---

# 31. REPORT obrigatório

Quando esta skill participar de um Gate, registrar quando aplicável:

`API_REVIEW=<PASS | FAIL | PARTIAL | NAO_APLICAVEL>`

`ENDPOINT_MATRIX=<anexada | NAO_EXECUTADA>`

`FIREBASE_TARGET_ALIGNMENT=<PASS | FAIL | NAO_DETERMINADO>`

`CLIENT_FIREBASE_PROJECT=<...>`

`ADMIN_FIREBASE_PROJECT=<...>`

`SERVER_DATA_NAMESPACE=<...>`

`AUTHENTICATION_REVIEW=<PASS | FAIL | NAO_DETERMINADO>`

`AUTHORIZATION_REVIEW=<PASS | FAIL | NAO_DETERMINADO>`

`PRIVILEGE_ESCALATION_PATHS=<NENHUM | lista | NAO_DETERMINADO>`

`RESTRICTED_RESPONSE_ALLOWLIST=<PASS | FAIL | NAO_DETERMINADO>`

`LOAN_TRANSACTIONALITY=<PASS | FAIL | NAO_APLICAVEL | NAO_DETERMINADO>`

`USER_ADMIN_PARTIAL_FAILURE_HANDLING=<PASS | FAIL | NAO_APLICAVEL | NAO_DETERMINADO>`

`RATE_LIMIT_REVIEW=<PASS | FAIL | NAO_APLICAVEL | NAO_DETERMINADO>`

`API_CACHE_AND_CORS_REVIEW=<PASS | FAIL | NAO_DETERMINADO>`

`IAM_BASELINE_APROVADO=<SIM | NAO | NAO_DETERMINADO>`

`ENV_VARS_REVIEW=<PASS | FAIL | NAO_DETERMINADO>` (nomes e escopos, sem valores)

`DEPENDENCY_REVIEW=<PASS | FAIL | NAO_EXECUTADO | NAO_APLICAVEL>`

`EMULATOR_TESTS=<PASS | FAIL | NAO_EXECUTADO>`

`REGRESSION_SENSITIVITY_TEST=<PASS | FAIL | NAO_EXECUTADO | NAO_APLICAVEL>`

`REAL_FIREBASE_CONTACTS=<numero | NAO_DETERMINADO>`

`DESTRUCTIVE_ENDPOINTS_USED=<SIM | NAO>`

`PRODUCTION_TOUCHED=<SIM | NAO>`

`NAO_DETERMINADOS=<lista | NENHUM>`

---

# 32. Critério de PASS

Não declarar PASS apenas porque:

- o endpoint responde 200;
- o teste funcional de um fluxo feliz passou;
- as variáveis existem;
- os logs não mostram erro;
- o Admin SDK inicializou.

PASS exige evidência suficiente de:

- alinhamento Firebase cliente, Admin e namespace;
- autenticação e autorização verificadas pelo código e por teste;
- ausência de escalonamento de privilégio;
- resposta do Restrito restrita à allowlist;
- integridade transacional das movimentações;
- tratamento de duplicidade e de falha parcial;
- IAM dentro do baseline aprovado;
- variáveis com escopo correto, sem valores expostos;
- testes isolados no Emulator, sem contato com Firebase real;
- nenhuma operação destrutiva executada;
- nenhuma alteração em Production.

Tudo que não foi efetivamente lido ou testado permanece:

`NAO_DETERMINADO`.