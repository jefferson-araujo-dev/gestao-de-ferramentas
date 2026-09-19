# Gestão de Ferramentas

Sistema web para controle de ferramentas, colaboradores, empréstimos, devoluções, usuários e auditoria.

**Versão atual:** `v3.1.0`

## Produção

A aplicação é publicada na Vercel e utiliza Firebase Authentication, Cloud Firestore e APIs serverless protegidas.

## Funcionalidades

- painel com indicadores operacionais;
- cadastro e consulta de ferramentas;
- cadastro e consulta de colaboradores;
- leitura de códigos pelo Scanner;
- empréstimos e devoluções;
- histórico e auditoria das movimentações;
- administração de usuários;
- importação e exportação de dados;
- funcionamento como PWA;
- interface responsiva para computadores e dispositivos móveis.

## Perfis e permissões

### Administrador

Possui acesso completo ao sistema:

- inventário;
- criação, edição e exclusão de ferramentas;
- criação e administração de usuários;
- cadastro e edição de colaboradores;
- auditoria;
- importação e exportação;
- ajustes administrativos.

### Usuário Padrão

Possui acesso operacional limitado:

- painel;
- leitor e Scanner;
- consulta de ferramentas;
- consulta de colaboradores;
- empréstimos;
- devoluções.

O Usuário Padrão não pode editar o inventário, administrar usuários, acessar a auditoria ou executar operações administrativas.

## Segurança

As operações sensíveis são executadas por APIs autenticadas:

```text
api/session/last-login.js
api/tools/movement.js
api/users/create.js
api/users/delete.js
api/users/status.js
api/users/update.js
```

As APIs validam o Firebase ID token e o perfil do usuário no servidor.

Empréstimos e devoluções usam uma transação do Firestore para atualizar a ferramenta e registrar o histórico de forma conjunta.

As regras de acesso ao Firestore estão versionadas em:

```text
firestore.rules
```

## Tecnologias

- JavaScript com módulos ES;
- Vite;
- Tailwind CSS;
- Firebase Authentication;
- Cloud Firestore;
- Firebase Admin SDK;
- Vercel Functions;
- Workbox e Vite PWA;
- SheetJS.

## Requisitos

- Node.js `24.x`;
- npm;
- projeto Firebase configurado;
- projeto Vercel para publicação das APIs.

## Instalação

Clone o repositório e instale as dependências:

```bash
git clone https://github.com/jefferson-araujo-dev/gestao-de-ferramentas.git
cd gestao-de-ferramentas
npm install
```

## Desenvolvimento local

Inicie o Vite:

```bash
npm run dev
```

O Vite serve apenas o frontend. As rotas em `/api` são Vercel Functions e não ficam disponíveis no servidor Vite comum.

Por isso, no ambiente local, chamadas como estas podem retornar `404`:

```text
/api/session/last-login
/api/tools/movement
/api/users/*
```

Para homologar fluxos que dependem das APIs, utilize um deployment Preview da Vercel ou um ambiente local compatível com Vercel Functions.

## Build

```bash
npm run build
```

Para visualizar o build localmente:

```bash
npm run preview
```

## Scripts disponíveis

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run backup
npm run export
```

## Variáveis de ambiente

As APIs protegidas exigem estas variáveis no ambiente da Vercel:

```text
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

Elas devem estar configuradas nos ambientes em que as APIs serão executadas, especialmente:

```text
Production
Preview
```

A chave privada deve ser mantida como segredo e nunca deve ser adicionada ao Git.

## Estrutura principal

```text
api/
  session/
    last-login.js
  tools/
    movement.js
  users/
    create.js
    delete.js
    status.js
    update.js

server/
  admin-authorization.js
  firebase-admin.js

src/
  index.html
  js/
    app.js
    config/
    core/
    modules/
    utils/

firestore.rules
firebase.json
vite.config.js
```

## Banco de dados

Os dados são armazenados no Cloud Firestore.

Coleções principais:

```text
tools
collaborators
users
history
```

## Backup e exportação

O repositório contém scripts para backup e exportação:

```bash
npm run backup
npm run export
```

Arquivos de backup podem conter dados operacionais e não devem ser adicionados ao repositório sem revisão.

## Homologação da versão 3.0.0

A versão `v3.0.0` foi validada em produção com:

- login de Administrador;
- login de Usuário Padrão;
- restrição das áreas administrativas;
- leitura de ferramentas e colaboradores;
- empréstimo;
- devolução;
- registro das duas movimentações na Auditoria;
- execução das APIs protegidas em produção.

## Release

- **Tag:** `v3.0.0`
- **Commit homologado:** `677e5a7`
- **Plataforma de produção:** Vercel
- **Banco e autenticação:** Firebase

## Homologação da versão 3.0.1

A versão `v3.0.1` foi validada em produção com:

- cache local persistente do Firestore atualizado;
- nome compacto do usuário no cabeçalho;
- histórico individual das ferramentas identificado por `toolId`;
- modais centralizados;
- modal de perfil compactado e sem rolagem desnecessária no desktop;
- PWA e Service Worker operacionais.

## Release 3.0.1

- **Tag:** `v3.0.1`
- **Commit homologado:** `cb07c9c`
- **Plataforma de produção:** Vercel
- **Banco e autenticação:** Firebase

## Homologação da versão 3.1.0

A versão `v3.1.0` foi validada com:

- registro administrativo de manutenção das ferramentas;
- endpoint protegido para registrar manutenções e atualizar o histórico;
- exibição dos dados de manutenção no histórico individual;
- ação de manutenção disponível nos cartões de ferramentas elegíveis;
- melhorias responsivas nas barras de ações, filtros e modais;
- auditoria automatizada de responsividade em 30 resoluções;
- 210 testes Playwright aprovados;
- build de produção, PWA e Service Worker validados.

## Release 3.1.0

- **Tag:** `v3.1.0`
- **Commit funcional homologado:** `ed8b416`
- **Plataforma de produção:** Vercel
- **Banco e autenticação:** Firebase

## Documentação adicional

O repositório também contém:

```text
docs/architecture/ARCHITECTURE.md
docs/audits/AUDIT-REPORT-2026-04-13.md
docs/archive/CHANGELOG-layout-2026-04-13.md
docs/archive/CHANGELOG-ADVANCED.md
docs/archive/OVERVIEW.md
docs/archive/README-IMPROVEMENTS.md
docs/responsive/RESPONSIVIDADE.md
```

Esses documentos podem registrar decisões técnicas, auditorias e melhorias históricas do projeto.

## Licença e uso

Projeto destinado à gestão interna de ferramentas. Defina formalmente a licença antes de distribuir ou reutilizar o código fora do contexto autorizado.
