@AGENTS.md

## Ciclo de trabalho com o Cowork

Este projeto segue um ciclo de gates definido no Cowork (Claude Web): GATE → EXECUÇÃO → REPORT → REVIEW → VEREDITO. O escopo autorizado para qualquer sessão é o gate colado pelo usuário no início da conversa — não este arquivo, não a memória de sessões anteriores.

- Antes de iniciar, verificar se o trabalho já foi feito, está em andamento, ou já existe REPORT/REVIEW sobre ele. Não repetir diagnóstico ou execução já cobertos.
- Executar apenas o escopo autorizado no gate ativo. Não ampliar escopo, não "corrigir de passagem", mesmo quando uma correção parecer óbvia e de baixo risco.
- Se uma pré-condição do gate não for satisfeita, ou surgir uma alternativa de design não prevista no gate, parar e relatar — a decisão é do Cowork, não do Claude Code.
- Produzir o REPORT com evidências verificáveis: caminho de arquivo e linha para cada afirmação sobre código, comandos executados e seus resultados, diffs, estado do Git. Nunca declarar sucesso sem evidência; marcar como "NÃO DETERMINADO" o que não puder ser confirmado.
- Ao final do REPORT, parar. Não iniciar a próxima responsabilidade sem aguardar o veredicto do Cowork.
