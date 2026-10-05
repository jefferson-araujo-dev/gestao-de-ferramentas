// Versão mínima observável (Gate 1-F4.C4, Decisão 7, interpretação D4 = opção b): parsing,
// classificação e log condicional. O helper nunca bloqueia: o efeito em status/corpo das respostas
// dos dois endpoints é coberto nos testes de integração (toolStatusEmulator, movementEmulator).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  MIN_APP_VERSION,
  OUTDATED_CLIENT_EVENT,
  classifyClientVersion,
  compareAppVersions,
  logOutdatedClientVersion,
  parseAppVersion,
} from '../../server/app-version.js';

const packageVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version;

function captureLog(header) {
  const lines = [];
  const status = logOutdatedClientVersion('tools/status', 'uid-teste', header, (line) =>
    lines.push(line)
  );

  return { status, lines };
}

describe('versão mínima do app (server/app-version.js)', () => {
  test('a versão mínima é semver válida e não passa da versão do app (package.json)', () => {
    assert.ok(parseAppVersion(MIN_APP_VERSION));
    assert.ok(compareAppVersions(MIN_APP_VERSION, packageVersion) <= 0);
  });

  test('parsing: só MAJOR.MINOR.PATCH numérico', () => {
    assert.deepEqual(parseAppVersion('3.1.0'), [3, 1, 0]);
    assert.deepEqual(parseAppVersion('10.20.30'), [10, 20, 30]);

    for (const value of [
      undefined,
      null,
      3,
      '',
      '3',
      '3.1',
      '3.1.0.0',
      'v3.1.0',
      '3.1.0-beta',
      '3.1.0+build',
      ' 3.1.0',
      '3.x.0',
      '1234567.0.0',
    ]) {
      assert.equal(parseAppVersion(value), null, JSON.stringify(value));
    }
  });

  test('comparação numérica, não lexicográfica', () => {
    assert.ok(compareAppVersions('3.10.0', '3.9.9') > 0);
    assert.ok(compareAppVersions('3.1.0', '3.1.1') < 0);
    assert.ok(compareAppVersions('10.0.0', '9.99.99') > 0);
    assert.equal(compareAppVersions('3.1.0', '3.1.0'), 0);
  });

  test('classificação: ausente, inválida, abaixo, igual e acima da mínima', () => {
    assert.deepEqual(classifyClientVersion(undefined, '3.1.0'), { status: 'absent', appVersion: null });
    assert.deepEqual(classifyClientVersion('   ', '3.1.0'), { status: 'absent', appVersion: null });
    assert.deepEqual(classifyClientVersion(42, '3.1.0'), { status: 'absent', appVersion: null });
    assert.deepEqual(classifyClientVersion('abc', '3.1.0'), { status: 'invalid', appVersion: 'abc' });
    assert.deepEqual(classifyClientVersion('3.0.9', '3.1.0'), { status: 'outdated', appVersion: '3.0.9' });
    assert.deepEqual(classifyClientVersion(' 3.1.0 ', '3.1.0'), { status: 'current', appVersion: '3.1.0' });
    assert.deepEqual(classifyClientVersion('3.2.0', '3.1.0'), { status: 'current', appVersion: '3.2.0' });
    // Cabeçalho repetido (array do Node): vale o primeiro valor.
    assert.deepEqual(classifyClientVersion(['3.0.0', '3.1.0'], '3.1.0'), {
      status: 'outdated',
      appVersion: '3.0.0',
    });
  });

  test('cabeçalho longo demais é inválido e a versão informada sai truncada', () => {
    const result = classifyClientVersion('9'.repeat(500), '3.1.0');

    assert.equal(result.status, 'invalid');
    assert.equal(result.appVersion.length, 32);
  });

  test('log: uma linha JSON só para ausente/inválida/desatualizada; nada para a versão atual', () => {
    for (const [header, reason] of [
      [undefined, 'absent'],
      ['xyz', 'invalid'],
      ['0.0.1', 'outdated'],
    ]) {
      const { status, lines } = captureLog(header);

      assert.equal(status, reason);
      assert.equal(lines.length, 1);
      assert.deepEqual(JSON.parse(lines[0]), {
        event: OUTDATED_CLIENT_EVENT,
        endpoint: 'tools/status',
        uid: 'uid-teste',
        reason,
        appVersion: header ?? null,
        minAppVersion: MIN_APP_VERSION,
      });
    }

    for (const header of [MIN_APP_VERSION, '999.0.0']) {
      const { status, lines } = captureLog(header);

      assert.equal(status, 'current');
      assert.deepEqual(lines, []);
    }
  });

  test('nunca lança: falha do próprio log não chega à requisição', () => {
    assert.doesNotThrow(() =>
      logOutdatedClientVersion('tools/status', 'uid-teste', undefined, () => {
        throw new Error('falha de log');
      })
    );
  });
});
