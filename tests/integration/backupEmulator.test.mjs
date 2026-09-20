// Integração REAL contra o Firebase Emulator Suite (Firestore + Auth), sem Firebase remoto.
//
// Executar:  npm run test:backup:emulator   (firebase emulators:exec)
// Requer:    LEGACY_BACKUP_PATH apontando para o backup legado 3.0 local (fora do repositório).
//
// Falha fechado: recusa iniciar sem os hosts do emulator, com host não local, com
// GOOGLE_APPLICATION_CREDENTIALS definido ou sem o backup legado. Todo tráfego de rede do
// processo é registrado e conexões não locais são bloqueadas. Nenhuma credencial real é usada:
// a chave RSA do Admin SDK é efêmera (memória) e nunca é gravada ou impressa. Nada de tokens,
// senhas ou dados do backup é impresso; a saída contém apenas contagens, status e booleanos.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

const PROJECT_ID = 'gestao-de-ferramentas-3f8f1';
const BASE = `artifacts/${PROJECT_ID}/public/data`;
const EXPECTED_LEGACY_SHA256 = '1D6C42BD54B6716EA1BAC2D9C0CDC0F7855C8A7794BB28A94889C3945B8E6546';
const THIS_FILE = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// Guardas (executam antes de qualquer import de Firebase e de qualquer teste)
// ---------------------------------------------------------------------------

function parseLocalHost(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} ausente: este teste roda somente dentro do Firebase Emulator (npm run test:backup:emulator).`
    );
  }

  const match = /^([^:/\s]+):(\d{2,5})$/.exec(value);

  if (!match || !['127.0.0.1', 'localhost'].includes(match[1].toLowerCase())) {
    throw new Error(`${name} deve apontar somente para 127.0.0.1 ou localhost.`);
  }

  return { host: match[1], port: Number(match[2]) };
}

function assertSafeEnvironment() {
  const firestore = parseLocalHost('FIRESTORE_EMULATOR_HOST');
  const auth = parseLocalHost('FIREBASE_AUTH_EMULATOR_HOST');

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS definido: nenhuma credencial real pode existir neste teste.'
    );
  }

  const legacyPath = process.env.LEGACY_BACKUP_PATH?.trim();

  if (!legacyPath) {
    throw new Error('LEGACY_BACKUP_PATH ausente: informe o backup legado 3.0 local.');
  }

  if (!existsSync(legacyPath)) {
    throw new Error('LEGACY_BACKUP_PATH nao aponta para um arquivo existente.');
  }

  return { firestore, auth, legacyPath: path.resolve(legacyPath) };
}

const environment = assertSafeEnvironment();

// Registro (e bloqueio) de toda conexão de rede feita por este processo.
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const networkAttempts = [];
const originalConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function connectGuard(...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  let host = 'localhost';
  let ipc = false;

  if (first !== null && typeof first === 'object') {
    ipc = typeof first.path === 'string';
    host = first.host ?? 'localhost';
  } else if (typeof first === 'string' && Number.isNaN(Number(first))) {
    ipc = true;
  } else if (typeof normalized[1] === 'string') {
    host = normalized[1];
  }

  const remote = !ipc && !LOOPBACK.has(String(host).toLowerCase());
  networkAttempts.push({ host: ipc ? 'ipc' : String(host), remote });

  if (remote) {
    throw new Error('Conexao de rede nao local bloqueada pelo teste de integracao.');
  }

  return originalConnect.apply(this, args);
};

// Chave RSA efêmera, apenas em memória, somente para o bootstrap do Admin SDK apontar ao emulator.
const { privateKey: ephemeralPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
process.env.FIREBASE_CLIENT_EMAIL = `emulator-test@${PROJECT_ID}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = ephemeralPrivateKey;

const { deleteApp, initializeApp } = await import('firebase/app');
const { connectAuthEmulator, getAuth, signInWithEmailAndPassword } = await import('firebase/auth');
const {
  connectFirestoreEmulator,
  deleteDoc,
  doc: clientDoc,
  getFirestore,
  setDoc,
  terminate,
  updateDoc,
} = await import('firebase/firestore');
const { Timestamp } = await import('firebase-admin/firestore');
const { deleteApp: deleteAdminApp, getApp: getAdminApp } = await import('firebase-admin/app');
const { adminAuth, adminDb } = await import('../../server/firebase-admin.js');
const {
  BackupOperationError,
  MAX_ATOMIC_MUTATIONS,
  RESET_CONFIRMATION,
  RESTORE_CONFIRMATION,
  countSnapshot,
  executeRestore,
  hashData,
  hashSnapshot,
  readOperationalSnapshot,
  readUsersDigest,
  snapshotToData,
} = await import('../../server/backup-operations.js');
const { buildBackupV4, computeDataSha256, normalizeBackup, normalizeValue } =
  await import('../../src/js/utils/backupContract.js');
const restoreApi = (await import('../../api/backup/restore.js')).default;
const resetApi = (await import('../../api/backup/reset.js')).default;

// ---------------------------------------------------------------------------
// Instrumentação (somente leitura do comportamento): escritas do Admin SDK e mutações de Auth
// ---------------------------------------------------------------------------

const writeLog = [];
let commitCount = 0;
const authMutationLog = [];

function instrumentAdminWrites() {
  const batchProto = Object.getPrototypeOf(adminDb.batch());
  const refProto = Object.getPrototypeOf(adminDb.doc(`${BASE}/tools/probe`));

  for (const name of ['set', 'create', 'update', 'delete']) {
    const originalBatch = batchProto[name];
    const originalRef = refProto[name];

    batchProto[name] = function batchWrite(...args) {
      writeLog.push({ op: name, path: String(args[0]?.path ?? '') });
      return originalBatch.apply(this, args);
    };
    refProto[name] = function refWrite(...args) {
      writeLog.push({ op: name, path: String(this.path ?? '') });
      return originalRef.apply(this, args);
    };
  }

  const originalCommit = batchProto.commit;

  batchProto.commit = function commitWrite(...args) {
    commitCount += 1;
    return originalCommit.apply(this, args);
  };

  for (const name of ['runTransaction', 'bulkWriter', 'recursiveDelete']) {
    const original = adminDb[name];

    adminDb[name] = function unexpectedWrite(...args) {
      writeLog.push({ op: name, path: '' });
      return original.apply(this, args);
    };
  }

  for (const name of [
    'createUser',
    'updateUser',
    'deleteUser',
    'deleteUsers',
    'setCustomUserClaims',
    'revokeRefreshTokens',
    'importUsers',
  ]) {
    const original = adminAuth[name];

    adminAuth[name] = function authMutation(...args) {
      authMutationLog.push(name);
      return original.apply(this, args);
    };
  }
}

function resetLogs() {
  writeLog.length = 0;
  authMutationLog.length = 0;
  commitCount = 0;
}

function describeWrites() {
  const usersPrefix = `${BASE}/users`;
  const allowed = new RegExp(`^${BASE}/(tools|collaborators|history)/[^/]+$`);

  return {
    total: writeLog.length,
    users: writeLog.filter((entry) => entry.path.startsWith(usersPrefix)).length,
    outsideWhitelist: writeLog.filter((entry) => !allowed.test(entry.path)).length,
    ops: [...new Set(writeLog.map((entry) => entry.op))].sort(),
    commits: commitCount,
    authMutations: authMutationLog.length,
  };
}

// ---------------------------------------------------------------------------
// Mock mínimo de req/res das Vercel Functions
// ---------------------------------------------------------------------------

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function callApi(handler, { method = 'POST', token, authorization, body } = {}) {
  const headers = {};
  const header = authorization ?? (token ? `Bearer ${token}` : undefined);

  if (header) {
    headers.authorization = header;
  }

  const res = createResponse();

  resetLogs();
  await handler({ method, headers, body }, res);

  return { status: res.statusCode, body: res.body, headers: res.headers, writes: describeWrites() };
}

// ---------------------------------------------------------------------------
// Estado do emulator (leituras e semeadura por Admin SDK: fixtures, não a API testada)
// ---------------------------------------------------------------------------

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const OPERATIONAL = ['tools', 'collaborators', 'history'];

async function operationalState() {
  const snapshot = await readOperationalSnapshot(adminDb);
  const independentCounts = {};

  for (const name of OPERATIONAL) {
    independentCounts[name] = (await adminDb.collection(`${BASE}/${name}`).get()).size;
  }

  assert.deepEqual(independentCounts, countSnapshot(snapshot));

  return {
    hash: hashSnapshot(snapshot),
    counts: independentCounts,
    data: snapshotToData(snapshot),
    usersDigest: await readUsersDigest(adminDb),
  };
}

async function dumpUsers() {
  const snapshot = await adminDb.collection(`${BASE}/users`).get();

  return snapshot.docs
    .map((document) => ({
      id: document.id,
      data: normalizeValue(document.data()),
      updateTime: `${document.updateTime.seconds}.${document.updateTime.nanoseconds}`,
    }))
    .sort((a, b) => compare(a.id, b.id));
}

async function dumpAuth() {
  const { users } = await adminAuth.listUsers(1000);

  return users
    .map((user) => ({
      uid: user.uid,
      email: user.email,
      disabled: user.disabled,
      emailVerified: user.emailVerified,
      claims: user.customClaims ?? null,
      providers: user.providerData.map((provider) => provider.providerId),
      created: user.metadata.creationTime,
    }))
    .sort((a, b) => compare(a.uid, b.uid));
}

async function clearOperational() {
  const batch = adminDb.batch();

  for (const name of OPERATIONAL) {
    (await adminDb.collection(`${BASE}/${name}`).get()).docs.forEach((document) =>
      batch.delete(document.ref)
    );
  }

  await batch.commit();
}

async function seedOperational(seed) {
  const batch = adminDb.batch();

  for (const name of OPERATIONAL) {
    for (const [id, data] of Object.entries(seed[name])) {
      batch.set(adminDb.doc(`${BASE}/${name}/${id}`), data);
    }
  }

  await batch.commit();
}

function initialSeed() {
  return {
    tools: {
      'T-001': {
        code: 'T-001',
        name: 'Furadeira',
        status: 'available',
        lastMaintenance: Timestamp.fromMillis(1789826558387),
      },
      'T-002': {
        code: 'T-002',
        name: 'Serra',
        status: 'borrowed',
        currentUser: 'Colaborador Alfa',
        currentCollaboratorId: 'c1',
      },
      'T-003': { code: 'T-003', name: 'Martelo', status: 'available' },
    },
    collaborators: {
      c1: { name: 'Colaborador Alfa', badge: '10', role: 'Operador', status: 'active' },
      c2: { name: 'Colaborador Beta', badge: '', role: 'Auxiliar', status: 'inactive' },
    },
    history: {
      h1: {
        date: '2026-09-01T10:00:00.000Z',
        type: 'out',
        toolId: 'T-002',
        toolCode: 'T-002',
        toolName: 'Serra',
        collaboratorId: 'c1',
        user: 'Colaborador Alfa',
      },
    },
  };
}

function restoreParts() {
  return {
    tools: [
      { id: 'T-001', code: 'T-001', name: 'Furadeira Restaurada', status: 'available' },
      { id: 'T-004', code: 'T-004', name: 'Chave', status: 'available' },
    ],
    collaborators: [
      { id: 'c1', name: 'Colaborador Alfa', badge: '10', role: 'Operador', status: 'active' },
      { id: 'c3', name: 'Colaborador Gama', badge: '30', role: 'Operador', status: 'active' },
    ],
    history: [
      {
        id: 'h2',
        date: '2026-09-02T10:00:00.000Z',
        type: 'in',
        toolId: 'T-004',
        toolCode: 'T-004',
        toolName: 'Chave',
        collaboratorId: 'c3',
        user: 'Colaborador Gama',
      },
    ],
    users: [],
  };
}

const makeRestoreBackup = () =>
  buildBackupV4(restoreParts(), { exportedAt: '2026-09-20T12:00:00.000Z' });

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const withTimeout = (promise, label, ms = 20000) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`timeout: ${label}`)), ms).unref();
    }),
  ]);

const isPermissionDenied = (error) => error?.code === 'permission-denied';

// Somente contagens, status e booleanos: nada de tokens, senhas ou dados do backup.
const evidence = {};
const record = (key, value) => {
  evidence[key] = value;
};

const clients = [];

async function signIn(label, email, password) {
  const app = initializeApp(
    {
      apiKey: 'emulator-fake-api-key',
      projectId: PROJECT_ID,
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
    },
    label
  );
  const auth = getAuth(app);

  connectAuthEmulator(auth, `http://${environment.auth.host}:${environment.auth.port}`, {
    disableWarnings: true,
  });

  const credential = await withTimeout(
    signInWithEmailAndPassword(auth, email, password),
    `login ${label}`
  );
  const db = getFirestore(app);

  connectFirestoreEmulator(db, environment.firestore.host, environment.firestore.port);

  const client = { app, db, uid: credential.user.uid, token: await credential.user.getIdToken() };

  clients.push(client);

  return client;
}

const FIXTURE_PASSWORD = 'Senha-De-Teste-Emulator-1';
const users = {};
let legacyBackup;
let legacyExpectedHash;
let seedState;
let usersBaseline;
let authBaseline;

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe(
  'backup/restore/reset contra Firebase Emulator (Firestore + Auth)',
  { concurrency: false },
  () => {
    before(async () => {
      const definitions = [
        ['admin', 'admin.backup@emulator.local', 'Administrador', 'Ativo'],
        ['standard', 'standard.backup@emulator.local', 'Operador', 'Ativo'],
        ['inactiveAdmin', 'inactive.backup@emulator.local', 'Administrador', 'Inativo'],
      ];

      for (const [key, email, accessLevel, status] of definitions) {
        const created = await adminAuth.createUser({
          email,
          password: FIXTURE_PASSWORD,
          emailVerified: true,
        });

        await adminDb.doc(`${BASE}/users/${created.uid}`).set({
          name: `Usuario ${key}`,
          email,
          accessLevel,
          department: 'Teste',
          status,
          isRestricted: false,
          createdAt: Timestamp.fromMillis(1700000000000),
          lastLogin: Timestamp.fromMillis(1700000100000),
        });
        users[key] = { email, uid: created.uid, ...(await signIn(key, email, FIXTURE_PASSWORD)) };
      }

      await seedOperational(initialSeed());

      legacyBackup = JSON.parse(readFileSync(environment.legacyPath, 'utf8'));
      legacyExpectedHash = hashData(
        normalizeBackup(legacyBackup, { requireNonEmpty: true }).backup.data
      );
      seedState = await operationalState();
      usersBaseline = await dumpUsers();
      authBaseline = await dumpAuth();
      instrumentAdminWrites();
      resetLogs();
    });

    after(async () => {
      for (const client of clients) {
        await terminate(client.db).catch(() => {});
        await deleteApp(client.app).catch(() => {});
      }

      await adminDb.terminate().catch(() => {});
      await deleteAdminApp(getAdminApp()).catch(() => {});

      for (const key of Object.keys(evidence).sort()) {
        console.log(`EVIDENCE ${key}=${evidence[key]}`);
      }
    });

    test('01 guardas: hosts locais, projeto, chave efêmera e sem credencial real', () => {
      assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
      assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
      assert.equal(process.env.FIREBASE_PROJECT_ID, PROJECT_ID);
      assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
      assert.match(process.env.FIREBASE_CLIENT_EMAIL, /^emulator-test@/);
      record('EMULATOR_HOST_GUARD', true);
      record('REMOTE_FIREBASE_GUARD', true);
      record('REAL_SERVICE_ACCOUNT_USED', false);
      record('EPHEMERAL_TEST_KEY_ONLY', true);
      record('TEST_KEY_WRITTEN_TO_DISK', false);
    });

    test('02 guardas fail-closed: o proprio arquivo recusa iniciar em ambiente inseguro', () => {
      const base = { ...process.env };

      for (const name of [
        'FIRESTORE_EMULATOR_HOST',
        'FIREBASE_AUTH_EMULATOR_HOST',
        'GOOGLE_APPLICATION_CREDENTIALS',
        'LEGACY_BACKUP_PATH',
      ]) {
        delete base[name];
      }

      const local = {
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      };
      const cases = [
        ['sem hosts', {}, /FIRESTORE_EMULATOR_HOST/],
        [
          'firestore remoto',
          { ...local, FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' },
          /FIRESTORE_EMULATOR_HOST/,
        ],
        [
          'auth remoto',
          { ...local, FIREBASE_AUTH_EMULATOR_HOST: 'identitytoolkit.example.com:9099' },
          /FIREBASE_AUTH_EMULATOR_HOST/,
        ],
        [
          'credencial real',
          { ...local, GOOGLE_APPLICATION_CREDENTIALS: 'nao-usado.json' },
          /GOOGLE_APPLICATION_CREDENTIALS/,
        ],
        ['sem backup legado', local, /LEGACY_BACKUP_PATH/],
      ];

      for (const [label, extra, pattern] of cases) {
        const result = spawnSync(process.execPath, [THIS_FILE], {
          env: { ...base, ...extra },
          encoding: 'utf8',
          timeout: 60000,
        });

        assert.notEqual(result.status, 0, `${label}: deveria recusar`);
        assert.match(`${result.stderr}`, pattern, label);
      }
    });

    test('03 tokens reais do Auth Emulator obtidos para as fixtures', () => {
      for (const key of ['admin', 'standard', 'inactiveAdmin']) {
        assert.equal(typeof users[key].token, 'string');
        assert.ok(users[key].token.split('.').length === 3, `${key}: token com 3 segmentos`);
      }

      assert.equal(new Set(Object.values(users).map((user) => user.uid)).size, 3);
      record('ADMIN_EMULATOR_TOKEN_OBTAINED', true);
      record('STANDARD_EMULATOR_TOKEN_OBTAINED', true);
    });

    test('04 restore: autorizacao (401/401/403/403 e admin prossegue)', async () => {
      const body = { confirmation: RESTORE_CONFIRMATION, backup: await makeRestoreBackup() };

      const noToken = await callApi(restoreApi, { body });
      const invalid = await callApi(restoreApi, { token: 'token-invalido', body });
      const standard = await callApi(restoreApi, { token: users.standard.token, body });
      const inactive = await callApi(restoreApi, { token: users.inactiveAdmin.token, body });
      const wrongMethod = await callApi(restoreApi, { method: 'GET', token: users.admin.token });
      const adminGuard = await callApi(restoreApi, {
        token: users.admin.token,
        body: { backup: body.backup },
      });

      assert.equal(noToken.status, 401);
      assert.equal(invalid.status, 401);
      assert.equal(standard.status, 403);
      assert.equal(inactive.status, 403);
      assert.equal(wrongMethod.status, 405);
      assert.equal(adminGuard.status, 400, 'admin passa da autorizacao e para na confirmacao');

      for (const result of [noToken, invalid, standard, inactive, wrongMethod, adminGuard]) {
        assert.equal(result.writes.total, 0);
        assert.equal(result.body.success, false);
      }

      assert.deepEqual((await operationalState()).hash, seedState.hash);
      record('RESTORE_NO_TOKEN_STATUS', noToken.status);
      record('RESTORE_INVALID_TOKEN_STATUS', invalid.status);
      record('RESTORE_STANDARD_STATUS', standard.status);
      record('RESTORE_INACTIVE_ADMIN_STATUS', inactive.status);
      record('RESTORE_ADMIN_AUTHORIZED', true);
    });

    test('05 reset: autorizacao (401/403/403 e admin prossegue)', async () => {
      const body = { confirmation: RESET_CONFIRMATION };

      const noToken = await callApi(resetApi, { body });
      const invalid = await callApi(resetApi, { token: 'token-invalido', body });
      const standard = await callApi(resetApi, { token: users.standard.token, body });
      const inactive = await callApi(resetApi, { token: users.inactiveAdmin.token, body });
      const adminGuard = await callApi(resetApi, { token: users.admin.token, body: {} });

      assert.equal(noToken.status, 401);
      assert.equal(invalid.status, 401);
      assert.equal(standard.status, 403);
      assert.equal(inactive.status, 403);
      assert.equal(adminGuard.status, 400, 'admin passa da autorizacao e para na confirmacao');

      for (const result of [noToken, invalid, standard, inactive, adminGuard]) {
        assert.equal(result.writes.total, 0);
      }

      assert.deepEqual((await operationalState()).hash, seedState.hash);
      record('RESET_NO_TOKEN_STATUS', noToken.status);
      record('RESET_STANDARD_STATUS', standard.status);
      record('RESET_ADMIN_AUTHORIZED', true);
    });

    test('06 confirmation guards: 400 e nenhuma alteracao', async () => {
      const before = await operationalState();
      const backup = await makeRestoreBackup();

      const restoreMissing = await callApi(restoreApi, {
        token: users.admin.token,
        body: { backup },
      });
      const restoreWrong = await callApi(restoreApi, {
        token: users.admin.token,
        body: { confirmation: 'restore_operational_data', backup },
      });
      const resetMissing = await callApi(resetApi, { token: users.admin.token, body: {} });
      const resetWrong = await callApi(resetApi, {
        token: users.admin.token,
        body: { confirmation: RESTORE_CONFIRMATION },
      });

      for (const result of [restoreMissing, restoreWrong, resetMissing, resetWrong]) {
        assert.equal(result.status, 400);
        assert.equal(result.writes.total, 0);
      }

      const after = await operationalState();

      assert.deepEqual(after, before);
      assert.deepEqual(await dumpUsers(), usersBaseline);
      record('RESTORE_CONFIRMATION_GUARD', true);
      record('RESET_CONFIRMATION_GUARD', true);
      record('CONFIRMATION_FAILURE_WRITES', 0);
    });

    test('07 firestore.rules (client SDK): standard negado, admin escreve tools, users sempre negado', async () => {
      const { admin, standard, inactiveAdmin } = users;
      const path = (...segments) => [BASE, ...segments].join('/');

      await assert.rejects(
        withTimeout(
          setDoc(clientDoc(standard.db, path('tools', 'T-RULES')), {
            code: 'T-RULES',
            name: 'x',
            status: 'available',
          }),
          'standard set'
        ),
        isPermissionDenied
      );
      await assert.rejects(
        withTimeout(deleteDoc(clientDoc(standard.db, path('tools', 'T-001'))), 'standard delete'),
        isPermissionDenied
      );
      await assert.rejects(
        withTimeout(
          setDoc(clientDoc(standard.db, path('users', standard.uid)), {
            accessLevel: 'Administrador',
          }),
          'standard users'
        ),
        isPermissionDenied
      );
      await assert.rejects(
        withTimeout(
          setDoc(clientDoc(inactiveAdmin.db, path('tools', 'T-RULES')), {
            code: 'T-RULES',
            name: 'x',
            status: 'available',
          }),
          'inactive set'
        ),
        isPermissionDenied
      );

      assert.equal((await adminDb.doc(path('tools', 'T-RULES')).get()).exists, false);
      assert.equal((await adminDb.doc(path('tools', 'T-001')).get()).exists, true);

      await withTimeout(
        setDoc(clientDoc(admin.db, path('tools', 'T-RULES')), {
          code: 'T-RULES',
          name: 'Regra',
          status: 'available',
        }),
        'admin set'
      );
      assert.equal((await adminDb.doc(path('tools', 'T-RULES')).get()).exists, true);
      await withTimeout(deleteDoc(clientDoc(admin.db, path('tools', 'T-RULES'))), 'admin cleanup');
      assert.equal((await adminDb.doc(path('tools', 'T-RULES')).get()).exists, false);

      await assert.rejects(
        withTimeout(
          setDoc(clientDoc(admin.db, path('users', admin.uid)), { accessLevel: 'Administrador' }),
          'admin users set'
        ),
        isPermissionDenied
      );
      await assert.rejects(
        withTimeout(
          updateDoc(clientDoc(admin.db, path('users', standard.uid)), {
            accessLevel: 'Administrador',
          }),
          'admin users update'
        ),
        isPermissionDenied
      );
      await assert.rejects(
        withTimeout(
          deleteDoc(clientDoc(admin.db, path('users', standard.uid))),
          'admin users delete'
        ),
        isPermissionDenied
      );

      assert.deepEqual(await dumpUsers(), usersBaseline);
      assert.equal((await operationalState()).hash, seedState.hash);
      record('STANDARD_TOOL_WRITE_DENIED', true);
      record('STANDARD_TOOL_DELETE_DENIED', true);
      record('STANDARD_USERS_WRITE_DENIED', true);
      record('ADMIN_TOOL_WRITE_ALLOWED', true);
      record('ADMIN_USERS_WRITE_DENIED', true);
    });

    test('08 backup legado real: SHA-256 exato do snapshot aprovado', () => {
      const digest = createHash('sha256')
        .update(readFileSync(environment.legacyPath))
        .digest('hex')
        .toUpperCase();

      assert.equal(digest, EXPECTED_LEGACY_SHA256);
      assert.ok(
        Array.isArray(legacyBackup.data.users) && legacyBackup.data.users.length > 0,
        'a origem possui users'
      );
      record('LEGACY_REAL_BACKUP_HASH_MATCH', true);
    });

    let legacyRestore;

    test('09 restore do backup legado 3.0 real via API (200, legacyAdapted, 301 status defaultados)', async () => {
      legacyRestore = await callApi(restoreApi, {
        token: users.admin.token,
        body: { confirmation: RESTORE_CONFIRMATION, backup: legacyBackup },
      });

      assert.equal(legacyRestore.status, 200, JSON.stringify(legacyRestore.body?.message));
      assert.equal(legacyRestore.body.success, true);
      assert.equal(legacyRestore.body.data.legacyAdapted, true);
      assert.equal(legacyRestore.body.data.statusDefaulted, 301);
      assert.deepEqual(legacyRestore.body.data.counts, {
        tools: 5,
        collaborators: 302,
        history: 14,
      });
      assert.equal(legacyRestore.body.data.mutations.sets, 321);
      assert.ok(legacyRestore.body.data.mutations.total <= MAX_ATOMIC_MUTATIONS);
      assert.equal(legacyRestore.writes.total, legacyRestore.body.data.mutations.total);
      assert.equal(legacyRestore.writes.commits, 1, 'uma unica WriteBatch');
      assert.ok(legacyRestore.writes.ops.includes('set'));
      assert.ok(legacyRestore.writes.ops.every((op) => ['delete', 'set'].includes(op)));
      assert.equal(legacyRestore.writes.outsideWhitelist, 0);

      const emails = legacyBackup.data.users.map((user) => user.email).filter(Boolean);

      assert.equal(
        emails.some((email) => JSON.stringify(legacyRestore.body).includes(email)),
        false
      );
      record('LEGACY_RESTORE_HTTP_STATUS', legacyRestore.status);
      record('LEGACY_RESTORE_SUCCESS', legacyRestore.body.success);
      record('LEGACY_RESTORE_STATUS_DEFAULTED', legacyRestore.body.data.statusDefaulted);
      record('LEGACY_RESTORE_MUTATIONS_TOTAL', legacyRestore.body.data.mutations.total);
    });

    test('10 readback do Firestore: 5/302/14, hash normalizado igual, status validos', async () => {
      const state = await operationalState();

      assert.deepEqual(state.counts, { tools: 5, collaborators: 302, history: 14 });
      assert.equal(state.hash, legacyExpectedHash);
      assert.equal(state.hash, legacyRestore.body.data.dataSha256);
      assert.equal(state.hash, await computeDataSha256(normalizeBackup(legacyBackup).backup.data));
      assert.equal(
        state.data.collaborators.every((collaborator) =>
          ['active', 'inactive'].includes(collaborator.status)
        ),
        true
      );
      record('LEGACY_RESTORE_TOOLS', state.counts.tools);
      record('LEGACY_RESTORE_COLLABORATORS', state.counts.collaborators);
      record('LEGACY_RESTORE_HISTORY', state.counts.history);
      record('LEGACY_RESTORE_HASH_MATCH', true);
    });

    test('11 users e Auth intactos apos o restore legado; nenhuma escrita em users', async () => {
      assert.deepEqual(await dumpUsers(), usersBaseline);
      assert.deepEqual(await dumpAuth(), authBaseline);
      assert.equal(legacyRestore.writes.users, 0);
      assert.equal(legacyRestore.writes.authMutations, 0);
      record('LEGACY_RESTORE_USERS_UNCHANGED', true);
      record('LEGACY_RESTORE_AUTH_UNCHANGED', true);
      record('LEGACY_USERS_WRITE_COUNT', legacyRestore.writes.users);
      record('BACKUP_API_AUTH_MUTATIONS', legacyRestore.writes.authMutations);
    });

    test('12 entradas invalidas: 422/409 com 0 escritas e estado inalterado', async () => {
      const before = await operationalState();
      const usersBefore = await dumpUsers();
      const send = (backup) =>
        callApi(restoreApi, {
          token: users.admin.token,
          body: { confirmation: RESTORE_CONFIRMATION, backup },
        });
      const codesOf = (result) => (result.body.errors ?? []).map((error) => error.code);

      const unexpected = await makeRestoreBackup();
      unexpected.data.unexpectedCollection = [{ id: 'x1', name: 'x' }];

      const unknownVersion = await makeRestoreBackup();
      unknownVersion.schemaVersion = '5.0';

      const unknownLegacy = { ...structuredClone(legacyBackup), version: '2.0' };

      const tampered = await makeRestoreBackup();
      tampered.summary.dataSha256 = 'A'.repeat(64);

      const withUsers = await makeRestoreBackup();
      withUsers.data.users = [{ id: 'u1', name: 'x', email: 'x@example.test' }];

      const oversized = await buildBackupV4(
        {
          tools: [{ id: 'T-900', code: 'T-900', name: 'Ferramenta', status: 'available' }],
          collaborators: Array.from({ length: 501 }, (_, index) => ({
            id: `bulk-${String(index).padStart(3, '0')}`,
            name: `Colaborador ${index}`,
            badge: String(index),
            role: 'Operador',
            status: 'active',
          })),
          history: [],
          users: [],
        },
        { exportedAt: '2026-09-20T12:00:00.000Z' }
      );

      assert.equal(
        normalizeBackup(oversized, { requireNonEmpty: true }).ok,
        true,
        'o backup grande e valido'
      );

      const results = {
        unexpected: await send(unexpected),
        unknownVersion: await send(unknownVersion),
        unknownLegacy: await send(unknownLegacy),
        tampered: await send(tampered),
        withUsers: await send(withUsers),
        oversized: await send(oversized),
      };

      assert.equal(results.unexpected.status, 422);
      assert.ok(codesOf(results.unexpected).includes('UNEXPECTED_COLLECTION'));
      assert.equal(results.unknownVersion.status, 422);
      assert.ok(codesOf(results.unknownVersion).includes('UNSUPPORTED_SCHEMA_VERSION'));
      assert.equal(results.unknownLegacy.status, 422);
      assert.ok(codesOf(results.unknownLegacy).includes('UNSUPPORTED_VERSION'));
      assert.equal(results.tampered.status, 422);
      assert.equal(results.tampered.body.code, 'HASH_MISMATCH');
      assert.equal(results.withUsers.status, 422);
      assert.ok(codesOf(results.withUsers).includes('USERS_IN_DATA'));
      assert.equal(results.oversized.status, 409);
      assert.equal(results.oversized.body.code, 'ATOMIC_LIMIT_EXCEEDED');
      assert.ok(results.oversized.body.mutations > MAX_ATOMIC_MUTATIONS);

      for (const [name, result] of Object.entries(results)) {
        assert.equal(result.writes.total, 0, `${name}: nenhuma escrita`);
        assert.equal(result.writes.commits, 0, `${name}: nenhum commit`);
      }

      assert.deepEqual(await operationalState(), before);
      assert.deepEqual(await dumpUsers(), usersBefore);
      record('UNEXPECTED_COLLECTION_STATUS', results.unexpected.status);
      record('UNEXPECTED_COLLECTION_WRITES', results.unexpected.writes.total);
      record('UNKNOWN_VERSION_STATUS', results.unknownVersion.status);
      record('UNKNOWN_VERSION_WRITES', results.unknownVersion.writes.total);
      record('UNKNOWN_LEGACY_VERSION_STATUS', results.unknownLegacy.status);
      record('HASH_MISMATCH_STATUS', results.tampered.status);
      record('HASH_MISMATCH_WRITES', results.tampered.writes.total);
      record('USERS_IN_DATA_REJECTED', true);
      record('USERS_IN_DATA_WRITES', results.withUsers.writes.total);
      record('OVER_500_STATUS', results.oversized.status);
      record('OVER_500_REJECTED', true);
      record('OVER_500_WRITES', results.oversized.writes.total);
    });

    test('13 reset real: 200, operacional zerado, users e Auth intactos', async () => {
      const before = await operationalState();

      assert.equal(before.counts.collaborators, 302);

      const result = await callApi(resetApi, {
        token: users.admin.token,
        body: { confirmation: RESET_CONFIRMATION },
      });

      assert.equal(result.status, 200);
      assert.equal(result.body.success, true);
      assert.equal(result.writes.commits, 1);
      assert.deepEqual(result.writes.ops, ['delete']);
      assert.equal(result.writes.users, 0);
      assert.equal(result.writes.outsideWhitelist, 0);
      assert.equal(result.writes.authMutations, 0);

      const after = await operationalState();

      assert.deepEqual(after.counts, { tools: 0, collaborators: 0, history: 0 });
      assert.deepEqual(await dumpUsers(), usersBaseline);
      assert.deepEqual(await dumpAuth(), authBaseline);
      record('RESET_HTTP_STATUS', result.status);
      record('RESET_SUCCESS', result.body.success);
      record('RESET_TOOLS_AFTER', after.counts.tools);
      record('RESET_COLLABORATORS_AFTER', after.counts.collaborators);
      record('RESET_HISTORY_AFTER', after.counts.history);
      record('RESET_USERS_UNCHANGED', true);
      record('RESET_AUTH_UNCHANGED', true);
    });

    test('14 restore do backup legado apos o reset reconstroi 5/302/14', async () => {
      const result = await callApi(restoreApi, {
        token: users.admin.token,
        body: JSON.stringify({ confirmation: RESTORE_CONFIRMATION, backup: legacyBackup }),
      });

      assert.equal(result.status, 200, JSON.stringify(result.body?.message));
      assert.equal(result.body.data.mutations.deletes, 0);
      assert.equal(result.writes.users, 0);

      const state = await operationalState();

      assert.deepEqual(state.counts, { tools: 5, collaborators: 302, history: 14 });
      assert.equal(state.hash, legacyExpectedHash);
      assert.deepEqual(await dumpUsers(), usersBaseline);
      assert.deepEqual(await dumpAuth(), authBaseline);
      record('POST_RESET_RESTORE_SUCCESS', true);
      record('POST_RESET_RESTORE_COUNTS_MATCH', true);
    });

    test('15 rollback real: controle sem falha e depois falha injetada apos o commit', async () => {
      // Estado pequeno e conhecido.
      await clearOperational();
      await seedOperational(initialSeed());

      const restoreInput = await makeRestoreBackup();
      const expectedHash = hashData(
        normalizeBackup(restoreInput, { requireNonEmpty: true }).backup.data
      );

      // Controle: o mesmo restore, sem falha injetada, e bem-sucedido.
      const control = await executeRestore({ db: adminDb, input: restoreInput });

      assert.equal(control.dataSha256, expectedHash);
      assert.equal((await operationalState()).hash, expectedHash);

      await clearOperational();
      await seedOperational(initialSeed());

      const previous = await operationalState();
      const usersBefore = await dumpUsers();
      const stats = { commits: 0, injected: 0 };

      const wrapBatch = (batch) =>
        new Proxy(batch, {
          get(target, property) {
            const value = Reflect.get(target, property, target);

            if (property === 'commit') {
              return async (...args) => {
                const outcome = await value.apply(target, args);

                stats.commits += 1;

                if (stats.commits === 1) {
                  // Corrupcao controlada, somente no teste, antes do readback.
                  await adminDb.doc(`${BASE}/tools/T-001`).update({ name: 'ADULTERADO' });
                  stats.injected += 1;
                }

                return outcome;
              };
            }

            return typeof value === 'function' ? value.bind(target) : value;
          },
        });

      const faultInjectingDb = new Proxy(adminDb, {
        get(target, property) {
          const value = Reflect.get(target, property, target);

          if (property === 'batch') {
            return () => wrapBatch(target.batch());
          }

          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      let failure;

      try {
        await executeRestore({ db: faultInjectingDb, input: restoreInput });
      } catch (error) {
        failure = error;
      }

      assert.ok(
        failure instanceof BackupOperationError,
        'restore com falha deve lancar BackupOperationError'
      );
      assert.equal(failure.statusCode, 500);
      assert.deepEqual(failure.publicDetails, { applied: true, rolledBack: true, incident: false });
      assert.equal(stats.injected, 1, 'a falha foi injetada exatamente uma vez');
      assert.equal(stats.commits, 2, 'commit do restore + commit do rollback');

      const restored = await operationalState();

      assert.equal(restored.hash, previous.hash);
      assert.deepEqual(restored.counts, previous.counts);
      assert.deepEqual(restored.data, previous.data);
      assert.notEqual(restored.hash, expectedHash);
      assert.equal(restored.usersDigest, previous.usersDigest);
      assert.deepEqual(await dumpUsers(), usersBefore);
      assert.deepEqual(await dumpAuth(), authBaseline);
      record('ROLLBACK_FAULT_INJECTED', true);
      record('ROLLBACK_TRIGGERED', true);
      record('ROLLBACK_REPORTED_TRUE', failure.publicDetails.rolledBack);
      record('ROLLBACK_INCIDENT', failure.publicDetails.incident);
      record('ROLLBACK_PREVIOUS_HASH_RESTORED', true);
      record('ROLLBACK_USERS_UNCHANGED', true);
    });

    test('16 cobertura unitaria do caminho de falha do rollback (incident=true)', () => {
      const source = readFileSync(
        new URL('../unit/backupOperations.test.mjs', import.meta.url),
        'utf8'
      );

      assert.match(source, /rollback que tambem falha: incident=true/);
      assert.match(source, /incident: true/);
      record('ROLLBACK_FAILURE_UNIT_COVERAGE', true);
    });

    test('17 digest de users: ignora campos volateis e cobre identidade/acesso', async () => {
      const probe = adminDb.doc(`${BASE}/users/digest-probe`);
      const digest = async () => readUsersDigest(adminDb);
      const initial = await digest();

      await probe.set({
        name: 'Probe',
        email: 'probe@emulator.local',
        accessLevel: 'Operador',
        status: 'Ativo',
        lastLogin: Timestamp.fromMillis(1700000200000),
        lastIp: '203.0.113.1',
        lastDevice: 'dispositivo-a',
      });

      const baseline = await digest();

      await probe.update({
        lastLogin: Timestamp.fromMillis(1800000000000),
        lastIp: '203.0.113.99',
        lastDevice: 'dispositivo-b',
      });
      assert.equal(await digest(), baseline, 'campos volateis nao alteram o digest');

      for (const change of [
        { accessLevel: 'Administrador' },
        { status: 'Inativo' },
        { email: 'outro@emulator.local' },
      ]) {
        await probe.set({
          name: 'Probe',
          email: 'probe@emulator.local',
          accessLevel: 'Operador',
          status: 'Ativo',
          lastLogin: Timestamp.fromMillis(1700000200000),
          lastIp: '203.0.113.1',
          lastDevice: 'dispositivo-a',
        });
        assert.equal(await digest(), baseline);
        await probe.update(change);
        assert.notEqual(await digest(), baseline, `${Object.keys(change)[0]} altera o digest`);
      }

      await probe.delete();
      assert.equal(await digest(), initial, 'remover o probe volta ao digest inicial');
      assert.deepEqual(await dumpUsers(), usersBaseline);

      const withoutProbe = await digest();

      await adminDb.doc(`${BASE}/users/digest-extra`).set({
        name: 'Extra',
        email: 'extra@emulator.local',
        accessLevel: 'Operador',
        status: 'Ativo',
      });
      assert.notEqual(await digest(), withoutProbe, 'adicionar usuario altera o digest');
      await adminDb.doc(`${BASE}/users/digest-extra`).delete();
      assert.equal(
        await digest(),
        withoutProbe,
        'remover o usuario extra volta ao digest anterior'
      );
      record('VOLATILE_USER_FIELDS_IGNORED', true);
      record('IDENTITY_ACCESS_FIELDS_COVERED', true);
    });

    test('18 zero contato remoto: hosts locais e nenhuma conexao de rede nao local', () => {
      assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
      assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
      assert.ok(networkAttempts.length > 0, 'o guard de rede observou trafego local');

      const remote = networkAttempts.filter((attempt) => attempt.remote);

      assert.equal(remote.length, 0);
      record('NETWORK_CONNECTIONS_OBSERVED_LOCAL', networkAttempts.length);
      record(
        'NETWORK_HOSTS_OBSERVED',
        [...new Set(networkAttempts.map((attempt) => attempt.host))].sort().join(',')
      );
      record('FIREBASE_REMOTE_CONTACT', remote.length);
    });
  }
);
