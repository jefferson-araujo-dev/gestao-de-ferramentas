# Tela "Ferramentas" (Gate 1-F2)

Redesenho da tela Ferramentas (`#/ferramentas`) sobre os tokens (1-C), o App Shell (1-D), os componentes
(1-E) e o padrão administrativo (1-F1). **Só interface**: nenhuma regra de negócio, contrato de backend,
autorização, consulta ao Firestore ou modelo de dados mudou.

## Diagnóstico da tela original

| Problema | Onde estava |
| --- | --- |
| Título "Catálogo de Inventário" repetia o h1 do shell | `tab-management.html` |
| 4 contadores (Total/Disponíveis/Emprestadas/Manutenção) **e** 6 filtros repetindo os mesmos números | `#inventory-stats`, `#inventory-quick-filters` |
| Cartões grandes (≈280px cada, 4 botões de ícone sem texto, `<select>` de status em cada cartão): 8 ferramentas ocupavam mais que uma tela | `renderGridView` |
| Filtro de categoria **sem categorias**: as opções eram lidas no boot, antes de os dados chegarem (só "Todas as Categorias") | `ui.js` |
| Falha ao carregar aparecia como "Nenhuma ferramenta cadastrada" (só `console.warn`) | `data.js` |
| 10 controles sem rótulo (axe `select-name`, crítico), emoji e `animate-pulse` nos alertas, sombras e bordas em cores fixas | cartões e CSS legado |
| Mobile: controles ocupavam a primeira tela antes de qualquer ferramenta | layout |

## Decisão de representação

`TOOLS_VIEW_MODE=HYBRID`: mesma fonte de dados e o mesmo `render()`, com duas formas escolhidas por
`matchMedia('(min-width: 1024px)')` (`BREAKPOINTS.notebook`, o contrato do shell):

* **>= 1024 (notebook e desktop): tabela semântica** (`<table>` com `<caption>`, `scope="col"`, nome da
  ferramenta como `rowheader`). Comparar status, responsável e última ação lado a lado é o uso principal.
* **< 1024 (tablet e mobile): cartões compactos** em lista (`<ul>`), 1 coluna no mobile e 2 no tablet.
  A tabela desktop não é forçada em telas estreitas. No tablet (768–1023) a tabela não cabe com o drawer.

Ao cruzar 1024 a lista é redesenhada (mesmos dados). Nada de DataTable genérica.

## Estrutura

1. **Ações do inventário** (só administrador): Exportar e Importar (`secondary`), Nova (`primary`, a única
   ação primária). Sem ações visíveis (padrão/restrito) o bloco some (`:has`).
2. **Filtros de status com contagem** (`role="group"`, botões `aria-pressed`): Todas, Disponíveis, Emprestadas,
   Manutenção, Em atraso, Revisão vencida. Substituem os 4 contadores e os 6 botões duplicados
   (`TOOLS_SUMMARY_METRICS`: as contagens já existentes, agora num único lugar).
3. **Busca, categoria e ordenação**: `Search` e `Select` ×2 do design system, todos com nome acessível.
4. **Linha de resultado**: "Mostrando N de M ferramentas" (região `aria-live`), "N filtros ativos" e
   **Limpar filtros** (só com filtro ativo).
5. **Lista**: tabela ou cartões, "Carregar mais" (inalterado: +12).

Ferramenta = miniatura (abre o visualizador, quando há imagem) + nome + `patrimônio · categoria`; status
(`StatusBadge`, sempre com texto) + alertas de prazo em palavras ("Atrasada (39d)", "Revisão vencida",
"Revisão próxima"); responsável; última ação; ações.

## Ações por ferramenta (só quem gerencia ferramentas)

* **Ação principal visível**: Emprestar (disponível) ou Devolver (emprestada); atalho para o Scanner em
  modo câmera, como antes. Ferramenta em manutenção não tem ação principal.
* **Menu "Mais ações"** (`Dropdown`, teclado completo): Editar, Registrar manutenção (não emprestada),
  Histórico e, para ferramentas não emprestadas, "Marcar como…" (os outros status). É a mesma troca que o
  `<select>` de cada cartão fazia, chamando o mesmo `quickStatusUpdate`.
* **Não existe ação destrutiva por ferramenta na interface** (nem antes): `deleteTool` e a exclusão em lote
  são código sem gatilho na UI e ficam intactos (com o mesmo `canManageTools()`).
* Cada função continua checando `canManageTools()` ao executar; esconder o botão não é a proteção.
* **Menu aberto isola o resto da tela** (Addendum 1-F2.1): o menu flutuante cobre parte de botões de outras
  linhas; sem isolamento, um clique fora dele sobre a faixa visível de um botão coberto fechava o menu **e**
  acionava o botão (ex.: Emprestar levava ao Scanner) e o axe `target-size` acusava essa faixa. Entre `onOpen` e
  `onClose` o cabeçalho, filtros, busca, linha de resultado, "Carregar mais" e as demais linhas ficam
  `inert`; só a linha do menu é interativa. O teclado nunca alcançava alvos cobertos (as setas ficam no menu;
  Tab fecha o menu e segue em ordem; Shift+Tab volta ao gatilho).
* Ao usar um item do menu, o foco vai para o gatilho da linha; se a ação abrir um modal, o foco volta a ele
  ao fechar. Uma atualização de dados com o menu aberto espera o menu fechar e devolve o foco ao gatilho novo.

## Estados

| Estado | Comportamento |
| --- | --- |
| CARREGANDO | `SkeletonCard` ×6, `aria-busy`, "Carregando ferramentas..."; nunca "nenhuma ferramenta" |
| VAZIO | inventário sem ferramentas: "Nenhuma ferramenta cadastrada" (+ "Nova ferramenta" só para quem pode) |
| SEM RESULTADOS | há ferramentas, mas a busca/filtros não batem: "Nenhuma ferramenta encontrada" + **Limpar filtros** |
| ERRO | `Alert` persistente ("Não foi possível carregar as ferramentas... recarregue a página"), sem detalhes internos; distinto de VAZIO (`App.Data.toolsError`, novo sinal de UI no listener existente) |

## Preservado (sem mudança de comportamento)

* Algoritmo da busca (sem acento; nome, patrimônio e categoria), filtros por status/atraso/revisão,
  categoria, as 6 ordenações, paginação, contagens, exportação (colunas, conteúdo, nome do arquivo),
  importação, cadastro/edição/manutenção/histórico (modais existentes), atalho para o Scanner.
* Permissões: admin gerencia; padrão e restrito só leem. Restrito **não** lê colaboradores (a tela mostra o
  `currentUser` do próprio documento da ferramenta). Movement API, regras do Firestore e Backup API intactos.

## Mudanças de comportamento (todas na interface, declaradas)

1. **Filtro de categoria passou a funcionar**: as opções vêm dos dados carregados (antes só "Todas").
2. "Status Atual" em `<select>` por cartão virou `StatusBadge` + itens "Marcar como…" no menu (mesmas
   transições, mesmo `quickStatusUpdate`).
3. "Limpar filtros" (novo), "N filtros ativos" (novo) e estado de erro (novo).
4. Rótulos: "Todos" -> "Todas" (ferramentas), "Rev. Vencida" -> "Revisão vencida", emoji removidos.

## Inventário de dependências (PRESERVE / ADAPT / REMOVE_AFTER_MIGRATION)

| Item | Classe | Observação |
| --- | --- | --- |
| `#crud-list`, `#crud-load-more`, `#inventory-result-count` | PRESERVE | `domCache.crudList`, `App.Data.loadMoreCrud` |
| `#tools-action-export/-import/-new`, `#crud-import-input-tool` | PRESERVE | `auth.js` alterna `style.display` por permissão |
| `#tools-search` | PRESERVE | Scanner ("ver detalhes") preenche e dispara `input`; `ui.js` mantém o debounce |
| `#inventory-sort`, `#inventory-category-filter` | ADAPT | agora montados por `mountControls` (componentes) com listeners em `tools.js` |
| `.responsive-action-bar` na barra de ações | PRESERVE | contrato dos testes responsivos |
| `App.CRUDTools.setQuickFilter/render/quickStatusUpdate/showHistory/openModal/...` | PRESERVE | mesma API |
| `renderGridView` | REMOVE_AFTER_MIGRATION | substituída por `renderTableView`/`renderCardsView` (sem outros consumidores) |
| `#inventory-stats`, `#inventory-quick-filters`, `inv-stat-*`, `filter-inv-*`, `filter-count-late`, `filter-count-maintenance-due` | REMOVE_AFTER_MIGRATION | sem consumidores fora de `tab-management.html`/`tools.js` (conferido) |
| CSS `#inventory-*`, `.inv-filter-btn` em `main.css` (6 `!important`) | REMOVE_AFTER_MIGRATION | removidos |
| `.tool-card` | PRESERVE | continua no Painel (não é mais usada em Ferramentas) |
| Listeners de ordenação/categoria e população de categorias em `ui.js` | REMOVE_AFTER_MIGRATION | movidos para `mountControls` |
| `bulkAction`, `deleteTool`, `selectAll`... | PRESERVE | sem gatilho na UI (antes e depois); intactos |
| Modais de ferramenta/manutenção/histórico | PRESERVE | fora do redesign (sem tocar em schema, validação ou persistência) |

## Mudanças compartilhadas fora da tela

* `Dropdown.dispose()` e `onClose({ restoreFocus })` (`components/overlays.js`): menus por linha são recriados
  a cada renderização; sem `dispose()` cada render acumularia um listener no `document`. Compatível com o uso
  do menu da conta (ignora o argumento).
* `App.Data.toolsError` (`data.js`): sinal de UI, definido no callback de erro do listener que já existia.
* `ui.js`: chama `CRUDTools.mountControls()` e deixa de tratar ordenação/categoria.

## Testes

| Arquivo | Cobre |
| --- | --- |
| `tests/unit/toolsScreen.test.mjs` | tokens (sem `dark:`/`!important`/cor literal), classes com regra, ids preservados, algoritmo de busca, `canManageTools()` nas funções, sem colaboradores/backend, Dropdown `dispose` |
| `tests/e2e/tools.spec.js` | estrutura, busca, filtros, ordenação, ações/menu, exportação, estados, perfis, layout 10 larguras, escuro |
| `tests/e2e/tools.mobile.spec.js` | cartões, alvos de 44px, toque, barra inferior |
| `tests/e2e/tools.destructive.spec.js` | troca de status com escrita real no emulator (re-semeia) |
| `a11y-baseline`, `baseline.mobile`, `visual-baseline` | axe (ociosa, filtros, menu, modal, vazio, erro, escuro, mobile) e imagens |

## Dívidas conhecidas (fora do escopo)

* `#network-status-text` (contraste, do shell) segue como antes.
* "Marcar como emprestada" (sem responsável) existia no `<select>` antigo e foi preservado; é regra de
  negócio questionável, a decidir em outro gate.
* `showHistory` não checa `canManageTools()` na função (só a UI oculta o gatilho); o histórico só é carregado
  no cliente de quem tem `canAccessHistory` (não há listener para os demais perfis). Não alterado.
* Modais de ferramenta/manutenção/histórico e o Painel ainda usam estilos legados (`dark:` e `!important`).
