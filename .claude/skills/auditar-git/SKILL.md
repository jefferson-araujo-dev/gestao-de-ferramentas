---
name: auditar-git
description: Audita o estado real do repositório Git — branch, HEAD, working tree, relação com o remoto e últimos commits — com evidência de comando, no formato usado nos REPORTs deste projeto. Use antes de iniciar qualquer gate, ou sempre que for preciso confirmar o estado do repositório sem depender de memória de conversa.
allowed-tools: Bash(git rev-parse *) Bash(git status *) Bash(git log *) Bash(git diff *) Bash(git rev-list *)
---

## Estado do Git

- Branch atual: !`git rev-parse --abbrev-ref HEAD`
- HEAD: !`git rev-parse HEAD`
- Último commit: !`git log -1 --pretty=fuller`
- Status (branch + porcelain): !`git status --porcelain=v1 -b`
- Staged (resumo): !`git diff --cached --stat`
- Últimos 10 commits: !`git log --oneline -10`

## Instruções

Apresente o resultado acima no formato usado nos REPORTs deste projeto: branch, HEAD (hash completo + mensagem + data), working tree (limpo/sujo — se sujo, listar os arquivos), relação com o remoto (ahead/behind, se determinável pela saída acima), e os últimos commits em uma linha cada. Não interprete além do que os comandos mostraram — se algo não puder ser determinado a partir da saída, diga "NÃO DETERMINADO" em vez de supor.
