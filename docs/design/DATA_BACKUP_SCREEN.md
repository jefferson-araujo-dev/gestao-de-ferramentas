# Tela "Dados e backup" (Gate 1-F1)

Tela administrativa única para backup, restauração e manutenção dos dados operacionais. Substitui a
seção "Dados (transitório)" que vivia no menu da conta e migra os 6 `confirm()` nativos de
`src/js/modules/data.js` para o ConfirmDialog do Gate 1-E. Nenhuma alteração de backend, regras do
Firebase ou contrato da API de backup.

## Rota, permissão e navegação

| Item | Valor |
| --- | --- |
| Rota | `#/dados` |
| Rótulo / título | Dados e backup (`document.title`: "Dados e backup · Gestão de Ferramentas") |
| Grupo | Administração (após "Usuários e acessos") |
| Permissão | `canBackupData` (só administrador), declarada em `src/js/config/navigation.js` |
| Mobile | fora da barra inferior: aparece em "Mais" |
| Painel | `#tab-data` (`src/partials/tabs/tab-data.html`), montado por `App.DataAdmin` |

A regra de perfil **não** foi duplicada: `NAV_ITEMS` referencia o flag e o guard existente
(`App.UI.switchTab`) recusa a rota antes de qualquer render. Perfil padrão/restrito: sem item, deep
link e `switchTab` recusados (Painel + aviso), `#data-screen` permanece vazio, nenhum listener de
histórico é criado e as funções de `App.Data` respondem `denied` se chamadas diretamente.

Menu da conta agora: Meu Perfil, Alterar Senha, Modo Noturno, Sair do Sistema.

## Estrutura

1. **Resumo**: contagens que `App.Data` já carrega (ferramentas, colaboradores, histórico, usuários),
   atividade mais recente (`latestKnownActivity`) e formato do backup. `Skeleton` enquanto carrega.
2. **Backup**: exportar JSON v4 (ação segura, não altera dados, sem upload).
3. **Importação e restauração**: restaurar de arquivo JSON em etapas; importar ferramentas de Excel.
4. **Manutenção de dados** (zona destrutiva): excluir histórico > 30 dias; resetar dados operacionais.
5. **Métricas de uso**: as medidas de `MetricsManager.getReport()` (tempo ativo, taxa de erros
   ocultos, empréstimos/devoluções via scanner). O modal "Métricas do Sistema" foi **removido**: a
   seção o substitui com os mesmos números, sem métricas novas.

Componentes: `Card`, `Button`, `Input`, `Alert`, `Skeleton`, ConfirmDialog e Toast. CSS só de
layout em `src/css/data-admin.css` (somente tokens; sem `dark:`, sem `!important`, sem cor literal:
verificado por `tests/unit/dataAdminModel.test.mjs`).

## Restauração em etapas

`SELECIONAR` -> `VALIDAR` -> `REVISAR` -> `CONFIRMAR` -> `EXECUTAR`.

1. **Selecionar**: `input[type=file]` rotulado. Nada é enviado.
2. **Validar** (`inspectBackupFile`, local): extensão `.json`, tamanho <= 4 MB, JSON, schema (v4 ou
   legado 3.0 pelo adaptador), `requireNonEmpty` e hash SHA-256 de `data`. Erros têm mensagem útil,
   sem dados do backup (códigos e contagens apenas) e ficam associados ao campo (`aria-invalid`,
   `aria-describedby`).
3. **Revisar**: nome, tamanho, formato, data de exportação, contagens, aviso de legado 3.0 e aviso de
   "backup mais antigo que o sistema".
4. **Confirmar**: ConfirmDialog `danger` com **confirmação reforçada** (digitar `RESTAURAR`), efeito
   descrito ("substituídos", "usuários preservados", "backup de segurança"). Backup mais antigo que a
   atividade do sistema pede uma segunda confirmação. Cancelar (botão ou Esc) não faz nada; o fundo não
   cancela.
5. **Executar**: backup de segurança `pre_restore_*` é baixado **antes**, depois a API
   (`/api/backup/restore`) com a confirmação interna `RESTORE_OPERATIONAL_DATA`.

O arquivo lido (pode conter dados pessoais) é descartado ao concluir, ao remover e ao sair da tela.

## Confirmações (os 6 `confirm()` de `data.js`)

| Antes (nativo) | Agora | Classe |
| --- | --- | --- |
| "Deseja excluir registros > 30 dias?" | `confirm` danger: diz o que será excluído (quantidade), o que não é afetado e que não há backup automático | DESTRUCTIVE |
| Reset: "RESETAR DADOS OPERACIONAIS ... Tem certeza?" + "ÚLTIMA CHANCE!" (2 diálogos) | 1 diálogo danger com **digitar `RESETAR`**; contagens concretas; backup de segurança `pre_reset_*` antes | CRITICAL_DESTRUCTIVE |
| Restaurar: resumo em texto corrido | 1 diálogo danger com lista de efeitos e **digitar `RESTAURAR`** | CRITICAL_DESTRUCTIVE |
| Restaurar backup mais antigo | `confirmDanger` "Restaurar um backup mais antigo que o sistema?" | CRITICAL_DESTRUCTIVE |
| Importar Excel | `confirmAction` (não destrutivo: só cadastra) com o nome do arquivo e o aviso de duplicidade | MUTATING |

`NATIVE_CONFIRM` em `src/`: 6 -> 0. `alert()`/`prompt()`: 0 -> 0 (`deferredPrompt.prompt()` do
instalador PWA é método da API do navegador, não diálogo bloqueante).

A confirmação visual **nunca** substitui a validação server-side: a API continua exigindo
`confirmation` e admin ativo, e o cliente continua enviando as mesmas constantes.

## Inventário de `data.js`

| Função | Classe | Efeito |
| --- | --- | --- |
| `readCollectionForBackup`, `latestKnownActivity`, `processAndRenderHistory` | SAFE_READ | leitura |
| `inspectBackupFile` (novo; era parte do antigo `importJSON`) | SAFE_READ | lê e valida o arquivo localmente |
| `exportJSON` / `_generateBackup` | SAFE_EXPORT | lê 4 coleções e baixa o JSON; sem escrita |
| `exportExcel` | SAFE_EXPORT | baixa planilha (botão do Painel; não migrado) |
| `importExcel` | MUTATING | `addDoc` em `tools`; não altera as existentes |
| `updateTool` / `logAction` | MUTATING | movimentação (fora de escopo) |
| `cleanOldLogs` | DESTRUCTIVE | `deleteDoc` em `history` com mais de 30 dias |
| `resetAllData` | CRITICAL_DESTRUCTIVE | `/api/backup/reset` (server-side atômico) |
| `restoreBackup` (antes `importJSON`) | CRITICAL_DESTRUCTIVE | `/api/backup/restore` (server-side atômico) |

Contrato v4 preservado: restaurável = tools, collaborators, history; users somente referência
redigida e **nunca** restaurada (0 escritas em `users`); timestamp explícito; adaptador legado 3.0;
backups de segurança `pre_restore`/`pre_reset` mantidos. Verificado por `test:backup:emulator` e por
`tests/unit/backupStatic.test.mjs` (invariantes preservados; apenas os marcadores de `importJSON`
passaram a `restoreBackup`).

## Feedback, carregamento e duplo envio

* Uma operação de dados por vez, em duas camadas: `App.Data._beginOperation` (lock; um segundo
  acionamento devolve `busy`) e a tela (botão acionado em `aria-busy`, demais controles
  desabilitados). O botão só entra em "carregando" depois da confirmação.
* Toast continua para sucesso/andamento (comportamento existente). **Erros e o resultado de
  restore/reset ficam também num Alert persistente** na seção; o incidente (servidor sem conseguir
  reverter) gera Toast persistente + Alert "Incidente: ação do administrador necessária".
* Nada registra o conteúdo do backup (`console.error` recebe só `error.message`).

## Achados tratados por serem parte do fluxo migrado

* `importExcel` chamava `App.Data.init()` **sem permissões** após importar (os listeners não voltavam
  até recarregar); agora usa `window.App.Auth.permissions`. Também ganhou verificação de permissão
  (`canManageTools`) e `catch` com feedback (antes a falha virava rejeição sem tratamento).
* O botão "Limpar Antigos" saiu da tela Auditoria: a ação vive só em Manutenção de dados (uma única
  localização para a mesma ação destrutiva).
* Reset: os 2 diálogos ("Tem certeza" + "ÚLTIMA CHANCE") viraram 1 com digitação obrigatória.

## Testes

| Arquivo | Cobre |
| --- | --- |
| `tests/unit/dataAdminModel.test.mjs` | inspeção por estágios, PII fora das mensagens, stale, erros da API, tokens/CSS |
| `tests/unit/backupStatic.test.mjs` | invariantes do cliente (backup de segurança antes da API, sem escrita direta, sem `confirm()`) |
| `tests/unit/navigationModel.test.mjs` | rota `dados`, permissão `canBackupData`, grupo, "Mais" |
| `tests/e2e/data-backup.spec.js` | autorização (3 perfis), export, arquivo inválido/legado/stale, cancelar/Esc/fundo, reforçada, loading, duplo envio, falhas simuladas, layout 320-1440, escuro |
| `tests/e2e/data-backup.destructive.spec.js` | limpar histórico de verdade **no emulator**, por último; re-semeia o seed |
| `tests/e2e/a11y-baseline.spec.js`, `baseline.mobile.spec.js` | axe: ociosa, arquivo válido, diálogos, erro, escuro, mobile |
| `tests/e2e/visual-baseline.spec.js`, `baseline.mobile.spec.js` | 6 imagens novas (desktop claro/escuro, diálogo, mobile) |

Restore e reset **nunca** rodam de verdade nos testes de UI: a API é simulada por `page.route`
(nenhum request sai da máquina) e o contrato real é o de `npm run test:backup:emulator`.
