# Telas "Usuários" e "Auditoria" — Especificação de Escopo (Gate 1-F4)

> **Natureza deste documento**: ao contrário de `DATA_BACKUP_SCREEN.md`, `TOOLS_SCREEN.md` e
> `COLLABORATORS_SCREEN.md` — que descrevem gates já implementados — este documento é uma
> **especificação prévia**, produzida antes de qualquer implementação. Por isso, e por instrução
> explícita do Gate 1-F4.A, cada afirmação abaixo é rotulada como:
>
> - **[APROVADO]** — requisito funcional já decidido pelo usuário/Cowork, vinculante para a implementação.
> - **[COMPROVADO]** — comportamento hoje existente no código, verificado por leitura direta (arquivo:linha).
> - **[PROPOSTO]** — sugestão técnica desta etapa, ainda sujeita à aprovação do Cowork. Nada rotulado
>   como PROPOSTO deve ser implementado sem aprovação explícita em gate futuro.
>
> Nenhum código, regra ou dado foi alterado para produzir este documento.

---

## A. Redesign da tela de Usuários

### A.1 Estado atual [COMPROVADO]

- Tela existente em `src/partials/tabs/tab-users.html` (rota `#/usuarios`), ainda em Tailwind legado
  (não migrada ao design system dos Gates 1-C/1-E) — confirmado por `docs/design/APP_SHELL.md:5` e
  `docs/design/COLLABORATORS_SCREEN.md:134`.
- Cabeçalho: título "Controle de Acesso e Usuários"; ações Exportar/Importar/Novo
  (`tab-users.html:14-46`); 4 contadores — Total, Ativos, Admins, Usuários
  (`tab-users.html:55,69,84,98`); busca por nome/e-mail/departamento (`tab-users.html:112-118`);
  filtros de acesso — **apenas** Todos/Administradores/Usuários Padrão/Ativos/Inativos
  (`tab-users.html:122-161`) — **não existe filtro ou coluna "Restrito"**; ordenação por
  Nome/E-mail/Último Login/Status (`tab-users.html:171-202`).
- Linha por usuário, renderizada em JS (`src/js/modules/users.js:467-508`) em
  `#user-management-body`: avatar+nome, e-mail, badge de nível de acesso (Administrador/Usuário
  Padrão), badge de status (Ativo/Inativo), Último Login (data/hora + IP/dispositivo se houver),
  ações (Editar, Alternar Nível, Ativar/Desativar, Excluir) — `src/js/modules/users.js:470-506`.
  Não exibe `createdAt` nem "Departamento" na linha (só na exportação/modal).
- Módulo `App.CRUDUsers` (`src/js/modules/users.js`, 1015 linhas) expõe: seleção em lote e ações em
  lote (`toggleSelection`, `bulkAction` → `/api/users/status`, `/api/users/delete`), filtros/busca/
  ordenação/paginação, `openModal`/`saveUser` (→ `POST /api/users/create` ou
  `PATCH /api/users/update`), `toggleRole` (→ `PATCH /api/users/update`, **sem confirmação**),
  `toggleStatus` (→ `POST /api/users/status`), `deleteUser` (→ `POST /api/users/delete`, com
  confirmação), `importFile` (importação em massa via Excel), `exportExcel`.
- Formulário de criação/edição (`src/partials/modals/user-modal.html`, 154 linhas): campos Nome,
  E-mail, Departamento, Nível de Acesso (linhas 25-69). **Não existe campo para gerenciar o perfil
  Restrito.**

### A.2 Autorização server-side hoje [COMPROVADO]

Todas as quatro APIs (`api/users/create.js`, `update.js`, `delete.js`, `status.js`) exigem
`requireActiveAdmin(req)` como primeira verificação (`create.js:81`, `update.js:83`, `delete.js:62`,
`status.js:71`), definida em `server/admin-authorization.js:30-79` — token Firebase válido de um
perfil ativo com `accessLevel === 'Administrador'`. Um não-administrador é rejeitado (403) antes de
qualquer campo do corpo ser processado; não há caminho de auto-escalonamento de privilégio por essas
APIs.

Proteções existentes contra ações destrutivas sobre a própria conta ou o último admin:
- `update.js:113-119` — admin não pode remover o próprio nível de administrador nem alterar o
  próprio e-mail.
- `delete.js:66-71` — admin não pode excluir a própria conta.
- `delete.js:93-117` e `status.js:131-156` — bloqueiam excluir/desativar o último Administrador ativo
  restante (contagem transacional).
- `status.js:76-81` — admin não pode desativar a própria conta.

### A.3 Redesign visual [PROPOSTO]

Migrar `tab-users.html` e os componentes de `users.js` para os tokens/padrões visuais dos Gates
1-C/1-E e para a estrutura de estados (vazio/carregando/erro) já usada em
`docs/design/TOOLS_SCREEN.md` e `docs/design/COLLABORATORS_SCREEN.md`, **sem alterar** nenhuma regra
de autorização, validação ou os endpoints de `api/users/*` descritos em A.2. Esta etapa, isolada, é a
de menor risco entre as quatro frentes deste gate (A/B/C/D), pois não toca em lógica de permissão nem
em modelo de dados.

---

## B. Redesign da tela de Auditoria de movimentações

### B.1 Estado atual [COMPROVADO]

- `src/partials/tabs/tab-history.html`, rota `#/auditoria`, título "Auditoria de Sistema" / "Registro
  de movimentações e logs do sistema". Contém filtro de período, busca e lista paginada
  (`#history-list`, "Carregar Mais").
- Trata-se exclusivamente do histórico de empréstimo/devolução de ferramentas, gravado pela Movement
  API (`api/tools/movement.js:436-448`) na coleção `history`. Cada registro grava `user` (nome do
  colaborador) e `collaboratorId` — confirmado no mesmo trecho.
- Regra Firestore: `read, write: if isAdmin();` (`firestore.rules:71-73`) — leitura restrita a
  Administrador. Não há acesso, mesmo indireto, para Padrão ou Restrito.
- Não é uma trilha de ações administrativas: não registra criação/edição/exclusão de usuários nem
  mudanças de perfil/permissão.

### B.2 Redesign visual [PROPOSTO]

Mesma natureza do item A.3: migração visual da tela de histórico de movimentações para os padrões dos
Gates 1-C/1-E, preservando integralmente a leitura admin-only e o modelo de dados de `history`. Sem
mudança de comportamento ou de autorização.

---

## C. Gestão do perfil Restrito

### C.1 Requisito funcional aprovado [APROVADO]

Conforme fornecido no Gate 1-F4.A, adotado como requisito vinculante para toda implementação futura:

- O Restrito pode emprestar e devolver ferramentas.
- Não pode listar, pesquisar ou ler dados pessoais dos colaboradores.
- Não pode obter nome, crachá, função, fotografia ou identificador interno por API, dashboard,
  scanner, documentos de ferramentas ou cache.
- Seu comprovante (recibo do empréstimo/devolução) deve ser apenas operacional — sem dados pessoais
  do colaborador.
- O termo nominal (documento com identificação do colaborador) pertence a um fluxo separado,
  destinado a pessoa autorizada — não ao Restrito.
- **Conferência obrigatória do crachá na devolução**: ao devolver, o sistema deve conferir se o crachá
  informado pelo Restrito corresponde ao colaborador registrado como responsável atual pela ferramenta
  (`currentCollaboratorId` do empréstimo em curso). A resposta ao Restrito deve ser puramente
  operacional — `CONFERE` ou `NÃO CONFERE` — sem devolver nome, crachá, função ou qualquer outro dado
  pessoal do colaborador em nenhum dos dois casos. Em caso de `NÃO CONFERE`, a devolução pelo fluxo
  comum (Restrito) deve ser recusada; a divergência só pode ser resolvida por fluxo separado, destinado
  a pessoa autorizada (Administrador/Usuário Padrão), consistente com o item anterior sobre o termo
  nominal.

### C.2 Divergências encontradas frente ao requisito aprovado [COMPROVADO — DIVERGÊNCIA DE SEGURANÇA]

Duas divergências concretas entre o comportamento atual do código e o requisito C.1 foram identificadas
nesta etapa. Nenhuma foi corrigida — apenas documentadas, conforme os limites do gate.

**Divergência 1 — já conhecida, resposta da Movement API.**
No empréstimo bem-sucedido, `api/tools/movement.js:383-391` devolve `collaborator: { name, role }` na
resposta HTTP **para todos os perfis igualmente, inclusive Restrito** — comentário no próprio código:
"o nome e a função voltam na resposta ... para todos os perfis igualmente". Coberto por
`tests/integration/movementEmulator.test.mjs:365,375`. Isto contraria diretamente o requisito "não
pode obter nome... função... por API" (C.1), pois o Restrito recebe nome e função do colaborador que
acabou de emprestar/devolver, dentro da própria resposta da API que ele mesmo chamou.

**Divergência 2 — nova, identificada nesta etapa: exposição via documento de `tools` e telas
Ferramentas/Scanner.**
Diferente da coleção `collaborators` (bloqueada ao Restrito por `canReadCollaborators()`,
`firestore.rules:27-30,66-69`), a coleção `tools` é legível por **qualquer perfil ativo**, sem exceção
para Restrito (`firestore.rules:51`: `allow read: if hasActiveProfile();`). Enquanto uma ferramenta
está emprestada, o próprio documento da ferramenta grava o **nome real do colaborador** no campo
`currentUser` (string, não um ID) — `api/tools/movement.js:269,274,278-283` (`recordLoan`) — além do
ID opaco `currentCollaboratorId`. Esse nome:
- É exibido a **qualquer perfil**, sem filtro por role, na tabela e nos cartões da tela Ferramentas
  (`src/js/modules/tools.js:1508-1510` e `1526-1529`, coluna/linha "Responsável", sem gate de
  permissão — apenas a coluna de Ações é restrita por `canManageTools()`).
- É exibido também na tela Scanner, ao ler uma ferramenta já emprestada, **antes de qualquer nova
  ação de empréstimo/devolução** (`src/js/modules/scanner.js:624-630`: "Responsável atual: `<nome>`"),
  a partir do mesmo cache client-side (`src/js/modules/data.js:119-138`, listener aberto para
  qualquer perfil com `canReadTools`, que é verdadeiro para todo usuário autenticado —
  `src/js/modules/auth.js:32,36` — sem exceção para Restrito, ao contrário de
  `canReadCollaborators`, que a exclui explicitamente, `src/js/modules/auth.js:38`).
- Após a devolução, os campos `currentUser`/`currentCollaboratorId` do documento da ferramenta são
  zerados (`api/tools/movement.js:424-425,431-432`), mas o nome e o ID permanecem indefinidamente na
  coleção `history`, que é admin-only (`firestore.rules:71-73`) — não acessível ao Restrito por essa
  via.
- `docs/design/TOOLS_SCREEN.md:80-81` e `docs/design/COLLABORATORS_SCREEN.md:94-95` já registram esse
  comportamento como decisão deliberada do Gate 1-F2/1-F3 ("o nome do responsável que aparece em
  Ferramentas vem do próprio documento da ferramenta, não de uma leitura da coleção Colaboradores") —
  ou seja, **não é um bug introduzido agora**, mas uma exposição pré-existente que **contraria
  literalmente** o requisito C.1 ("não pode obter nome... por dashboard, scanner ou... documentos de
  ferramentas"), já que o requisito aprovado neste gate é mais restritivo do que a decisão registrada
  nos gates anteriores.

**Conclusão sobre C.2**: hoje, um usuário Restrito pode navegar até a tela Ferramentas e ver o nome de
todo colaborador com uma ferramenta emprestada no momento — não apenas do colaborador da sua própria
operação no Scanner. Isso é uma exposição mais ampla do que a já conhecida (Divergência 1), pois não
depende de o Restrito estar processando aquele empréstimo específico.

**Ambas as divergências (1 e 2) violam o requisito aprovado em C.1 e devem ser corrigidas — não há
alternativa de encerramento por aceitação formal da exposição atual.** A solução técnica a ser definida
em subgate de implementação deverá, cumulativamente: (i) preservar integralmente o funcionamento de
empréstimo e devolução de ferramentas para todos os perfis, incluindo Restrito; (ii) impedir que o
Restrito obtenha nome, crachá, função, fotografia ou identificador interno do colaborador por qualquer
via — resposta de API, documento de ferramenta, tela Ferramentas, Scanner ou cache do cliente
(`src/js/modules/data.js`); e (iii) evitar que a correção dependa de o cliente Restrito receber o
documento completo da ferramenta e apenas ocultar o campo na camada de UI — o campo não deve chegar ao
cliente Restrito, nem via listener do Firestore nem via resposta de API, para não permanecer acessível
por inspeção de rede, DevTools ou cache local. As opções técnicas concretas (ex.: `currentUser`
substituído por um identificador não-nominal visível a todos os perfis e resolvido a nome apenas para
quem tem `canReadCollaborators`; resposta da Movement API sem `collaborator.name`/`role` para Restrito;
possível necessidade de uma Cloud Function ou de leitura server-side intermediária para filtrar o campo
antes de chegar ao cliente Restrito) não foram avaliadas nem decididas nesta etapa, por estarem fora do
limite de "apenas documentação" — ficam registradas como escopo obrigatório do planejamento em 1-F4.B e
da implementação controlada em 1-F4.C (ver "Sequência recomendada dos próximos subgates"), não como
pendência opcional.

### C.3 Verificação obrigatória de regras publicadas [APROVADO COMO REQUISITO DE PROCESSO]

Há duas fontes de informação distintas sobre as regras do Firestore em produção, que não podem ser
tratadas como equivalentes:

- **Análise do arquivo versionado**: `firestore.rules`, lido integralmente neste repositório, nega ao
  Restrito a leitura de `collaborators` (`canReadCollaborators()`, `firestore.rules:27-30,66-69`) e
  permite a leitura de `tools` a qualquer perfil ativo (`firestore.rules:51`).
- **Evidência visual fornecida pelo usuário**: capturas de tela do console do Firebase do projeto
  `gestao-de-ferramentas-3f8f1`, fornecidas pelo usuário nesta etapa, mostram regras publicadas que
  permitem `read` de **ambas** as coleções `tools` e `collaborators` a **qualquer perfil ativo** — sem
  a restrição ao Restrito que o arquivo versionado implementa para `collaborators`. Trata-se de
  evidência visual fornecida pelo usuário, **não de uma leitura direta desta sessão contra o console ou
  o Admin SDK do Firebase** — esta sessão não acessou nem alterou o Firebase em nenhuma etapa deste
  gate.

Essas duas fontes divergem quanto a `collaborators` (arquivo nega ao Restrito; evidência visual indica
publicação sem essa restrição) e **não podem ser reconciliadas nesta etapa**. Não foi determinado qual
delas reflete o estado real em produção no momento de cada leitura, nem se ambas estiveram corretas em
momentos diferentes (ex.: arquivo alterado localmente após a última publicação, ou publicação manual
divergente do arquivo versionado).

Fica registrado como **requisito obrigatório e bloqueante**: imediatamente antes de qualquer publicação
de regra decorrente deste gate — inclusive qualquer regra elaborada para corrigir C.2 — reconfirmar,
por leitura direta e atual do console/Admin SDK do Firebase (não pela evidência visual já coletada nem
pelo arquivo versionado isoladamente), o conteúdo efetivamente publicado em `gestao-de-ferramentas-3f8f1`
para `tools`, `collaborators`, `users` e `history`, e relatar ao Cowork qualquer divergência frente ao
arquivo versionado antes de publicar. Essa reconfirmação **não foi feita nesta etapa** e não deve ser
presumida como concluída em nenhuma etapa futura sem evidência de comando explícita.

### C.4 Administração do perfil Restrito pelo Administrador [PROPOSTO]

Hoje, o campo `isRestricted` não é gravável por nenhuma API ou UI da aplicação: `api/users/create.js:112`
fixa `isRestricted: false` em toda criação; `api/users/update.js` nunca lê nem grava esse campo
(`update.js:132-139`); `user-modal.html` não tem esse campo. Segundo os comentários do próprio
`firestore.rules`, `isRestricted` só pode ser alterado hoje por escrita direta fora da aplicação
(Admin SDK/console).

Proposta técnica para avaliação do Cowork, abrangendo **tanto criação quanto edição** de usuários:
- Adicionar `isRestricted` (booleano) como campo aceito em `api/users/create.js` (hoje fixado em
  `false`, `create.js:112`) e como campo editável em `api/users/update.js` (hoje nunca lido/gravado,
  `update.js:132-139`), ambos com validação de tipo estrita (`typeof body.isRestricted === 'boolean'`)
  e sujeitos à mesma exigência de `requireActiveAdmin` já existente (`create.js:81`, `update.js:83`) —
  nenhuma rota nova, apenas extensão das já autorizadas.
- Validação server-side contra combinações inconsistentes de perfil: rejeitar explicitamente qualquer
  requisição que envie `accessLevel: 'Administrador'` junto com `isRestricted: true` para o mesmo
  usuário — mesmo que o efeito em runtime já seja neutralizado pela ordem de precedência de
  `src/js/modules/auth.js:275` (admin nunca é tratado como restrito), a API não deve persistir um
  documento com essa combinação, para não deixar o dado em estado logicamente inconsistente.
- Expor `isRestricted` como coluna/filtro na tela de Usuários (A.1) e como campo no modal de
  criação **e** edição — apenas para Administrador, protegido pelas mesmas permissões de tela já
  existentes (`canAccessUsers`, `src/js/modules/auth.js:40-41`).
- Nenhuma mudança nas regras de leitura de `collaborators`/`tools` decorre diretamente disto — este
  item trata apenas de como o admin atribui o perfil, não de onde o Restrito pode ler (essa parte é
  tratada em C.2, cuja correção é obrigatória e independente desta proposta).
- **Testes necessários** (integração contra emulador Firestore/Functions):
  1. Admin consegue definir `isRestricted` na criação de um novo usuário.
  2. Admin consegue alternar `isRestricted` de um usuário existente via edição.
  3. **Teste negativo de autorização**: não-admin não consegue definir/alterar `isRestricted` em
     nenhum dos dois endpoints (rejeição antes de qualquer parsing de campo, no mesmo padrão de
     `requireActiveAdmin`).
  4. **Teste negativo de consistência**: requisição com `accessLevel: 'Administrador'` +
     `isRestricted: true` é rejeitada pela API, não apenas neutralizada em runtime.
  5. Alternância de `isRestricted` reflete imediatamente nas permissões de leitura de `collaborators`
     na próxima sessão/token refresh do usuário afetado, no padrão já usado por
     `tests/integration/firestoreRulesEmulator.test.mjs:233-242`.
  6. **Regressão de empréstimos/devoluções**: reexecução completa de
     `tests/integration/movementEmulator.test.mjs`, `tests/e2e/restricted-loan.spec.js` e
     `tests/e2e/auth-restricted.spec.js` após a mudança, para confirmar que expor/gerenciar
     `isRestricted` na tela de Usuários não altera o comportamento do fluxo de empréstimo/devolução
     para nenhum perfil.

---

## D. Possível nova trilha de auditoria administrativa

### D.1 Estado atual [COMPROVADO]

Não existe hoje nenhum modelo de dados, coleção, API ou UI que registre ações administrativas sobre
contas de usuário (criação, edição, ativação/desativação, exclusão, alteração de nível de acesso ou de
`isRestricted`). `src/js/modules/auth.js:210` (`_updateUserSession`) registra apenas metadados de
sessão do próprio usuário logado (SO, navegador, último login) — não é uma trilha compartilhada nem
audita ações de terceiros. A única auditoria persistente e admin-only hoje é a coleção `history` de
movimentação de ferramentas (seção B.1).

### D.2 Proposta [PROPOSTO — decisão de escopo e confirmação final pendentes do Cowork]

Esta é a decisão de maior impacto deste gate: se 1-F4 deve, além do redesign visual (A, B) e da
gestão do perfil Restrito (C), **introduzir uma funcionalidade nova** (trilha de auditoria
administrativa). Caso aprovado, proposta técnica de alto nível, apenas para avaliação — nada disto deve
ser implementado nesta etapa. Todos os itens abaixo são propostas sujeitas a confirmação final do
Cowork, não requisitos aprovados.

**Modelo de dados e integridade da trilha**
- Nova coleção, ex. `artifacts/gestao-de-ferramentas-3f8f1/public/data/adminAuditLog/{eventId}`, com
  campos mínimos: `action` (enum: `user.create`, `user.update`, `user.statusChange`, `user.delete`,
  `user.roleChange`, `user.restrictedChange`, `auditAccess.grant`, `auditAccess.revoke`), `actorUid`,
  `actorEmail`, `targetUid`, `targetEmail`, `before`, `after`, `timestamp` (server timestamp, nunca
  client timestamp, para integridade).
- **Minimização obrigatória de `before`/`after`**: esses campos devem conter **apenas os campos
  efetivamente alterados** pela ação registrada (ex.: só `accessLevel` em `user.roleChange`, só
  `status` em `user.statusChange`, só `isRestricted` em `user.restrictedChange`) — nunca um snapshot
  integral do documento de usuário. Ficam explicitamente proibidos nesses campos: credenciais ou
  qualquer material de autenticação, e qualquer dado pessoal de colaborador (já vedado de forma mais
  ampla por C.1/C.2 — a trilha administrativa audita usuários da aplicação, não colaboradores). Campos
  como e-mail podem constar quando o próprio e-mail for o dado alterado (ex.: tentativa registrada de
  mudança), mas não devem ser replicados em eventos que não os alteraram.
- **Escrita exclusivamente no servidor**: toda gravação em `adminAuditLog` ocorre apenas pelo Admin SDK,
  dentro da mesma transação de cada endpoint em `api/users/*` — nunca por escrita direta do cliente, em
  nenhuma circunstância, inclusive admin. Mesmo padrão de `history` hoje
  (`api/tools/movement.js:436-448`, admin-only).
- **Regras Firestore da coleção**: `create`, `update` e `delete` devem ser `if false` para **todos os
  clientes**, sem exceção para Administrador — a única escrita válida é a do Admin SDK, que não é
  controlada pelas Firestore Rules (mesmo princípio já usado para `users/{userId}`,
  `firestore.rules:32-37`, onde write é sempre `false` para clientes). `read` pode ser condicionado à
  permissão dedicada de auditoria descrita abaixo. Documentos, uma vez criados pelo servidor, são
  imutáveis para qualquer cliente.
- Um evento por chamada bem-sucedida a cada endpoint de `api/users/*`, escrito na mesma transação da
  operação principal (evitar dessincronia entre a mudança e o registro).

**Ciclo de vida de usuários: desativação/reativação vs. exclusão definitiva**
- Estado atual [COMPROVADO]: `api/users/delete.js` executa exclusão permanente — remove o documento
  do Firestore (`delete.js:120`) e a conta do Firebase Auth (`delete.js:124`) — sem preservar
  histórico do usuário excluído; `src/js/modules/users.js:795` descreve `deleteUser` como exclusão
  permanente com confirmação, mas sem retenção de dados.
- Proposta: reservar `toggleStatus`/`status.js` (já existente, ativa/desativa sem apagar dados) como o
  caminho padrão de remoção de acesso — desativar e permitir reativação preservam o histórico do
  usuário (movimentações associadas, registros de auditoria onde ele foi ator ou alvo). A exclusão
  definitiva (`api/users/delete.js`) passaria a ser tratada como **procedimento excepcional**, não como
  ação de rotina — por exemplo, exigindo confirmação adicional e/ou justificativa registrada na trilha
  de auditoria antes de ser executada.
- Reativação de um usuário previamente desativado deve gerar seu próprio evento de auditoria
  (`user.statusChange` com `after: 'Ativo'`), distinguível de uma ativação inicial.

**Permissões específicas para a trilha de auditoria (distintas do acesso à tela de Usuários)**
- Permissão dedicada para **consultar** a auditoria administrativa, independente de `canAccessUsers`/
  `canAccessHistory` (`src/js/modules/auth.js:40-41`) — um Administrador comum não teria,
  automaticamente, acesso de leitura à trilha administrativa apenas por ser Administrador.
- Permissão **independente** para **conceder/revogar** acesso de consulta à trilha de auditoria,
  reservada a um subconjunto de "administradores designados" — não todo Administrador pode conceder
  esse acesso a outro.
- Proibição de autoatribuição: um administrador designado não pode conceder a si mesmo a permissão de
  auditoria caso ainda não a possua, no mesmo espírito da proteção já existente contra
  autopromoção/autoexclusão em `update.js:113-119` e `delete.js:66-71`.
- Proteção contra perda do último administrador designado: bloquear a revogação da permissão de
  auditoria do último administrador que a detém, no mesmo padrão de contagem transacional já usado
  para o último Administrador ativo (`delete.js:93-117`, `status.js:131-156`).
- **Designação inicial** do primeiro administrador com permissão de auditoria deve ocorrer por
  procedimento administrativo controlado **fora da interface comum** da aplicação (ex.: script
  administrativo executado com Admin SDK, ou ação direta no console do Firebase) — não deve existir,
  na primeira instalação desta funcionalidade, nenhum caminho dentro do app comum capaz de
  autoconceder essa permissão a ninguém.
- Toda concessão, revogação e reativação (de usuário ou de permissão de auditoria) deve, ela mesma,
  gerar um registro protegido e imutável na trilha de auditoria — sujeito às mesmas regras de
  integridade descritas acima (write `if false` para clientes após a criação).

**Cuidados com operações distribuídas entre Firebase Auth e Firestore**
- Estado atual [COMPROVADO]: os endpoints existentes já operam sobre dois sistemas distintos sem
  transação única entre eles. `api/users/status.js:110-114` chama `adminAuth.updateUser` **antes** da
  transação Firestore (linhas 116-161) e, em caso de falha na transação, tenta uma reversão manual
  best-effort do Authentication (linhas 162-174) — não uma reversão atômica. `api/users/delete.js:120-134`
  faz o inverso: a transação Firestore roda primeiro, depois `adminAuth.deleteUser` é chamado
  (linha 124); se este falhar por motivo diferente de "usuário já não existe", o código tenta recriar o
  documento Firestore como compensação (linha 128) — novamente best-effort, não atômico.
- Qualquer novo endpoint ou campo relacionado a D (trilha de auditoria) ou a C.4 (gestão de
  `isRestricted`) que grave em ambos os sistemas deve seguir o mesmo padrão de compensação best-effort
  já estabelecido, e **não deve prometer nem depender de atomicidade real entre Firebase Auth e
  Firestore** — o Firebase não oferece transação cross-serviço entre os dois. Testes de integração
  devem cobrir explicitamente o cenário de falha parcial (sucesso em um sistema, falha no outro) e
  verificar que a compensação best-effort é acionada e registrada (inclusive na própria trilha de
  auditoria, se D for aprovado).

**Leitura e UI**
- Autorização de leitura da trilha: conforme a permissão dedicada acima, não apenas admin-only
  genérico.
- Nova aba ou seção dentro da tela de Auditoria (B), visível apenas a quem detém a permissão de
  consulta, com filtro por ação/ator/alvo/período.
- Risco de regressão: qualquer escrita adicional nas transações de `api/users/*` deve ser avaliada
  quanto a desempenho; testes de integração devem cobrir que uma falha na escrita do log não deixe a
  operação principal (criação/edição/exclusão/reativação de usuário, concessão/revogação de permissão
  de auditoria) em estado inconsistente, dentro dos limites de atomicidade descritos acima.

---

## Critérios de aceitação (para as implementações futuras deste gate)

Aplicáveis a qualquer subgate de implementação de 1-F4 (A, B, C e/ou D), a depender do que for
aprovado:

1. **Responsividade**: telas de Usuários e Auditoria funcionam sem quebra de layout nas larguras já
   testadas nos gates anteriores (ex. 360×800, 390×844, 430×932, 1440×900), seguindo o padrão de
   `tests/responsive/*`.
2. **Acessibilidade**: navegação por teclado e leitura por leitor de tela nos novos controles (filtro
   Restrito, campo `isRestricted`, controles de permissão de auditoria, se aprovados), seguindo o
   padrão já usado nos testes e2e de Scanner/Colaboradores (Gate 1-F3.3B/1-F3).
3. **Autorização**: nenhuma alteração deve enfraquecer as proteções server-side já existentes em
   `api/users/*` (A.2) nem alterar os limites do Restrito além do que for explicitamente aprovado em
   C.4/D.2. Toda nova rota ou campo deve ser coberto por teste negativo (não-admin não consegue; e,
   quando D for implementado, administrador sem permissão de auditoria não consegue consultar nem
   conceder/revogar essa permissão).
4. **Proteção de dados — correção obrigatória, não aceitação**: nenhuma implementação decorrente deste
   gate pode introduzir nova exposição de dados pessoais de colaborador ao Restrito; as Divergências 1
   e 2 já existentes (C.2) **devem ser corrigidas** antes do fechamento do gate — não há alternativa de
   encerramento por aceitação formal da exposição atual, e o item não pode ficar implícito. A correção
   deve preservar integralmente empréstimo/devolução e não pode depender de o cliente Restrito receber
   o campo sensível por documento completo do Firestore nem por cache do cliente.
5. **Testes funcionais**: cobertura mínima para cada frente implementada, conforme detalhado nas
   seções A–D (hoje inexistente para Usuários e Auditoria, conforme relatado no REPORT de retomada),
   incluindo os testes negativos e de regressão especificados em C.4 e D.2.
6. **Regressão de empréstimos/devoluções**: qualquer mudança em `currentUser`/`currentCollaboratorId`,
   nas regras de `tools`/`collaborators`, ou na gestão de `isRestricted` (C.4), deve reexecutar (sem
   quebra) a suíte já existente: `tests/integration/movementEmulator.test.mjs`,
   `tests/integration/firestoreRulesEmulator.test.mjs`, `tests/e2e/restricted-loan.spec.js`,
   `tests/e2e/auth-restricted.spec.js`.
7. **Regras publicadas**: nenhuma publicação de regra sem a reconfirmação formal, direta e imediatamente
   anterior à publicação, descrita em C.3 — a evidência visual já coletada e o arquivo versionado não
   substituem essa reconfirmação.
8. **Ciclo de vida de usuários** (se D for aprovado): desativação/reativação de usuários preserva
   histórico e gera evento de auditoria próprio; exclusão definitiva só ocorre por procedimento
   excepcional, nunca como ação de rotina equivalente a desativar.
9. **Permissões de auditoria** (se D for aprovado): existe permissão dedicada para consultar a trilha,
   distinta de `canAccessUsers`/`canAccessHistory`; existe permissão independente e restrita para
   conceder/revogar esse acesso; autoatribuição é impossível; a revogação do último administrador
   designado é bloqueada; a designação inicial ocorre fora da interface comum; toda concessão/revogação
   é registrada de forma protegida e imutável.
10. **Atomicidade Auth/Firestore** (se C.4 ou D forem aprovados): nenhuma implementação promete ou
    depende de atomicidade real entre Firebase Auth e Firestore; toda operação distribuída segue o
    padrão de compensação best-effort já existente em `status.js`/`delete.js`, com teste de integração
    cobrindo o cenário de falha parcial.

---

## Sequência recomendada dos próximos subgates

1. **1-F4.B — Planejamento da contenção.** Definição, apenas em documentação/design técnico (sem
   implementar), de **como** corrigir as Divergências 1 e 2 de C.2 — a correção em si já é requisito
   aprovado, não decisão de escopo (ver critério 4). Cobre as opções técnicas concretas (ex.:
   `currentUser` substituído por identificador não-nominal; resposta da Movement API sem
   `collaborator.name`/`role` para Restrito; necessidade ou não de filtragem server-side/Cloud
   Function), a especificação da conferência de crachá na devolução (C.1), e a decisão sobre o escopo
   de D (confirmação final de cada proposta da seção D.2). Nenhuma implementação nesta etapa.
2. **1-F4.C — Reconfirmação das regras e correção controlada de privacidade.** Duas partes, nesta
   ordem: (i) reconfirmação formal, direta e atual das regras publicadas em produção (C.3) — distinta
   da evidência visual já coletada — antes de qualquer mudança em `firestore.rules`; (ii)
   **implementação controlada** das correções de privacidade planejadas em 1-F4.B, **somente mediante
   autorização específica de gate para essa implementação** (este documento não constitui essa
   autorização). Essas correções **devem preceder** qualquer ampliação do acesso ao ambiente de Preview
   da Vercel.
3. **1-F4.D** — Redesign visual das telas de Usuários (A.3) e Auditoria (B.2), sem mudança de
   comportamento — etapa posterior à conclusão de 1-F4.C.
4. **1-F4.E** — Implementação da gestão do perfil Restrito pelo Administrador (C.4: criação e edição,
   com os testes negativos e de regressão especificados), se aprovada — etapa posterior.
5. **1-F4.F** — Implementação da trilha de auditoria administrativa (D.2), se aprovada — depende de
   C.4 estar concluído, pois `user.restrictedChange` é um dos eventos a auditar, e depende da decisão
   de 1-F4.B sobre as permissões de auditoria e o modelo de ciclo de vida de usuários — etapa
   posterior.
6. **1-F4.H — Encerramento.** Reservado para testes integrados cobrindo todas as frentes implementadas
   (A–D) e revisão final do gate 1-F4, incluindo a suíte de regressão de empréstimo/devolução listada
   no critério 6. Não inicia antes da conclusão das etapas 1 a 5.

Nenhuma implementação foi ou deve ser executada nesta etapa (1-F4.A) — a sequência acima é apenas
planejamento; o início de 1-F4.B aguarda autorização própria do Cowork.
