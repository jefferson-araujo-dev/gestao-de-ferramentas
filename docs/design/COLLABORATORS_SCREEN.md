# Tela "Colaboradores" (Gate 1-F3)

Redesenho da tela Colaboradores (`#/colaboradores`) sobre os tokens (1-C), o App Shell (1-D), os
componentes (1-E) e os padrões das telas Dados e backup (1-F1) e Ferramentas (1-F2). **Só interface**:
nenhuma regra de negócio, contrato de backend, autorização, consulta ao Firestore ou modelo de dados
mudou. O perfil **restrito continua sem acesso** à tela, à lista e a qualquer leitura de colaborador.

## Diagnóstico da tela original

| Problema | Onde estava |
| --- | --- |
| Título "Colaboradores" repetia o h1 do shell, com subtítulo e contador logo abaixo | `tab-collaborators.html` |
| Três contagens do mesmo conjunto: `#collab-total-count`, `#collab-result-count` e `#collab-pagination-info` | partial e `render()` |
| 3 `<select>` **sem rótulo** (cargo, status, ordenação): axe `select-name`, **crítico**, 3 nós | filtros avançados |
| Cartões grandes (≈250px, 4–5 botões só de ícone, faixa colorida na borda): 5 pessoas não cabiam em uma tela | `renderCard` |
| Situação só como pílula colorida em caixa-alta ("ATIVO"/"INATIVO"), sem componente do design system | `renderCard` |
| Pendências como "2 PENDENTE(S)" em badge vermelho, com ícone e `title` | `renderCard` |
| Falha ao carregar aparecia como "Nenhum colaborador encontrado" (só `console.warn`) | `data.js` |
| 26 `onclick` inline na tela; cores fixas (`bg-brand-600`, `emerald`, `rose`, `indigo`) e `!important` no CSS legado | partial, `render`, `main.css` |
| Paginação agrupada podia mostrar mais que o limite de 30 (o corte era por grupo, não pelo total) | `renderWithGrouping` |

## Decisão de representação

`COLLABORATORS_VIEW_MODE=HYBRID`, o mesmo contrato de Ferramentas: uma fonte de dados, um `render()`,
duas formas escolhidas por `matchMedia('(min-width: 1024px)')` (`BREAKPOINTS.notebook`).

* **>= 1024 (notebook e desktop): tabela semântica** (`<table>` com `<caption>`, `scope="col"`, nome
  como `rowheader`). O uso principal é conferir a equipe lado a lado: quem está ativo, com qual crachá e
  quem está com ferramenta em posse.
* **< 1024 (tablet e mobile): cartões compactos** em lista (`<ul role="list">`), 1 coluna no mobile e 2
  no tablet. A tabela não é espremida em tela estreita.

**Agrupamento por cargo** (existente, ligado por padrão) vale nas duas formas: na tabela, cada cargo é um
`<tbody>` encabeçado por `<th scope="rowgroup" colspan>`; nos cartões, uma `<section>` com `<h3>`. Quando
agrupado, o cargo **não se repete**: a coluna "Cargo" (tabela) e o cargo na linha de identificação
(cartão) só aparecem com o agrupamento desligado.

## Estrutura

1. **Ações globais** (só administrador): Exportar e Importar (`secondary`), Novo (`primary`, a única
   ação primária). Sem ações visíveis (perfil padrão) o bloco some (`:has`).
2. **Filtros**, em dois grupos **independentes** (como antes): situação com contagem (Todos, Ativos,
   Inativos — `aria-pressed`, exclusivo) e pendências ("Com pendências" — `aria-pressed`, alterna
   sozinho). Substituem o `<select>` de status e os dois botões de pendência.
3. **Busca, cargo e ordenação**: `Search` e `Select` ×2 do design system, todos com nome acessível.
4. **Linha de resultado**: "Mostrando N de M colaboradores" (região `aria-live`), "N filtros ativos",
   **Limpar filtros** (só com filtro ativo) e o interruptor **Agrupar por cargo**.
5. **Lista**: tabela ou cartões, "Carregar mais" (inalterado: +30).

Colaborador = foto (abre o visualizador, quando há) + nome + crachá; situação (`StatusBadge`, sempre com
texto) + pendências em palavras ("1 ferramenta em posse"); contato; ações.

## Ações por colaborador

* **Ação visível**: **Histórico** — é a única ação comum a administrador e perfil padrão, então a linha
  tem a mesma forma nos dois perfis.
* **Menu "Mais ações"** (`Dropdown`, teclado completo): Editar, Ativar/Inativar, "Cobrar no WhatsApp"
  (só com telefone **e** pendência, mesma regra e mesma mensagem de antes) e, separada por `<hr>` e em
  tom de perigo, **Excluir**. Sem itens, o menu não é renderizado (perfil padrão sem pendência).
* Cada função continua checando a permissão ao executar (`canManageCollaborators`, `canExportData`);
  esconder o botão não é a proteção.
* **Menu aberto isola o resto da tela** (contrato do Addendum 1-F2.1): entre `onOpen` e `onClose`, o
  cabeçalho, filtros, busca, linha de resultado, "Carregar mais" e as demais linhas ficam `inert`; só a
  linha do menu é interativa. Isso evita o clique-através na faixa visível de um botão coberto e o
  `target-size` que o axe acusava.
* Ao usar um item do menu, o foco vai para o gatilho da linha; se a ação abrir um modal, o foco volta a
  ele ao fechar. Uma atualização de dados com o menu aberto espera o menu fechar.

## Formulário (novo/editar)

Campos, obrigatoriedade, normalização (`trim`), unicidade do crachá (sem diferenciar maiúsculas) e
persistência **inalterados**. Mudou a apresentação: `ui-field`/`ui-control` do design system, rótulo
sempre visível e associado, ajuda no campo do crachá explicando seu uso no Scanner, erro **ligado ao
campo** (`aria-describedby`) além do toast com a mesma mensagem de domínio, foco inicial no primeiro
campo, foco no campo com erro ao recusar, `setBusy` no botão Salvar (bloqueia o envio duplo sem perder o
foco) e política de fechamento do 1-E (`data-dismissible="false"`: o fundo não descarta; Esc com
alterações pede confirmação).

## Estados

| Estado | Comportamento |
| --- | --- |
| CARREGANDO | `SkeletonCard` ×6, `aria-busy`, "Carregando colaboradores..."; nunca "nenhum colaborador" |
| VAZIO | nenhum cadastro: "Nenhum colaborador cadastrado" (+ "Novo colaborador" só para quem pode) |
| SEM RESULTADOS | há colaboradores, mas a busca/filtros não batem: "Nenhum colaborador encontrado" + **Limpar filtros** |
| ERRO | `Alert` persistente ("Não foi possível carregar os colaboradores... recarregue a página"), sem detalhes internos; distinto de VAZIO (`App.Data.collaboratorsError`, novo sinal de UI no listener existente) |

## Perfil restrito (invariante)

`canReadCollaborators` é falso para o perfil restrito: **nenhum listener**, nenhuma `list`, nenhum `get`,
nada na memória do cliente e nenhum item de navegação — inclusive por deep link `#/colaboradores`. O
empréstimo continua resolvendo o colaborador **no servidor**, pelo crachá exato
(`/api/tools/movement`). Nada disso foi tocado neste gate; a tela apenas não existe para esse perfil.
O nome do responsável que aparece em Ferramentas vem do próprio documento da ferramenta (`currentUser`),
não de uma leitura da coleção.

## Preservado (sem mudança de comportamento)

* Algoritmo da busca (sem acento; nome, crachá e cargo), filtro por situação, por cargo e por pendência,
  as 4 ordenações, agrupamento por cargo, paginação (+30), contagem de pendências (`getPendingTools`),
  exportação (colunas Nome/Crachá/Cargo, conteúdo e nome do arquivo), importação (formato e contrato),
  cadastro/edição/ativação/exclusão, cobrança por WhatsApp e o histórico individual.
* Permissões: administrador gerencia; padrão só lê; restrito não acessa. Movement API, regras do
  Firestore e Backup API intactos.
* `bulkAction`, `toggleSelection`, `clearSelection` e `updateBulkBar` continuam **sem gatilho na UI**
  (era assim antes: `#collab-bulk-actions-bar` nunca existiu no markup) e ficam intactos.

## Mudanças de comportamento (todas na interface, declaradas)

1. **Paginação uniforme**: o limite de 30 passa a ser aplicado ao total filtrado antes de agrupar. Antes,
   o caminho agrupado podia exibir mais de 30 (o corte era por grupo).
2. **Cargo não se repete** quando o agrupamento está ligado (coluna e linha de identificação).
3. Situação passou a usar `StatusBadge` ("Ativo"/"Inativo"); pendência virou "N ferramenta(s) em posse".
4. Rótulos: "Desativar / Bloquear" -> "Inativar"; "Função" -> "Cargo" (o campo já era o `role` usado no
   agrupamento e no filtro); "Upload Foto" -> "Enviar foto"; no histórico, "Retirou"/"Devolveu" -> os
   rótulos do design system ("Retirada"/"Devolução"). Nenhum valor persistido mudou.
5. Contador total e informação de paginação foram absorvidos pela linha de resultado (eram três
   contagens do mesmo conjunto).

## Inventário de dependências (PRESERVE / ADAPT / REMOVE_AFTER_MIGRATION)

| Item | Classe | Observação |
| --- | --- | --- |
| `#collab-list` | PRESERVE | `domCache.collabList`, `data.js`, testes |
| `#collab-load-more`, `#collab-result-count`, `#collab-group-toggle` | PRESERVE | paginação, região viva e o Switch do 1-E |
| `#btn-collaborators-export/-import/-new`, `#crud-import-input-collab` | PRESERVE | `auth.js` alterna `style.display` por permissão; testes responsivos usam `#btn-collaborators-new` |
| `#collab-search` | PRESERVE | continua no debounce compartilhado de `ui.js` (montado antes dos listeners) |
| `#collab-role-filter`, `#collab-sort` | ADAPT | agora montados por `mountControls` (componentes) com listeners em `collaborators.js` |
| `crud-collab-*`, `#btn-save-collab`, `#collab-history-*` | PRESERVE | lidos por `collaborators.js` e pelos testes (inclusive o responsivo do modal) |
| `.responsive-action-bar` na barra de ações | PRESERVE | contrato dos testes responsivos (3 ações) |
| `App.CRUDCollaborators.setPendingFilter/render/toggleStatus/showHistory/openModal/...` | PRESERVE | mesma API pública |
| `renderCard`, `renderWithGrouping`, `renderFlat` | REMOVE_AFTER_MIGRATION | substituídas por `renderTableView`/`renderCardsView` (sem outros consumidores) |
| `#collab-total-count`, `#collab-pagination-info`, `#collab-quick-filters`, `#collab-status-filter`, `.collab-filter-btn`, `.collab-filter-select`, `.collab-sort-select` | REMOVE_AFTER_MIGRATION | sem consumidores fora do partial/`collaborators.js`/`ui.js` (conferido) |
| CSS `#collab-quick-filters .collab-filter-btn` em `main.css` (4 blocos com `!important`) | REMOVE_AFTER_MIGRATION | removido só o seletor de colaboradores; `#quick-filters`, `#users-filters` e `.sort-btn` continuam (Painel e Usuários) |
| `bulkAction`, `toggleSelection`, `clearSelection`, `updateBulkBar` | PRESERVE | sem gatilho na UI (antes e depois); intactos |

## Mudanças compartilhadas fora da tela

* `STATUS_MAP` (`components/display.js`): ganhou `active` ("Ativo", success) e `inactive` ("Inativo",
  neutral). São os valores **já persistidos** do colaborador; a tela passa a usar o vocabulário de status
  do design system em vez de inventar o seu. Nenhum status novo e nenhum consumidor existente afetado.
* `App.Data.collaboratorsError` (`data.js`): sinal de UI, definido no callback de erro do listener que já
  existia (espelha o `toolsError` do 1-F2).
* `ui.js`: chama `CRUDCollaborators.mountControls()` e deixa de tratar cargo, ordenação e agrupamento.

## Testes

| Arquivo | Cobre |
| --- | --- |
| `tests/unit/collaboratorsScreen.test.mjs` | tokens (sem `dark:`/`!important`/cor literal), classes com regra, ids preservados, contrato do formulário (3 blocos, 2 ações), algoritmo de busca, permissão dentro de cada função, contrato do crachá, estados, isolamento do menu, sem exclusão no axe |
| `tests/e2e/collaborators.spec.js` | estrutura, agrupamento, busca, filtros combinados, ordenação, ações/menu, formulário (erros, envio duplo, descarte), histórico, exportação/importação, estados, perfis (padrão e restrito, com deep link), layout em 10 larguras e tema escuro |
| `tests/e2e/collaborators.mobile.spec.js` | cartões, alvos de 44px, toque, barra inferior, formulário no mobile e isolamento do menu |
| `a11y-baseline`, `baseline.mobile`, `visual-baseline` | axe (ociosa, filtros, menu em cada linha, formulário vazio e com erro, histórico, vazio, erro, escuro, mobile) e imagens |

## Dívidas conhecidas (fora do escopo)

* `#network-status-text` (contraste, do shell) segue como antes: é o único nó que as varreduras de página
  inteira desta tela herdam.
* **Switch do 1-E**: clicar no *trilho* não alterna (só o rótulo e o teclado funcionam). Reproduz igual na
  galeria `/components.html`, isolada desta tela: é dívida do componente compartilhado, não deste gate.
* "Marcar como emprestada" e demais decisões de negócio de Ferramentas não têm equivalente aqui.
* `showHistory` lê `App.Data.allHistoryLogs`, que só é carregado para quem tem `canAccessHistory`; para o
  perfil padrão o histórico individual aparece vazio. Comportamento anterior, não alterado.
* O modal de perfil e o Painel ainda usam estilos legados (`dark:` e `!important`).
