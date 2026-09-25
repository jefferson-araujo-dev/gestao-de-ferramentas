@AGENTS.md

## Orquestração de ferramentas Claude Code

A skill local `.claude/skills/gestao-ferramentas-workflow/SKILL.md` define quando acionar Superpowers, Ponytail, Security Guidance, Frontend Design, playwright-cli e Humanizer neste repositório. Consultá-la antes de acionar qualquer uma dessas ferramentas em um gate.

## Ciclo de trabalho com o Cowork

Este projeto segue o ciclo de governança:

GATE → EXECUÇÃO → REPORT → REVIEW → VEREDITO.

O escopo autorizado para qualquer sessão é exclusivamente o gate fornecido pelo Cowork no início da responsabilidade. Este arquivo, a memória de sessões anteriores e o histórico de conversas não constituem autorização adicional.

- Antes de iniciar, verificar se o trabalho já foi feito, está em andamento, ou já existe REPORT/REVIEW sobre ele. Não repetir diagnóstico ou execução já cobertos.
- Executar apenas o escopo autorizado no gate ativo. Não ampliar escopo, não "corrigir de passagem", mesmo quando uma correção parecer óbvia e de baixo risco.
- Se uma pré-condição do gate não for satisfeita, ou surgir uma alternativa de design não prevista no gate, parar e relatar — a decisão é do Cowork, não do Claude Code.
- Produzir o REPORT com evidências verificáveis: caminho de arquivo e linha para cada afirmação sobre código, comandos executados e seus resultados, diffs, estado do Git. Nunca declarar sucesso sem evidência; marcar como "NÃO DETERMINADO" o que não puder ser confirmado.
- Ao final do REPORT, parar. Não iniciar a próxima responsabilidade sem aguardar o veredicto do Cowork.

## Governança de modelos e esforços

Modelo, esforço e Thinking são selecionados dinamicamente por gate, conforme risco e complexidade — não há padrão absoluto fixo.

### Claude Web / Cowork

**Modelos:** Haiku 4.5, Sonnet 5, Opus 5, Fable 5.
**Esforços:** Baixo, Médio, Alto, Extra.

- **Haiku 4.5** — classificação simples; tarefas curtas; transformações textuais; baixo risco.
- **Sonnet 5** — criação de gates; planejamento; revisão de REPORT; REVIEW e veredito; documentação; análise técnica de baixa/média complexidade.
- **Opus 5** — arquitetura complexa; segurança; causa raiz; alto impacto; múltiplas dependências; auditorias críticas; decisões com alto custo de erro.
- **Fable 5** — problemas excepcionalmente complexos; análises extensas; casos multidisciplinares difíceis; usar apenas com justificativa explícita.

### Claude Code / VS Code

**Modelos:** Haiku 4.5, Sonnet 5 / Default, Opus 5, Fable 5, Max, Ultracode - xhigh + workflows.
**Esforços (conforme a interface/modelo):** Low, Medium, High, Extra High, Max, Ultracode - xhigh + workflows.
**Thinking:** On, Off.

- **Haiku 4.5** — inspeções simples; tarefas mecânicas; baixo risco; nenhuma alteração estrutural relevante.
- **Sonnet 5 / Default** — inspeção; implementação cotidiana; testes; Git autorizado; refatoração de baixo/médio risco.
- **Opus 5** — debugging difícil; arquitetura; segurança; dependências complexas; refatorações de alto impacto; diagnóstico de causa raiz; mudanças difíceis de reverter.
- **Fable 5** — problemas excepcionalmente difíceis; tarefas longas e multidisciplinares; situações em que Opus não seja suficiente.
- **Max** — não usar como padrão; exigir justificativa concreta de complexidade e benefício esperado.
- **Ultracode - xhigh + workflows** — reservar para engenharia excepcionalmente complexa; exigir justificativa explícita.

### Critérios de seleção

Antes de escolher modelo/esforço, considerar: risco, impacto, dificuldade, quantidade de arquivos/componentes envolvidos, risco de regressão, necessidade de raciocínio arquitetural, dificuldade de validação e custo de uma decisão errada.

- Usar a menor capacidade (modelo/esforço) que ofereça margem adequada ao risco da tarefa.
- Não usar capacidade máxima (Max, Fable 5, Ultracode - xhigh + workflows, esforço Extra/Extra High/Max) sem justificativa explícita de complexidade e benefício esperado.

Perfis de tarefa:

- **Tarefas simples** — classificação, transformação textual mecânica, leitura/checagem pontual: Haiku 4.5, esforço Baixo/Low.
- **Tarefas de complexidade baixa/média** — criação de gates, documentação, implementação cotidiana, testes, refatoração de baixo/médio risco: Sonnet 5 / Default, esforço Médio/Alto ou High.
- **Tarefas de alto risco** — segurança, arquitetura, causa raiz, múltiplas dependências, mudanças difíceis de reverter: Opus 5, esforço Alto/High ou Extra High, avaliar Thinking On.
- **Tarefas excepcionalmente complexas** — análises extensas, casos multidisciplinares difíceis, engenharia excepcionalmente complexa: Fable 5, Max ou Ultracode - xhigh + workflows, sempre com justificativa explícita registrada no gate.

### Registro obrigatório no Gate

Todo gate técnico deve indicar:

**Claude Web / Cowork:** ambiente, modelo, esforço, nova conversa ou continuação, justificativa.

**Claude Code / VS Code:** modelo, esforço, Thinking, nova sessão ou continuação, justificativa.
