---
name: gestao-ferramentas-workflow
description: Orquestra quando e como usar Superpowers, Ponytail, Security Guidance, Frontend Design, playwright-cli e Humanizer neste repositório. Use como referência antes de acionar qualquer uma dessas ferramentas durante um gate, para decidir se ela se aplica e evitar sobreposição ou invocação desnecessária.
---

# Orquestração das ferramentas — Gestão de Ferramentas

Esta skill não substitui as instruções reais de cada ferramenta. Ela decide **quando** acionar cada uma dentro do ciclo GATE → EXECUÇÃO → REPORT → REVIEW → VEREDITO definido em CLAUDE.md. Antes de usar qualquer uma delas, releia a skill/README real da ferramenta — não assuma comando, opção ou comportamento a partir de memória.

## Regra geral

Não executar todas as seis ferramentas em toda tarefa. Cada uma tem um gatilho específico abaixo; se o gatilho não se aplica ao gate ativo, a ferramenta fica de fora.

## 1. Superpowers — coordenação

Superpowers coordena planejamento, investigação e execução orientada a testes. Para qualquer criação de funcionalidade, mudança de comportamento ou correção de bug, o fluxo entra primeiro por uma skill de processo do Superpowers (`brainstorming` para trabalho novo, `systematic-debugging` para bugs) antes de acionar qualquer uma das outras cinco ferramentas. Isso já é o comportamento padrão descrito em `superpowers:using-superpowers`; esta skill apenas confirma que, neste repositório, Ponytail, Security Guidance, Frontend Design, playwright-cli e Humanizer entram como ferramentas complementares ao fluxo do Superpowers — cada uma seguindo seu próprio mecanismo e escopo (hook automático, skill acionada manualmente, etc.) — nunca no lugar dele.

## 2. Ponytail — modo lite neste repositório

Ponytail deve funcionar preferencialmente em **modo lite** neste repositório, para não duplicar o papel de planejamento/verificação que já é do Superpowers (brainstorming, TDD, verification-before-completion). O hook de sessão ativa o Ponytail em modo **full** por padrão — isso é configuração global do usuário, fora do escopo desta skill, e não é alterado aqui. Ao iniciar trabalho de código neste repositório, alternar explicitamente com `/ponytail lite` no início da sessão ou da resposta. Emitir o comando não comprova a mudança: a confirmação de que o modo lite está de fato ativo deve vir de uma resposta, indicador ou evidência produzida pelo próprio Ponytail na sessão (por exemplo, a confirmação de troca de modo que o comando retorna), não da simples presença do comando digitado. Ponytail orienta a simplicidade da solução (ladder YAGNI → reutilizar → stdlib → nativo → dependência já instalada → uma linha → código mínimo); ele não decide o que testar ou como investigar — isso é do Superpowers.

## 3. Security Guidance — revisão complementar, não substitutiva

Security Guidance roda por hooks automáticos (avisos de padrão em Edit/Write, revisão de diff via LLM ao final do turno, revisão agêntica no commit) — não é acionado manualmente como uma skill comum. Ele complementa, mas não substitui, a revisão humana, SAST/DAST, dependency scanning ou pentest (conforme o próprio README do plugin admite ser "best-effort assistive tool, not a guarantee"). Cada camada tem sua própria evidência, vinculada à sessão e à etapa em que efetivamente rodou — não considerar uma camada validada sem essa evidência específica:

- **Camada 1 (avisos de padrão em Edit/Write)**: evidência é o aviso aparecendo inline na sessão no momento do Edit/Write correspondente.
- **Camada 2 (revisão de diff via LLM ao final do turno)**: evidência é o finding (ou a ausência de finding) reportado ao final do turno em que houve diff, ou entrada correspondente em `~/.claude/security/log.txt`.
- **Camada 3 (revisão agêntica no commit)**: só roda no `git commit`. Antes de haver um commit nesta sessão, registrar essa camada como "ainda não executada" — nunca como validada, e nunca criar um commit apenas para testá-la.

Na ausência de evidência de que uma camada rodou, tratá-la como pendente, não como concluída.

## 4. Frontend Design — apenas com UX/UI em escopo

Acionar Frontend Design somente quando o gate ativo envolve trabalho de UX/UI (criação ou alteração de interface, componente visual, layout, tema). Para gates de backend puro (Firebase Admin, funções Vercel sem UI, scripts, configuração), não acionar.

## 5. playwright-cli — inspeção visual e testes isolados

Acionar playwright-cli para inspeção visual e testes em ambiente isolado (browser local, dados de teste), nunca contra o Firebase real ou dados de produção. Antes de usar, confirmar explicitamente que tanto a aplicação quanto as APIs e serviços que ela chama (Firebase, funções Vercel, qualquer backend) apontam para ambientes isolados — não presumir isolamento só porque o browser é local; a URL da aplicação pode estar isolada enquanto o backend por trás dela ainda aponta para projeto/dados reais. Consultar a SKILL.md real da ferramenta (`~/.claude/skills/playwright-cli/SKILL.md`) para os comandos disponíveis antes de usar — não inventar subcomandos.

## 6. Humanizer — apenas revisão textual

Acionar Humanizer somente para revisão de prosa (documentação, mensagens de commit/PR, texto de REPORT), nunca sobre código. Ele não altera blocos de código, comandos, caminhos ou dados — apenas texto corrido, conforme sua própria descrição. Neste repositório, preservar também YAML/frontmatter, hashes (de commit, HEAD, etc.), evidências de comando, resultados de teste e conclusões técnicas de REPORT — nada disso é "prosa a suavizar"; são dados que precisam permanecer exatos.

## Conflitos identificados e resolução

- **Ponytail full (hook global) vs. lite (preferência deste projeto):** não há mecanismo desta skill para forçar o modo lite automaticamente; a alternância é manual (`/ponytail lite`) a cada sessão de código neste repositório. Registrar essa limitação, não fingir que foi resolvida.
- **Security Guidance é automático, as demais são acionadas por skill:** não tratar a ausência de acionamento manual como falha — o correto é confirmar, via log ou finding reportado, que o hook rodou quando o gate envolveu Edit/Write ou commit.
- **Superpowers vs. Ponytail no planejamento:** Superpowers decide o quê investigar/testar; Ponytail decide o tamanho da solução. Não usar Ponytail para pular etapas de investigação do Superpowers.

## O que esta skill não faz

- Não cria comandos novos, não garante integração entre as ferramentas além do que cada uma já oferece nativamente.
- Não altera o comportamento dos hooks globais (Ponytail, Security Guidance) fora deste repositório.
- Não inicia nenhum Gate de desenvolvimento por conta própria.
