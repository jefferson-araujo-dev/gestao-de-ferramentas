---
name: "pwa-release-safety"
description: "Use ao alterar service worker, cache, manifest, versao do app, build Vite/PWA, atualizacao de cliente ou cabecalhos de cache no Gestao de Ferramentas; evita cache obsoleto, vazamento entre usuarios e quebra de clientes."
disable-model-invocation: true
---

# pwa-release-safety — Segurança de release PWA (Gestão de Ferramentas)

Nível: sênior. Aplicar a qualquer Gate que toque `src/sw.js`, `vite.config.js`, `public/manifest.json`, registro do service worker e fluxo de atualização no cliente, `server/app-version.js`, versão em `package.json`, cabeçalhos de cache (não há `vercel.json` hoje; ver seção 8), ícones/assets do PWA, ou qualquer endpoint em `api/` (por causa do cache do SW). Complementa `tool-loan-integrity`, `firebase-admin-vercel-api` e `secret-pii-hygiene`.

## 1. Princípio de evidência
CONFIRMADO = lido no código (commit 30a6103). CONFIRMAR NO CÓDIGO = não verificado. O código atual prevalece sobre este texto; reler o arquivo antes de alterar. Este skill nunca é prova de comportamento.

## 2. Fatos confirmados
### vite.config.js
- VitePWA em modo `injectManifest`, arquivo `sw.js`; `injectRegister: false` (registro manual no cliente); `manifest: false` (usa `public/manifest.json`).
- `globPatterns` do precache: js, css, html, png, svg, ico.
- `__APP_VERSION__` injetado a partir de `package.json`.
### src/sw.js
- `precacheAndRoute(self.__WB_MANIFEST || [])` (Workbox, arquivos com hash).
- `CACHE_NAME = 'gestao-ferramentas-cache-v6'`; `CACHE_PREFIX = 'gestao-ferramentas-cache'`; padrão legado `/-tools-cache-v\d+$/`.
- `install`: `self.skipWaiting()` incondicional. `activate`: apaga caches com o prefixo próprio ou padrão legado diferentes de `CACHE_NAME` (a guarda de prefixo preserva caches `workbox-precache-*`) e chama `self.clients.claim()`.
- Fetch runtime: stale-while-revalidate para TODO GET same-origin, exceto `/manifest.json`, protocolos não http(s) e origens diferentes. A resposta de rede é gravada no cache SEM checar `ok`/status/tipo e SEM excluir `/api/`.
- Não há fallback de navegação (offline shell) explícito. Retorno em erro de rede sem cache: `Response.error()`.
### public/manifest.json
- `display: standalone`. Ícones `public/img/icon-192.png` e `icon-512.png` declaram `sizes` 480x480 e 720x720 e têm exatamente essas dimensões (medido em a4fa134); os nomes não correspondem aos tamanhos. Só `purpose: any` (sem maskable). `src/manifest.json` é cópia idêntica de `public/manifest.json` (a página liga `/manifest.json`); alterar um sem o outro cria divergência.
### server/app-version.js
- `MIN_APP_VERSION = '3.1.0'`; `classifyClientVersion`; `logOutdatedClientVersion` só observa e registra; nunca rejeita.
### Mitigação por desenho já existente
- `api/tools/status.js` e `api/tools/movement.js` e `api/tools/maintenance.js` aceitam SOMENTE POST (o comentário de status.js cita explicitamente o cache do SW e usa `cache: 'no-store'` no cliente). Isso evita o risco hoje para essas três rotas, mas a PROTEÇÃO ESTÁ NO ENDPOINT, não no SW.
- Verificado em a4fa134: `api/session/last-login.js`, `api/users/{create,status,delete}.js` e `api/backup/{reset,restore}.js` aceitam somente POST, e `api/users/update.js` aceita somente PATCH, todos com `Allow`. Nenhuma rota de `api/` aceita GET hoje. O SW só intercepta GET, então POST e PATCH não passam por ele (`src/sw.js`, `event.request.method !== 'GET'`).

## 3. Riscos conhecidos (tratar como PENDÊNCIA/HIPÓTESE até comprovar)
- R1 (médio, preventivo: hoje nenhuma rota de `api/` aceita GET, seção 2, então não há resposta autenticada para cachear): qualquer GET same-origin em `/api/*` (rota futura, ou GET acidental que receba 405) passa pelo SWR, pode ser servido obsoleto e o CacheStorage é compartilhado entre usuários do mesmo navegador (vazamento entre sessões; dado autenticado em disco local). Defesa em profundidade ausente: o SW não exclui `/api/`.
- R2 (médio): respostas não-ok (404/500/redirect/opaque) são gravadas e depois servidas como `cachedResponse`, mantendo erro após correção.
- R3 (baixo hoje; médio se houver divisão de bundle): `skipWaiting` + `clients.claim` trocam o SW sob aba aberta, e arquivos hasheados antigos removidos do deploy podem gerar 404 de chunk em sessão longa (uso em pátio, app aberto por horas). Não há `import()` dinâmico em `src` (grep em a4fa134), então a quebra por chunk de JS ausente não se aplica hoje; reavaliar ao introduzir `import()` ou divisão de bundle.
- R4 (baixo): ícones e manifest não divergem hoje (seção 2); o risco restante é a cópia duplicada `src/manifest.json` e os nomes dos ícones não refletirem os tamanhos reais.
- R5: Preview protegido por SSO bloqueia `manifest.json`; o botão de instalar não aparece em Preview. Não concluir falha de PWA a partir do Preview.
- R6: cache SWR de recursos runtime pode servir asset de versão anterior a quem já tem o SW antigo até a próxima revalidação; interação com JS hasheado é segura, com assets sem hash (ex.: imagens fixas) pode mostrar versão antiga.
- R7: nenhum código fora de `src/sw.js` chama `caches.delete` ou `unregister` (grep em a4fa134), então o logout não limpa o CacheStorage; o efeito em runtime NÃO foi testado. Se houver dado autenticado em cache, o logout deve limpá-lo.

## 4. Regras de ouro
1. Dado autenticado ou de API nunca é cacheado pelo SW. Em qualquer Gate que edite o fetch handler: excluir `/api/` explicitamente e só cachear respostas GET com `status === 200` e `type === 'basic'`, sem `Cache-Control: no-store` nem `Set-Cookie`.
2. Endpoint novo em `api/` é POST por padrão, com `Allow` e `no-store` no cliente; GET autenticado só com decisão e proteção também no SW e em cabeçalhos.
3. Alterar estratégia de cache (SWR vs network-first, escopo, versão) é mudança de comportamento: Gate próprio, e decisão do usuário se afetar dados/autenticação/offline.
4. Quando o formato do cache runtime mudar, incrementar `CACHE_NAME`, manter limpeza de caches legados e a guarda de prefixo. Nunca apagar caches do Workbox nem de outros escopos por limpeza genérica.
5. Não remover `skipWaiting`/`clients.claim` nem tornar a atualização manual sem avaliar UX (aplicação operacional, abas longas) e sem plano para chunk 404.
6. `MIN_APP_VERSION` só sobe depois que o cliente já foi entregue e adotado; nunca converter observação em bloqueio sem decisão; subir antes inutiliza clientes abertos.
7. Versionamento: `package.json` -> `__APP_VERSION__` -> cabeçalho `X-App-Version` (confirmar) -> `app-version.js`. Manter a cadeia coerente e registrar no REPORT.
8. Contratos de API retrocompatíveis durante a janela de atualização: cliente antigo convive com servidor novo por horas/dias. Mudança incompatível exige transição (aceitar ambos), Gate próprio e decisão.
9. Nada de dado pessoal, token ou segredo em precache, manifest, sourcemap público ou nome de arquivo.
10. Não testar SW em produção. Usar build local (`vite build` + preview) e Playwright; Preview serve só para fumaça de funcionalidade (limitação do manifest).
11. Produção (main, deployment atual) não é tocada: nada de redeploy, promoção, rollback ou alias sem Gate e autorização explícitos.

## 5. Atualização de cliente (fluxo a verificar em todo release)
Cenários obrigatórios: (a) usuário novo; (b) usuário com SW antigo e aba fechada; (c) usuário com aba aberta durante o deploy; (d) usuário offline ao reabrir; (e) usuário que já tem cliente abaixo de `MIN_APP_VERSION`. Para cada um: o app continua utilizável, a versão exibida é a esperada, nenhuma tela quebrada por chunk ausente e nenhuma operação de movimentação enviada com contrato antigo incompatível.

## 6. Offline
- Movimentação exige API e deve falhar de forma explícita e segura offline; proibido fila silenciosa de empréstimos/devoluções sem Gate e decisão (risco de estado inconsistente e de dupla aplicação).
- Mensagem ao usuário deve diferenciar offline de erro do servidor.
- Se um offline shell for introduzido, não deve incluir dado autenticado.

## 7. Manifest e instalabilidade
Validar: JSON válido, `start_url`, `scope`, `display`, `theme_color`, `background_color`, um ícone de pelo menos 192 px e outro de pelo menos 512 px (hoje 480 e 720), com `sizes` iguais às dimensões reais, `purpose` apropriado (any/maskable) e acessibilidade sem proteção. Validação de instalação só em domínio sem SSO (produção/pós go-live). Não afirmar que o PWA é instalável sem teste em dispositivo.

## 8. Cabeçalhos e CDN (Vercel)
`vercel.json` NÃO existe no repositório (a4fa134, `git ls-files`): os cabeçalhos efetivos vêm dos padrões da Vercel ou do painel e são NÃO DETERMINADOS até serem lidos do deployment (leitura somente com Gate/autorização). Desejado: `sw.js` servido com `Cache-Control: no-cache` (ou `max-age=0, must-revalidate`) para atualizações do SW; assets hasheados com `immutable`; `/api/*` com `no-store`; `manifest.json` revalidável. Alterar cabeçalhos é mudança de comportamento com impacto em todos os clientes: Gate próprio.

## 9. Segurança
- CSP/headers: qualquer alteração em CSP, CORS ou frames exige Gate de segurança.
- Sourcemaps de produção: decisão explícita; nunca expor comentários com segredos.
- Variáveis `VITE_*` são públicas por desenho; nunca colocar segredo (ver `secret-pii-hygiene`). Config Web do Firebase é pública; credenciais Admin jamais no bundle.
- Revisar a lista de precache do build: nenhum `.env`, dump, backup, relatório ou arquivo de dados.

## 10. Checklist de release
- [ ] Escopo e Gate autorizados; branch/HEAD/working tree conferidos.
- [ ] Versão em package.json coerente com o escopo (decisão do usuário em bump relevante).
- [ ] Build local sem erro; lista de precache revisada.
- [ ] Fetch handler: `/api/` excluído; só 200/basic cacheados (se este Gate autorizar).
- [ ] Cenários da seção 5 testados.
- [ ] CacheStorage inspecionado após login e uso: nenhuma resposta de `/api/` ou dado autenticado.
- [ ] Logout comporta-se conforme definido (seção 3, R7).
- [ ] Manifest e ícones validados.
- [ ] Cabeçalhos de cache conforme seção 8.
- [ ] Contratos de API retrocompatíveis; `MIN_APP_VERSION` inalterado ou com decisão citada.
- [ ] Produção e legado intocados.

## 11. Testes recomendados (Playwright, build local)
- SW registra, ativa e a segunda carga serve do precache.
- GET a rota `/api/*` não aparece em CacheStorage.
- Resposta 500 simulada não é servida do cache na tentativa seguinte.
- Dois usuários sucessivos no mesmo navegador: nenhum dado do primeiro visível ao segundo (cache e armazenamento local).
- Atualização: servir build A, carregar, servir build B, recarregar e continuar a usar; sem chunk 404.
- Offline: UI degrada, nenhuma movimentação silenciosa.
- Cliente com versão abaixo de `MIN_APP_VERSION`: operação continua; apenas observação é registrada.

## 12. Governança
- Plano, REPORT e este skill não autorizam execução. Só Gate explícito.
- Mudança que altere arquitetura de cache, autenticação/sessão, contrato de API ou política de versão mínima exige decisão do usuário, com alternativas e riscos.
- Anti-overengineering: correção mínima (ex.: exclusão de `/api/` e filtro de status no handler) antes de adotar bibliotecas ou estratégias novas.
- Descobertas fora do Gate viram PENDÊNCIA.

## 13. Condições de interrupção
Parar e pedir decisão se: a correção exigir mudar contrato de API; mudar autenticação/sessão; tornar `MIN_APP_VERSION` bloqueante; tocar domínio, produção ou legado; ou se o teste revelar dado autenticado em CacheStorage (tratar como achado de segurança e escalar imediatamente).

## 14. Chaves do REPORT
SW_API_EXCLUDED_FROM_CACHE: SIM|NAO|NAO_DETERMINADO
SW_CACHES_ONLY_OK_RESPONSES: SIM|NAO|NAO_DETERMINADO
AUTH_DATA_IN_CACHE_STORAGE: NAO|SIM|NAO_DETERMINADO
API_GET_ENDPOINTS_FOUND: lista de rotas ou NENHUMA|NAO_DETERMINADO
UPDATE_FLOW_SCENARIOS_TESTED: lista a-e
MULTI_USER_SAME_BROWSER_TESTED: SIM|NAO
OFFLINE_BEHAVIOR_VERIFIED: SIM|NAO
APP_VERSION_COHERENT: SIM|NAO
MIN_APP_VERSION_CHANGED: NAO|SIM (se SIM, decisão citada)
CACHE_HEADERS_VERIFIED: SIM|NAO|NAO_APLICAVEL
MANIFEST_VALID_AND_ICONS_VERIFIED: SIM|NAO
PRECACHE_LIST_REVIEWED_NO_SENSITIVE_FILES: SIM|NAO
PRODUCTION_TOUCHED: NAO (obrigatório)
LEGACY_PROJECT_TOUCHED: NAO (obrigatório)

## 15. Critério de PASS
PASS exige build local verificado, cenários de atualização testados, prova de que dados de API/autenticados não entram no CacheStorage, teste multiusuário no mesmo navegador, manifest validado e produção intocada. R1/R2 não verificados limitam a classificação a PASS COM RESSALVAS. Revisão por IA nunca é apresentada como revisão humana.