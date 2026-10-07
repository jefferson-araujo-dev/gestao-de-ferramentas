---
name: "secret-pii-hygiene"
description: "Controla prevenção, detecção, classificação, contenção e reporte de segredos, credenciais e dados pessoais no Gestão de Ferramentas. Usar em Gates com Git, commits, logs, REPORTs, Vercel, Firebase, variáveis de ambiente, screenshots ou debugging."
---

# Higiene de segredos e dados pessoais — Gestão de Ferramentas

## 1. Objetivo

Impedir que segredos, credenciais, dados pessoais ou informações operacionais
sensíveis sejam:

- introduzidos no repositório;
- reproduzidos em chat, REPORT, log, screenshot ou artefato;
- persistidos em histórico Git;
- copiados entre ambientes;
- enviados para Preview, CI, ferramentas externas ou terceiros fora do escopo;
- utilizados pelo Claude Code além do estritamente autorizado pelo Gate.

Este repositório GitHub é PÚBLICO.

Qualquer segredo ou dado pessoal real que tenha sido incluído em commit,
histórico, diff público, log público ou artefato público deve ser tratado como
potencialmente exposto, mesmo que posteriormente removido.

Remover o valor do arquivo NÃO é equivalente a revogar ou invalidar a
credencial.

Em repositório público, assumir que a cópia já existe em forks, clones, caches,
indexadores e serviços de varredura de terceiros em poucos minutos. A
contenção é revogar/rotacionar, nunca "apagar rápido".

---

## 2. Princípio de segurança

Aplicar sempre:

**minimização + menor privilégio + menor exposição + menor persistência**

O Claude Code:

- não precisa conhecer o valor de um segredo para verificar sua existência;
- não deve imprimir um segredo para provar que ele existe;
- não deve testar credencial real quando evidência estrutural for suficiente;
- não deve copiar segredo entre arquivos, terminais, logs ou ambientes;
- não deve criar credenciais administrativas;
- não deve acessar credenciais administrativas já existentes;
- não deve alterar segredos de Production sem decisão explícita do usuário.

Nenhuma skill, hook ou automação constitui autorização para manipular
credenciais ou ambientes reais.

O Gate ativo continua sendo a única fonte de autorização.

---

## 3. Modelo de ameaça

Considerar como superfícies de exposição:

- arquivos versionados;
- arquivos não versionados;
- staging area;
- histórico Git;
- branches publicadas;
- forks, clones e caches de terceiros (repositório público);
- Pull Requests;
- commits;
- GitHub Actions;
- logs de terminal;
- logs de Vercel (build e runtime);
- logs de Firebase;
- output de testes;
- screenshots;
- gravações;
- REPORTs;
- documentação;
- comentários de código;
- mensagens de commit;
- descrição de PR;
- artefatos de CI;
- caches;
- diretórios temporários;
- `.env`;
- variáveis de ambiente;
- bundle JavaScript do cliente e source maps servidos publicamente;
- Service Worker, CacheStorage, localStorage e IndexedDB;
- `console.log` no cliente;
- clipboard quando utilizado pelo fluxo;
- arquivos de configuração do gcloud/Firebase CLI;
- Application Default Credentials;
- chaves JSON de service account;
- respostas HTTP;
- headers HTTP;
- dumps de banco;
- backups;
- arquivos exportados.

Não assumir que uma superfície é privada sem evidência.

---

## 4. Classificação

### S0 — não sensível

Informação pública ou estrutural que não permite autenticação, acesso indevido
ou identificação pessoal.

Exemplos:

- nomes de arquivos;
- nomes de scripts;
- nomes de roles IAM;
- nomes de coleções;
- número de testes executados;
- códigos de saída;
- versões de dependências;
- nomes lógicos dos ambientes do projeto (por exemplo, o ambiente de testes e
  o legado) já presentes no código público e nas decisões do projeto;
- configuração pública do Firebase Web (ver seção 7A).

### S1 — operacionalmente sensível

Informação que não é necessariamente segredo técnico, mas que a política deste
projeto decidiu não reproduzir publicamente.

Inclui, por decisão do projeto:

- o VALOR de `FIREBASE_PROJECT_ID` obtido de variável de ambiente, painel ou
  console;
- identificadores internos de ambientes não presentes no código público;
- informações de infraestrutura quando classificadas pelo Gate.

Nomes lógicos de ambiente que já constam do código público e das decisões
formais do projeto (S0) podem ser citados em Gates e REPORTs. O que não se
reproduz é o valor lido de variável ou painel.

Mesmo quando um identificador não seja tecnicamente uma credencial, seguir a
classificação definida pelo projeto.

### S2 — dado pessoal

Inclui:

- nome real;
- e-mail;
- crachá;
- matrícula;
- UID vinculado a pessoa;
- identificador de colaborador;
- telefone;
- qualquer combinação capaz de identificar colaborador real.

### S3 — segredo ou credencial

Inclui:

- senha;
- token;
- cookie de sessão;
- JWT;
- refresh token;
- access token;
- API key privada;
- chave privada;
- service-account JSON;
- credenciais ADC;
- `FIREBASE_PRIVATE_KEY`;
- `FIREBASE_CLIENT_EMAIL`;
- secrets da Vercel;
- secrets de CI;
- credenciais Google Cloud;
- qualquer valor capaz de autenticar ou autorizar uma ação.

### S4 — credencial crítica / administrativa

Inclui:

- Owner/Admin credential;
- service account administrativa;
- chave com acesso a produção;
- credencial capaz de alterar IAM;
- credencial capaz de acessar dados reais;
- credencial capaz de publicar Rules ou realizar deploy administrativo.

S4 exige contenção imediata se houver suspeita de exposição.

---

## 5. Regra absoluta de reprodução

Nunca reproduzir S2, S3 ou S4 em:

- chat;
- REPORT;
- commit;
- diff;
- log;
- screenshot;
- comentário;
- documentação;
- mensagem de commit;
- PR;
- artefato de teste;
- arquivo temporário não controlado.

Se um valor sensível aparecer em output de comando:

1. não repetir o valor;
2. não copiar o output integral;
3. registrar somente:
   - tipo do achado;
   - localização;
   - classificação;
   - ação recomendada;
   - estado de contenção.

Exemplo permitido:

`CREDENCIAL_ENCONTRADA=SIM — tipo: ADC — local: perfil isolado`

Exemplo proibido:

`TOKEN=ya29...`

---

## 6. Regra de redaction

Quando for necessário relatar um achado:

Usar:

`<REDACTED>`

ou descrição sem valor:

`SERVICE_ACCOUNT_KEY_PRESENTE=SIM`

Nunca usar truncamento parcial como mecanismo de segurança quando o fragmento
ainda possa ser reutilizado, correlacionado ou pesquisado.

Não registrar:

- primeiros caracteres;
- últimos caracteres;
- fingerprint improvisado;
- parte da chave;
- parte do token.

Hash de arquivo é permitido quando o hash serve para integridade do artefato e
não deriva diretamente de um segredo isolado.

---

## 7. Variáveis de ambiente

Ao inspecionar Vercel, Firebase, sistema operacional ou CI:

Permitido registrar somente:

- NOME;
- ESCOPO;
- BRANCH;
- existência;
- data de atualização, quando relevante;
- se é ou não referenciada pelo código.

Nunca decriptar ou exibir valor.

Formato permitido:

`FIREBASE_PRIVATE_KEY | Preview | feat/... | PRESENTE`

Formato proibido:

`FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."`

### Higiene de cadastro na Vercel

- Cadastrar segredos como variável do tipo sensível/secret.
- Limitar Preview à branch necessária; duplicatas "All Preview Branches" devem
  ser identificadas e reportadas, não ignoradas.
- Valores novos valem apenas para novos deployments; registrar se o Redeploy
  foi feito.
- Colar o valor somente no painel, nunca em chat, terminal compartilhado ou
  arquivo.

---

## 7A. Cliente público: configuração Firebase Web e bundle

Tudo que entra no código do cliente (`src/`) e no bundle do Vite é PÚBLICO.

- Variáveis com prefixo `VITE_` são incorporadas ao bundle. NUNCA colocar S2,
  S3 ou S4 em variável `VITE_*`, em `src/` ou em arquivo público do Vite.
- A configuração Firebase Web (apiKey, authDomain, projectId e similares,
  hoje em `src/js/config/constants.js`) é projetada para ser pública e NÃO é
  credencial de autorização. Não classificar como incidente S3/S4 por si só.
  Scanners costumam sinalizá-la: registrar como falso positivo esperado, com
  localização, sem tratar como vazamento.
- A proteção real do cliente é: Firestore Rules, restrições da API key no
  Google Cloud (restrição por referrer HTTP e por APIs) e, opcionalmente, App
  Check. Restrições e App Check são endurecimento: verificar o estado atual é
  NAO_DETERMINADO até leitura do console; alterá-las exige Gate.
- Nunca depender de ofuscação, minificação ou "campo escondido na UI" como
  proteção de dado.

---

## 8. Arquivos sensíveis

Tratar como potencialmente sensíveis:

`.env`
`.env.*`
`*.pem`
`*.key`
`*.p12`
`*.pfx`
`service-account*.json`
`application_default_credentials.json`
`credentials.json`

e qualquer arquivo contendo:

`private_key`
`client_email`
`client_secret`
`refresh_token`
`access_token`
`Authorization: Bearer`
`-----BEGIN PRIVATE KEY-----`
`-----BEGIN RSA PRIVATE KEY-----`

Não abrir conteúdo de arquivo sensível se a existência e o caminho já forem
suficientes para concluir a verificação.

Confirmar que o `.gitignore` cobre esses padrões sem ler os arquivos:
`git check-ignore -v <caminho>` (mostra a regra aplicada, não o conteúdo).

---

## 8A. Varredura sem eco (como procurar sem vazar)

O erro mais comum é o comando de busca imprimir o próprio segredo encontrado.
Ao varrer, usar SEMPRE modos que não ecoam o conteúdo:

- listar apenas arquivos: `git grep -nIl -E "<padrão>" -- .`
  (`-l` lista caminhos; nunca usar `-o`, `-h` ou mostrar a linha correspondente);
- contar ocorrências: `git grep -cI -E "<padrão>"` ou `grep -c`;
- só verificar existência: `-q` e usar o código de saída;
- no staging: `git diff --staged -U0 | grep -c -E "<padrão>"` (contagem,
  nunca o trecho);
- histórico, só nomes: `git log --all --name-only --format= -S"<trecho>"` e
  `git log --all --diff-filter=A --name-only --format= -- "*.env*" "*.pem"
  "*service-account*"`.

Padrões úteis (ajustar ao caso; não colar achados no REPORT):

- chave privada PEM: `-----BEGIN [A-Z ]*PRIVATE KEY-----`;
- JSON de service account: `"private_key" *:` e `"client_email" *:`;
- token OAuth Google: `ya29\.`;
- JWT: `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.`;
- cabeçalho: `Authorization: *Bearer`;
- formato de API key Google: `AIza[0-9A-Za-z_-]{35}` (esperado na configuração
  Firebase Web pública; ver 7A).

A saída da varredura vai para o REPORT como: padrão (categoria), nº de
arquivos, caminhos, e classificação. Nunca o valor.

Varredura limitada a `git grep` em um ramo NÃO cobre histórico, outras
branches, forks nem artefatos. Declarar o alcance real da varredura.

---

## 9. Verificação antes de commit

Antes de qualquer commit autorizado, verificar:

`git status`

`git diff`

`git diff --staged`

e procurar por:

- `.env`;
- credenciais JSON;
- private keys;
- tokens;
- JWTs;
- headers Authorization;
- dados pessoais;
- dumps;
- backups;
- arquivos temporários;
- screenshots contendo painéis;
- logs.

Não executar `git add .` ou equivalente cego quando houver risco de arquivos
sensíveis não revisados.

Preferir staging explícito por caminho.

O commit não pode prosseguir quando houver achado S2, S3 ou S4 não resolvido.

Repositório público: considerar habilitar secret scanning e push protection do
GitHub como controle preventivo. É recomendação ao usuário, não ação do Claude
Code.

---

## 10. Verificação de histórico

Quando houver suspeita de que um segredo foi commitado anteriormente:

NÃO assumir que remover no HEAD resolve o incidente.

Verificar, dentro do escopo autorizado:

- histórico Git;
- branches publicadas relevantes;
- PRs;
- tags;
- arquivos removidos;
- commits antigos.

Se existir evidência de publicação:

classificar:

`SEGREDO_PUBLICADO=SIM`

e considerar a credencial comprometida.

A ação primária é:

**revogar/rotacionar**

e não apenas apagar do Git.

Reescrita de histórico é operação destrutiva e NÃO pode ser realizada sem
autorização explícita do usuário. Mesmo após reescrita, a credencial segue
comprometida.

---

## 11. Resposta a incidente

Ao encontrar segredo ou credencial:

### Caso A — somente local, nunca publicada

1. interromper a operação que causaria publicação;
2. não reproduzir o segredo;
3. remover do fluxo de staging quando autorizado;
4. verificar se existe cópia em log, cache ou artefato;
5. avaliar necessidade de rotação conforme exposição.

### Caso B — já publicada ou enviada a superfície não confiável

1. tratar como comprometida;
2. interromper o Gate quando o risco exigir;
3. recomendar revogação/rotação;
4. não depender da remoção do commit como contenção;
5. registrar apenas metadados do incidente;
6. aguardar decisão do usuário quando a ação alterar Production, IAM ou segredo
   real.

### Caso C — credencial administrativa S4

Classificar imediatamente:

`SECURITY_INCIDENT=SIM`

Parar qualquer ação não essencial.

Não testar se a credencial ainda funciona.

Recomendar revogação/rotação pela autoridade humana competente.

### Matriz de decisão

| Classe | Exposição | Ação primária | Quem executa |
| --- | --- | --- | --- |
| S2 | publicada | avaliar notificação/LGPD, remover, registrar | usuário decide |
| S3 | publicada | revogar/rotacionar | usuário, em painel |
| S3 | só local | evitar publicação, higienizar | Claude Code, se autorizado |
| S4 | qualquer suspeita | desabilitar imediatamente, depois investigar | usuário, em painel |

---

## 11A. Runbook de rotação de chave de service account

Executado exclusivamente por humano, em painéis autorizados. O Claude Code não
executa, não vê o valor e não testa a chave.

Rotação planejada (sem exposição confirmada):

1. criar a nova chave na MESMA conta de serviço dedicada (nunca reaproveitar
   conta de outro ambiente);
2. atualizar `FIREBASE_PRIVATE_KEY` e `FIREBASE_CLIENT_EMAIL` na Vercel, no
   escopo e branch corretos;
3. fazer Redeploy do escopo afetado (valores novos só valem em novo
   deployment);
4. validar a funcionalidade por teste fictício;
5. desativar a chave antiga; após a janela de observação, excluí-la;
6. apagar o JSON baixado, inclusive da lixeira do sistema;
7. registrar no REPORT: datas, escopo, `SEGREDOS_EXPOSTOS` e quem executou.

Exposição confirmada ou suspeita:

1. DESABILITAR a chave comprometida imediatamente (aceitar indisponibilidade);
2. seguir o runbook acima com chave nova;
3. revisar logs de uso da conta no período de exposição (somente leitura);
4. tratar como incidente e registrar metadados, nunca o valor.

Rotação em Production exige decisão explícita do usuário e Gate próprio.

---

## 12. Logs e debugging

Nunca registrar:

- Authorization header;
- cookie;
- token;
- corpo de login;
- corpo contendo dados pessoais;
- Firebase ID Token;
- refresh token;
- credencial Google.

Quando o erro original contiver informação sensível, sanitizar antes de
registrar.

Formato permitido:

`HTTP 401 — token rejeitado`

Formato proibido:

`HTTP 401 — token ya29... rejeitado`

Não ativar logging adicional em Production sem autorização específica.

Não introduzir `console.log` de objetos de usuário, colaborador, crachá, token
ou resposta de API no cliente nem nas funções; no cliente o log é visível ao
usuário e em capturas de tela.

---

## 13. Screenshots

Antes de salvar screenshot, verificar visualmente:

- e-mails;
- nomes;
- UIDs;
- tokens;
- secrets;
- variables;
- paths contendo informação sensível;
- painéis IAM;
- Authentication users;
- dados reais.

Se houver conteúdo sensível:

não gerar o screenshot ou redigir antes de persistir, quando tecnicamente
seguro e autorizado.

Não confiar em blur visual reversível como única proteção.

---

## 14. REPORT

Todo REPORT envolvendo código, Git, infraestrutura, Firebase, Vercel ou
credenciais deve declarar:

`SEGREDOS_EXPOSTOS=<SIM | NAO | NAO_DETERMINADO>`

`DADOS_PESSOAIS_EXPOSTOS=<SIM | NAO | NAO_DETERMINADO>`

`SECRET_SCAN_EXECUTADO=<SIM | NAO>`

`SECRET_SCAN_ALCANCE=<working tree | staging | branch | historico | outros>`

`GIT_STAGED_REVISADO=<SIM | NAO | NAO_APLICAVEL>`

`HISTORICO_GIT_VERIFICADO=<SIM | NAO | NAO_APLICAVEL>`

`CREDENCIAIS_ADMINISTRATIVAS_UTILIZADAS=<SIM | NAO>`

Só declarar:

`SEGREDOS_EXPOSTOS=NAO`

quando houver evidência suficiente.

Ausência de achado em busca parcial não é prova de ausência global.

Quando a verificação não cobrir toda a superfície relevante:

`SEGREDOS_EXPOSTOS=NAO_DETERMINADO`

---

## 15. Dados de teste

Usar exclusivamente dados sintéticos.

Nunca copiar dados reais para:

- teste unitário;
- fixture;
- seed;
- Playwright;
- emulator;
- Preview;
- screenshot;
- exemplo de documentação.

O projeto Firebase:

`gestao-de-ferramentas-3f8f1`

é exclusivamente ambiente de testes com dados fictícios, conforme decisão do
usuário de 2026-10-06.

Nenhum dado real, pessoal ou operacional deve entrar nesse projeto.

Operações mutáveis somente dentro de Gate explicitamente autorizado.

Dados sintéticos devem ser inequivocamente falsos (nomes e crachás de
exemplo, e-mails em domínio reservado como example.com), para que um dado real
nunca seja confundido com fixture e vice-versa.

---

## 16. Firebase legado

O projeto:

Firebase legado (nome informado no Gate)

permanece protegido contra novas alterações até decisão explícita.

A existência de uso operacional atual não constitui autorização para:

- escrita nova;
- migração;
- restauração;
- importação;
- reset;
- publicação de Rules;
- reconexão de aplicação;
- alteração IAM.

Leitura somente ocorre quando Gate específico autorizar.

---

## 17. Credenciais de Preview

Credenciais de Preview devem:

- possuir menor privilégio possível;
- ser usadas somente no ambiente explicitamente autorizado;
- não ser reutilizadas em Production;
- não ser persistidas no repositório;
- possuir decisão de revogação registrada no Gate.

A chave `preview-admin-sdk`, enquanto a decisão vigente permitir sua
manutenção temporária, permanece limitada ao ciclo atual de testes e ao
ambiente Preview autorizado.

Revogar imediatamente quando houver:

- suspeita de exposição;
- presença em arquivo;
- presença em commit;
- presença em log;
- presença em histórico;
- presença em REPORT;
- acesso fora do Preview;
- uso fora do escopo;
- entrada de dado real;
- encerramento do ciclo definido pelo Gate.

A manipulação da chave é exclusivamente humana em painel autorizado.

O Claude Code nunca recebe, lê, copia ou testa seu valor.

---

## 18. Produção

Qualquer ação envolvendo:

- segredo de Production;
- rotação de credencial de Production;
- alteração de variável de Production;
- IAM de Production;
- Firebase de Production;
- Rules de Production;
- deploy;
- rollback;
- redeploy;
- promoção;

exige decisão explícita do usuário e Gate apropriado.

Nenhuma correção de segurança autoriza implicitamente mudança de Production.

---

## 19. Ferramentas automáticas

Secret scanners, hooks e verificações automáticas são controles auxiliares.

Eles não substituem:

- revisão de diff;
- revisão de staging;
- inspeção contextual;
- decisão humana;
- rotação de credencial comprometida.

Resultado negativo de scanner:

`nenhum segredo detectado`

NÃO equivale a:

`nenhum segredo existe`.

Não instalar nova ferramenta de segurança ou dependência apenas para executar
uma verificação pontual sem autorização quando isso alterar o repositório.

---

## 20. Condições de interrupção

Interromper o Gate e reportar quando ocorrer:

- segredo S3/S4 exposto;
- dado pessoal real em ambiente de teste;
- credencial administrativa acessível ao Claude Code;
- necessidade de visualizar segredo para continuar;
- necessidade de alterar segredo de Production;
- necessidade de reescrever histórico Git;
- necessidade de ativar serviço externo não autorizado;
- dúvida razoável se determinado dado é real ou sintético.

Na dúvida:

**não expor, não copiar, não publicar, não continuar.**

Registrar:

`STATUS=BLOCKED`

e pedir decisão.

---

## 21. Decisões reservadas ao usuário

Exigem decisão explícita do usuário:

- tornar o repositório privado;
- habilitar secret scanning/push protection no GitHub;
- revogar ou rotacionar credenciais de Production;
- alterar secrets de Production;
- reescrever histórico Git publicado;
- remover ou substituir conta de serviço;
- alterar IAM;
- alterar escopo de credencial;
- alterar restrições da API key ou ativar App Check;
- transferir dados reais entre projetos;
- permitir exceção a esta política.

O Claude Code pode recomendar essas ações, mas não executá-las sem autorização.

---

## 22. Critério de conclusão

Esta skill só pode ser considerada cumprida quando:

- nenhuma informação sensível foi reproduzida;
- superfícies relevantes foram revisadas dentro do escopo;
- o alcance real da varredura foi declarado;
- achados foram classificados;
- segredos potencialmente expostos foram tratados como incidentes;
- REPORT foi sanitizado;
- nenhuma ação administrativa excedeu o Gate;
- pendências e áreas não verificadas foram explicitamente marcadas como
  `NAO_DETERMINADO`.