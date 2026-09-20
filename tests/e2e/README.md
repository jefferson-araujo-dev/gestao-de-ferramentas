# E2E autenticado (Firebase Emulator)

Rede de segurança do redesign (Gate 1-B). Roda o app real (Vite em modo emulator) contra o
**Firebase Emulator Suite local** (Auth + Firestore), com dados 100% sintéticos.

```
npm run test:e2e:auth
```

O script sobe os emuladores (`firebase emulators:exec`), semeia o estado, inicia o Vite na porta
3200 com `VITE_USE_FIREBASE_EMULATOR=true` e executa dois projetos: `desktop` (1440x900) e
`mobile` (390x844, arquivos `*.mobile.spec.js`). Requer Java (emuladores) e Chromium do Playwright.

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
- Restore/reset/import reais **nunca** são executados. Só se testa presença, permissão e o guard local
  de backup inválido.

## Estrutura

| Arquivo | Cobre |
| --- | --- |
| `auth-admin.spec.js` | login, 6 telas, dados semeados, menu admin, guard de restore inválido, export v4 (somente leitura), logout |
| `auth-standard.spec.js` | login, telas permitidas, ausência de itens admin **e** recusa em JS (dados nem chegam ao cliente) |
| `auth-restricted.spec.js` | idem para o perfil restrito (sem Colaboradores) |
| `modals.spec.js` | ferramenta, colaborador, perfil, senha, histórico, métricas, logout (sem salvar nada) |
| `scanner.spec.js` | ciclo de vida do Scanner com câmera falsa |
| `navigation-baseline.spec.js` | comportamento ATUAL da navegação (pré-router por hash) |
| `a11y-baseline.spec.js` | baseline axe (desktop, tema claro) |
| `visual-baseline.spec.js` | 4 capturas desktop |
| `baseline.mobile.spec.js` | navegação mobile atual, 2 capturas e axe mobile |

`support/fixtures.js` centraliza login, mapa de abas e a definição de "item ativo". Quando a
navegação mudar de propósito (Gate 1-D), ajuste esses helpers e os testes `*-baseline` em vez de
espalhar seletores.

## Achados registrados como `test.fail()`

Descrevem o contrato desejado e passam enquanto o defeito existir. Quando o defeito for corrigido o
Playwright avisa ("expected to fail but passed"); então remova o `test.fail`.

1. `auth-restricted`: perfil restrito só tem o item de menu oculto; `switchTab('collaborators')`
   funciona e os dados de colaboradores são carregados.
2. `scanner`: o modo câmera nunca exibe o container (`hidden-tab` com `!important`), e o Scanner
   volta ao modo USB com o aviso "Container da câmera não está visível.". Também existe em `main`.

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
