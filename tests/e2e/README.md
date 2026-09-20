# E2E autenticado (Firebase Emulator)

Rede de segurança do redesign (Gate 1-B). Roda o app real (Vite em modo emulator) contra o
**Firebase Emulator Suite local** (Auth + Firestore), com dados 100% sintéticos.

```
npm run test:e2e:auth
```

O script sobe os emuladores (`firebase emulators:exec`), semeia o estado, inicia o Vite na porta
3200 com `VITE_USE_FIREBASE_EMULATOR=true` e executa três projetos: `desktop` (1440x900),
`mobile` (390x844, arquivos `*.mobile.spec.js`) e `destructive` (arquivos `*.destructive.spec.js`, roda
**por último**: apaga documentos semeados do emulator e re-semeia ao terminar). Requer Java (emuladores) e Chromium do Playwright.

## Segurança (falha fechado)

- `playwright.auth.config.js` recusa iniciar sem `FIRESTORE_EMULATOR_HOST` e
  `FIREBASE_AUTH_EMULATOR_HOST` locais (`127.0.0.1`/`localhost`), com `GOOGLE_APPLICATION_CREDENTIALS`,
  com variáveis de service account ou com `PLAYWRIGHT_BASE_URL`.
- Antes do login, o teste exige `__FIREBASE_EMULATOR_CONNECTED__ === true` no app.
- Todo request do navegador passa por uma allowlist (`support/env.mjs`): local, código estático de
  CDN (SDK Firebase em `www.gstatic.com/firebasejs/`, jsDelivr, cdnjs). Qualquer outro host é
  bloqueado e reprova o teste. Fontes e a imagem de terceiro da tela de login são substituídas
  por stubs locais. Dados e autenticação só vão ao emulator.
- Só `POST /api/session/last-login` é respondido por stub; qualquer outra chamada `/api/*`
  (inclusive `/api/backup/*`) é bloqueada e reprova o teste. Nenhum `confirm()`/`alert()` é tolerado.
- Restore e reset reais **nunca** são executados: a API de backup é SIMULADA por `page.route` nos testes
  da tela Dados e backup (nenhum request sai da máquina; o contrato real é o de
  `npm run test:backup:emulator`). A falha simulada de propósito é declarada por teste com
  `guard.allow(regex, motivo)`; qualquer outro erro continua reprovando. Único fluxo que confirma de
  verdade: limpar histórico, no projeto `destructive`, só no emulator.

## Estrutura

| Arquivo | Cobre |
| --- | --- |
| `auth-admin.spec.js` | login, 7 telas, dados semeados, menu da conta (Perfil, Senha, Tema, Sair), logout |
| `data-backup.spec.js` | Gate 1-F1: tela Dados e backup (`#/dados`): rota/aria-current/reload/back-forward, autorização (admin, padrão, restrito), export v4, seleção/validação/revisão de arquivo (inválido, legado 3.0, mais antigo), ConfirmDialog (cancelar, Esc, fundo, confirmação reforçada), restore/reset protegidos com API simulada (ordem backup de segurança -> API, payload sem users, loading, duplo envio, falhas), layout 320/390/768/1024/1440 e tema escuro |
| `data-backup.destructive.spec.js` | Gate 1-F1: limpar histórico confirmado de verdade no emulator (projeto `destructive`, por último; re-semeia) |
| `auth-standard.spec.js` | login, telas permitidas, ausência de itens admin **e** recusa em JS (dados nem chegam ao cliente) |
| `auth-restricted.spec.js` | idem para o perfil restrito: sem Colaboradores no menu, na navegação programática, no listener, na memória e nas regras (leitura direta negada) |
| `restricted-loan.spec.js` | Scanner do perfil restrito: empréstimo por crachá exato (`collaboratorBadge`), recibo sem a lista, recusa genérica, sem busca por nome e devolução; controle do perfil padrão (`collaboratorId`) |
| `modals.spec.js` | ferramenta, colaborador, perfil, senha, histórico, logout (sem salvar nada; o modal de métricas foi substituído pela seção da tela Dados e backup) |
| `scanner.spec.js` | ciclo de vida do Scanner com câmera falsa |
| `navigation.spec.js` | rotas por hash (`#/painel`…), back/forward, reload, deep link, rota desconhecida, recusa das rotas não autorizadas (padrão/restrito), `aria-current`, `document.title` |
| `components.spec.js` | Gate 1-E: componentes fundamentais em isolamento na galeria `/components.html` (só dev): Button/IconButton, Input/Select/Search, Checkbox/Switch, Badge/StatCard/Alert/EmptyState/Skeleton, política de fechamento do Modal, ConfirmDialog, Toast (regiões vivas e tempo), Dropdown (teclado) e axe em light/dark por estado |
| `components-app.spec.js` | Gate 1-E: componentes ADOTADOS no app real (menu da conta, KPIs, filtros do Painel, modais reais com `dismissible`, ConfirmDialog no lugar de `confirm()`, Toast, Switch) |
| `shell.spec.js` | app shell por breakpoint: sidebar 256/72px, rail notebook, drawer tablet, barra inferior + "Mais" no mobile, foco/Esc, mudança de breakpoint em tempo real |
| `a11y-baseline.spec.js` | baseline axe (desktop, tema claro), inclui drawer (tablet), rail expandido (notebook) e, desde o 1-F1, a tela Dados e backup (ociosa, arquivo válido, diálogos, erro, escuro) com varredura restrita à tela |
| `visual-baseline.spec.js` | 4 capturas desktop + 4 da tela Dados e backup (topo, manutenção, diálogo de reset, manutenção no escuro) |
| `foundation.spec.js` | Gate 1-C: tokens LIGHT/DARK no navegador, `:focus-visible`, movimento reduzido e equivalência das regras legadas migradas para tokens (`docs/design/DESIGN_FOUNDATION.md`) |
| `baseline.mobile.spec.js` | barra inferior mobile (C-01 resolvido), 4 capturas (2 da tela Dados e backup) e axe mobile |

`support/fixtures.js` centraliza login (com deep link opcional), mapa de abas (`TABS`: rota, item, título) e a
definição de "tela ativa" (painel visível + URL `#/rota` + título + `document.title` + `aria-current`). O Gate 1-D
atualizou esses helpers de propósito; ajuste-os em vez de espalhar seletores. Contrato completo em
`docs/design/APP_SHELL.md`.

## Achados registrados como `test.fail()`

Nenhum aberto. Os dois achados do Gate 1-B foram corrigidos no Addendum 1-B1 e viraram testes normais:

- **Scanner**: o modo câmera nunca exibia o container (`hidden-tab` com `!important`). `scanner.spec.js`
  cobre USB -> câmera -> USB, inicialização única, liberação da câmera ao sair da aba e o atalho
  "Emprestar" dos cards.
- **Perfil restrito**: só tinha o item de menu oculto. Agora `switchTab('collaborators')` é recusado, o
  listener não inicia, `Data.collaborators` fica vazio e as regras do Firestore negam a leitura. O
  empréstimo continua: o restrito informa o crachá exato e o servidor resolve o colaborador
  (`/api/tools/movement`, coberto por `tests/integration/movementEmulator.test.mjs`; as regras, por
  `tests/integration/firestoreRulesEmulator.test.mjs`).

Quando um novo defeito for registrado, use `test.fail()` com a descrição do contrato desejado e remova-o
ao corrigir (o Playwright avisa "expected to fail but passed").

## API de movimentação no E2E

`/api/tools/movement` é uma função Vercel e não existe no servidor de desenvolvimento do E2E. Os testes
de empréstimo/devolução a substituem por um stub **na página** (`page.route`), que registra o payload
exato enviado pelo app. O servidor real é validado nos testes de integração (Auth + Firestore
Emulator). Qualquer outra chamada `/api/*` continua bloqueada pelo guard.

## Baselines

- **axe** (`baselines/axe-baseline.<projeto>.json`): registra as violações atuais. O teste só falha por
  regressão (regra nova, impacto maior ou mais nós). Para atualizar de propósito:
  `UPDATE_AXE_BASELINE=1 npm run test:e2e:auth` e justifique no commit. Ausência de violações do axe **não**
  comprova conformidade WCAG.
- **Visual** (`*-snapshots/`): baseline estrutural PRÉ-redesign, não aprova o design atual. Imagens
  específicas de Windows + Chromium, com fonte do sistema (fontes remotas são stubadas). Regenerar de
  propósito com `--update-snapshots` (ex.: `npx firebase emulators:exec --only firestore,auth --project
  gestao-de-ferramentas-3f8f1 "playwright test --config playwright.auth.config.js --update-snapshots"`).
- O caminho do service worker/PWA **não** é exercitado (`serviceWorkers: 'block'`), como no gate responsivo.
