import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  BACKUP_APP_ID,
  BACKUP_SCHEMA_VERSION,
  RESTORABLE_COLLECTIONS,
  buildBackupV4,
  canonicalDataString,
  computeDataSha256,
  normalizeBackup,
  verifyBackupDataHash,
} from '../../src/js/utils/backupContract.js';

const SENTINEL_NAME = 'Fulano Sentinela';

function makeTimestampLike(seconds, nanoseconds) {
  return {
    seconds,
    nanoseconds,
    toDate() {
      return new Date(seconds * 1000);
    },
  };
}

function baseParts() {
  return {
    tools: [
      { id: 'T-001', code: 'T-001', name: 'Furadeira', category: 'Eletrica', status: 'available' },
      {
        id: 'T-002',
        code: 'T-002',
        name: 'Serra',
        category: 'Manual',
        status: 'borrowed',
        currentUser: SENTINEL_NAME,
        currentCollaboratorId: 'c1',
        lastAction: '2026-09-01T10:00:00.000Z',
      },
    ],
    collaborators: [
      { id: 'c1', name: SENTINEL_NAME, badge: '10', role: 'Operador', status: 'active' },
      { id: 'c2', name: 'Outro', badge: '', role: 'Auxiliar', status: 'inactive' },
    ],
    history: [
      {
        id: 'h1',
        date: '2026-09-01T10:00:00.000Z',
        type: 'out',
        toolId: 'T-002',
        toolCode: 'T-002',
        toolName: 'Serra',
        collaboratorId: 'c1',
        user: SENTINEL_NAME,
      },
      {
        id: 'h2',
        date: '2026-09-02T10:00:00.000Z',
        type: 'maintenance',
        toolId: 'T-001',
        toolCode: 'T-001',
        toolName: 'Furadeira',
        user: 'Admin',
      },
    ],
    users: [
      {
        id: 'u1',
        name: 'Admin',
        email: 'admin@example.test',
        accessLevel: 'Administrador',
        department: 'TI',
        status: 'Ativo',
        isRestricted: false,
        createdAt: makeTimestampLike(1789826558, 387000000),
        lastLogin: '2026-09-01T10:00:00.000Z',
        lastIp: '203.0.113.9',
        lastDevice: 'Dispositivo secreto',
        updatedBy: 'u9',
      },
    ],
  };
}

async function makeV4(mutate) {
  const parts = baseParts();
  if (mutate) {
    mutate(parts);
  }
  return buildBackupV4(parts, { exportedAt: '2026-09-20T12:00:00.000Z' });
}

function makeLegacy(mutate) {
  const parts = baseParts();
  const legacy = {
    exportDate: '2026-09-20T12:00:00.000Z',
    version: '3.0',
    data: {
      tools: parts.tools,
      users: [
        {
          ...parts.users[0],
          createdAt: { seconds: 1789826558, nanoseconds: 387000000 },
          updatedAt: { type: 'firestore/timestamp/1.0', seconds: 1789826559, nanoseconds: 5 },
        },
      ],
      collaborators: parts.collaborators.map((c) => {
        const copy = { ...c };
        delete copy.status;
        return copy;
      }),
      history: parts.history,
    },
  };
  if (mutate) {
    mutate(legacy);
  }
  return legacy;
}

const codesOf = (result) => result.errors.map((error) => error.code);

describe('backupContract - v4', () => {
  test('1. backup v4 valido e aceito', async () => {
    const backup = await makeV4();
    const result = normalizeBackup(backup);

    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.backup.schemaVersion, BACKUP_SCHEMA_VERSION);
    assert.equal(result.backup.source.appId, BACKUP_APP_ID);
    assert.equal(result.meta.legacy, false);
    assert.deepEqual(result.meta.counts, { tools: 2, collaborators: 2, history: 2 });
    assert.equal(result.backup.summary.totalRecords, 6);
    assert.equal((await verifyBackupDataHash(result.backup)).ok, true);
  });

  test('2. canonicalizacao e deterministica (ordem de registros e de chaves)', () => {
    const a = {
      tools: [
        { id: 'B', code: 'B', status: 'available', zeta: 1, alpha: { y: 2, x: 1 } },
        { id: 'A', code: 'A', status: 'available' },
      ],
      collaborators: [],
      history: [],
    };
    const b = {
      history: [],
      collaborators: [],
      tools: [
        { status: 'available', code: 'A', id: 'A' },
        { alpha: { x: 1, y: 2 }, id: 'B', zeta: 1, status: 'available', code: 'B' },
      ],
    };

    assert.equal(canonicalDataString(a), canonicalDataString(b));
    assert.equal(
      canonicalDataString({
        tools: [{ id: 'A', code: 'A', status: 'available' }],
        collaborators: [],
        history: [],
      }),
      '{"tools":[{"code":"A","id":"A","status":"available"}],"collaborators":[],"history":[]}'
    );
  });

  test('2b. ordenacao de ids usa code units, sem localeCompare', () => {
    const canonical = canonicalDataString({
      tools: [
        { id: 'a', code: 'a' },
        { id: 'B', code: 'B' },
        { id: 'Z', code: 'Z' },
      ],
      collaborators: [],
      history: [],
    });

    assert.ok(canonical.indexOf('"id":"B"') < canonical.indexOf('"id":"Z"'));
    assert.ok(canonical.indexOf('"id":"Z"') < canonical.indexOf('"id":"a"'));
  });

  test('3. hash e estavel, maiusculo e igual ao node:crypto', async () => {
    const data = {
      tools: [{ id: 'A', code: 'A', status: 'available' }],
      collaborators: [],
      history: [],
    };
    const first = await computeDataSha256(data);
    const second = await computeDataSha256(structuredClone(data));
    const expected = createHash('sha256')
      .update(canonicalDataString(data), 'utf8')
      .digest('hex')
      .toUpperCase();

    assert.equal(first, second);
    assert.equal(first, expected);
    assert.match(first, /^[0-9A-F]{64}$/);
  });

  test('3b. adulterar data invalida o hash declarado', async () => {
    const backup = await makeV4();
    backup.data.tools[0].name = 'Adulterada';
    const result = normalizeBackup(backup);

    assert.equal(result.ok, true);
    assert.equal((await verifyBackupDataHash(result.backup)).ok, false);
  });

  test('4. collection inesperada e rejeitada (v4 e legado)', async () => {
    const v4 = await makeV4();
    v4.data.someUnexpectedCollection = [];
    assert.ok(codesOf(normalizeBackup(v4)).includes('UNEXPECTED_COLLECTION'));

    const legacy = makeLegacy((l) => {
      l.data.someUnexpectedCollection = [];
    });
    assert.ok(codesOf(normalizeBackup(legacy)).includes('UNEXPECTED_COLLECTION'));
  });

  test('4b. users dentro de data v4 e rejeitado', async () => {
    const v4 = await makeV4();
    v4.data.users = [];
    assert.ok(codesOf(normalizeBackup(v4)).includes('USERS_IN_DATA'));
  });

  test('5. item sem id (ou id invalido) e rejeitado', async () => {
    for (const badId of [undefined, '', '   ', 'a/b', '.', '..', '__reservado__', 42]) {
      const backup = await makeV4();
      backup.data.collaborators[0].id = badId;
      const result = normalizeBackup(backup);

      assert.equal(result.ok, false);
      assert.ok(codesOf(result).includes('INVALID_DOCUMENT_ID'), String(badId));
    }
  });

  test('6. id duplicado e rejeitado', async () => {
    const backup = await makeV4();
    backup.data.collaborators[1].id = backup.data.collaborators[0].id;
    assert.ok(codesOf(normalizeBackup(backup)).includes('DUPLICATE_DOCUMENT_ID'));
  });

  test('7. tool com id diferente de code e rejeitada', async () => {
    const backup = await makeV4();
    backup.data.tools[0].code = 'OUTRO';
    assert.ok(codesOf(normalizeBackup(backup)).includes('TOOL_ID_CODE_MISMATCH'));
  });

  test('8. tool com status invalido e rejeitada', async () => {
    const backup = await makeV4();
    backup.data.tools[0].status = 'Disponivel';
    assert.ok(codesOf(normalizeBackup(backup)).includes('INVALID_TOOL_STATUS'));
  });

  test('9. collaborator com status invalido ou ausente (v4) e rejeitado', async () => {
    const invalid = await makeV4();
    invalid.data.collaborators[0].status = 'ativo';
    assert.ok(codesOf(normalizeBackup(invalid)).includes('INVALID_COLLABORATOR_STATUS'));

    const missing = await makeV4();
    delete missing.data.collaborators[0].status;
    assert.ok(codesOf(normalizeBackup(missing)).includes('INVALID_COLLABORATOR_STATUS'));
  });

  test('10. history com type invalido e rejeitado', async () => {
    const backup = await makeV4();
    backup.data.history[0].type = 'saida';
    assert.ok(codesOf(normalizeBackup(backup)).includes('INVALID_HISTORY_TYPE'));
  });

  test('11. history orfao de tool e rejeitado (toolId e toolCode)', async () => {
    const byId = await makeV4();
    byId.data.history[0].toolId = 'INEXISTENTE';
    assert.ok(codesOf(normalizeBackup(byId)).includes('ORPHAN_HISTORY_TOOL'));

    const byCode = await makeV4((parts) => {
      delete parts.history[0].toolId;
      parts.history[0].toolCode = 'INEXISTENTE';
    });
    assert.ok(codesOf(normalizeBackup(byCode)).includes('ORPHAN_HISTORY_TOOL'));

    const none = await makeV4((parts) => {
      delete parts.history[0].toolId;
      delete parts.history[0].toolCode;
    });
    assert.ok(codesOf(normalizeBackup(none)).includes('HISTORY_WITHOUT_TOOL_REFERENCE'));
  });

  test('11b. toolCode sem toolId resolve por codigo normalizado (sem acento/caixa)', async () => {
    const backup = await makeV4((parts) => {
      delete parts.history[0].toolId;
      parts.history[0].toolCode = ' t-002 ';
    });
    assert.equal(normalizeBackup(backup).ok, true);
  });

  test('12. history orfao de collaborator e rejeitado', async () => {
    const backup = await makeV4();
    backup.data.history[0].collaboratorId = 'INEXISTENTE';
    assert.ok(codesOf(normalizeBackup(backup)).includes('ORPHAN_HISTORY_COLLABORATOR'));
  });

  test('13. timestamp v4: instancia vira formato explicito e explicito e preservado', async () => {
    const backup = await makeV4((parts) => {
      parts.tools[0].lastMaintenance = makeTimestampLike(1789826558, 387000000);
    });

    assert.deepEqual(backup.data.tools[0].lastMaintenance, {
      __type: 'timestamp',
      seconds: 1789826558,
      nanoseconds: 387000000,
    });
    assert.equal(normalizeBackup(backup).ok, true);

    const invalid = await makeV4();
    invalid.data.tools[0].lastMaintenance = { __type: 'timestamp', seconds: 1.5, nanoseconds: 0 };
    assert.ok(codesOf(normalizeBackup(invalid)).includes('INVALID_TIMESTAMP'));

    const wrongKeys = await makeV4();
    wrongKeys.data.tools[0].lastMaintenance = { __type: 'timestamp', seconds: 1 };
    assert.ok(codesOf(normalizeBackup(wrongKeys)).includes('INVALID_TIMESTAMP'));
  });

  test('13b. v4 nao converte {seconds,nanoseconds} solto (somente o adaptador legado)', async () => {
    const backup = await makeV4();
    backup.data.tools[0].plainMap = { seconds: 1, nanoseconds: 2 };
    const result = normalizeBackup(backup);

    assert.equal(result.ok, true);
    assert.deepEqual(result.backup.data.tools[0].plainMap, { seconds: 1, nanoseconds: 2 });
  });

  test('20. documento acima de 1 MiB e rejeitado', async () => {
    const backup = await makeV4();
    backup.data.tools[0].notes = 'x'.repeat(1048576 + 10);
    assert.ok(codesOf(normalizeBackup(backup)).includes('DOCUMENT_TOO_LARGE'));
  });

  test('estrutura: campo desconhecido, sumario divergente e backup vazio', async () => {
    const extra = await makeV4();
    extra.surprise = true;
    assert.ok(codesOf(normalizeBackup(extra)).includes('UNEXPECTED_TOP_LEVEL_FIELD'));

    const mismatch = await makeV4();
    mismatch.summary.collections.tools = 99;
    assert.ok(codesOf(normalizeBackup(mismatch)).includes('SUMMARY_COUNT_MISMATCH'));

    const wrongApp = await makeV4();
    wrongApp.source.appId = 'outro-projeto';
    assert.ok(codesOf(normalizeBackup(wrongApp)).includes('INVALID_SOURCE'));

    const empty = await buildBackupV4({}, { exportedAt: '2026-09-20T12:00:00.000Z' });
    assert.equal(normalizeBackup(empty).ok, true);
    assert.ok(codesOf(normalizeBackup(empty, { requireNonEmpty: true })).includes('EMPTY_BACKUP'));
  });

  test('erros nunca carregam dados dos registros (sem PII)', async () => {
    const backup = await makeV4();
    backup.data.collaborators[0].status = 'invalido';
    backup.data.tools[1].currentUser = SENTINEL_NAME;
    backup.data.history[0].toolId = 'INEXISTENTE';
    const result = normalizeBackup(backup);

    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result.errors).includes(SENTINEL_NAME), false);
    assert.equal(JSON.stringify(result.errors).includes('INEXISTENTE'), false);
  });

  test('exporta users somente em reference (redigido) e nunca em data', async () => {
    const backup = await makeV4();

    assert.deepEqual(Object.keys(backup.data).sort(), [...RESTORABLE_COLLECTIONS].sort());
    assert.equal(backup.summary.usersReferenceCount, 1);
    const [user] = backup.reference.users;
    assert.equal('lastIp' in user, false);
    assert.equal('lastDevice' in user, false);
    assert.equal('updatedBy' in user, false);
    assert.equal(user.email, 'admin@example.test');
    assert.deepEqual(user.createdAt, {
      __type: 'timestamp',
      seconds: 1789826558,
      nanoseconds: 387000000,
    });
  });
});

describe('backupContract - adaptador legado 3.0', () => {
  test('14. timestamp legado do navegador {seconds,nanoseconds}', () => {
    const result = normalizeBackup(makeLegacy());

    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.backup.reference.users[0].createdAt, {
      __type: 'timestamp',
      seconds: 1789826558,
      nanoseconds: 387000000,
    });
  });

  test('15. timestamp legado do npm firebase {type,seconds,nanoseconds}', () => {
    const legacy = makeLegacy((l) => {
      l.data.tools[0].lastMaintenance = {
        type: 'firestore/timestamp/1.0',
        seconds: 1789826559,
        nanoseconds: 5,
      };
    });
    const result = normalizeBackup(legacy);

    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.backup.data.tools[0].lastMaintenance, {
      __type: 'timestamp',
      seconds: 1789826559,
      nanoseconds: 5,
    });
  });

  test('16. backup legado 3.0 e aceito e convertido para v4', () => {
    const result = normalizeBackup(makeLegacy());

    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.meta.legacy, true);
    assert.equal(result.meta.sourceSchema, '3.0');
    assert.equal(result.backup.schemaVersion, '4.0');
    assert.equal(result.backup.source.generator, 'legacy-adapter');
    assert.equal(result.backup.summary.dataSha256, null);
    assert.deepEqual(result.meta.counts, { tools: 2, collaborators: 2, history: 2 });
  });

  test('17. users legados saem de data e vao (redigidos) para reference.users', () => {
    const result = normalizeBackup(makeLegacy());

    assert.equal('users' in result.backup.data, false);
    assert.equal(result.backup.summary.usersReferenceCount, 1);
    const [user] = result.backup.reference.users;
    assert.equal('lastIp' in user, false);
    assert.equal('lastDevice' in user, false);
    assert.equal('updatedBy' in user, false);
    assert.deepEqual(user.updatedAt, { __type: 'timestamp', seconds: 1789826559, nanoseconds: 5 });
    assert.equal(user.accessLevel, 'Administrador');
  });

  test('18. collaborator legado sem status vira "active"; status existente e preservado', () => {
    const legacy = makeLegacy((l) => {
      l.data.collaborators[1].status = 'inactive';
    });
    const result = normalizeBackup(legacy);

    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.meta.statusDefaulted, 1);
    const byId = Object.fromEntries(result.backup.data.collaborators.map((c) => [c.id, c.status]));
    assert.deepEqual(byId, { c1: 'active', c2: 'inactive' });
  });

  test('18b. legado: status invalido presente continua sendo rejeitado', () => {
    const legacy = makeLegacy((l) => {
      l.data.collaborators[0].status = 'ativo';
    });
    assert.ok(codesOf(normalizeBackup(legacy)).includes('INVALID_COLLABORATOR_STATUS'));
  });

  test('19. versao desconhecida e rejeitada', async () => {
    const legacy = makeLegacy((l) => {
      l.version = '2.0';
    });
    assert.ok(codesOf(normalizeBackup(legacy)).includes('UNSUPPORTED_VERSION'));

    const appIdVersion = makeLegacy((l) => {
      l.version = BACKUP_APP_ID;
    });
    assert.ok(codesOf(normalizeBackup(appIdVersion)).includes('UNSUPPORTED_VERSION'));

    const future = await makeV4();
    future.schemaVersion = '5.0';
    assert.ok(codesOf(normalizeBackup(future)).includes('UNSUPPORTED_SCHEMA_VERSION'));

    assert.ok(codesOf(normalizeBackup({ data: {} })).includes('UNSUPPORTED_VERSION'));
    assert.ok(codesOf(normalizeBackup(null)).includes('INVALID_BACKUP_SHAPE'));
    assert.ok(codesOf(normalizeBackup([])).includes('INVALID_BACKUP_SHAPE'));
    assert.ok(codesOf(normalizeBackup('texto')).includes('INVALID_BACKUP_SHAPE'));
  });

  test('legado: campo extra no topo e collection ausente sao rejeitados', () => {
    const extra = makeLegacy((l) => {
      l.summary = {};
    });
    assert.ok(codesOf(normalizeBackup(extra)).includes('UNEXPECTED_TOP_LEVEL_FIELD'));

    const missing = makeLegacy((l) => {
      delete l.data.history;
    });
    assert.ok(codesOf(normalizeBackup(missing)).includes('MISSING_COLLECTION'));

    const notArray = makeLegacy((l) => {
      l.data.tools = { a: 1 };
    });
    assert.ok(codesOf(normalizeBackup(notArray)).includes('MISSING_COLLECTION'));
  });
});
