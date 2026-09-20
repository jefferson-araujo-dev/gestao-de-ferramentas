import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { Timestamp } from 'firebase-admin/firestore';

import {
  MAX_ATOMIC_MUTATIONS,
  BackupOperationError,
  assertAtomicLimit,
  buildResetPlan,
  buildRestorePlan,
  buildRollbackPlan,
  computeUsersDigest,
  executeReset,
  executeRestore,
  hashData,
} from '../../server/backup-operations.js';
import { buildBackupV4 } from '../../src/js/utils/backupContract.js';
import { BASE_PATH, FakeFirestore } from './helpers/fakeFirestore.mjs';

const SENTINEL = 'Fulano Sentinela';

function tsLike(seconds, nanoseconds) {
  return { seconds, nanoseconds, toDate: () => new Date(seconds * 1000) };
}

function backupParts() {
  return {
    tools: [
      {
        id: 'T-001',
        code: 'T-001',
        name: 'Furadeira',
        status: 'available',
        lastMaintenance: tsLike(1789826558, 387000000),
      },
      {
        id: 'T-002',
        code: 'T-002',
        name: 'Serra',
        status: 'borrowed',
        currentUser: SENTINEL,
        currentCollaboratorId: 'c1',
      },
    ],
    collaborators: [
      { id: 'c1', name: SENTINEL, badge: '10', role: 'Operador', status: 'active' },
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
        user: SENTINEL,
      },
    ],
    users: [],
  };
}

const makeBackup = () => buildBackupV4(backupParts(), { exportedAt: '2026-09-20T12:00:00.000Z' });

function makeLegacy() {
  const parts = backupParts();

  return {
    exportDate: '2026-09-20T12:00:00.000Z',
    version: '3.0',
    data: {
      tools: parts.tools.map((tool) => ({
        ...tool,
        lastMaintenance: tool.lastMaintenance ? { seconds: 1789826558, nanoseconds: 387000000 } : undefined,
      })),
      users: [{ id: 'legacy-user-1', name: 'Legado', email: 'legado@example.test', accessLevel: 'Administrador' }],
      collaborators: parts.collaborators.map((collaborator) => {
        const copy = { ...collaborator };
        delete copy.status;
        return copy;
      }),
      history: parts.history,
    },
  };
}

function currentState() {
  return {
    tools: [
      { id: 'OLD-1', data: { code: 'OLD-1', name: 'Antiga', status: 'available' } },
      { id: 'T-001', data: { code: 'T-001', name: 'Furadeira antiga', status: 'maintenance' } },
    ],
    collaborators: [{ id: 'c9', data: { name: 'Antigo', badge: '9', role: 'X', status: 'active' } }],
    history: [{ id: 'h0', data: { date: '2026-08-01T10:00:00.000Z', type: 'in', toolId: 'OLD-1' } }],
    users: [
      {
        id: 'uid-atual-1',
        data: {
          name: 'Admin Atual',
          email: 'admin@example.test',
          accessLevel: 'Administrador',
          status: 'Ativo',
          createdAt: new Timestamp(1789826558, 1),
          lastLogin: '2026-09-19T10:00:00.000Z',
        },
      },
    ],
  };
}

const expectFailure = async (promise, statusCode) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof BackupOperationError, String(error));
    assert.equal(error.statusCode, statusCode);
    return true;
  });
};

const snapshotOf = (db) => JSON.stringify(['tools', 'collaborators', 'history', 'users'].map((n) => db.dump(n)));

describe('backup-operations - planos puros', () => {
  const emptyIncoming = { tools: [], collaborators: [], history: [] };
  const snapshotOfIds = (ids) => ({
    tools: ids.map((id) => ({ id, raw: { code: id } })),
    collaborators: [],
    history: [],
  });

  test('incoming igual ao atual gera somente sets', () => {
    const incoming = { ...emptyIncoming, tools: [{ id: 'A', code: 'A' }, { id: 'B', code: 'B' }] };
    const plan = buildRestorePlan(incoming, snapshotOfIds(['A', 'B']));

    assert.equal(plan.sets.length, 2);
    assert.equal(plan.deletes.length, 0);
    assert.equal(plan.totalMutations, 2);
  });

  test('documento extra no atual vira delete; novo incoming vira set', () => {
    const incoming = { ...emptyIncoming, tools: [{ id: 'A', code: 'A' }, { id: 'NOVO', code: 'NOVO' }] };
    const plan = buildRestorePlan(incoming, snapshotOfIds(['A', 'EXTRA']));

    assert.deepEqual(plan.sets.map((s) => s.id).sort(), ['A', 'NOVO']);
    assert.deepEqual(plan.deletes, [{ collection: 'tools', id: 'EXTRA' }]);
    assert.equal(plan.totalMutations, 3);
  });

  test('set carrega os campos sem o id e o plano nunca inclui users', () => {
    const incoming = { ...emptyIncoming, tools: [{ id: 'A', code: 'A', name: 'x' }], users: [{ id: 'u' }] };
    const plan = buildRestorePlan(incoming, { ...snapshotOfIds([]), users: [{ id: 'u', raw: {} }] });

    assert.deepEqual(plan.sets[0].data, { code: 'A', name: 'x' });
    assert.equal([...plan.sets, ...plan.deletes].some((item) => item.collection === 'users'), false);
  });

  test('limite atomico: 500 passa, 501 e rejeitado (409)', () => {
    assertAtomicLimit({ totalMutations: MAX_ATOMIC_MUTATIONS });
    assert.throws(
      () => assertAtomicLimit({ totalMutations: MAX_ATOMIC_MUTATIONS + 1 }),
      (error) => error.statusCode === 409 && error.publicDetails.code === 'ATOMIC_LIMIT_EXCEEDED'
    );
  });

  test('rollback: sets do estado anterior + deletes do que foi criado; mesma contagem do forward', () => {
    const previous = snapshotOfIds(['A', 'EXTRA']);
    const incoming = { ...emptyIncoming, tools: [{ id: 'A', code: 'A' }, { id: 'NOVO', code: 'NOVO' }] };
    const forward = buildRestorePlan(incoming, previous);
    const rollback = buildRollbackPlan(previous, forward);

    assert.deepEqual(rollback.sets.map((s) => s.id).sort(), ['A', 'EXTRA']);
    assert.deepEqual(rollback.deletes, [{ collection: 'tools', id: 'NOVO' }]);
    assert.equal(rollback.totalMutations, forward.totalMutations);
    assert.equal([...rollback.sets, ...rollback.deletes].some((item) => item.collection === 'users'), false);
  });

  test('reset apaga somente collections operacionais', () => {
    const snapshot = {
      tools: [{ id: 'A', raw: {} }],
      collaborators: [{ id: 'c', raw: {} }],
      history: [{ id: 'h', raw: {} }],
    };
    const plan = buildResetPlan(snapshot);

    assert.equal(plan.sets.length, 0);
    assert.equal(plan.totalMutations, 3);
    assert.deepEqual([...new Set(plan.deletes.map((d) => d.collection))].sort(), [
      'collaborators',
      'history',
      'tools',
    ]);
  });

  test('digest de users nao depende da ordem, ignora telemetria e detecta mudancas reais', () => {
    const a = { id: 'a', raw: { name: 'A', accessLevel: 'Administrador', lastLogin: 'x', lastIp: '1' } };
    const b = { id: 'b', raw: { name: 'B', accessLevel: 'Usuario', createdAt: new Timestamp(1, 2) } };

    const base = computeUsersDigest([a, b]);
    assert.equal(computeUsersDigest([b, a]), base);
    assert.equal(
      computeUsersDigest([{ ...a, raw: { ...a.raw, lastLogin: 'y', lastIp: '2', lastDevice: 'z' } }, b]),
      base
    );
    assert.notEqual(computeUsersDigest([{ ...a, raw: { ...a.raw, accessLevel: 'Usuario' } }, b]), base);
    assert.notEqual(computeUsersDigest([a]), base);
    assert.notEqual(computeUsersDigest([a, b, { id: 'c', raw: {} }]), base);
  });
});

describe('backup-operations - restore', () => {
  test('restore v4 aplica em 1 batch, verifica e preserva users', async () => {
    const db = new FakeFirestore(currentState());
    const usersBefore = JSON.stringify(db.dump('users'));
    const backup = await makeBackup();
    const result = await executeRestore({ db, input: backup });

    assert.deepEqual(db.dump('tools').map((d) => d.id), ['T-001', 'T-002']);
    assert.deepEqual(db.dump('collaborators').map((d) => d.id), ['c1', 'c2']);
    assert.deepEqual(db.dump('history').map((d) => d.id), ['h1']);
    assert.equal(JSON.stringify(db.dump('users')), usersBefore);

    assert.equal(db.commits.length, 1);
    assert.equal(db.commits[0].count, 5 + 3);
    assert.deepEqual(db.commits[0].paths.map((p) => p.replace(`${BASE_PATH}/`, '')).sort(), [
      'collaborators',
      'history',
      'tools',
    ]);
    assert.equal(db.commits[0].paths.some((p) => p.endsWith('/users')), false);

    assert.deepEqual(result.counts, { tools: 2, collaborators: 2, history: 1 });
    assert.equal(result.dataSha256, backup.summary.dataSha256);
    assert.equal(result.legacyAdapted, false);
    assert.equal(result.statusDefaulted, 0);
    assert.deepEqual(result.mutations, { sets: 5, deletes: 3, total: 8 });
    assert.equal(result.rollback, false);
    assert.equal(JSON.stringify(result).includes(SENTINEL), false);
  });

  test('timestamps explicitos viram Timestamp real e o hash do readback confere', async () => {
    const db = new FakeFirestore(currentState());
    await executeRestore({ db, input: await makeBackup() });

    const tool = db.dump('tools').find((d) => d.id === 'T-001');
    assert.ok(tool.data.lastMaintenance instanceof Timestamp);
    assert.equal(tool.data.lastMaintenance.seconds, 1789826558);
    assert.equal(tool.data.lastMaintenance.nanoseconds, 387000000);
  });

  test('restore do legado 3.0: adapta, defaulta status e nunca escreve users', async () => {
    const db = new FakeFirestore(currentState());
    const usersBefore = JSON.stringify(db.dump('users'));
    const result = await executeRestore({ db, input: makeLegacy() });

    assert.equal(result.legacyAdapted, true);
    assert.equal(result.statusDefaulted, 2);
    assert.deepEqual(db.dump('collaborators').map((d) => d.data.status), ['active', 'active']);
    assert.equal(JSON.stringify(db.dump('users')), usersBefore);
    assert.equal(db.dump('users').some((d) => d.id === 'legacy-user-1'), false);
    assert.equal(db.commits[0].paths.some((p) => p.endsWith('/users')), false);
  });

  test('backup invalido: 422 e nenhuma escrita', async () => {
    const db = new FakeFirestore(currentState());
    const before = snapshotOf(db);
    const backup = await makeBackup();
    backup.data.tools[0].status = 'invalido';

    await expectFailure(executeRestore({ db, input: backup }), 422);
    assert.equal(db.commits.length, 0);
    assert.equal(snapshotOf(db), before);
  });

  test('hash divergente: 422 HASH_MISMATCH e nenhuma escrita', async () => {
    const db = new FakeFirestore(currentState());
    const backup = await makeBackup();
    backup.data.tools[0].name = 'adulterada';

    await assert.rejects(executeRestore({ db, input: backup }), (error) => {
      assert.equal(error.statusCode, 422);
      assert.equal(error.publicDetails.code, 'HASH_MISMATCH');
      return true;
    });
    assert.equal(db.commits.length, 0);
  });

  test('backup vazio e rejeitado (para apagar tudo existe o reset)', async () => {
    const db = new FakeFirestore(currentState());
    const empty = await buildBackupV4({}, { exportedAt: '2026-09-20T12:00:00.000Z' });

    await expectFailure(executeRestore({ db, input: empty }), 422);
    assert.equal(db.commits.length, 0);
  });

  test('acima de 500 mutacoes: 409 e nenhuma escrita', async () => {
    const collaborators = Array.from({ length: 501 }, (_, i) => ({
      id: `c${String(i).padStart(4, '0')}`,
      name: `N${i}`,
      status: 'active',
    }));
    const backup = await buildBackupV4({ collaborators }, { exportedAt: '2026-09-20T12:00:00.000Z' });
    const db = new FakeFirestore(currentState());
    const before = snapshotOf(db);

    await assert.rejects(executeRestore({ db, input: backup }), (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.publicDetails.code, 'ATOMIC_LIMIT_EXCEEDED');
      return true;
    });
    assert.equal(db.commits.length, 0);
    assert.equal(snapshotOf(db), before);
  });

  test('extras existentes contam no limite (incoming 499 + 3 deletes > 500)', async () => {
    const collaborators = Array.from({ length: 499 }, (_, i) => ({
      id: `c${String(i).padStart(4, '0')}`,
      status: 'active',
    }));
    const backup = await buildBackupV4({ collaborators }, { exportedAt: '2026-09-20T12:00:00.000Z' });
    const db = new FakeFirestore({
      ...currentState(),
      collaborators: [
        { id: 'x1', data: { status: 'active' } },
        { id: 'x2', data: { status: 'active' } },
        { id: 'x3', data: { status: 'active' } },
      ],
    });

    await expectFailure(executeRestore({ db, input: backup }), 409);
    assert.equal(db.commits.length, 0);
  });

  test('commit falha antes de aplicar: 500 applied=false, estado intacto, sem retry', async () => {
    const db = new FakeFirestore(currentState(), { 0: { mode: 'throw-before' } });
    const before = snapshotOf(db);

    await assert.rejects(executeRestore({ db, input: await makeBackup() }), (error) => {
      assert.equal(error.statusCode, 500);
      assert.deepEqual(error.publicDetails, { applied: false, rolledBack: false, incident: false });
      return true;
    });
    assert.equal(db.commits.length, 1);
    assert.equal(snapshotOf(db), before);
  });

  test('commit com erro ambiguo mas aplicado: verificado por readback e aceito (sem retry)', async () => {
    const db = new FakeFirestore(currentState(), { 0: { mode: 'throw-after' } });
    const backup = await makeBackup();
    const result = await executeRestore({ db, input: backup });

    assert.equal(db.commits.length, 1);
    assert.equal(result.dataSha256, backup.summary.dataSha256);
    assert.deepEqual(db.dump('tools').map((d) => d.id), ['T-001', 'T-002']);
  });

  test('falha na verificacao pos-commit: rollback em 1 batch volta ao estado anterior', async () => {
    const db = new FakeFirestore(currentState(), {
      0: {
        mode: 'after-apply',
        run: (fake) => fake.put('tools', 'T-001', { code: 'T-001', name: 'corrompida', status: 'available' }),
      },
    });
    const before = snapshotOf(db);

    await assert.rejects(executeRestore({ db, input: await makeBackup() }), (error) => {
      assert.equal(error.statusCode, 500);
      assert.deepEqual(error.publicDetails, { applied: true, rolledBack: true, incident: false });
      return true;
    });
    assert.equal(db.commits.length, 2);
    assert.equal(snapshotOf(db), before);
    assert.equal(db.commits[1].paths.some((p) => p.endsWith('/users')), false);
  });

  test('rollback que tambem falha: incident=true e nenhum retry cego', async () => {
    const db = new FakeFirestore(currentState(), {
      0: { mode: 'after-apply', run: (fake) => fake.put('tools', 'T-001', { code: 'x' }) },
      1: { mode: 'throw-before' },
    });

    await assert.rejects(executeRestore({ db, input: await makeBackup() }), (error) => {
      assert.equal(error.statusCode, 500);
      assert.deepEqual(error.publicDetails, { applied: true, rolledBack: false, incident: true });
      return true;
    });
    assert.equal(db.commits.length, 2);
  });

  test('users alterado durante o restore: verificacao falha e nada e escrito em users', async () => {
    const db = new FakeFirestore(currentState(), {
      0: {
        mode: 'after-apply',
        run: (fake) => fake.put('users', 'uid-atual-1', { name: 'Outro', accessLevel: 'Usuario' }),
      },
    });

    await assert.rejects(executeRestore({ db, input: await makeBackup() }), (error) => {
      assert.equal(error.statusCode, 500);
      assert.equal(error.publicDetails.applied, true);
      return true;
    });
    assert.equal(db.commits.every((commit) => !commit.paths.some((p) => p.endsWith('/users'))), true);
  });

  test('valor Firestore nao suportado no estado atual: 409 antes de qualquer escrita', async () => {
    class GeoLike {
      constructor() {
        this.latitude = 1;
        this.longitude = 2;
      }
    }

    const db = new FakeFirestore({
      ...currentState(),
      tools: [{ id: 'G', data: { code: 'G', where: new GeoLike() } }],
    });

    await expectFailure(executeRestore({ db, input: await makeBackup() }), 409);
    assert.equal(db.commits.length, 0);
  });
});

describe('backup-operations - reset', () => {
  test('reset apaga tools/collaborators/history em 1 batch e preserva users', async () => {
    const db = new FakeFirestore(currentState());
    const usersBefore = JSON.stringify(db.dump('users'));
    const result = await executeReset({ db });

    assert.equal(db.dump('tools').length, 0);
    assert.equal(db.dump('collaborators').length, 0);
    assert.equal(db.dump('history').length, 0);
    assert.equal(JSON.stringify(db.dump('users')), usersBefore);
    assert.equal(db.commits.length, 1);
    assert.equal(db.commits[0].sets, 0);
    assert.equal(db.commits[0].deletes, 4);
    assert.equal(db.commits[0].paths.some((p) => p.endsWith('/users')), false);
    assert.deepEqual(result, {
      deleted: { tools: 2, collaborators: 1, history: 1 },
      totalDeleted: 4,
      usersUnchanged: true,
      rollback: false,
    });
  });

  test('reset acima de 500 delecoes: 409 e nenhuma escrita', async () => {
    const collaborators = Array.from({ length: 501 }, (_, i) => ({ id: `c${i}`, data: { status: 'active' } }));
    const db = new FakeFirestore({ ...currentState(), collaborators });

    await assert.rejects(executeReset({ db }), (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.publicDetails.code, 'ATOMIC_LIMIT_EXCEEDED');
      return true;
    });
    assert.equal(db.commits.length, 0);
  });

  test('reset com falha de verificacao faz rollback e restaura o estado anterior', async () => {
    const db = new FakeFirestore(currentState(), {
      0: {
        mode: 'after-apply',
        run: (fake) => fake.put('tools', 'T-001', { code: 'T-001', name: 'ressuscitada' }),
      },
    });

    await assert.rejects(executeReset({ db }), (error) => {
      assert.deepEqual(error.publicDetails, { applied: true, rolledBack: true, incident: false });
      return true;
    });
    assert.equal(db.commits.length, 2);
    assert.deepEqual(db.dump('tools').map((d) => d.id), ['OLD-1', 'T-001']);
  });

  test('reset sem dados operacionais: 0 delecoes e sucesso', async () => {
    const db = new FakeFirestore({ users: currentState().users });
    const result = await executeReset({ db });

    assert.equal(result.totalDeleted, 0);
    assert.equal(hashData({ tools: [], collaborators: [], history: [] }).length, 64);
  });
});
