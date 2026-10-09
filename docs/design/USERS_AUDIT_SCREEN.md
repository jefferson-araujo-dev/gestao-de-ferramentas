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

## E. Planejamento da contenção (Gate 1-F4.B, revisado em 1-F4.B1)

> Esta seção substitui a versão produzida em 1-F4.B e a corrige nos pontos A–E do gate 1-F4.B1
> (mapeados em E.1–E.5). Continua sendo só planejamento: **nenhum código, regra ou dado foi
> alterado para produzi-la.** Rótulos: **[APROVADO]** requisito já decidido; **[COMPROVADO]** fato do
> código em `d0c2072`, com arquivo:linha; **[PROPOSTO]** sugestão sujeita a decisão do Cowork.
> Nada rotulado [PROPOSTO] autoriza implementação. Citações sem caminho completo referem-se a
> `api/tools/movement.js` (`movement.js`) e aos módulos em `src/js/modules/`.

### E.0 Correções em relação à versão 1-F4.B [COMPROVADO]

- A versão anterior tratava só `data.collaborator` na resposta de empréstimo. A resposta também
  devolve `data.tool.currentUser` (nome) e `data.tool.currentCollaboratorId` (ID) a todos os perfis,
  inclusive o Restrito (`movement.js:270-276,299,369-381`). Corrigido em E.1.
- A versão anterior afirmava que o Scanner não dependia de `collaborator.name`. Está errado:
  `scanner.js:754,759,762-765,781` usa `movement.collaborator.name`/`role`. Sem o campo,
  `borrower.name` lança `TypeError` depois de o empréstimo já ter sido gravado, e o `catch`
  (`scanner.js:786-809`) mostra "Falha de comunicação", o que induz nova tentativa sobre uma
  ferramenta já emprestada. Corrigido em E.1 e E.4.
- A opção escolhida para a Divergência 2 mantinha `currentCollaboratorId` no documento de `tools`,
  que o Restrito lê (`firestore.rules:51`). Isso viola C.1 ("identificador interno"). Descartada em
  E.2.
- Não havia tratamento do cache do navegador nem ordem de execução. Acrescentados em E.3 e E.4.
- A versão anterior citava "linhas 172-178 desta mesma seção", que não existem na seção E (eram
  linhas de C.2). Referências removidas.
- Esta revisão passou por revisão independente somente leitura (1-F4.B1). As objeções conferidas no
  código foram incorporadas: etapa C0 para `collaborators`, resíduo de DOM e memória antecipado para
  C1, endpoint obrigatoriamente POST por causa do service worker, snapshot do cache antes do
  `permission-denied`, oráculo de crachá e de tempo, e três citações corrigidas.

### E.1 Resposta da Movement API ao Restrito — lista fechada de campos

**Estado atual [COMPROVADO]**

- Empréstimo, qualquer perfil: `data = { action, tool, collaborator }` (`movement.js:477-485`), com
  `tool = { id, status, currentUser, currentCollaboratorId, lastAction }` (`movement.js:270-276`,
  devolvido em `299`) e `collaborator = { name, role }` (`movement.js:386-392`).
- Devolução, qualquer perfil: `data = { action, tool }` (`movement.js:490-497`), com
  `tool = { id, status, currentUser: null, currentCollaboratorId: null, lastAction }`
  (`movement.js:421-427`). Não expõe valor, mas as chaves existem.
- Falhas: `{ success, message }` e, no crachá não autorizado, `code` (`movement.js:508-516`). As
  mensagens de falha do Restrito são fixas (`movement.js:21-22,302-310`).
- O único cliente da API é o Scanner (`scanner.js:21,685,744`). Ele não lê `data.tool`: o
  empréstimo usa só `movement.collaborator` (`scanner.js:754`) e a devolução descarta o retorno
  (`scanner.js:685-692`).

**Lista fechada [PROPOSTO]** — qualquer chave fora dela fica ausente do JSON (ausente, não `null`):

| Resposta | Restrito | Administrador / Padrão |
|---|---|---|
| Empréstimo 200 | `success`, `message`, `data.action`, `data.tool.id`, `data.tool.status`, `data.tool.lastAction` | os mesmos + `data.collaborator.name`, `data.collaborator.role` |
| Devolução 200 | `success`, `message`, `data.action`, `data.tool.id`, `data.tool.status`, `data.tool.lastAction` | os mesmos |
| Falha 4xx | `success`, `message` (texto fixo, sem dado de colaborador), `code` quando houver | os mesmos; mensagens específicas permitidas, como hoje |

- `data.tool` segue a mesma lista para todos os perfis. Tirar `currentUser`/`currentCollaboratorId`
  também de Admin/Padrão não quebra nada, porque nenhum cliente lê esses campos da resposta.
- A resposta é montada campo a campo a partir da lista, e não pela remoção de campos do objeto
  gravado — assim um campo novo no documento não vaza por omissão.
- `data.collaborator` só existe quando `restricted === false` (`movement.js:465`).

**Impacto em `assertLoanSuccessShape` [PROPOSTO]** (`tests/integration/movementEmulator.test.mjs:200-211`)

- Hoje a função exige, para todos os perfis, `data` = `['action','collaborator','tool']` (linha
  203), `tool` com `currentCollaboratorId` e `currentUser` (linhas 204-208) e `collaborator` =
  `['name','role']` (linha 210). Os testes 05 e 06 afirmam que o Restrito recebe o nome (linhas
  349-350 e 374-375).
- Passa a receber o perfil. Restrito: `data` exatamente `['action','tool']`; `tool` exatamente
  `['id','lastAction','status']`; `assertNoLeak` (linhas 192-198) aplicado também ao corpo de
  sucesso. Admin, Padrão, legado e adminflag (chamadas nas linhas 313, 337, 643, 654): `data` =
  `['action','collaborator','tool']`, com o mesmo `tool` reduzido.
- Os testes 05 e 06 passam a exigir a ausência de `collaborator`. A lista `SENSITIVE` (linhas
  179-190) ganha `'Colaborador Zeta'` e `'c6'`, usados no teste 06. A evidência
  `MOVEMENT_RESTRICTED_RESPONSE_FIELDS` (linha 365) passa a registrar `data.tool{id,lastAction,status}`.
- O teste 16 (linha 539) passa a exigir o `tool` reduzido na devolução.

**Impacto no Scanner e no comprovante [PROPOSTO]**

- Para o Restrito, o toast e a caixa de status passam a texto operacional ("Empréstimo
  registrado"), sem nome (`scanner.js:759,781`).
- O Scanner hoje gera para o Restrito o PDF "TERMO DE RESPONSABILIDADE" com nome, função e o
  crachá digitado (`scanner.js:761-765`; `pdf.js:4,30-33,46`) [COMPROVADO]. Para o Restrito passa a
  ser um comprovante operacional: protocolo, patrimônio, descrição da ferramenta, operação e
  data/hora, sem nome, crachá, função ou ID do colaborador. Base [APROVADO — C.1]: "comprovante...
  apenas operacional" e "termo nominal... fluxo separado".

### E.2 Vínculo ferramenta → colaborador

**Requisito [APROVADO — C.1/C.2]**: nem o nome nem o ID do colaborador podem chegar ao Restrito, seja
pelo listener, pela API ou pelo cache.

**Fatos que limitam as opções [COMPROVADO]**

- As regras do Firestore valem por documento, não por campo. Enquanto o Restrito puder ler `tools`
  (`firestore.rules:51`), todo campo do documento chega a ele pelo listener (`data.js:119-141`),
  aberto para qualquer perfil autenticado (`auth.js:32,36`).
- O vínculo fica em `tools.currentUser` + `tools.currentCollaboratorId`. A Movement API grava
  (`movement.js:278-283`) e zera na devolução (`movement.js:429-434`); a manutenção também zera
  (`api/tools/maintenance.js:284-285,295-296`).
- Quem lê o vínculo no cliente: Ferramentas (`tools.js:1509,1527-1528`), Dashboard
  (`ui.js:763,808-813`), Scanner (`scanner.js:627-628`), pendências por colaborador — comparando
  **nome** (`collaborators.js:421-428`) —, exportações Excel (`data.js:664`; `tools.js:346,450`) e o
  fallback do PDF (`pdf.js:30-33`).
- Escritas fora da Movement API: a importação Excel grava em `currentUser` texto livre da planilha
  (`data.js:765-775`, campo na linha 772). É uma criação (`addDoc`), que a regra permite quando a
  ferramenta não nasce emprestada (`firestore.rules:53`). O restore grava `tools` campo a campo, validando só
  `id`/`code`/`status` (`src/js/utils/backupContract.js:296,309-317`).
- A opção escolhida em 1-F4.B (remover só o nome e manter `currentCollaboratorId`) não atende: o ID
  continua num documento que o Restrito lê.

**Alternativas [PROPOSTO]**

**B1 — Negar `tools` ao Restrito; o Restrito consulta a ferramenta por API.** O vínculo continua em
`tools`. A regra de leitura de `tools` passa a `canReadCollaborators()`, a mesma condição já usada
para colaboradores (`firestore.rules:27-30`). O Restrito não abre o listener de `tools`; no Scanner,
busca a ferramenta lida num endpoint que devolve só `{ id, code, name, category, status, imageUrl,
nextMaintenance }`.

- Rules: muda uma linha (`firestore.rules:51`); nenhuma regra nova.
- Listener: Admin/Padrão sem mudança; Restrito sem listener de `tools`.
- Telas de Admin/Padrão: sem mudança.
- Telas do Restrito: o Scanner passa a consultar a API (hoje procura em `App.Data.tools`,
  `scanner.js:515-520`). A resposta precisa trazer o `id` do documento, que o Scanner usa como
  `toolId` (`scanner.js:687,746`). Dashboard e Ferramentas, abertas a todos
  (`src/js/config/navigation.js:30,54`), ficariam sem dados. É preciso decidir: ocultá-las para o
  Restrito ou servir uma lista reduzida pela mesma API. Se forem ocultadas, a rota padrão `painel`
  (`navigation.js:9`) precisa apontar o Restrito para o Scanner.
- Método do endpoint: obrigatoriamente POST com `cache: 'no-store'`, como a Movement API
  (`scanner.js:21-29`). O service worker grava em CacheStorage **todo GET da mesma origem**,
  inclusive `/api/*` (`src/sw.js:41-75`), e esse cache é compartilhado entre os usuários do
  navegador. [COMPROVADO quanto ao SW; apontado pela revisão independente]
- Backup/restore: sem mudança (o conteúdo de `tools` não muda; o restore usa a Admin SDK).
- Importação: sem mudança quanto à exposição, porque só quem já lê colaboradores passa a ver `tools`.
- Migração de dados em produção: nenhuma.
- Infraestrutura: nenhuma nova. É um endpoint a mais na plataforma de funções já usada (`api/` tem
  9 funções hoje). Ele é necessário porque, com a leitura negada, o Restrito não tem outro canal
  para saber status e nome da ferramenta — a Movement API só registra movimentos. No plano Hobby
  da Vercel o limite é de 12 funções por deploy; com o endpoint seriam 10. Qual plano o projeto usa
  não foi verificado. Se o limite for problema, a consulta pode virar uma ação da própria
  `api/tools/movement.js`.
- Custo: o Restrito perde a lista em tempo real (com POST sem cache, cada consulta sai atualizada
  do servidor) e a navegação dele muda.

**B2 — Mover o vínculo para uma coleção própria, `toolAssignments/{toolId}`.** `tools` fica só com
`status`/`lastAction`; `{ collaboratorId, collaboratorName, since }` vai para a nova coleção, escrita
só pela Admin SDK na transação do movimento.

- Rules: coleção nova com `read: canReadCollaborators()` e `write: false`. Em `tools`, retirar as
  comparações de `firestore.rules:58-59` e proibir `currentUser`/`currentCollaboratorId` em escritas
  do cliente; sem isso, a importação (`data.js:772`) volta a gravar nomes.
- Listener: o Restrito mantém o de `tools` (tempo real preservado, documento sem dado pessoal);
  Admin/Padrão ganham mais um.
- Telas de Admin/Padrão: todos os leitores listados acima passam a juntar por `toolId`;
  `collaborators.js:426` passa a comparar ID em vez de nome.
- Backup/restore: a coleção entra em `RESTORABLE_COLLECTIONS` (`backupContract.js:22`), no hash
  canônico, no reset (`server/backup-operations.js:418`) e numa validação cruzada (`borrowed` ⇔
  vínculo). A versão do backup sobe e os backups v4 precisam ser convertidos na importação; do
  contrário, restaurar um backup antigo devolve os nomes a `tools`.
- Importação: deixa de gravar `currentUser`.
- Migração em produção: obrigatória (mover o vínculo de cada ferramenta emprestada e apagar os
  campos). É ponto de não retorno, recuperável só por restore.
- Infraestrutura: nenhuma nova (só uma coleção), mas a superfície de mudança é grande.

**B3 — Guardar o vínculo no documento do colaborador (`collaborators/{id}.activeToolIds`).** `tools`
fica sem vínculo; Admin/Padrão já leem `collaborators`.

- Rules: hoje o Admin grava colaboradores pelo cliente sem restrição de campo
  (`firestore.rules:68`; `collaborators.js:865,911,1154,1196`). Seria preciso congelar
  `activeToolIds` e impedir a exclusão de colaborador com ferramenta — regra nova e mais complexa
  que a de `tools`.
- Listener: nenhum novo; o Restrito mantém `tools`.
- Telas: a mesma junção de B2, no sentido inverso (varrer colaboradores por `toolId`).
- Backup/restore: validação cruzada `tools.status` ⇔ `activeToolIds`; conversão de backups v4.
- Importação: a de colaboradores não pode tocar no campo; a de ferramentas deixa de gravar
  `currentUser`.
- Migração em produção: obrigatória.
- Outros: empréstimos simultâneos ao mesmo colaborador disputam o mesmo documento, e um estado
  operacional passa a morar num cadastro editado pela UI.

**Recomendação [PROPOSTO]: B1.**

- É a única das três sem migração de dados em produção e sem mudança no contrato de backup, que são
  os pontos mais difíceis de reverter em B2 e B3.
- Telas e fluxos de Admin/Padrão não mudam; a mudança fica no caminho do Restrito.
- A correção de segurança é uma regra de uma linha, revertível republicando a versão anterior e
  testável no emulator (Restrito: `get` e `list` em `tools` negados).
- Segue o padrão já adotado de o Restrito operar por API com o servidor resolvendo a identidade
  (`movement.js:120-122`; comentário em `firestore.rules:24-26`).
- Tira do alcance do Restrito, como efeito colateral, outros campos de `tools` que ele lê hoje,
  como `lastMaintenanceBy` — nome do administrador (`maintenance.js:277-279,290`).
- Premissa: B1 só protege se a regra de `collaborators` publicada em produção for a do arquivo
  versionado (`firestore.rules:27-30,66-69`). A evidência visual registrada em C.3 indica o
  contrário. Por isso E.4 põe a reconfirmação e a publicação da regra de `collaborators` na
  primeira etapa (C0), e não no fim.

Decisão pendente dentro de B1: Dashboard e Ferramentas para o Restrito. (a) Ocultar e deixar só o
Scanner — menor mudança; o requisito aprovado garante ao Restrito apenas empréstimo e devolução. (b)
Servir lista reduzida pela API. Recomendação: (a).

### E.3 Cache do navegador

**Estado atual [COMPROVADO]**

- O Firestore usa cache persistente em IndexedDB (`src/js/app.js:64-68`, `persistentLocalCache`).
  Os documentos recebidos pelos listeners ficam gravados no navegador: `tools` para todos;
  `users`, `collaborators` e `history` para quem tem permissão (`data.js:119-207`).
- Logout (`auth.js:292-303`) e fim de sessão (`auth.js:138-157`) só encerram os listeners
  (`data.js:101-109`). Não limpam o IndexedDB nem os arrays em memória `tools`, `users`,
  `allHistoryLogs` e `history` (`data.js:249`). Só `collaborators` é zerado, e só quando o perfil
  que entra é Restrito (`data.js:170-174`). `clearIndexedDbPersistence` só é chamado quando o
  IndexedDB corrompe (`app.js:86-100`).
- O logout não recarrega a página, e `renderAll` só redesenha a aba ativa (`ui.js:552-566`). O HTML
  já desenhado de Colaboradores, Auditoria e Ferramentas continua no DOM, oculto, quando o próximo
  usuário entra na mesma aba. No Scanner, `clearOperation` esconde os blocos mas não esvazia
  "Responsável atual" nem "Guarda: nome" (`scanner.js:627-628,781,816-852`). [apontado pela
  revisão independente e conferido]
- O service worker grava em CacheStorage todo GET da mesma origem (`src/sw.js:41-75`). As chamadas
  à Movement API são POST (`scanner.js:21-29`) e o Firestore é outra origem, então hoje nenhum dos
  dois passa por ele.
- `CacheManager.persist`/`restore` (`src/js/core/CacheManager.js:267-310`) não são chamados em `src/`
  (busca por `.persist(` e `.restore(` sem ocorrências). O único uso do CacheManager é o perfil do
  próprio usuário, em memória (`auth.js:158-170`).
- Premissa de trabalho [PROPOSTO — a confirmar pelo teste abaixo]: o SDK Web mantém um único
  IndexedDB por app/projeto; as filas de mutação são separadas por uid, mas os documentos em cache
  são compartilhados. Assim, um Restrito que entra num navegador usado antes por Admin/Padrão tem
  nomes, crachás e IDs de colaboradores no IndexedDB, legíveis pelo DevTools.
- Premissa de trabalho [PROPOSTO — a confirmar pelo teste abaixo]: o `onSnapshot` entrega primeiro o
  resultado do cache local, que não passa pelas regras, e só depois recebe `permission-denied` do
  servidor. Então, mesmo com as regras corrigidas, um bundle antigo que ainda abra o listener pode
  **mostrar na tela** dados cacheados de uma sessão anterior.

**Proposta [PROPOSTO]**

1. Dados já gravados nos dispositivos: na primeira carga da versão corrigida, antes de abrir
   qualquer listener, limpar o cache persistente uma vez (marca de versão local, `terminate`,
   `clearIndexedDbPersistence`, recarga). Dispositivos que não abrirem mais o app mantêm o que já
   têm; não há como apagar remotamente. Fica registrado como risco residual. Com
   `persistentSingleTabManager` (`app.js:66`), a limpeza pode falhar se houver outra aba do app
   aberta; a implementação precisa tratar essa falha (tentar de novo na próxima carga) e o teste
   precisa cobri-la.
2. Troca de usuário: em todo logout e em toda entrada de usuário diferente, zerar todos os arrays
   de dados em memória (não só `collaborators`) e recarregar a página, para descartar o DOM já
   desenhado. Isso vale qualquer que seja o resultado do teste, porque os resíduos em memória e no
   DOM já estão comprovados acima. Com B1 o resíduo piora (o Restrito deixa de receber o snapshot
   que hoje substitui `tools`), por isso este item vai para a etapa C1, antes de C4.
3. Cache persistente: definido pelo teste abaixo. Se o marcador aparecer, a limpeza roda no logout
   **e** no login com uid diferente do anterior. O logout sozinho não cobre sessão encerrada sem
   logout (aba fechada, token expirado). Alternativa mais simples, para o Cowork avaliar: trocar
   `persistentLocalCache` por cache em memória para todos, eliminando o problema ao custo do cache
   offline.
4. Com B1, o próprio Restrito deixa de gravar `tools` no IndexedDB, porque não abre o listener.

**Teste decisivo [PROPOSTO — executar em 1-F4.C, não nesta etapa]**

- Ambiente: Firestore e Auth Emulator; build com `VITE_USE_FIREBASE_EMULATOR=true`
  (`app.js:73-84`); Playwright com contexto persistente num diretório temporário, para o IndexedDB
  sobreviver entre logins e recargas. Guardas que recusam rodar contra projeto real, no padrão de
  `movementEmulator.test.mjs:246-291`.
- Marcador sintético único, sem dado real: colaborador `MARCADOR-7F3A-NOME`, crachá
  `MARCADOR-7F3A-CRACHA`, ID `marcador-7f3a-id`; uma ferramenta emprestada a ele; um registro em
  `history` com o nome.
- Roteiro: (1) login Admin e abertura de Ferramentas, Colaboradores e Auditoria até o marcador
  aparecer; (2) logout pela UI; (3) login Restrito no mesmo contexto. Variantes: com recarga entre
  (2) e (3); sem logout (fechar a página, reabrir, entrar como Restrito).
- Coleta depois de (3): (a) todos os bancos de `indexedDB.databases()` e todos os object stores,
  percorrendo os valores recursivamente em busca das três strings; (b)
  `window.App.Data.tools`, `users`, `collaborators`, `history` e `allHistoryLogs`; (c) o DOM
  inteiro por `outerHTML`/`textContent`, incluindo nós ocultos e atributos (`innerText` ignora nós
  ocultos); (d) o corpo de toda resposta de rede recebida na sessão do Restrito; (e) o CacheStorage
  do service worker.
- Variante adicional, depois das regras corrigidas (emulator com as regras novas): bundle antigo
  com listener de `tools`, em navegador com cache de sessão Admin — verificar se o marcador aparece
  na tela antes do `permission-denied`.
- Regra de decisão: marcador em (a) → limpeza de cache obrigatória no logout e no login com uid
  diferente (ou cache em memória); em (b) ou (c) → confirma o item 2; em (d) ou (e) → falha de
  E.1/E.2, bloqueante; na variante adicional → reforça a necessidade do item 1 antes de C8. Depois
  da correção, o mesmo teste tem de passar sem nenhuma ocorrência e fica como teste de regressão.

### E.4 Ordem de execução

**Princípio [PROPOSTO]**: cada etapa em gate próprio. Cada mudança de código tem de funcionar com as
regras e os dados publicados naquele momento. A regra de `tools` vem por último; a de
`collaborators` vem primeiro, porque o cliente atual já não depende de o Restrito ler colaboradores
(`data.js:170-174`). Um PWA com bundle antigo pode seguir ativo até o service worker trocar de
versão (`app.js:141-150`), então toda mudança de contrato sai em duas publicações: primeiro o
cliente tolerante, depois o servidor.

| Etapa (gate) [PROPOSTO] | Conteúdo | O que fica irreversível |
|---|---|---|
| C0 | Reconfirmação direta das regras publicadas (C.3) e, se `collaborators` estiver aberta ao Restrito, publicação da regra versionada de `collaborators` (`firestore.rules:27-30,66-69`) por pessoa autorizada, depois dos testes de regras no emulator | Regra revertível republicando a anterior. A exposição de colaboradores até aqui não é recolhível |
| C1 | Cliente tolerante: Scanner funciona com e sem `collaborator`; comprovante operacional para o Restrito (E.1); zerar memória e recarregar a página na troca de usuário (E.3, item 2). Ajustar `tests/e2e/restricted-loan.spec.js:122,258`, que exigem "Autorizada para Colaborador …" no toast | Nada; código revertível |
| C2 | Movement API com lista fechada (E.1) e testes do emulator ajustados | Nada |
| C3 | Devolução com crachá (E.5) em três passos: a API aceita crachá opcional e confere quando vier; o cliente passa a enviar; a API torna obrigatório. Caminho administrativo junto | Nada. Na transição, a devolução sem crachá continua possível, como hoje |
| C4 | Caminho do Restrito (B1): endpoint de consulta, Restrito sem listener de `tools`, navegação conforme a decisão de E.2 | Nada. Com a regra antiga publicada, o Restrito ainda consegue ler `tools` por fora do app |
| C5 | Cache (E.3): teste decisivo; depois, limpeza conforme o resultado | A limpeza apaga cache local, que o servidor repõe; o que já foi exposto não volta |
| C6 | Backup completo pela tela Dados e Backup, guardado fora do repositório, com hash conferido | Nada; o arquivo contém dados pessoais e exige guarda controlada |
| C7 | Migração de dados em produção | Com B1: não se aplica. Com B2/B3: obrigatória e ponto de não retorno; recuperação só por restore do backup de C6, perdendo os movimentos posteriores |
| C8 | Regras: nova reconfirmação direta das regras publicadas (C.3), testes de regras no emulator e publicação de `tools: read if canReadCollaborators()` por pessoa autorizada. Ajustar `tests/integration/firestoreRulesEmulator.test.mjs:207`, que hoje registra `RESTRICTED_TOOLS_READ` como `ALLOWED` | A regra é revertível republicando a anterior. Clientes antigos com listener de `tools` passam a receber `permission-denied`, mas podem antes mostrar dados do cache local (E.3). Só publicar depois de C4 e C5 ativos nos dispositivos do Restrito |

- Até C8 a Divergência 2 continua aberta: qualquer Restrito consegue ler `tools` pelo SDK. C2 e C4
  reduzem a exposição dentro do app, mas não a fecham.
- A condição de C8 ("C4 e C5 ativos nos dispositivos") não é verificável hoje: o app não informa
  sua versão ao servidor. Decisão pendente do Cowork: aceitar um prazo de espera após C5, ou
  acrescentar a C4 uma verificação de versão mínima.
- Nenhuma etapa exige que o Claude Code acesse o Firebase real. C0, C6 e C8 são executados por
  pessoa autorizada.
- Irreversível em qualquer ordem: o que já chegou a dispositivos de Restritos antes da correção
  (cache, PDFs de termo já baixados) não pode ser recolhido.

### E.5 Devolução: abrangência da conferência e casos de exceção

**Estado atual [COMPROVADO]**: a devolução não pede crachá (`movement.js:134-137`;
`scanner.js:685-692`), e o teste 16 exige que um crachá enviado na devolução seja rejeitado com 400
(`movementEmulator.test.mjs:550-555`). `registerReturn` já aceita empréstimo sem ID
(`movement.js:416-419`).

**Abrangência [PROPOSTO]**

- A conferência vale no fluxo comum do Scanner para **todos os perfis** (Admin, Padrão, Restrito),
  como o contrato de empréstimo já é único (`movement.js:120-122`). O requisito aprovado a exige
  para o Restrito [APROVADO — C.1]; estendê-la aos demais evita dois contratos.
- Respostas: o Restrito recebe só CONFERE (200) ou NÃO CONFERE (422, com `code` fixo, por exemplo
  `RETURN_NOT_CONFIRMED`, e a mesma mensagem para todas as causas). Admin e Padrão podem receber
  mensagem específica, como no empréstimo (`movement.js:302-321`).
- CONFERE: o crachá resolve para exatamente um colaborador, e o ID dele é igual a
  `currentCollaboratorId`. O status do colaborador não conta — quem está com a ferramenta pode
  devolvê-la mesmo inativo. Decisão do Cowork.
- NÃO CONFERE: crachá inexistente, duplicado ou de outra pessoa; colaborador excluído; empréstimo
  sem `currentCollaboratorId`. Nada é gravado na ferramenta nem em `history`, e a tentativa não
  deixa registro com dado de colaborador.
- A consulta do crachá roda sempre, mesmo quando o empréstimo não tem `currentCollaboratorId`, para
  que o tempo de resposta não indique a causa do NÃO CONFERE.

**Caminho mínimo para o Administrador [PROPOSTO]**

- Ação "Devolução administrativa" na linha da ferramenta emprestada, na tela Ferramentas, só para
  Admin. No servidor: `requireActiveAdmin` (`server/admin-authorization.js:71`); corpo
  `{ toolId, device, reason }`, com `reason` obrigatório (10 a 500 caracteres); sem conferência de
  crachá.
- Mesma transação da devolução comum: zera o vínculo e grava em `history` um registro tipo `in` com
  `resolution: 'admin_override'`, `reason`, `operatorUid` e `operatorEmail`.
- Resolve os dois casos: NÃO CONFERE no Scanner e empréstimo antigo sem ID.
- Implementação preferida: nova ação na própria `api/tools/movement.js`, sem função nova.
- Testes: o Admin consegue; Padrão, Restrito e legado recebem 403 antes de qualquer leitura; sem
  `reason`, 400; o registro em `history` traz os campos acima.
- Pendente: incluir ou não o Usuário Padrão nesse caminho. O texto aprovado de C.1 cita
  "Administrador/Usuário Padrão" como pessoas autorizadas; o gate 1-F4.B1 pediu o mínimo para o
  Admin.

**Empréstimos antigos sem ID**: quantidade em produção NÃO DETERMINADA, porque exige ler o Firebase
real, o que está fora deste gate. Tratamento [PROPOSTO]: sempre NÃO CONFERE no fluxo comum; saída
só pelo caminho administrativo.

**Risco registrado [PROPOSTO]**: há oráculo de crachá sem limite de tentativas. No empréstimo ele
já existe hoje: 200 para crachá válido e ativo, 422 para os demais; o teste 17 exige que a falha
não grave nada (`movementEmulator.test.mjs:596-598`). A devolução proposta cria outro: CONFERE
confirma que o crachá é do responsável (com efeito visível, porque executa a devolução). Proposta,
para decisão do Cowork: registrar cada tentativa falha sem dado de colaborador (uid do operador,
ferramenta, contagem) e limitar tentativas por uid, nos dois fluxos. Enquanto isso não for
decidido, o risco fica aceito explicitamente, não implícito.

**Testes (1-F4.C) [PROPOSTO]**: CONFERE para os três perfis; NÃO CONFERE com crachá de outro
colaborador, inexistente, duplicado e com empréstimo sem ID, com respostas idênticas para o
Restrito e `assertNoLeak`; reescrita do teste 16 (crachá passa a ser obrigatório); regressão
completa de `movementEmulator.test.mjs` e `tests/e2e/restricted-loan.spec.js`.

**Implementado (Gate 1-F4.C3) [COMPROVADO]** — registra o que foi de fato construído e onde isso
diverge do texto [PROPOSTO] acima (que permanece como registro histórico da proposta):

- **Resposta uniforme, não diferenciada por perfil**: ao contrário do texto acima ("Admin e Padrão
  podem receber mensagem específica"), a implementação usa a MESMA resposta CONFERE (200)/NÃO
  CONFERE (422, `code: 'RETURN_NOT_CONFIRMED'`, mesma mensagem para todas as causas) para os três
  perfis (Admin, Padrão, Restrito) — decisão do Claude Code, mais restritiva que o proposto, para
  alinhar com o texto do próprio gate 1-F4.C3 ("nunca nome, crachá, função... para nenhum perfil, em
  nenhum dos dois casos"). `api/tools/movement.js:createReturnNotConfirmedError/registerReturn`.
- **Devolução administrativa disponível para Admin E Padrão** (decisão do Cowork registrada no gate
  1-F4.C3, que resolve o "Pendente" deixado acima): implementada como ação `return_admin` no próprio
  `api/tools/movement.js` (`registerReturnAdmin`), autorizada para qualquer perfil não-restrito
  (`!isRestrictedOperator`), negada ao Restrito com 403 antes de qualquer leitura. Campo de
  auditoria simples gravado como `returnMethod: 'administrative'` (devolução comum grava
  `returnMethod: 'badge_verified'`) — não `resolution: 'admin_override'` como o texto acima
  cogitava; o nome do campo foi ajustado para descrever o método, não uma resolução de conflito.
- **UI**: no Scanner, a devolução comum passa a pedir o crachá de quem devolve
  (`#return-user-badge`) antes de habilitar "Devolver"; Admin/Padrão veem um link "Devolução
  administrativa" que troca para um formulário de motivo (`#return-admin-step`), ausente para o
  Restrito. Não foi implementada na tela Ferramentas (linha da ferramenta emprestada) como o texto
  acima cogitava — colocar a ação no próprio fluxo de devolução do Scanner evita expandir a
  visibilidade do menu de ações da tela Ferramentas (hoje restrito a quem tem `canManageTools`,
  só Admin) para o Padrão, o que estaria fora do escopo autorizado nesta etapa.
- **Rate limit do oráculo de crachá [COMPROVADO — não havia nenhum antes deste gate]**: busca prévia
  no código confirmou que não existia rate limit em nenhum endpoint do projeto, nem no empréstimo
  (contradizendo a suposição do "Risco registrado" acima, que presumia poder haver um). Implementado
  do zero em `api/tools/movement.js` (`assertBadgeRateLimit`/`registerBadgeFailure`), com um único
  contador por uid do operador (`badgeRateLimits/{uid}`, só uid/contagem/janela — nenhum dado de
  colaborador), compartilhado entre empréstimo e devolução, cobrindo toda falha de resolução de
  crachá (inclusive as antes genéricas do Restrito). Limite: **5 tentativas falhas por 60
  segundos por uid** — proposta do Claude Code, sem referência prévia no projeto para calibrar;
  valor conservador sujeito a ajuste do Cowork. Resposta de bloqueio: 429,
  `code: 'BADGE_RATE_LIMITED'`, mesma mensagem genérica, sem dado de colaborador.

### E.6 Recomendação sobre o escopo de D [PROPOSTO — recomendação; decisão final do Cowork; texto inalterado desde 1-F4.B]

**Recomendação**: não incluir D (trilha de auditoria administrativa, D.2) no fechamento deste
gate 1-F4. Tratar D como iniciativa própria, com gate de escopo dedicado, a ser aberto somente
após a conclusão de 1-F4.C (correção obrigatória de C.2) e, se aprovado C.4, após sua conclusão —
exatamente a ordem de dependência que o próprio D.2 já reconhece (`user.restrictedChange` como
evento a auditar).

**Por quê**:
- D.2 introduz uma funcionalidade nova e extensa (nova coleção, novo modelo de permissões
  independente de `canAccessUsers`, fluxo de designação inicial fora do app, proteção contra
  autoatribuição e perda do último administrador designado, ciclo de vida
  desativação/reativação/exclusão, e compensação best-effort entre Firebase Auth e Firestore) —
  escopo comparável, isoladamente, a um gate completo, não a um item dentro de 1-F4.
- A correção das Divergências 1 e 2 (C.2) é obrigatória e bloqueante para o encerramento deste gate
  (critério de aceitação 4); D não é necessário para essa correção nem depende dela — são frentes
  independentes. Empacotar as duas no mesmo gate aumenta o risco de a decisão de escopo de uma
  funcionalidade nova (D) atrasar o fechamento de uma correção de segurança já aprovada e pendente
  (C.2).
- O redesign visual (A, B) também não depende de D.
- Caso o Cowork opte por aprovar D, a sequência já registrada no documento (1-F4.F, após 1-F4.C e
  1-F4.E) continua válida como plano de implementação; esta recomendação afeta apenas o
  agrupamento em gates, não o conteúdo técnico já descrito em D.2.

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
   **Planejamento concluído — ver seção E.** Itens rotulados [PROPOSTO] na seção E permanecem sujeitos
   a decisão do Cowork antes do início de 1-F4.C.
2. **1-F4.C — Reconfirmação das regras e correção controlada de privacidade.** Duas partes, nesta
   ordem: (i) reconfirmação formal, direta e atual das regras publicadas em produção (C.3) — distinta
   da evidência visual já coletada — antes de qualquer mudança em `firestore.rules`; (ii)
   **implementação controlada** das correções de privacidade planejadas em 1-F4.B, **somente mediante
   autorização específica de gate para essa implementação** (este documento não constitui essa
   autorização). Essas correções **devem preceder** qualquer ampliação do acesso ao ambiente de Preview
   da Vercel.
3. **1-F4.D** — Redesign visual das telas de Usuários (A.3) e Auditoria (B.2), sem mudança de
   comportamento — etapa posterior à conclusão de 1-F4.C.
   **Status 1-F4.D1 (Usuários, A.3): implementado em commits locais, revisão visual humana pendente; Auditoria (B.2) não iniciada.**
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
