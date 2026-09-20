# App shell, navegação e contrato responsivo (Gate 1-D)

Este documento descreve o shell implementado, o modelo único de navegação, o roteamento por hash e
o contrato de breakpoints **do shell**. As telas internas (Painel, Scanner, Ferramentas, Colaboradores,
Auditoria, Usuários) **não foram redesenhadas** neste gate.

## Onde vive cada coisa

| Arquivo | Responsabilidade |
| --- | --- |
| `src/js/config/navigation.js` | Modelo ÚNICO de navegação: grupos, itens (id, rota, tela, rótulo, ícone, grupo, permissão, ordem), regras de "Mais", helpers de rota/hash |
| `src/js/config/breakpoints.js` | Contrato ÚNICO de breakpoints do shell (768 / 1024 / 1280) e observação por `matchMedia` |
| `src/js/core/Router.js` | Roteador por hash sem biblioteca: só mantém a URL e avisa mudanças |
| `src/js/modules/shell.js` | Renderiza sidebar, barra inferior e "Mais" a partir do modelo; estado por breakpoint, foco, Esc, `aria-*` |
| `src/js/modules/ui.js` | `switchTab` (ponto único de troca de tela, com as guardas), `startRouting`/`applyRoute`/`stopRouting`, lifecycle da tela |
| `src/css/shell.css` | Layout do shell (só tokens do 1-C; claro/escuro sem `dark:`), mesmos limites do contrato |
| `src/partials/layout/{sidebar,header,more-sheet}.html` | Casca estática; os itens de navegação são gerados |

## Arquitetura de informação

```
VISÃO GERAL   Painel                                #/painel
OPERAÇÃO      Retirar/Devolver                      #/scanner
              Ferramentas                           #/ferramentas
PESSOAS       Colaboradores   (não restrito)        #/colaboradores
CONTROLE      Auditoria       (admin)               #/auditoria
ADMINISTRAÇÃO Usuários e acessos (admin)            #/usuarios
              Dados e backup (admin)                #/dados   (Gate 1-F1)
CONTA         Perfil · Senha · Tema · Sair          (menu do avatar; no mobile, também em "Mais")
```

- "Dados e backup" foi criado no Gate 1-F1 (`docs/design/DATA_BACKUP_SCREEN.md`): permissão `canBackupData`,
  as ações do menu antigo foram migradas **juntas** e a dívida transitória abaixo foi quitada.
- "Inventário" deixou de existir como item separado: admin e demais perfis usam **Ferramentas**
  (mesma tela `#tab-management`; as ações de admin continuam controladas por permissão).
- A UI **só esconde** itens. A autorização funcional continua nas guardas de `switchTab` (permissões de
  `App.Auth`), nas regras do Firestore e nas APIs; nada disso foi enfraquecido.

## Modelo único de navegação

Cada item declara `permission`, o nome de um flag de `App.Auth.permissions` (`canAccessDashboard`,
`canAccessScanner`, `canReadTools`, `canReadCollaborators`, `canAccessHistory`, `canAccessUsers`, `canBackupData`).
Não há regra de perfil duplicada: `ui.js` não conhece perfis e `isItemAllowed` é fail-closed (só
`=== true` autoriza). `tests/unit/navigationModel.test.mjs` cobre consistência, visibilidade por perfil
(admin / padrão / restrito), o limite de 4 destinos primários e o não-drift com `AppAuth._setPermissions`.

## Roteamento por hash

- Rotas: `#/painel`, `#/scanner`, `#/ferramentas`, `#/colaboradores`, `#/auditoria`, `#/usuarios`, `#/dados`.
- **Ponto único**: `App.UI.switchTab(tab)` (usado também pelos `onclick` inline e pelo Scanner) valida
  a permissão, escreve a rota e executa o lifecycle. Links da navegação são `<a href="#/rota">`; o
  `hashchange` (clique, back/forward, edição manual) chega a `applyRoute` → `switchTab`.
- `pushState` na navegação programática (síncrona, sem evento duplicado); `replaceState` nas correções.
- **Rota vazia/desconhecida** → Painel, com `replace` (não cria armadilha de histórico).
- **Rota conhecida, não autorizada** (ex.: `#/colaboradores` no perfil restrito, `#/auditoria` no padrão)
  → Painel com `replace` + aviso; a tela e os dados **não** são carregados.
- **Reload e deep link** preservam a tela: o roteamento começa em `_handleAuthenticatedUser` depois de
  perfil e permissões; antes do login o hash é preservado. **Logout** limpa a URL e o próximo login
  começa no Painel.
- `aria-current="page"` no item ativo (sidebar, barra inferior e "Mais"); título da topbar e
  `document.title` (`<Tela> · Gestão de Ferramentas`) acompanham a rota.
- **Lifecycle preservado**: `switchTab` → `_activateTab` mantém os mesmos hooks (métricas, Scanner
  `setMode('usb')`/`stopCamera`/`focus`, `renderAll`, rolagem ao topo). Os containers das telas e o
  `domCache` **não** são recriados (só alternamos `hidden`).

## Contrato de breakpoints do shell

| Modo | Largura | Shell |
| --- | --- | --- |
| mobile | < 768 | barra inferior: até 4 destinos + "Mais"; sem sidebar |
| tablet | 768–1023 | drawer com overlay, aberto por botão explícito |
| notebook | 1024–1279 | rail de 72px; "expandir" abre 256px **sobre** o conteúdo |
| desktop | ≥ 1280 | sidebar de 256px, recolhe para 72px (persistido em `localStorage`) |

- Fonte JS: `config/breakpoints.js` (`matchMedia`). Valores = `md`/`lg`/`xl` do Tailwind, declarados em
  `tokens.css` (`--breakpoint-md/lg/xl`) e usados por `shell.css`. `tests/unit/breakpointsContract.test.mjs`
  confere JS × tokens × CSS e proíbe `innerWidth` nos consumidores do shell.
- `ui.js` e `ResponsiveManager` não decidem mais o layout da sidebar; `setMobileSidebarState`,
  `syncResponsiveLayout` e `toggleSidebar` viraram fachadas de compatibilidade do `App.Shell`.

### O que NÃO está unificado (legado que permanece)

`SHELL_BREAKPOINTS_UNIFIED=true`, mas **os breakpoints globais não estão unificados**:

- `src/css/main.css`: 8 media queries fora do contrato (374, 375, 479, 480, 1535, 1536; grades, cards
  e tabelas históricas).
- `ResponsiveManager.breakpoints` (`xs` 375, `sm` 480, `xl` 1536): ainda alimenta `breakpointChange`
  (re-render do Painel) e `data-breakpoint`; não afeta o shell.
- Tailwind `sm:` (640px): ~119 usos nas telas internas.
- `ResponsiveManager` ainda observa `#main-sidebar` e define `--sidebar-width`, que nada consome.

A migração dessas regras pertence aos gates das telas internas.

## Acessibilidade da navegação

`nav` com nome (`Navegação principal` / `Navegação inferior`); grupos com `role="group"` rotulado;
todo destino é um link com **texto visível** (no mobile também; ícones `aria-hidden`); `aria-current`;
o botão do menu tem `aria-expanded`/`aria-controls`; drawer com foco no item ativo, Tab preso, `Esc`
fecha e devolve o foco, clique no destino ou no overlay fecha; "Mais" é um `<dialog>` modal (`Esc`,
foco preso nativo). No rail (72px) os rótulos ficam fora da tela, mas continuam no DOM: o nome acessível
não depende de hover. Foco visível vem da foundation do 1-C; `prefers-reduced-motion` encerra as
transições. Alvos de toque ≥ 44px; a barra inferior respeita `safe-area-inset-bottom` e o conteúdo
recebe padding para nunca ficar sob ela. O achado **C-01** (Gate 1-A: navegação mobile só com ícones,
sem nome) está resolvido; ver `tests/e2e/baseline.mobile.spec.js`.

## Inventário do acoplamento (antes → depois)

| Acoplamento | Classe | Situação |
| --- | --- | --- |
| `#main-sidebar`, `#sidebar-overlay`, `#topbar-title`, `#main-content-scroll` | PRESERVE | IDs mantidos; usados por JS e testes |
| `#nav-dashboard/-scanner/-collaborators/-users/-history`, `#nav-tools` | ADAPT | Agora gerados a partir do modelo (`<a>` em vez de `<button>`) |
| `#nav-management` (Inventário, admin) | REMOVE_AFTER_MIGRATION | Removido; testes atualizados. O admin usa "Ferramentas" |
| `.nav-btn` + listener em `ui.init` | REMOVE_AFTER_MIGRATION | Removidos (links `#/rota` + `hashchange`) |
| `#admin-section` (`style.display`) | REMOVE_AFTER_MIGRATION | Removido; grupos vazios não são renderizados |
| `#admin-tools` (menu do avatar) | PRESERVE | Mantido: ações de dados (ver dívida) |
| `#btn-user-mgmt` ("Gerenciar Usuários") | REMOVE_AFTER_MIGRATION | Removido do avatar (duplicava "Usuários e acessos") |
| `tools-action-*`, `crud-import-input-tool`, `btn-export-*` (`style.display` por permissão) | PRESERVE | Fora do shell; intactos |
| `activeTab`, `domCache`, `renderAll` | PRESERVE | Semântica idêntica (`activeTab` usado por Scanner, Data, app.js) |
| `switchTab(tab, sourceNavId)` | ADAPT | Agora `switchTab(tab, { replace })`; único ponto de entrada, guardas via modelo |
| Guardas de perfil em `switchTab` (users/history/collaborators) | ADAPT | Derivadas de `permission` do modelo; mesmas mensagens e mesmo redirecionamento |
| Bloco `restrictedTabs` em `_updateUIForUser` | REMOVE_AFTER_MIGRATION | Substituído pelo roteamento pós-login |
| Scanner: `setMode('usb')`/`stopCamera`/`focus` no troca de aba | PRESERVE | Mesmos hooks em `_activateTab` |
| `switchTab('scanner')`/`('management')`/`('history')` em `tools.js`, `scanner.js`, `tab-dashboard.html` | PRESERVE | Continuam funcionando e agora atualizam a URL |
| `setMobileSidebarState`, `syncResponsiveLayout`, `toggleSidebar` | ADAPT | Fachadas → `App.Shell` |
| `window.innerWidth < 1024` em `ui.js` (6 usos) e listeners de `orientationchange` | REMOVE_AFTER_MIGRATION | Removidos (matchMedia em `breakpoints.js`) |
| `ResponsiveManager.handleResize` (classes da sidebar), `handleSwipe` | REMOVE / ADAPT | `handleResize` removido; swipe só fecha o overlay via `App.Shell` |
| `ResponsiveManager.breakpoints` / `breakpointChange` | PRESERVE (legado) | Não é do shell; ver "O que NÃO está unificado" |
| `#btn-install-pwa` | ADAPT | Continua na sidebar; `[data-pwa-install]` também em "Mais" (mobile) |
| Menu do avatar (perfil, senha, tema, sair) | PRESERVE | IDs e handlers intactos; reordenado como CONTA |
| CSS `#main-sidebar.lg:w-20`, `.nav-btn`, overrides `!important` da sidebar, bloco landscape | REMOVE_AFTER_MIGRATION | Removidos de `main.css` (substituídos por `shell.css`) |
| `#back-to-top`, `#toast-container` | ADAPT | Sobem acima da barra inferior no mobile |

## Dívida transitória (QUITADA no Gate 1-F1)

Até o Gate 1-E o menu do avatar abrigava, sob "Dados (transitório)" e só para admin, as ações
**Importar Excel, Resetar dados operacionais, Backup JSON, Restaurar JSON e Métricas do Sistema**.
O Gate 1-F1 as migrou **juntas** para a tela "Dados e backup" (`#/dados`) e só então as removeu do menu,
que agora tem apenas Meu Perfil, Alterar Senha, Modo Noturno e Sair. Nenhuma ação ficou em dois lugares.
