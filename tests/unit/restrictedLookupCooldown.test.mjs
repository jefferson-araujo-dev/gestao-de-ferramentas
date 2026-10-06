// Gate 1-F4.C4-FIX2: classificação do cooldown de leitura repetida do Restrito (status -> duração),
// usada por `_processCode` em src/js/modules/scanner.js. O efeito no navegador (requisições,
// Recentes, mensagens, câmera) é coberto no e2e (tests/e2e/restricted-loan.spec.js).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  RESTRICTED_LOOKUP_COOLDOWN_MS,
  RESTRICTED_LOOKUP_COOLDOWN_STATUSES,
  RESTRICTED_LOOKUP_FAILURE_COOLDOWN_MS,
  restrictedLookupCooldownMs,
} from '../../src/js/utils/restrictedLookupCooldown.js';

describe('restrictedLookupCooldownMs', () => {
  test('valores: 10 s para 404/409/429 (FIX1, inalterado) e 5 s para falha sem resultado', () => {
    assert.equal(RESTRICTED_LOOKUP_COOLDOWN_MS, 10000);
    assert.deepEqual(RESTRICTED_LOOKUP_COOLDOWN_STATUSES, [404, 409, 429]);
    assert.equal(RESTRICTED_LOOKUP_FAILURE_COOLDOWN_MS, 5000);
    assert.ok(RESTRICTED_LOOKUP_FAILURE_COOLDOWN_MS >= 3000);
    assert.ok(RESTRICTED_LOOKUP_FAILURE_COOLDOWN_MS <= 10000);
  });

  test('404, 409 e 429: cooldown longo', () => {
    for (const status of [404, 409, 429]) {
      assert.equal(restrictedLookupCooldownMs(status, false), 10000, String(status));
    }
  });

  test('falha sem resultado: status nulo, 400, 401, 403, 5xx e status não mapeado', () => {
    for (const status of [null, undefined, 0, 400, 401, 403, 418, 500, 502, 503, 504, 200]) {
      assert.equal(restrictedLookupCooldownMs(status, false), 5000, String(status));
    }
  });

  test('sucesso nunca gera cooldown, qualquer que seja o status', () => {
    for (const status of [200, 201, null, 404, 409, 429, 500]) {
      assert.equal(restrictedLookupCooldownMs(status, true), 0, String(status));
    }
  });
});
