import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import {
  RESTORABLE_COLLECTIONS,
  canonicalDataString,
  canonicalStringify,
  isExplicitTimestamp,
  normalizeBackup,
  normalizeValue
} from '../src/js/utils/backupContract.js';

/**
 * Núcleo server-side de restore/reset operacional.
 *
 * Regras estruturais:
 *  - caminho do banco e collections fixos (nunca derivados de entrada);
 *  - somente tools, collaborators e history são mutáveis; `users` é apenas lido (digest);
 *  - nenhuma operação de Authentication (este módulo não usa o módulo de Auth do Admin SDK);
 *  - uma única WriteBatch atômica com no máximo MAX_ATOMIC_MUTATIONS operações;
 *  - verificação por readback (hash operacional + digest de users) e rollback em 1 batch.
 *
 * A autorização (requireActiveAdmin) fica nas APIs; o Firestore é injetado (`db`).
 */

export const BACKUP_BASE_PATH = 'artifacts/gestao-de-ferramentas-3f8f1/public/data';
export const USERS_COLLECTION = 'users';
export const MAX_ATOMIC_MUTATIONS = 500;
export const MAX_RESTORE_BODY_BYTES = 4000000;
export const RESTORE_CONFIRMATION = 'RESTORE_OPERATIONAL_DATA';
export const RESET_CONFIRMATION = 'RESET_OPERATIONAL_DATA';

const MAX_PUBLIC_ERRORS = 20;
const compareCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export class BackupOperationError extends Error {
  constructor(statusCode, message, publicDetails = {}) {
    super(message);
    this.name = 'BackupOperationError';
    this.statusCode = statusCode;
    this.publicDetails = publicDetails;
  }
}

// ---------------------------------------------------------------------------
// Hash e conversões
// ---------------------------------------------------------------------------

export function sha256Upper(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

export function hashData(data) {
  return sha256Upper(canonicalDataString(data));
}

function isPlainValue(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Representação explícita de timestamp -> Timestamp do Admin SDK (recursivo). */
export function toFirestoreValue(value) {
  if (Array.isArray(value)) {
    return value.map(toFirestoreValue);
  }

  if (isExplicitTimestamp(value)) {
    return new Timestamp(value.seconds, value.nanoseconds);
  }

  if (isPlainValue(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toFirestoreValue(item)])
    );
  }

  return value;
}

function isTimestampValue(value) {
  return value !== null && typeof value === 'object' && typeof value.toDate === 'function';
}

/** Recusa valores Firestore que este fluxo não sabe restaurar sem perda (GeoPoint, referências...). */
function assertSupportedValue(value) {
  if (value === null || typeof value !== 'object' || isTimestampValue(value)) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(assertSupportedValue);
    return;
  }

  if (!isPlainValue(value)) {
    throw new BackupOperationError(
      409,
      'Existem documentos com tipos de valor não suportados pelo restore atômico.',
      { code: 'UNSUPPORTED_FIRESTORE_VALUE' }
    );
  }

  Object.values(value).forEach(assertSupportedValue);
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

function assertKnownCollection(name, { allowUsers = false } = {}) {
  const allowed = allowUsers ? [...RESTORABLE_COLLECTIONS, USERS_COLLECTION] : RESTORABLE_COLLECTIONS;

  if (!allowed.includes(name)) {
    throw new BackupOperationError(500, 'Collection não permitida.');
  }
}

function collectionRef(db, name, options) {
  assertKnownCollection(name, options);
  return db.collection(`${BACKUP_BASE_PATH}/${name}`);
}

async function readCollection(db, name, options) {
  const snapshot = await collectionRef(db, name, options).get();

  return snapshot.docs
    .map((document) => ({
      id: document.id,
      raw: document.data()
    }))
    .sort((a, b) => compareCodeUnits(a.id, b.id));
}

/** Estado operacional atual (dados brutos do Firestore, em memória, para rollback). */
export async function readOperationalSnapshot(db) {
  const snapshot = {};

  for (const name of RESTORABLE_COLLECTIONS) {
    snapshot[name] = await readCollection(db, name);
    snapshot[name].forEach((entry) => assertSupportedValue(entry.raw));
  }

  return snapshot;
}

/** Snapshot -> `data` canônico (registros planos, timestamps explícitos). */
export function snapshotToData(snapshot) {
  return Object.fromEntries(
    RESTORABLE_COLLECTIONS.map((name) => [
      name,
      snapshot[name].map((entry) => ({ ...normalizeValue(entry.raw), id: entry.id }))
    ])
  );
}

export function hashSnapshot(snapshot) {
  return hashData(snapshotToData(snapshot));
}

export function countSnapshot(snapshot) {
  return Object.fromEntries(RESTORABLE_COLLECTIONS.map((name) => [name, snapshot[name].length]));
}

// Telemetria de sessão que muda a cada login (api/session/last-login.js). Fica fora do digest
// para que um login concorrente não faça um restore correto parecer falha (e disparar rollback).
const VOLATILE_USER_FIELDS = ['lastLogin', 'lastIp', 'lastDevice'];

/**
 * Digest de `users` independente da ordem de leitura. Cobre o conjunto de perfis e todos os
 * campos de identidade/acesso; ignora somente VOLATILE_USER_FIELDS.
 */
export function computeUsersDigest(documents) {
  const items = documents
    .map((document) => {
      const data = normalizeValue(document.raw);
      VOLATILE_USER_FIELDS.forEach((field) => delete data[field]);

      return { id: document.id, data };
    })
    .sort((a, b) => compareCodeUnits(a.id, b.id));

  return sha256Upper(canonicalStringify(items));
}

export async function readUsersDigest(db) {
  return computeUsersDigest(await readCollection(db, USERS_COLLECTION, { allowUsers: true }));
}

// ---------------------------------------------------------------------------
// Planos de mutação (funções puras)
// ---------------------------------------------------------------------------

function fieldsOf(record) {
  const fields = { ...record };
  delete fields.id;
  return fields;
}

/** Restore: set completo de todo documento do backup + delete dos extras existentes. */
export function buildRestorePlan(incomingData, currentSnapshot) {
  const sets = [];
  const deletes = [];

  for (const name of RESTORABLE_COLLECTIONS) {
    const incoming = incomingData[name];
    const incomingIds = new Set(incoming.map((record) => record.id));

    incoming.forEach((record) => sets.push({ collection: name, id: record.id, data: fieldsOf(record) }));
    currentSnapshot[name]
      .filter((entry) => !incomingIds.has(entry.id))
      .forEach((entry) => deletes.push({ collection: name, id: entry.id }));
  }

  return { sets, deletes, totalMutations: sets.length + deletes.length };
}

/** Reset: delete de todos os documentos operacionais. Nunca inclui users. */
export function buildResetPlan(currentSnapshot) {
  const deletes = RESTORABLE_COLLECTIONS.flatMap((name) =>
    currentSnapshot[name].map((entry) => ({ collection: name, id: entry.id }))
  );

  return { sets: [], deletes, totalMutations: deletes.length };
}

/** Volta exatamente ao snapshot anterior: set dos existentes antes + delete do que foi criado. */
export function buildRollbackPlan(previousSnapshot, forwardPlan) {
  const sets = [];
  const deletes = [];

  for (const name of RESTORABLE_COLLECTIONS) {
    const previousIds = new Set(previousSnapshot[name].map((entry) => entry.id));

    previousSnapshot[name].forEach((entry) =>
      sets.push({ collection: name, id: entry.id, data: normalizeValue(entry.raw) })
    );
    forwardPlan.sets
      .filter((item) => item.collection === name && !previousIds.has(item.id))
      .forEach((item) => deletes.push({ collection: name, id: item.id }));
  }

  return { sets, deletes, totalMutations: sets.length + deletes.length };
}

export function assertAtomicLimit(plan, label = 'A operação') {
  if (plan.totalMutations > MAX_ATOMIC_MUTATIONS) {
    throw new BackupOperationError(
      409,
      `${label} excede o limite do modo atômico (${MAX_ATOMIC_MUTATIONS} mutações) e requer procedimento administrativo específico.`,
      { code: 'ATOMIC_LIMIT_EXCEEDED', mutations: plan.totalMutations, limit: MAX_ATOMIC_MUTATIONS }
    );
  }
}

// ---------------------------------------------------------------------------
// Aplicação (uma única WriteBatch por plano)
// ---------------------------------------------------------------------------

async function applyPlan(db, plan) {
  assertAtomicLimit(plan);
  const batch = db.batch();

  plan.sets.forEach((item) => {
    batch.set(collectionRef(db, item.collection).doc(item.id), toFirestoreValue(item.data));
  });
  plan.deletes.forEach((item) => {
    batch.delete(collectionRef(db, item.collection).doc(item.id));
  });

  await batch.commit();
}

async function verifyState(db, expectedDataHash, usersDigestBefore) {
  const state = await readOperationalSnapshot(db);
  const usersDigestAfter = await readUsersDigest(db);

  return {
    dataOk: hashSnapshot(state) === expectedDataHash,
    usersOk: usersDigestAfter === usersDigestBefore,
    counts: countSnapshot(state)
  };
}

async function rollbackToPrevious(db, rollbackPlan, previousHash, usersDigestBefore) {
  try {
    await applyPlan(db, rollbackPlan);
    const verification = await verifyState(db, previousHash, usersDigestBefore);

    return verification.dataOk && verification.usersOk;
  } catch {
    return false;
  }
}

/**
 * Após o commit: verifica o estado esperado; se falhar, faz rollback em 1 batch e sinaliza.
 * Nunca repete o commit original.
 */
async function finalizeOperation({
  db,
  commitError,
  expectedHash,
  previousHash,
  usersBefore,
  rollbackPlan,
  failureMessage
}) {
  let verification = null;

  try {
    verification = await verifyState(db, expectedHash, usersBefore);
  } catch {
    verification = null;
  }

  if (verification?.dataOk && verification.usersOk) {
    return verification;
  }

  if (commitError) {
    // O commit falhou; se o estado ainda é exatamente o anterior, nada foi aplicado.
    try {
      const state = await verifyState(db, previousHash, usersBefore);

      if (state.dataOk && state.usersOk) {
        throw new BackupOperationError(500, failureMessage, {
          applied: false,
          rolledBack: false,
          incident: false
        });
      }
    } catch (error) {
      if (error instanceof BackupOperationError) {
        throw error;
      }
    }
  }

  const rolledBack = await rollbackToPrevious(db, rollbackPlan, previousHash, usersBefore);

  throw new BackupOperationError(500, failureMessage, {
    applied: true,
    rolledBack,
    incident: !rolledBack
  });
}

// ---------------------------------------------------------------------------
// Operações públicas
// ---------------------------------------------------------------------------

/**
 * Restore operacional atômico. `input` é o objeto de backup recebido (v4 ou legado 3.0).
 * Retorna somente metadados seguros (contagens, hash, flags).
 */
export async function executeRestore({ db, input }) {
  const normalized = normalizeBackup(input, { requireNonEmpty: true });

  if (!normalized.ok) {
    throw new BackupOperationError(422, 'Backup inválido: nada foi alterado.', {
      errors: normalized.errors.slice(0, MAX_PUBLIC_ERRORS),
      errorCount: normalized.errorCount
    });
  }

  const { backup, meta } = normalized;
  const dataHash = hashData(backup.data);

  if (!meta.legacy && backup.summary.dataSha256 !== dataHash) {
    throw new BackupOperationError(422, 'Hash do backup não confere: nada foi alterado.', {
      code: 'HASH_MISMATCH'
    });
  }

  const previous = await readOperationalSnapshot(db);
  const previousHash = hashSnapshot(previous);
  const usersBefore = await readUsersDigest(db);
  const plan = buildRestorePlan(backup.data, previous);
  const rollbackPlan = buildRollbackPlan(previous, plan);

  assertAtomicLimit(plan, 'O restore');
  assertAtomicLimit(rollbackPlan, 'O rollback do restore');

  let commitError = null;

  try {
    await applyPlan(db, plan);
  } catch (error) {
    commitError = error;
  }

  await finalizeOperation({
    db,
    commitError,
    expectedHash: dataHash,
    previousHash,
    usersBefore,
    rollbackPlan,
    failureMessage: 'Falha ao aplicar ou verificar o restore.'
  });

  return {
    counts: meta.counts,
    totalRecords: meta.totalRecords,
    dataSha256: dataHash,
    legacyAdapted: meta.legacy,
    statusDefaulted: meta.statusDefaulted,
    mutations: { sets: plan.sets.length, deletes: plan.deletes.length, total: plan.totalMutations },
    usersUnchanged: true,
    rollback: false
  };
}

/** Reset operacional atômico: apaga tools, collaborators e history. Users/Auth intocados. */
export async function executeReset({ db }) {
  const previous = await readOperationalSnapshot(db);
  const previousHash = hashSnapshot(previous);
  const usersBefore = await readUsersDigest(db);
  const plan = buildResetPlan(previous);
  const rollbackPlan = buildRollbackPlan(previous, plan);

  assertAtomicLimit(plan, 'O reset');
  assertAtomicLimit(rollbackPlan, 'O rollback do reset');

  let commitError = null;

  try {
    await applyPlan(db, plan);
  } catch (error) {
    commitError = error;
  }

  await finalizeOperation({
    db,
    commitError,
    expectedHash: hashData({ tools: [], collaborators: [], history: [] }),
    previousHash,
    usersBefore,
    rollbackPlan,
    failureMessage: 'Falha ao aplicar ou verificar o reset.'
  });

  return {
    deleted: countSnapshot(previous),
    totalDeleted: plan.totalMutations,
    usersUnchanged: true,
    rollback: false
  };
}
