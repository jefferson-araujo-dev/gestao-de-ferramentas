# Componentes fundamentais (Gate 1-E)

Primeira leva do design system, sobre os tokens do 1-C e o app shell do 1-D. **Vanilla JS + CSS**,
sem biblioteca. Os componentes existem porque têm uso real no produto; o que ainda não tem
(DataTable, paginação avançada, Tabs, Radio, Breadcrumb, Tooltip) foi **adiado de propósito**.

## Onde vive cada coisa

| Arquivo | Conteúdo |
| --- | --- |
| `src/js/components/` | `util.js` (`esc`, `cx`, `attrs`, `icon`, `uid`), `actions.js` (Button, IconButton, `setBusy`), `forms.js` (Input, Select, Search, Checkbox, Switch, `bindFieldValidation`), `display.js` (Badge, StatusBadge, Card, StatCard, Alert, EmptyState, Skeleton), `overlays.js` (política de Modal, ConfirmDialog, Dropdown), `toast-policy.js` |
| `src/js/core/NotificationManager.js` | Toast (renderização e regiões vivas; API `success/error/warning/info` inalterada) |
| `src/css/components.css` | Classes `ui-*`, **somente tokens** (sem hex, sem `!important`, sem `dark:`) |
| `src/components.html` + `src/dev/components-gallery.js` | Galeria **só de desenvolvimento/testes** (`/components.html`, `?theme=dark`). Não é entrada do build (o `dist/` não a contém) |

Os componentes são funções que devolvem HTML (mesmo estilo dos templates do app); todo texto dinâmico
passa por `esc`. O comportamento (foco, teclado, política de fechamento) fica em controladores pequenos
(`initModals`, `confirmDialog`, `Dropdown`, `setBusy`). Foco visível vem da foundation do 1-C.

## Contratos

- **Button** — variantes `primary | secondary | ghost | danger`; estados default, hover, active,
  focus-visible, disabled e `loading` (`setBusy`: `aria-busy` + `aria-disabled`, texto preservado, sem
  `disabled` para não perder o foco; quem trata o clique confere `isBusy`). Alvo 40px (44px em ponteiro
  grosso). `danger` usa o token `on-danger` (texto escuro no dark, onde o vermelho é claro).
- **IconButton** — `label` (nome acessível) é **obrigatório** (lança erro sem ele); ícone `aria-hidden`.
- **Input / Select / Search** — mesma altura, raio, `border-control` (≥ 3:1), tipografia, disabled, invalid,
  ajuda/erro. **Rótulo obrigatório** e associado (`label[for]`); placeholder não substitui rótulo. `hideLabel`
  mantém o rótulo no DOM, visualmente oculto (barras de filtro). Erro só aparece após interação
  (`:user-invalid`), com `aria-invalid` sincronizado por `bindFieldValidation` (guia
  "accessible-error-announcement"). Mobile < 768: 16px (evita zoom no iOS).
- **Checkbox / Switch** — rótulo associado, teclado nativo, foco visível, alvo ≥ 40px. O switch é um
  `input[type=checkbox][role=switch]`; o estado não depende só de cor (a posição do botão muda).
- **Badge / StatusBadge** — tons `neutral | info | success | warning | danger`; o **texto** do status vem
  sempre (o tom é reforço). `getBadgeHTML` continua existindo e agora delega ao `StatusBadge`.
- **Card / StatCard** — `surface`, `border`, `radius-ui`, `shadow-ui`, espaçamento; StatCard: valor
  (`tabular-nums`), rótulo e meta opcional; interativo = `<button>` (antes era um `<div>` só com clique).
- **Alert** — persistente; `warning`/`danger` = `role="alert"`, `info`/`success` = `role="status"`; ícone + texto.
- **EmptyState / Skeleton** — título obrigatório, descrição/ícone/ação opcionais; skeleton decorativo
  (`aria-hidden`), sem animação com `prefers-reduced-motion`. `getSkeletonHTML`/`getEmptyStateHTML` delegam.

## Modal: política de fechamento (`dismissible`)

`initModals()` (em `UI.init`) prepara **todos** os `<dialog>`: dá nome acessível a partir do título quando
falta e define `closedby`.

| `data-dismissible` | `closedby` | Clique no fundo | Esc / "voltar" |
| --- | --- | --- | --- |
| `true` (padrão) | `any` | fecha | fecha |
| `false` | `closerequest` | **não** fecha | fecha; se o formulário foi alterado, pergunta antes ("Descartar alterações?") |

`closedby` não existe no Safari: o clique no fundo tem fallback em JS que respeita a mesma política. Modais
com formulário passaram a `dismissible=false`: `crud-modal` (ferramenta), `crud-collab-modal`,
`crud-user-modal`, `password-modal`, `tool-maintenance-modal` e `forgot-password-modal`. Os demais
(perfil, histórico, métricas, lightbox, logout) continuam dispensáveis. Botões `[data-modal-close]` fecham
sem `onclick` inline.

## ConfirmDialog (substitui `confirm()`)

`App.UI.confirm(options)` → `Promise<boolean>`; atalhos `confirmDanger(título, descrição)` e
`confirmAction(título, descrição, rótulo)`. Um único `<dialog>` compartilhado; chamadas simultâneas são
**enfileiradas**. Variante `danger`: foco inicial em **Cancelar**, botão perigoso e `Alert` "Esta ação não
pode ser desfeita.". `requireText` = confirmação reforçada (digitar o texto exato). `onConfirm` assíncrono:
botão em `loading`; se falhar, o diálogo fica aberto com o erro. Esc cancela; o fundo **não** cancela.

Migrados (8 `confirm()` + 1 `alert()`): excluir colaborador (1 e em lote), excluir ferramenta (1 e em lote),
alterar status e mover categoria em lote, excluir usuário (1 e em lote); e a expiração de sessão, que era um
`alert()` bloqueante e agora é um Toast persistente. **Não migrados** (6 `confirm()` em `data.js`: limpar
histórico, reset, restaurar/importar backup): aguardam a tela "Dados e backup".

## Toast (H-07) e Alert

- `#toast-container` é uma região (`role="region"`, "Notificações") com **duas regiões vivas persistentes**:
  `role="status"` (sucesso/info, educado) e `role="alert"` (erro/aviso, assertivo), criadas antes de qualquer toast.
- Tipo repetido em texto para leitor de tela ("Erro: …"), ícone decorativo, botão **Fechar notificação**.
- Política (`toast-policy.js`, pura e testada): sucesso 4s, info 5s, aviso 8s, erro 12s, somados ao tempo
  de leitura da mensagem (teto 20s); erro/aviso nunca abaixo do mínimo; `persistent: true` exige fechar
  manualmente. Hover/foco **suspendem** a contagem (WCAG 2.2.1).
- O Toast não substitui o log: `Logger.error` continua chamando `console.error`.

## Dropdown

Padrão "menu button" do WAI-ARIA: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`, painel
`role="menu"`, itens `role="menuitem"`. Teclado: Enter/Espaço/↓ abre no 1º; ↑ abre no último; ↑/↓ com volta,
Home/End, Esc fecha e devolve o foco, Tab fecha; clique fora fecha. Só declara `role="menu"` porque
implementa esse contrato. Posiciona-se dentro da viewport (desloca, inverte para cima, limita a altura).
Ações perigosas ficam separadas por `ui-menu__sep`. Usa **sem** Popover API/polyfill (não há polyfill
de CDN sob o guard de rede). Adotado no **menu da conta**; itens `<label>` de arquivo são focáveis.

## Adoção controlada nas telas

| Onde | Componente |
| --- | --- |
| Painel: 4 KPIs | StatCard interativo (ids `stat-*` preservados; teclado) |
| Painel: busca, filtro, ordenação, Limpar | Search, Select ×2, Button |
| 4 botões Exportar/Importar verdes (`.btn` + override) | Button `secondary` |
| Menu do avatar | Dropdown (ações por `data-menu-action`, sem `onclick`) |
| "Agrupar por cargo" | Switch |
| Toasts | Toast novo |
| Listas (badges, skeleton, vazio) | StatusBadge / SkeletonCard / EmptyState via helpers compatíveis |
| Botões só-ícone sem nome (8 fechar de modal, mostrar senha) | `aria-label` |

## Inventário do legado (decisão por item)

| Item | Antes | Decisão |
| --- | --- | --- |
| `.btn`, `.btn-primary/secondary` | 37 usos, `@apply` | **KEEP** enquanto houver telas; novo `ui-btn`. Sucessor: REMOVE_AFTER_MIGRATION |
| `.btn[class*='bg-*-600']` (override `!important`) | 4 botões | **REMOVIDO** (botões migrados) |
| Botões só-ícone | ad hoc | **REPLACE** gradual (IconButton); nomes acessíveis já corrigidos |
| Input/Select/Search | classes Tailwind por tela | **REPLACE** gradual; Painel migrado |
| Checkbox / switch | 1 caso | Switch aplicado; Checkbox disponível, **sem uso no produto ainda** |
| Badge / status | `getBadgeHTML` (cores fixas) | **REPLACE** (delegação compatível) |
| Card | `.panel-card`, `tool-card` | **KEEP** (telas de dados); StatCard novo |
| `.stat-card` + regras `!important` | 26 regras | **REMOVIDAS** (StatCard) |
| Dialogs | 12 `<dialog>` | **KEEP** nativo, **REFINE** (`initModals`) |
| `confirm()`/`alert()` | 15 | 9 **REPLACE**; 6 em `data.js` **pendentes** |
| Toast / `.toast-item` | cores fixas, sem live region | **REPLACE**; CSS legado removido |
| Alert | inexistente | novo (usado no ConfirmDialog) |
| Empty state / skeleton | helpers com cores fixas | **REPLACE** por delegação |
| Dropdown | menu do avatar custom | **REPLACE** (Dropdown) |

## Legado medido (`src/`, comentários ignorados)

| Métrica | Antes | Depois |
| --- | --- | --- |
| `!important` (CSS) | 48 | 29 |
| `onclick=` inline (HTML + templates JS) | 120 | 102 |
| `confirm()`/`alert()` nativos | 15 | 6 |
| Pares `dark:*` (HTML/JS) | 731 | 641 |

Ainda restam 102 `onclick` inline (as telas de dados e os templates de cartões em JS), 29 `!important`
(camada "sobriedade" dos filtros, print, iOS 16px, reduced-motion) e os breakpoints legados 375/480/1536
das telas internas: pertencem aos próximos gates. Os componentes novos só usam o contrato 768/1024/1280.
