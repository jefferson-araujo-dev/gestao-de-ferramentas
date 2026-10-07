---
name: "auditar-git"
description: "Audita o estado real do repositório Git (diretório, remote, branch, HEAD, working tree, upstream, operações em andamento e últimos commits) com evidência de comando, no formato dos REPORTs do projeto. Usar antes de qualquer Gate ou para confirmar o estado sem depender de memória."
allowed-tools: Bash(git rev-parse *) Bash(git log *) Bash(git status *) Bash(git diff *) Bash(git rev-list *) Bash(git branch -vv) Bash(git config --get remote.origin.url) Bash(git stash list) Bash(git worktree list) Bash(git submodule status) Bash(git describe --tags --exact-match HEAD)
---

# auditar-git — Auditoria somente leitura do estado Git (Gestão de Ferramentas)

Nível: sênior. Produz evidência verificável do estado do repositório para abertura, fechamento e revisão de Gates. Não corrige, não limpa, não sincroniza: apenas observa e reporta.

## 1. Princípios
1. Evidência primeiro: toda afirmação vem da saída real de um comando executado NESTA auditoria. Memória, REPORT anterior e handoff não substituem a execução.
2. Somente leitura: nenhum comando desta skill altera working tree, índice, refs, configuração ou remoto.
3. Não interpretar além da saída. O que não puder ser determinado é registrado como NÃO DETERMINADO, nunca suposto.
4. Segredos nunca são reproduzidos (seção 9).
5. Auditar não autoriza agir. Divergência encontrada vira PENDÊNCIA ou condição de interrupção; a correção exige Gate.

## 2. Quem executa e onde (modo de operação)
- MODO LOCAL (Claude Code, ou Cowork com acesso real ao repositório do usuário): executar os comandos da seção 4 no diretório do repositório.
- MODO REMOTO (Cowork sem acesso local; apenas conector GitHub): NÃO executar git local no container de nuvem como se fosse o repositório do usuário. Consultar branch, SHA, commits e comparações pelo conector e declarar explicitamente: ESTADO_LOCAL = NÃO DETERMINADO (working tree, staged, untracked, stash e operações em andamento só podem ser provados localmente).
- Se `git rev-parse --show-toplevel` falhar ou apontar para diretório que não seja o repositório oficial, declarar "NÃO É O REPOSITÓRIO OFICIAL / NÃO É REPOSITÓRIO" e parar.

## 3. Isolamento do projeto (obrigatório antes de tudo)
Repositório oficial esperado: `<USERPROFILE>\Projetos\gestao-de-ferramentas-oficial` (<USERPROFILE> = pasta do usuário atual do Windows; a comparação deve usar o caminho resolvido) (Git costuma exibir com barras: `<USERPROFILE>/Projetos/gestao-de-ferramentas-oficial`). Remote esperado: repositório `jefferson-araujo-dev/gestao-de-ferramentas` (comparar owner/repo após sanitização, ignorando protocolo e `.git`).
NÃO misturar com `C:\Projetos\gestao-de-ferramentas` nem `C:\Projetos\gestao-de-ferramentas-next`. Se o toplevel coincidir com algum deles, ou divergir do esperado, NÃO assumir equivalência: registrar a divergência, não prosseguir para auditoria de Gate e pedir decisão. Se o Gate informar caminho/remote diferente, o Gate autorizado prevalece, mas a divergência deve ser registrada.

## 4. Comandos (executar todos; cada um é somente leitura)
Executar um por vez e guardar a saída. Se algum falhar, registrar a falha literal e classificar o item como NÃO DETERMINADO.

```
git rev-parse --show-toplevel
git rev-parse --is-inside-work-tree
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git log -1 --format="%H%n%s%n%ad" --date=iso-strict
git status --porcelain=v1 -b --untracked-files=all
git status
git diff --stat
git diff --cached --stat
git rev-parse --abbrev-ref --symbolic-full-name @{u}
git rev-list --left-right --count HEAD...@{u}
git branch -vv
git config --get remote.origin.url
git stash list
git worktree list
git submodule status
git describe --tags --exact-match HEAD
git log --oneline -10
```

Notas:
- `git rev-parse --abbrev-ref HEAD` retornando `HEAD` = HEAD destacado (detached). Registrar como risco.
- `git rev-list --left-right --count HEAD...@{u}` imprime "ahead behind" (esquerda = commits só locais, direita = commits só no upstream). Sem upstream o comando falha: registrar "sem upstream configurado" e relação com remoto = NÃO DETERMINADO.
- `git describe --tags --exact-match` falhar é normal (HEAD sem tag): registrar "sem tag exata".
- O formato do último commit usa hash, assunto e data; não imprimir e-mail do autor no REPORT.
- `git config --get remote.origin.url` pode conter credencial embutida: nunca copiar a saída crua (seção 9).
- Se a saída estiver truncada ou muito longa (ex.: mais de 50 arquivos sujos), registrar o total e listar apenas os 50 primeiros, dizendo que há truncamento.

## 5. Escopo de rede
- Esta auditoria NÃO executa `git fetch`, `git pull`, `git remote update` nem `git ls-remote` por padrão. Portanto ahead/behind reflete a última referência remota conhecida localmente, NÃO o estado atual do servidor. Declarar sempre: "relação com o remoto baseada em referência local possivelmente desatualizada".
- `git fetch origin` (sem --prune) só pode ser executado se o Gate ou o usuário autorizar expressamente; ele não altera a working tree, mas atualiza refs remotas locais. Registrar quando executado e refazer o ahead/behind depois.

## 6. Interpretação (apenas o que a saída suporta)
1. Working tree LIMPA = `git status --porcelain=v1` sem linhas além da linha de branch (`## ...`), com `--untracked-files=all`. Qualquer linha adicional = SUJA; listar arquivos com código (M, A, D, R, ??, UU etc.).
2. Arquivos ignorados pelo .gitignore não aparecem; não afirmar que "não há arquivos soltos", apenas que não há não rastreados NÃO ignorados.
3. Operação em andamento (merge, rebase, cherry-pick, revert, bisect, am): detectar pelo texto de `git status` (ex.: "rebase in progress", "You have unmerged paths", "All conflicts fixed but you are still merging"). Se houver, classificar como INTERRUPÇÃO.
4. Conflitos não resolvidos: códigos UU, AA, DD, AU, UA, DU, UD no porcelain.
5. Status sujo mas `git diff --stat` e `git diff --cached --stat` vazios e sem `??`: possível alteração só de modo de arquivo ou fim de linha (CRLF/LF, comum no Windows). Registrar como HIPÓTESE, sem concluir; confirmar com `git diff` ou configuração `core.autocrlf`/`core.fileMode` somente se o usuário pedir.
6. Ahead>0 e behind=0: commits locais ainda não publicados. Ahead=0 e behind>0: local atrasado. Ahead>0 e behind>0: DIVERGÊNCIA; não resolver, interromper e reportar.
7. Stash não vazio: reportar quantidade e mensagens; é trabalho potencialmente não commitado e pode ser desconhecido para o Gate.
8. Worktrees adicionais ou submódulos: reportar; o Gate deve ter ciência.
9. Branch atual vs branch esperada do Gate; HEAD atual vs HEAD esperado (comparar por prefixo de pelo menos 7 caracteres, mas reportar o hash completo).
10. Commits recentes: apenas fatos (hash curto, assunto). Não inferir autoria, intenção ou qualidade.

## 7. Comparação com o estado esperado do Gate
Quando o Gate informar estado inicial esperado, avaliar item a item e registrar SIM, NÃO ou NÃO DETERMINADO:
- diretório e remote corretos;
- branch esperada;
- HEAD esperado (ou ancestral esperado);
- working tree limpa quando o Gate exigir baseline limpa;
- sem operação em andamento;
- upstream e relação com o remoto conforme esperado.
Sem estado esperado informado, apenas descrever; não declarar "compatível".

## 8. Condições de interrupção (reportar e parar; não corrigir)
- diretório ou remote fora do oficial, ou divergência não compreendida;
- branch inesperada ou HEAD destacado;
- working tree suja quando o Gate exige baseline limpa;
- operação Git em andamento ou conflitos não resolvidos;
- divergência local/remoto (ahead e behind ambos maiores que zero);
- stash, worktree ou submódulo desconhecidos pelo Gate;
- credencial embutida na URL do remote ou arquivo possivelmente sensível rastreado ou não rastreado;
- risco de perda de trabalho.
Proibido nesta skill (e sem Gate): `checkout`, `switch`, `reset`, `clean`, `restore`, `stash` (push/pop/drop), `rebase`, `merge`, `pull`, `commit`, `push`, `add`, `rm`, `branch -D`, `gc`, qualquer alteração de configuração.

## 9. Segredos e dados pessoais
- A URL do remote pode conter credencial (formato `https://usuario:token@host/...`). Nunca imprimir a saída crua. Reportar apenas `host/owner/repo` sem userinfo e, se houver userinfo, registrar o achado de segurança "credencial embutida na URL do remote" SEM reproduzi-la, com a ação recomendada (remover do remote e rotacionar a credencial, mediante Gate).
- Arquivos não rastreados ou alterados cujo nome sugira segredo (`.env*`, `*.pem`, `*.key`, `*serviceAccount*.json`, `*-adminsdk-*.json`, `*credentials*`, `*secret*`): reportar o CAMINHO e "possível segredo"; nunca ler nem exibir o conteúdo; recomendar verificação de .gitignore em Gate próprio.
- Assunto de commit é conteúdo livre: se parecer conter segredo ou dado pessoal, não reproduzir; apontar o hash e orientar.
- Não incluir e-mails de autor no REPORT.

## 10. Formato de saída (REPORT)
Apresentar em bloco, com valores literais da saída, sem decoração:

```
GIT_STATE
  AUDIT_MODE: LOCAL | REMOTO
  REPO_PATH: (toplevel; normalizado)
  REPO_PATH_MATCH_OFFICIAL: SIM | NAO | NAO_DETERMINADO
  REMOTE_ORIGIN: host/owner/repo (sanitizado)
  REMOTE_MATCH_EXPECTED: SIM | NAO | NAO_DETERMINADO
  BRANCH: nome | HEAD_DESTACADO
  HEAD: hash completo
  HEAD_SUBJECT: assunto
  HEAD_DATE: data ISO
  HEAD_TAG: tag exata | SEM_TAG
  WORKING_TREE: LIMPA | SUJA (N arquivos; lista)
  STAGED: vazio | resumo
  UNTRACKED: nenhum | lista (truncada se > 50)
  OPERATION_IN_PROGRESS: NENHUMA | tipo
  CONFLICTS: NENHUM | arquivos
  UPSTREAM: nome | SEM_UPSTREAM
  AHEAD_BEHIND: A/B | NAO_DETERMINADO
  REMOTE_REF_FRESHNESS: LOCAL_NAO_ATUALIZADA (sem fetch) | FETCH_EXECUTADO_AUTORIZADO
  STASH: N entradas | VAZIO
  WORKTREES_SUBMODULES: nenhum | lista
  LAST_COMMITS: 10 linhas (hash curto + assunto)
  SECURITY_FINDINGS: nenhum | descrição sem reproduzir segredo
  EXPECTED_STATE_COMPARISON: itens SIM/NAO/NAO_DETERMINADO | NAO_FORNECIDO
  INTERRUPTION_CONDITIONS: nenhuma | lista
  NOT_DETERMINED: lista do que não pôde ser provado e por quê
```

Separar ao final: FATOS CONFIRMADOS (saída de comando), HIPÓTESES (ex.: CRLF) e PENDÊNCIAS. Em auditoria de FECHAMENTO de Gate, incluir também GIT_PUBLICATION: commit(s) criado(s) e se foram publicados, cada afirmação com a evidência do comando (ex.: HEAD, ahead/behind, upstream); sem evidência, declarar NÃO DETERMINADO. Nunca declarar commit, push, merge ou PR realizados sem prova.

## 11. Classificação
- AUDITORIA COMPLETA: todos os comandos executados com saída válida.
- AUDITORIA PARCIAL: algum comando falhou ou o modo foi REMOTO; listar os NÃO DETERMINADOS.
- Esta skill não emite PASS/FAIL de Gate: fornece evidência para a revisão. A classificação do Gate (PASS, PASS COM RESSALVAS, PARTIAL, BLOCKED, FAIL) é do revisor.

## 12. Uso em abertura e fechamento de Gate
- Abertura: executar antes de qualquer alteração e comparar com o estado inicial esperado. Divergência material = interromper e pedir decisão.
- Fechamento: executar novamente após o trabalho para registrar o estado final, diferenciando o que foi alterado, staged, commitado e publicado.
- Revalidar quando houver intervalo relevante, troca de sessão ou suspeita de alteração externa; evidência antiga de Git não vale como estado atual.