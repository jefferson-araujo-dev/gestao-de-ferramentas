// Integração REAL do handler /api/tools/movement contra o Firebase Emulator Suite
// (Firestore + Auth), sem Firebase remoto e sem Vercel.
//
// Executar:  npm run test:movement:emulator   (firebase emulators:exec)
//
// Cobre o contrato do empréstimo por perfil: Admin/Padrão seguem por collaboratorId; o perfil
// RESTRITO envia somente o crachá exato e o servidor resolve o colaborador (anti-enumeração).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import {
  BASE,
  Timestamp,
  adminDb,
  closeEmulatorClients,
  createUserFixture,
  networkAttempts,
  signIn,
} from './support/emulator.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const movementApi = (await import('../../api/tools/movement.js')).default;

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

// Captura tudo que o handler escreve em console durante a chamada (verificação de PII em logs).
async function callMovement({ method = 'POST', token, authorization, body } = {}) {
  const headers = {};
  const header = authorization ?? (token ? `Bearer ${token}` : undefined);

  if (header) {
    headers.authorization = header;
  }

  const res = createResponse();
  const logged = [];
  const originals = {};

  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    originals[level] = console[level];
    console[level] = (...args) => logged.push(args.map(String).join(' '));
  }

  try {
    await movementApi({ method, headers, body }, res);
  } finally {
    Object.assign(console, originals);
  }

  return { status: res.statusCode, body: res.body, logged: logged.join('\n') };
}

const evidence = {};
const record = (key, value) => {
  evidence[key] = value;
};

const device = 'Navegador de Teste';
const loan = (toolId, extra) => ({ action: 'loan', toolId, device, ...extra });
const restrictedLoan = (toolId, collaboratorBadge) => loan(toolId, { collaboratorBadge });

// ---------------------------------------------------------------------------
// Estado do emulator (fixtures via Admin SDK; não é a API testada)
// ---------------------------------------------------------------------------

const tool = (code, name, status, extra = {}) => ({
  code,
  name,
  category: 'Elétrica',
  status,
  currentUser: null,
  currentCollaboratorId: null,
  lastAction: null,
  nextMaintenance: null,
  ...extra,
});

const FIXED_TOOLS = () => ({
  'T-01': tool('T-01', 'Furadeira', 'available'),
  'T-02': tool('T-02', 'Parafusadeira', 'available'),
  'T-03': tool('T-03', 'Serra', 'borrowed', {
    currentUser: 'Colaborador Alfa',
    currentCollaboratorId: 'c1',
    lastAction: '2026-09-01T10:00:00.000Z',
  }),
  'T-04': tool('T-04', 'Esmerilhadeira', 'maintenance'),
  'T-05': tool('T-05', 'Nivel', 'available', {
    nextMaintenance: Timestamp.fromMillis(Date.parse('2020-01-01T00:00:00Z')),
  }),
  'T-06': tool('T-06', 'Martelo', 'available'),
  'T-07': tool('T-07', 'Trena', 'available'),
  'T-08': tool('T-08', 'Alicate', 'available'),
  'T-09': tool('T-09', 'Chave', 'available'),
  'T-10': tool('T-10', 'Lima', 'available'),
  'T-11': tool('T-11', 'Serrote', 'available'),
  'T-12': tool('T-12', 'Nivelador', 'available'),
});

const FIXED_COLLABORATORS = {
  c1: { name: 'Colaborador Alfa', badge: 'B-100', role: 'Operador', status: 'active' },
  c2: { name: 'Colaborador Beta', badge: 'B-200', role: 'Auxiliar', status: 'inactive' },
  c3: { name: 'Colaborador Gama', badge: 'B-300', role: 'Supervisor', status: 'active' },
  c4: { name: 'Colaborador Delta', badge: 'B-DUP', role: 'Operador', status: 'active' },
  c5: { name: 'Colaborador Epsilon', badge: 'B-DUP', role: 'Operador', status: 'active' },
  c6: { name: 'Colaborador Zeta', badge: 'B-600', status: 'active' },
  c7: { name: 'Colaborador Eta', badge: '', role: 'Operador', status: 'active' },
};

async function seedOperational() {
  const batch = adminDb.batch();

  for (const name of ['tools', 'collaborators', 'history']) {
    (await adminDb.collection(`${BASE}/${name}`).get()).docs.forEach((document) =>
      batch.delete(document.ref)
    );
  }

  for (const [id, data] of Object.entries(FIXED_TOOLS())) {
    batch.set(adminDb.doc(`${BASE}/tools/${id}`), data);
  }

  for (const [id, data] of Object.entries(FIXED_COLLABORATORS)) {
    batch.set(adminDb.doc(`${BASE}/collaborators/${id}`), data);
  }

  await batch.commit();
}

const readTool = async (id) => (await adminDb.doc(`${BASE}/tools/${id}`).get()).data();
const historyDocs = async () =>
  (await adminDb.collection(`${BASE}/history`).get()).docs.map((document) => document.data());
const collaboratorsDigest = async () =>
  JSON.stringify(
    (await adminDb.collection(`${BASE}/collaborators`).get()).docs
      .map((document) => [document.id, document.data()])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  );

const users = {};

// Nada do que segue pode aparecer em respostas de falha nem em logs do perfil restrito.
const SENSITIVE = [
  'Colaborador Alfa',
  'Colaborador Beta',
  'Colaborador Delta',
  'Operador',
  'Auxiliar',
  'B-100',
  'B-200',
  'B-DUP',
  'c1',
  'c2',
];

function assertNoLeak(result, label) {
  const serialized = JSON.stringify(result.body ?? {}) + result.logged;

  for (const value of SENSITIVE) {
    assert.ok(!serialized.includes(value), `${label}: vazou dado sensível`);
  }
}

describe('POST /api/tools/movement contra Firebase Emulator (Firestore + Auth)', () => {
  before(async () => {
    const definitions = [
      ['admin', { accessLevel: 'Administrador', extra: { isRestricted: false } }],
      ['standard', { accessLevel: 'Usuário Padrão', extra: { isRestricted: false } }],
      ['restricted', { accessLevel: 'Usuário Padrão', extra: { isRestricted: true } }],
      // Perfil antigo, sem o campo isRestricted: comporta-se como padrão.
      ['legacy', { accessLevel: 'Usuário Padrão' }],
      // Administrador com a flag ligada continua administrador (não é restrito).
      ['adminflag', { accessLevel: 'Administrador', extra: { isRestricted: true } }],
      [
        'inactiverestricted',
        { accessLevel: 'Usuário Padrão', status: 'Inativo', extra: { isRestricted: true } },
      ],
    ];

    for (const [key, options] of definitions) {
      const user = await createUserFixture(key, options);

      users[key] = { ...user, ...(await signIn(user)) };
    }

    await seedOperational();
  });

  after(async () => {
    await closeEmulatorClients();

    for (const key of Object.keys(evidence).sort()) {
      console.log(`EVIDENCE ${key}=${evidence[key]}`);
    }
  });

  test('01 guardas fail-closed: o ambiente recusa iniciar sem emulator local', () => {
    assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
    assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST, /^(127\.0\.0\.1|localhost):\d+$/);
    assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);

    const base = { ...process.env };

    for (const name of [
      'FIRESTORE_EMULATOR_HOST',
      'FIREBASE_AUTH_EMULATOR_HOST',
      'GOOGLE_APPLICATION_CREDENTIALS',
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
        'credencial real',
        { ...local, GOOGLE_APPLICATION_CREDENTIALS: 'nao-usado.json' },
        /GOOGLE_APPLICATION_CREDENTIALS/,
      ],
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

    record('EMULATOR_HOST_GUARD', true);
  });

  test('02 sem autenticação: 401 (sem token, cabeçalho inválido, token inválido) e 405', async () => {
    const digestBefore = await collaboratorsDigest();
    const body = restrictedLoan('T-01', 'B-100');

    assert.equal((await callMovement({ body })).status, 401);
    assert.equal((await callMovement({ authorization: 'Basic abc', body })).status, 401);
    assert.equal((await callMovement({ token: 'token-invalido', body })).status, 401);
    assert.equal((await callMovement({ method: 'GET', token: users.restricted.token })).status, 405);
    assert.equal((await callMovement({ token: users.inactiverestricted.token, body })).status, 403);
    assert.equal((await readTool('T-01')).status, 'available');
    assert.equal(await collaboratorsDigest(), digestBefore);
    record('MOVEMENT_UNAUTHENTICATED_401', true);
  });

  test('03 restrito + crachá válido: empréstimo registrado no servidor com resposta mínima', async () => {
    const result = await callMovement({
      token: users.restricted.token,
      body: restrictedLoan('T-01', 'B-100'),
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.deepEqual(Object.keys(result.body.data).sort(), ['action', 'collaborator', 'tool']);
    // Somente nome (confirmação/termo) e função (termo): nada de crachá, telefone, ID ou foto.
    assert.deepEqual(result.body.data.collaborator, { name: 'Colaborador Alfa', role: 'Operador' });
    assert.equal(result.body.data.tool.status, 'borrowed');

    const stored = await readTool('T-01');

    assert.equal(stored.status, 'borrowed');
    assert.equal(stored.currentUser, 'Colaborador Alfa');
    assert.equal(stored.currentCollaboratorId, 'c1');

    const entries = (await historyDocs()).filter((entry) => entry.toolId === 'T-01');

    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, 'out');
    assert.equal(entries[0].collaboratorId, 'c1');
    assert.equal(entries[0].operatorUid, users.restricted.uid);
    record('MOVEMENT_RESTRICTED_VALID_BADGE', 'PASS');
    record('MOVEMENT_RESTRICTED_RESPONSE_FIELDS', 'data.collaborator{name,role}');
  });

  test('04 restrito + crachá com espaços nas pontas: aparado e aceito; sem função = string vazia', async () => {
    const result = await callMovement({
      token: users.restricted.token,
      body: restrictedLoan('T-02', '  B-600  '),
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data.collaborator, { name: 'Colaborador Zeta', role: '' });
  });

  test('05 restrito: falhas de crachá são genéricas e idênticas (sem PII, sem escrita)', async () => {
    const digestBefore = await collaboratorsDigest();
    const toolsBefore = JSON.stringify(await readTool('T-06'));
    const historyBefore = (await historyDocs()).length;
    const attempts = {
      inexistente: restrictedLoan('T-06', 'B-999'),
      inativo: restrictedLoan('T-06', 'B-200'),
      duplicado: restrictedLoan('T-06', 'B-DUP'),
      caixaDiferente: restrictedLoan('T-06', 'b-100'),
      nomeNoLugarDoCracha: restrictedLoan('T-06', 'Colaborador Alfa'),
      prefixo: restrictedLoan('T-06', 'B-1'),
      vazio: restrictedLoan('T-06', ''),
      espacos: restrictedLoan('T-06', '   '),
      longo: restrictedLoan('T-06', 'B'.repeat(51)),
      numero: loan('T-06', { collaboratorBadge: 100 }),
      nulo: loan('T-06', { collaboratorBadge: null }),
      objeto: loan('T-06', { collaboratorBadge: { $ne: '' } }),
    };
    const results = {};

    for (const [label, body] of Object.entries(attempts)) {
      results[label] = await callMovement({ token: users.restricted.token, body });
      assertNoLeak(results[label], label);
    }

    const [reference, ...others] = Object.values(results);

    assert.equal(reference.status, 422);
    assert.equal(reference.body.success, false);
    assert.equal(reference.body.code, 'LOAN_NOT_AUTHORIZED');
    assert.deepEqual(Object.keys(reference.body).sort(), ['code', 'message', 'success']);

    for (const other of others) {
      assert.equal(other.status, reference.status);
      assert.deepEqual(other.body, reference.body);
    }

    assert.equal(JSON.stringify(await readTool('T-06')), toolsBefore);
    assert.equal((await historyDocs()).length, historyBefore);
    assert.equal(await collaboratorsDigest(), digestBefore);
    record('MOVEMENT_RESTRICTED_INVALID_BADGE_GENERIC', true);
    record('MOVEMENT_RESTRICTED_FAILURE_CASES_IDENTICAL', Object.keys(attempts).length);
  });

  test('06 restrito: collaboratorId (bypass) é negado com 403, com ou sem crachá, sem escrita', async () => {
    const historyBefore = (await historyDocs()).length;
    const bypass = [
      loan('T-07', { collaboratorId: 'c3' }),
      loan('T-07', { collaboratorId: 'c3', collaboratorBadge: 'B-300' }),
      loan('T-07', { collaboratorId: 'inexistente' }),
      loan('T-07', { collaboratorId: 'c2' }),
    ];
    const results = [];

    for (const body of bypass) {
      const result = await callMovement({ token: users.restricted.token, body });

      results.push(result);
      assert.equal(result.status, 403);
      assert.equal(result.body.success, false);
      assertNoLeak(result, 'bypass');
    }

    // Mesma resposta para ID válido, inexistente ou de colaborador inativo: nenhum oráculo.
    assert.deepEqual(results[0].body, results[2].body);
    assert.deepEqual(results[0].body, results[3].body);
    assert.equal((await readTool('T-07')).status, 'available');
    assert.equal((await historyDocs()).length, historyBefore);
    record('MOVEMENT_RESTRICTED_COLLABORATOR_ID_BYPASS', 'DENIED_403');
  });

  test('07 restrito: erros da ferramenta independem do crachá (nenhum vazamento por ordem)', async () => {
    for (const [toolId, status] of [
      ['T-03', 409],
      ['T-04', 409],
      ['T-05', 409],
      ['T-99', 404],
    ]) {
      const valid = await callMovement({
        token: users.restricted.token,
        body: restrictedLoan(toolId, 'B-300'),
      });
      const invalid = await callMovement({
        token: users.restricted.token,
        body: restrictedLoan(toolId, 'B-999'),
      });

      assert.equal(valid.status, status, `${toolId} com crachá válido`);
      assert.deepEqual(invalid.body, valid.body, `${toolId}: mesma resposta com crachá inválido`);
      assertNoLeak(valid, toolId);
    }
  });

  test('08 restrito: corpo malformado devolve 400 sem tocar colaboradores', async () => {
    const digest = await collaboratorsDigest();

    for (const body of [
      undefined,
      [],
      { action: 'loan' },
      { action: 'loan', toolId: 'T-08', device },
      { action: 'transfer', toolId: 'T-08', device },
      { ...restrictedLoan('T-08', 'B-300'), isRestricted: true },
      { ...restrictedLoan('T-08', 'B-300'), accessLevel: 'Administrador' },
    ]) {
      const result = await callMovement({ token: users.restricted.token, body });

      assert.equal(result.status, 400);
      assert.equal(result.body.message, 'Dados da movimentação inválidos.');
    }

    assert.equal((await readTool('T-08')).status, 'available');
    assert.equal(await collaboratorsDigest(), digest);
  });

  test('09 restrito: sem PII nos logs do servidor em qualquer falha de crachá', async () => {
    const result = await callMovement({
      token: users.restricted.token,
      body: restrictedLoan('T-08', 'B-200'),
    });

    assert.equal(result.status, 422);
    assert.equal(result.logged, '', 'nenhuma saída de console em falha de crachá');
    record('MOVEMENT_RESTRICTED_NO_PII_LOGS', true);
  });

  test('10 restrito: devolução continua funcionando (sem crachá, sem colaborador)', async () => {
    const result = await callMovement({
      token: users.restricted.token,
      body: { action: 'return', toolId: 'T-03', device },
    });

    assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(result.body.data).sort(), ['action', 'tool']);
    assert.equal(result.body.data.tool.status, 'available');
    assert.equal((await readTool('T-03')).status, 'available');

    const entries = (await historyDocs()).filter((entry) => entry.toolId === 'T-03');

    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, 'in');
    assert.equal(entries[0].collaboratorId, 'c1');
    assert.equal(entries[0].operatorUid, users.restricted.uid);

    const extra = await callMovement({
      token: users.restricted.token,
      body: { action: 'return', toolId: 'T-01', device, collaboratorBadge: 'B-100' },
    });

    assert.equal(extra.status, 400);
    record('MOVEMENT_RESTRICTED_RETURN', 'PASS');
  });

  test('11 restrito: duas retiradas concorrentes da mesma ferramenta -> uma só vence', async () => {
    const [first, second] = await Promise.all([
      callMovement({ token: users.restricted.token, body: restrictedLoan('T-09', 'B-100') }),
      callMovement({ token: users.restricted.token, body: restrictedLoan('T-09', 'B-300') }),
    ]);
    const statuses = [first.status, second.status].sort();

    assert.deepEqual(statuses, [200, 409]);

    const entries = (await historyDocs()).filter((entry) => entry.toolId === 'T-09');

    assert.equal(entries.length, 1);
    assert.equal((await readTool('T-09')).status, 'borrowed');
    record('MOVEMENT_RESTRICTED_ATOMIC', true);
  });

  test('12 admin/padrão/legado: fluxo anterior preservado (collaboratorId e resposta)', async () => {
    for (const [key, toolId, collaboratorId, expectedName] of [
      ['admin', 'T-10', 'c1', 'Colaborador Alfa'],
      ['standard', 'T-11', 'c3', 'Colaborador Gama'],
      ['legacy', 'T-12', 'c6', 'Colaborador Zeta'],
    ]) {
      const result = await callMovement({
        token: users[key].token,
        body: loan(toolId, { collaboratorId }),
      });

      assert.equal(result.status, 200, key);
      assert.equal(result.body.message, 'Empréstimo registrado.');
      assert.deepEqual(Object.keys(result.body.data).sort(), ['action', 'tool'], key);
      assert.deepEqual(
        Object.keys(result.body.data.tool).sort(),
        ['currentCollaboratorId', 'currentUser', 'id', 'lastAction', 'status'],
        key
      );
      assert.equal(result.body.data.tool.currentUser, expectedName);
      assert.equal((await readTool(toolId)).currentCollaboratorId, collaboratorId);

      const returned = await callMovement({
        token: users[key].token,
        body: { action: 'return', toolId, device },
      });

      assert.equal(returned.status, 200, `${key} devolução`);
    }

    record('MOVEMENT_ADMIN_STANDARD_PRESERVED', 'PASS');
  });

  test('13 admin/padrão: mensagens de erro anteriores preservadas', async () => {
    for (const key of ['admin', 'standard']) {
      const inactive = await callMovement({
        token: users[key].token,
        body: loan('T-06', { collaboratorId: 'c2' }),
      });
      const missing = await callMovement({
        token: users[key].token,
        body: loan('T-06', { collaboratorId: 'nao-existe' }),
      });

      assert.equal(inactive.status, 409);
      assert.equal(inactive.body.message, 'Colaborador inativo.');
      assert.equal(missing.status, 404);
      assert.equal(missing.body.message, 'Colaborador não encontrado.');
    }
  });

  test('14 admin/padrão não usam o caminho do crachá nem escolhem o fluxo restrito pelo corpo', async () => {
    for (const key of ['admin', 'standard', 'legacy']) {
      for (const body of [
        restrictedLoan('T-06', 'B-100'),
        loan('T-06', { collaboratorId: 'c1', collaboratorBadge: 'B-100' }),
        loan('T-06', { collaboratorId: 'c1', isRestricted: true }),
        loan('T-06', { collaboratorId: 'c1', accessLevel: 'Usuário Padrão' }),
      ]) {
        const result = await callMovement({ token: users[key].token, body });

        assert.equal(result.status, 400, key);
        assert.equal(result.body.message, 'Dados da movimentação inválidos.');
      }
    }

    assert.equal((await readTool('T-06')).status, 'available');
  });

  test('15 administrador com a flag isRestricted continua administrador (collaboratorId)', async () => {
    const result = await callMovement({
      token: users.adminflag.token,
      body: loan('T-06', { collaboratorId: 'c3' }),
    });

    assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(result.body.data).sort(), ['action', 'tool']);

    const badgeAttempt = await callMovement({
      token: users.adminflag.token,
      body: restrictedLoan('T-07', 'B-300'),
    });

    assert.equal(badgeAttempt.status, 400);
  });

  test('16 nenhuma conexão de rede não local durante os testes', () => {
    const remote = networkAttempts.filter((attempt) => attempt.remote);

    assert.equal(remote.length, 0);
    record('REAL_FIREBASE_CONTACTS', remote.length);
  });
});
