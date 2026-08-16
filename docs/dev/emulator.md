# Firebase Emulator Suite (ambiente local de teste)

Este projeto tem um único projeto Firebase configurado (`gestao-ferramentas-coeng-2026`), e ele é o de **produção** (ver `README.md`, seção "Produção", e `docs/audits/` para o histórico de homologação). Não existe projeto de staging separado. `npm run dev` sozinho conecta o cliente diretamente a esse projeto de produção — sempre foi assim, e continua sendo o padrão.

Este documento descreve como rodar a aplicação inteira (cliente + APIs) contra um **Firebase Emulator Suite local** (Firestore + Auth), como alternativa opt-in, sem tocar em dados reais. Isso é pré-requisito para retomar o Gate 17 — Fase 1 (validação de fluxos de negócio reais).

## Pré-requisito: Java

O Firestore Emulator e o Auth Emulator do Firebase são processos Java. É necessário ter um JRE instalado e no `PATH` (`java -version` deve funcionar). Isso **não** é instalado automaticamente por este projeto — é um pré-requisito de sistema, fora do escopo de `npm install`.

## Subindo o emulador

```bash
npm run emulators
```

Isso inicia o Firestore Emulator na porta `8080`, o Auth Emulator na porta `9099`, e a UI do emulador em `http://127.0.0.1:4000` (configurado em `firebase.json`). Usa o projeto `gestao-ferramentas-coeng-2026` (definido em `.firebaserc`), mas **inteiramente local** — nenhuma chamada chega ao Firebase real.

## Populando dados de teste

Em outro terminal, com o emulador já rodando:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed:emulator
```

Cria (de forma idempotente — pode rodar de novo sem duplicar):

- 1 usuário administrador: `admin.teste@emulador.local` / `SenhaTeste123!-NAO-USAR-EM-PRODUCAO` — **credencial de teste do emulador local, não é uma conta real, não funciona fora dele.**
- 1 colaborador ativo (`SEED-001`)
- 2 ferramentas: uma `available` (`SEED-TOOL-AVAILABLE`) e uma `borrowed` (`SEED-TOOL-BORROWED`), já vinculada ao colaborador de teste — para permitir testar devolução sem precisar antes fazer uma retirada.

O script se recusa a rodar se `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST` não estiverem definidas, para nunca escrever em produção por engano.

## Rodando o cliente contra o emulador

```bash
npm run dev:emulator
```

Isso roda o Vite normalmente, mas com o modo `emulator`, que carrega `src/.env.emulator` (arquivo local, não versionado — mesmo tratamento do `.env` raiz do projeto; ver `.gitignore`). Esse arquivo define `VITE_USE_FIREBASE_EMULATOR=true`, que ativa a chamada condicional a `connectFirestoreEmulator`/`connectAuthEmulator` em `src/js/app.js`.

Crie `src/.env.emulator` manualmente (não é distribuído no repositório) com o conteúdo:

```
VITE_USE_FIREBASE_EMULATOR=true
```

**Sem essa flag, `npm run dev` continua apontando para produção exatamente como antes** — comportamento padrão inalterado, confirmado por build estático (ver REPORT do Gate 18): o código de conexão ao emulador é eliminado do bundle quando a flag não está ativa, não apenas "não executado".

## Rodando as APIs (`/api/*`) contra o emulador

`npm run dev` (Vite puro) não serve as rotas `/api/*` — isso já é documentado no `README.md`. Para testar os endpoints, use `vercel dev` com as variáveis de ambiente do emulador definidas:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npx vercel dev
```

`server/firebase-admin.js` continua exigindo `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` (não foi alterado neste gate). Isso é compatível com o emulador: o Admin SDK respeita `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST` independentemente da credencial fornecida a `cert()` — confirmado empiricamente no Gate 18 (a chamada tenta conectar em `127.0.0.1:8080`, não em produção, mesmo usando uma chave de teste). Não é necessário que a chave seja real; qualquer chave RSA privada sintaticamente válida é suficiente para o SDK inicializar.

## Limitação conhecida

No ambiente em que este gate foi executado, o Firestore/Auth Emulator não pôde ser efetivamente iniciado por falta de Java instalado no sistema — a validação de ponta a ponta (subir o emulador, rodar o seed contra ele, abrir a aplicação e ver o cliente conectado) não pôde ser completada. A conexão do Admin SDK ao host do emulador foi confirmada por um teste isolado (sem depender do processo Java do emulador estar de pé). Ver REPORT do Gate 18 para os detalhes e o que ainda precisa ser confirmado quando Java estiver disponível.
