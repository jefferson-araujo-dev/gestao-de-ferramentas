// Teste SOMENTE LEITURA contra o backup legado real, mantido fora do repositório.
// Sem o arquivo local (ex.: CI) a suíte inteira é ignorada. Nunca imprime dados do backup.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { Timestamp } from 'firebase-admin/firestore';

import { executeRestore, hashData } from '../../server/backup-operations.js';
import { computeDataSha256, normalizeBackup } from '../../src/js/utils/backupContract.js';
import { FakeFirestore } from './helpers/fakeFirestore.mjs';

const EXPECTED_SHA256 = '1D6C42BD54B6716EA1BAC2D9C0CDC0F7855C8A7794BB28A94889C3945B8E6546';
const backupPath =
  process.env.LEGACY_BACKUP_PATH ||
  path.join(os.homedir(), 'Downloads', 'backup_coeng_2026-09-20.json');
const available = existsSync(backupPath);

describe('backup legado real (local, somente leitura)', { skip: !available && 'backup legado ausente' }, () => {
  const raw = available ? readFileSync(backupPath) : Buffer.alloc(0);
  const legacy = available ? JSON.parse(raw.toString('utf8')) : null;

  test('o arquivo e exatamente o snapshot aprovado (SHA-256)', () => {
    assert.equal(createHash('sha256').update(raw).digest('hex').toUpperCase(), EXPECTED_SHA256);
  });

  test('o adaptador produz 5 tools, 302 collaborators, 14 history, 301 status defaultados', () => {
    const result = normalizeBackup(legacy, { requireNonEmpty: true });

    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.meta.legacy, true);
    assert.deepEqual(result.meta.counts, { tools: 5, collaborators: 302, history: 14 });
    assert.equal(result.meta.statusDefaulted, 301);
    assert.equal(result.meta.totalRecords, 321);
    assert.equal('users' in result.backup.data, false);
    assert.equal(result.backup.summary.usersReferenceCount, 2);
    assert.equal(
      result.backup.data.collaborators.every((c) => ['active', 'inactive'].includes(c.status)),
      true
    );
    assert.equal(
      result.backup.reference.users.some((u) => 'lastIp' in u || 'lastDevice' in u),
      false
    );
  });

  test('o hash canonico e deterministico e igual em Web Crypto e node:crypto', async () => {
    const { backup } = normalizeBackup(legacy);
    const first = await computeDataSha256(backup.data);
    const second = await computeDataSha256(normalizeBackup(structuredClone(legacy)).backup.data);

    assert.equal(first, second);
    assert.equal(first, hashData(backup.data));
  });

  test('restore simulado sobre o baseline migrado: 321 sets, 0 deletes, users intactos', async () => {
    const { backup } = normalizeBackup(legacy);
    const toDocs = (records) =>
      records.map((record) => {
        const data = { ...record };
        delete data.id;
        return { id: record.id, data };
      });
    const currentUsers = [
      { id: 'uid-a', data: { name: 'A', email: 'a@example.test', accessLevel: 'Administrador', status: 'Ativo', createdAt: new Timestamp(1, 1) } },
      { id: 'uid-b', data: { name: 'B', email: 'b@example.test', accessLevel: 'Usuário Padrão', status: 'Ativo' } },
    ];
    const db = new FakeFirestore({
      tools: toDocs(backup.data.tools),
      collaborators: toDocs(backup.data.collaborators),
      history: toDocs(backup.data.history),
      users: currentUsers,
    });
    const usersBefore = JSON.stringify(db.dump('users'));

    const result = await executeRestore({ db, input: legacy });

    assert.deepEqual(result.mutations, { sets: 321, deletes: 0, total: 321 });
    assert.equal(result.legacyAdapted, true);
    assert.equal(result.statusDefaulted, 301);
    assert.equal(db.commits.length, 1);
    assert.equal(db.commits[0].paths.some((p) => p.endsWith('/users')), false);
    assert.equal(JSON.stringify(db.dump('users')), usersBefore);

    const emails = (legacy.data.users ?? []).map((u) => u.email).filter(Boolean);
    assert.equal(emails.some((email) => JSON.stringify(result).includes(email)), false);
  });
});
