import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatDateTime, toValidDate } from '../../src/js/utils/dateFormat.js';

// Valor real de createdAt dos perfis, nos dois formatos que o sistema já gravou.
const LEGACY_ISO = '2026-09-19T14:02:38.387Z';
const EPOCH_MS = 1789826558387;
const EPOCH_SECONDS = 1789826558;
const EPOCH_NANOSECONDS = 387000000;

const OPTIONS_WITHOUT_SECONDS = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

const OPTIONS_WITH_SECONDS = { ...OPTIONS_WITHOUT_SECONDS, second: '2-digit' };

function createTimestampLike(seconds, nanoseconds) {
  return {
    seconds,
    nanoseconds,
    toDate() {
      return new Date(seconds * 1000 + Math.floor(nanoseconds / 1e6));
    },
    // O Timestamp real devolve uma string em valueOf(); new Date(timestamp) é inválido.
    valueOf() {
      return '063925423358.387000000';
    },
  };
}

describe('toValidDate', () => {
  test('Timestamp-like com toDate()', () => {
    const date = toValidDate(createTimestampLike(EPOCH_SECONDS, EPOCH_NANOSECONDS));

    assert.ok(date instanceof Date);
    assert.equal(date.toISOString(), LEGACY_ISO);
  });

  test('objeto { seconds, nanoseconds }', () => {
    const date = toValidDate({ seconds: EPOCH_SECONDS, nanoseconds: EPOCH_NANOSECONDS });

    assert.equal(date.toISOString(), LEGACY_ISO);
  });

  test('objeto { seconds } sem nanoseconds', () => {
    const date = toValidDate({ seconds: EPOCH_SECONDS });

    assert.equal(date.getTime(), EPOCH_SECONDS * 1000);
  });

  test('Date válido', () => {
    const date = toValidDate(new Date(LEGACY_ISO));

    assert.equal(date.toISOString(), LEGACY_ISO);
  });

  test('ISO string válida (formato legado)', () => {
    assert.equal(toValidDate(LEGACY_ISO).toISOString(), LEGACY_ISO);
  });

  test('milissegundos numéricos', () => {
    assert.equal(toValidDate(EPOCH_MS).toISOString(), LEGACY_ISO);
  });

  test('null, undefined e string vazia retornam null', () => {
    assert.equal(toValidDate(null), null);
    assert.equal(toValidDate(undefined), null);
    assert.equal(toValidDate(''), null);
  });

  test('string inválida retorna null', () => {
    assert.equal(toValidDate('nao-e-uma-data'), null);
  });

  test('string numérica arbitrária não é tratada como seconds', () => {
    assert.equal(toValidDate(String(EPOCH_SECONDS)), null);
  });

  test('Date inválido retorna null', () => {
    assert.equal(toValidDate(new Date('x')), null);
  });

  test('toDate() que lança erro retorna null', () => {
    const broken = {
      toDate() {
        throw new Error('falha simulada');
      },
    };

    assert.equal(toValidDate(broken), null);
  });

  test('toDate() que devolve valor inválido retorna null', () => {
    assert.equal(toValidDate({ toDate: () => new Date('x') }), null);
    assert.equal(toValidDate({ toDate: () => 'texto' }), null);
  });

  test('outros valores inválidos retornam null', () => {
    assert.equal(toValidDate(Number.NaN), null);
    assert.equal(toValidDate(Number.POSITIVE_INFINITY), null);
    assert.equal(toValidDate({}), null);
    assert.equal(toValidDate({ seconds: 'abc' }), null);
    assert.equal(toValidDate(true), null);
  });

  test('o Timestamp real NÃO pode ser convertido por new Date() diretamente', () => {
    // Regressão do bug original: new Date(timestamp) usa valueOf() e produz data inválida.
    const timestamp = createTimestampLike(EPOCH_SECONDS, EPOCH_NANOSECONDS);

    assert.ok(Number.isNaN(new Date(timestamp).getTime()));
    assert.ok(toValidDate(timestamp) instanceof Date);
  });
});

describe('compatibilidade dos dois formatos reais de createdAt', () => {
  test('LEGACY_ISO_COMPAT: ISO legado e Timestamp novo produzem a mesma data', () => {
    const legacy = toValidDate(LEGACY_ISO);
    const modern = toValidDate(createTimestampLike(EPOCH_SECONDS, EPOCH_NANOSECONDS));

    assert.ok(legacy instanceof Date);
    assert.ok(modern instanceof Date);
    assert.equal(legacy.getTime(), modern.getTime());
  });

  test('FIRESTORE_TIMESTAMP_COMPAT: os dois formatos formatam sem "Invalid Date"', () => {
    const legacy = formatDateTime(LEGACY_ISO);
    const modern = formatDateTime(createTimestampLike(EPOCH_SECONDS, EPOCH_NANOSECONDS));

    assert.equal(legacy, modern);
    assert.ok(!legacy.includes('Invalid Date'));
  });
});

describe('formatDateTime', () => {
  const expectedWithSeconds = new Date(EPOCH_MS).toLocaleString('pt-BR', OPTIONS_WITH_SECONDS);
  const expectedWithoutSeconds = new Date(EPOCH_MS).toLocaleString(
    'pt-BR',
    OPTIONS_WITHOUT_SECONDS
  );

  test('includeSeconds=true (padrão) corresponde a toLocaleString com segundos', () => {
    assert.equal(formatDateTime(LEGACY_ISO), expectedWithSeconds);
    assert.equal(formatDateTime(LEGACY_ISO, { includeSeconds: true }), expectedWithSeconds);
  });

  test('includeSeconds=false corresponde a toLocaleString sem segundos', () => {
    assert.equal(formatDateTime(LEGACY_ISO, { includeSeconds: false }), expectedWithoutSeconds);
  });

  test('valor válido nunca contém "Invalid Date"', () => {
    const inputs = [
      LEGACY_ISO,
      EPOCH_MS,
      new Date(EPOCH_MS),
      { seconds: EPOCH_SECONDS, nanoseconds: EPOCH_NANOSECONDS },
      createTimestampLike(EPOCH_SECONDS, EPOCH_NANOSECONDS),
    ];

    for (const input of inputs) {
      assert.ok(!formatDateTime(input).includes('Invalid Date'));
    }
  });

  test('fallback padrão é "-" para ausente ou inválido', () => {
    for (const input of [null, undefined, '', 'nao-e-uma-data', new Date('x'), {}]) {
      assert.equal(formatDateTime(input), '-');
    }
  });

  test('fallback customizado é respeitado', () => {
    assert.equal(formatDateTime(null, { fallback: 'Sem registro' }), 'Sem registro');
    assert.equal(formatDateTime('x', { fallback: 'Não disponível' }), 'Não disponível');
  });

  test('toDate() com erro usa o fallback', () => {
    const broken = {
      toDate() {
        throw new Error('falha simulada');
      },
    };

    assert.equal(formatDateTime(broken), '-');
  });
});
