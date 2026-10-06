// Cooldown de leitura repetida do Restrito (src/js/modules/scanner.js, `_processCode`). Módulo puro,
// sem DOM nem Firebase, para que a regra seja testável sem navegador (tests/unit).

// Gate 1-F4.C4-FIX1: depois de uma resposta 404, 409 ou 429, novas leituras do MESMO código pelo
// Restrito são ignoradas por este intervalo (sem requisição, toast, Recentes nem estatística). Sem
// isso, uma etiqueta não cadastrada parada diante da câmera gera ~1 consulta/s e esgota o limite do
// servidor (10 falhas / 60 s, api/tools/status.js) em ~10 s, bloqueando também ferramentas válidas.
// Precisa ser de pelo menos 7 s: abaixo de 6 s, uma leitura contínua ainda estouraria o limite.
export const RESTRICTED_LOOKUP_COOLDOWN_MS = 10 * 1000;
export const RESTRICTED_LOOKUP_COOLDOWN_STATUSES = [404, 409, 429];

// Gate 1-F4.C4-FIX2: falha SEM resultado (sem sessão, token indisponível, rede, resposta ilegível,
// 400, 401, 403, 5xx ou qualquer outro status não-OK). O servidor não conta essas falhas no limite,
// então o motivo aqui é só o laço da câmera: sem cooldown, a etiqueta parada no enquadramento repete
// ~1 consulta/s com bipe, vibração e toast. Curto porque a causa costuma ser passageira (rede, 5xx):
// a nova tentativa do mesmo código volta em 5 s, e o laço cai de ~20 para ~4 consultas em 20 s.
export const RESTRICTED_LOOKUP_FAILURE_COOLDOWN_MS = 5 * 1000;

// Duração do cooldown do código lido, a partir do resultado da consulta: `status` HTTP (null sem
// resposta) e `found` (a consulta devolveu a ferramenta). Sucesso nunca gera cooldown.
export function restrictedLookupCooldownMs(status, found) {
  if (found) {
    return 0;
  }
  if (RESTRICTED_LOOKUP_COOLDOWN_STATUSES.includes(status)) {
    return RESTRICTED_LOOKUP_COOLDOWN_MS;
  }
  return RESTRICTED_LOOKUP_FAILURE_COOLDOWN_MS;
}
