# AGENTS.md

## Projeto e escopo

Este repositório contém o sistema Gestão de Ferramentas, composto por aplicação web Vite/PWA, Firebase cliente e funções serverless da Vercel com Firebase Admin.

As alterações devem permanecer estritamente dentro do escopo solicitado.

## Princípios de trabalho

- Separar diagnóstico de alteração.
- Executar uma única alteração ou objetivo por etapa.
- Fazer mudanças cirúrgicas, evitando reformatar conteúdo fora do escopo.
- Preservar todas as alterações locais preexistentes.
- Após qualquer erro, interromper e não executar comandos dependentes.
- Não assumir que avisos enviados ao stderr representam falha sem verificar o código de saída.

## Ambiente e comandos

- Garantir compatibilidade explícita com Windows PowerShell 5.1.
- Preferir PowerShell; usar CMD somente quando for necessário ou tecnicamente mais adequado.
- Derivar caminhos a partir de `(Get-Location).Path`.
- Não usar Base64 ou GZip para criar ou transmitir código.
- Evitar comandos excessivamente longos ou com muitas estruturas aninhadas.
- Avaliar separadamente os códigos de saída de npm, node, git e demais ferramentas.

## Alterações de arquivos

- Preservar UTF-8 sem BOM e as quebras de linha definidas pelo `.gitattributes`.
- Para arquivos novos, gravar primeiro em arquivo temporário, validar e somente depois mover para o destino definitivo.
- Para arquivos existentes, validar a ocorrência exata do bloco antes de substituir.
- Interromper sem gravar quando o conteúdo esperado divergir.
- Não alterar arquivos ou trechos fora do escopo solicitado.

## Git

- Não executar `git add`, `git commit`, `git push`, `git reset`, `git restore`, `git checkout` ou operações destrutivas sem autorização explícita.
- Mostrar alterações com `git --no-pager diff`.
- Executar o diff separadamente após cada alteração.
- Não descartar ou sobrescrever mudanças locais preexistentes.
- Tratar avisos de normalização CRLF/LF como avisos, desde que o comando termine com sucesso.

## Validações

- Executar somente as validações solicitadas.
- Não corrigir automaticamente falhas sem autorização.
- Informar o comando executado, seu código de saída e o resultado.
- Não executar `npm audit fix` ou `npm audit fix --force` automaticamente.

## Segurança

- Não ler, mostrar, copiar ou versionar `.env`, chaves privadas, tokens, senhas ou credenciais.
- Não registrar valores secretos em logs, comandos, diffs ou mensagens.
- Não alterar ambientes de produção, variáveis da Vercel, regras do Firebase ou realizar deploy sem autorização explícita.
