// Integração REAL do handler /api/tools/movement contra o Firebase Emulator Suite
// (Firestore + Auth), sem Firebase remoto e sem Vercel.
//
// Executar:  npm run test:movement:emulator   (firebase emulators:exec)
//
// Cobre o contrato do empréstimo, igual em TODOS os perfis (admin, padrão, restrito): o cliente envia
// o ID da ferramenta, o patrimônio lido e o crachá exato; o servidor confere o patrimônio, resolve
// o crachá (exatamente um colaborador ativo) e grava movimento `out` + `borrowed` na mesma transação.
// collaboratorId e nome do colaborador nunca são aceitos.
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

const { deleteDoc, doc, updateDoc } = await import('firebase/firestore');

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
// Contrato do empréstimo (todos os perfis): ID da ferramenta + patrimônio lido + crachá.
const badgeLoan = (toolId, collaboratorBadge, toolCode = toolId) =>
  loan(toolId, { toolCode, collaboratorBadge });
const GENERIC_DENIAL = {
  success: false,
  message: 'Não foi possível autorizar a retirada. Confira o crachá informado.',
  code: 'LOAN_NOT_AUTHORIZED',
};
const PROFILES = ['admin', 'standard', 'restricted', 'legacy'];

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
  'T-13': tool('T-13', 'Torquimetro', 'available'),
  // Patrimônio com acento e caixa mista: a conferência segue a normalização do Scanner.
  'T-14': tool('FER-Ação-14', 'Paquimetro', 'available'),
});

const FIXED_COLLABORATORS = {
  c1: { name: 'Colaborador Alfa', badge: 'B-100', role: 'Operador', status: 'active' },
  c2: { name: 'Colaborador Beta', badge: 'B-200', role: 'Auxiliar', status: 'inactive' },
  c3: { name: 'Colaborador Gama', badge: 'B-300', role: 'Supervisor', status: 'active' },
  c4: { name: 'Colaborador Delta', badge: 'B-DUP', role: 'Operador', status: 'active' },
  c5: { name: 'Colaborador Epsilon', badge: 'B-DUP', role: 'Operador', status: 'active' },
  c6: { name: 'Colaborador Zeta', badge: 'B-600', status: 'active' },
  c7: { name: 'Colaborador Eta', badge: '', role: 'Operador', status: 'active' },
  // Importado sem status: não é colaborador ativo, então não empresta.
  c8: { name: 'Colaborador Teta', badge: 'B-800', role: 'Operador' },
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
// Fotografia de tudo que um empréstimo recusado não pode alterar.
const operationalDigest = async () =>
  JSON.stringify({
    tools: (await adminDb.collection(`${BASE}/tools`).get()).docs
      .map((document) => [document.id, document.data()])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    history: (await historyDocs()).length,
    collaborators: await collaboratorsDigest(),
  });

const users = {};

// Nada do que segue pode aparecer em respostas de falha nem em logs.
const SENSITIVE = [
  'Colaborador Alfa',
  'Colaborador Beta',
  'Colaborador Delta',
  'Colaborador Teta',
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

async function assertLoanRecorded({ result, toolId, collaboratorId, name, role, operator }) {
  assert.equal(result.status, 200, `${operator}: status`);
  assert.equal(result.body.success, true);
  assert.equal(result.body.message, 'Empréstimo registrado.');
  assert.deepEqual(Object.keys(result.body.data).sort(), ['action', 'collaborator', 'tool']);
  // Somente nome (confirmação/termo) e função (termo): nada de crachá, telefone, ID ou foto.
  assert.deepEqual(result.body.data.collaborator, { name, role });
  assert.deepEqual(
    Object.keys(result.body.data.tool).sort(),
    ['currentCollaboratorId', 'currentUser', 'id', 'lastAction', 'status']
  );
  assert.equal(result.body.data.tool.status, 'borrowed');

  const stored = await readTool(toolId);

  assert.equal(stored.status, 'borrowed');
  assert.equal(stored.currentUser, name);
  assert.equal(stored.currentCollaboratorId, collaboratorId);

  const entries = (await historyDocs()).filter(
    (entry) => entry.toolId === toolId && entry.type === 'out'
  );

  assert.equal(entries.length, 1, `${operator}: um único movimento out`);
  assert.equal(entries[0].collaboratorId, collaboratorId);
  assert.equal(entries[0].user, name);
  assert.equal(entries[0].operatorUid, users[operator].uid);
  // Mesmo instante no movimento e na ferramenta: gravados na mesma transação.
  assert.equal(entries[0].date, stored.lastAction);
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
    const body = badgeLoan('T-01', 'B-100');

    assert.equal((await callMovement({ body })).status, 401);
    assert.equal((await callMovement({ authorization: 'Basic abc', body })).status, 401);
    assert.equal((await callMovement({ token: 'token-invalido', body })).status, 401);
    assert.equal((await callMovement({ method: 'GET', token: users.restricted.token })).status, 405);
    assert.equal((await callMovement({ token: users.inactiverestricted.token, body })).status, 403);
    assert.equal((await readTool('T-01')).status, 'available');
    assert.equal(await collaboratorsDigest(), digestBefore);
    record('MOVEMENT_UNAUTHENTICATED_401', true);
  });

  test('03 restrito + crachá válido: movimento out e borrowed atômicos, resposta mínima', async () => {
    await assertLoanRecorded({
      result: await callMovement({
        token: users.restricted.token,
        body: badgeLoan('T-01', 'B-100'),
      }),
      toolId: 'T-01',
      collaboratorId: 'c1',
      name: 'Colaborador Alfa',
      role: 'Operador',
      operator: 'restricted',
    });
    record('MOVEMENT_RESTRICTED_VALID_BADGE', 'PASS');
    record('MOVEMENT_RESPONSE_FIELDS', 'data.collaborator{name,role}');
  });

  test('04 crachá com espaços nas pontas: aparado e aceito; sem função = string vazia', async () => {
    const result = await callMovement({
      token: users.restricted.token,
      body: badgeLoan('T-02', '  B-600  '),
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data.collaborator, { name: 'Colaborador Zeta', role: '' });
  });

  test('05 todos os perfis: crachá inexistente, duplicado, inativo, sem status, nome no lugar do crachá -> genérico, sem escrita', async () => {
    const attempts = {
      inexistente: badgeLoan('T-06', 'B-999'),
      inativo: badgeLoan('T-06', 'B-200'),
      duplicado: badgeLoan('T-06', 'B-DUP'),
      semStatus: badgeLoan('T-06', 'B-800'),
      caixaDiferente: badgeLoan('T-06', 'b-100'),
      nomeNoLugarDoCracha: badgeLoan('T-06', 'Colaborador Alfa'),
      prefixo: badgeLoan('T-06', 'B-1'),
      vazio: badgeLoan('T-06', ''),
      espacos: badgeLoan('T-06', '   '),
      longo: badgeLoan('T-06', 'B'.repeat(51)),
      numero: badgeLoan('T-06', 100),
      nulo: badgeLoan('T-06', null),
      objeto: badgeLoan('T-06', { $ne: '' }),
    };
    const before = await operationalDigest();

    for (const key of [...PROFILES, 'adminflag']) {
      for (const [label, body] of Object.entries(attempts)) {
        const result = await callMovement({ token: users[key].token, body });

        assert.equal(result.status, 422, `${key}/${label}`);
        assert.deepEqual(result.body, GENERIC_DENIAL, `${key}/${label}`);
        assertNoLeak(result, `${key}/${label}`);
      }
    }

    assert.equal(await operationalDigest(), before);
    record('MOVEMENT_UNKNOWN_BADGE_REJECTED', true);
    record('MOVEMENT_DUPLICATE_BADGE_REJECTED', true);
    record('MOVEMENT_INACTIVE_BADGE_REJECTED', true);
    record('MOVEMENT_NAME_AS_BADGE_REJECTED', true);
    record('MOVEMENT_BADGE_FAILURE_CASES_PER_PROFILE', Object.keys(attempts).length);
  });

  test('06 todos os perfis: collaboratorId (escolha do colaborador pelo cliente) -> 403, sem escrita', async () => {
    const before = await operationalDigest();
    const bypass = [
      loan('T-07', { toolCode: 'T-07', collaboratorId: 'c3' }),
      loan('T-07', { toolCode: 'T-07', collaboratorId: 'c3', collaboratorBadge: 'B-300' }),
      loan('T-07', { collaboratorId: 'c3' }),
      loan('T-07', { toolCode: 'T-07', collaboratorId: 'inexistente' }),
      loan('T-07', { toolCode: 'T-07', collaboratorId: 'c2' }),
    ];

    for (const key of [...PROFILES, 'adminflag']) {
      const results = [];

      for (const body of bypass) {
        const result = await callMovement({ token: users[key].token, body });

        results.push(result);
        assert.equal(result.status, 403, key);
        assert.deepEqual(result.body, {
          success: false,
          message: 'O empréstimo exige o crachá do colaborador.',
        });
        assertNoLeak(result, `${key} bypass`);
      }
    }

    assert.equal(await operationalDigest(), before);
    record('MOVEMENT_COLLABORATOR_ID_BYPASS', 'DENIED_403_ALL_PROFILES');
  });

  test('07 todos os perfis: ferramenta inexistente/emprestada/manutenção/revisão vencida recusadas, independente do crachá', async () => {
    const before = await operationalDigest();

    for (const key of PROFILES) {
      for (const [toolId, status, message] of [
        ['T-03', 409, 'Ferramenta indisponível para empréstimo.'],
        ['T-04', 409, 'Ferramenta indisponível para empréstimo.'],
        ['T-05', 409, 'Ferramenta com manutenção vencida.'],
        ['T-99', 404, 'Ferramenta não encontrada.'],
      ]) {
        const valid = await callMovement({
          token: users[key].token,
          body: badgeLoan(toolId, 'B-300'),
        });
        const invalid = await callMovement({
          token: users[key].token,
          body: badgeLoan(toolId, 'B-999'),
        });

        assert.equal(valid.status, status, `${key} ${toolId} com crachá válido`);
        assert.equal(valid.body.message, message, `${key} ${toolId}`);
        assert.deepEqual(invalid.body, valid.body, `${key} ${toolId}: mesma resposta com crachá inválido`);
        assertNoLeak(valid, `${key} ${toolId}`);
      }
    }

    assert.equal(await operationalDigest(), before);
    record('MOVEMENT_INVALID_TOOL_REJECTED', true);
    record('MOVEMENT_BORROWED_TOOL_REJECTED', true);
    record('MOVEMENT_MAINTENANCE_REJECTED', true);
  });

  test('08 patrimônio divergente do ID da ferramenta -> 422 sem escrita; normalização igual à do Scanner', async () => {
    const before = await operationalDigest();

    for (const key of PROFILES) {
      for (const toolCode of ['T-07', 'T-6', 'T-06X', 'Martelo', 'FER-Ação-14']) {
        const mismatch = await callMovement({
          token: users[key].token,
          body: badgeLoan('T-06', 'B-300', toolCode),
        });

        assert.equal(mismatch.status, 422, `${key} ${toolCode}`);
        assert.deepEqual(mismatch.body, {
          success: false,
          message: 'O patrimônio informado não corresponde à ferramenta.',
        });
      }
    }

    assert.equal(await operationalDigest(), before);

    // Mesma regra de leitura do Scanner: sem acentos e sem diferenciar maiúsculas.
    const normalized = await callMovement({
      token: users.standard.token,
      body: badgeLoan('T-14', 'B-300', '  fer-acao-14 '),
    });

    assert.equal(normalized.status, 200);
    assert.equal((await readTool('T-14')).status, 'borrowed');
    record('MOVEMENT_TOOL_CODE_MISMATCH_REJECTED', true);
  });

  test('09 corpo malformado devolve 400 sem tocar dados', async () => {
    const before = await operationalDigest();

    for (const key of PROFILES) {
      for (const body of [
        undefined,
        [],
        { action: 'loan' },
        { action: 'loan', toolId: 'T-08', device },
        loan('T-08', { collaboratorBadge: 'B-300' }),
        loan('T-08', { toolCode: 'T-08' }),
        badgeLoan('T-08', 'B-300', ''),
        badgeLoan('T-08', 'B-300', 8),
        badgeLoan('T-08', 'B-300', 'X'.repeat(129)),
        { action: 'transfer', toolId: 'T-08', device },
        { ...badgeLoan('T-08', 'B-300'), collaboratorName: 'Colaborador Gama' },
        { ...badgeLoan('T-08', 'B-300'), isRestricted: true },
        { ...badgeLoan('T-08', 'B-300'), accessLevel: 'Administrador' },
        { ...badgeLoan('T-08', 'B-300'), status: 'borrowed' },
      ]) {
        const result = await callMovement({ token: users[key].token, body });

        assert.equal(result.status, 400, `${key} ${JSON.stringify(body)}`);
        assert.equal(result.body.message, 'Dados da movimentação inválidos.');
      }
    }

    assert.equal(await operationalDigest(), before);
  });

  test('10 sem PII nos logs do servidor em qualquer falha de crachá', async () => {
    for (const key of PROFILES) {
      const result = await callMovement({
        token: users[key].token,
        body: badgeLoan('T-08', 'B-200'),
      });

      assert.equal(result.status, 422);
      assert.equal(result.logged, '', `${key}: nenhuma saída de console em falha de crachá`);
    }

    record('MOVEMENT_NO_PII_LOGS', true);
  });

  test('11 devolução continua funcionando (sem crachá, sem colaborador) e recusa campos extras', async () => {
    const result = await callMovement({
      token: users.restricted.token,
      body: { action: 'return', toolId: 'T-03', device },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.message, 'Devolução registrada.');
    assert.deepEqual(Object.keys(result.body.data).sort(), ['action', 'tool']);
    assert.equal(result.body.data.tool.status, 'available');
    assert.equal((await readTool('T-03')).status, 'available');

    const entries = (await historyDocs()).filter((entry) => entry.toolId === 'T-03');

    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, 'in');
    assert.equal(entries[0].collaboratorId, 'c1');
    assert.equal(entries[0].operatorUid, users.restricted.uid);

    for (const extra of [{ collaboratorBadge: 'B-100' }, { toolCode: 'T-01' }]) {
      const rejected = await callMovement({
        token: users.restricted.token,
        body: { action: 'return', toolId: 'T-01', device, ...extra },
      });

      assert.equal(rejected.status, 400);
    }

    const notBorrowed = await callMovement({
      token: users.admin.token,
      body: { action: 'return', toolId: 'T-06', device },
    });

    assert.equal(notBorrowed.status, 409);
    record('MOVEMENT_RETURN', 'PASS');
  });

  test('12 duas retiradas concorrentes da mesma ferramenta -> uma só vence', async () => {
    const [first, second] = await Promise.all([
      callMovement({ token: users.restricted.token, body: badgeLoan('T-09', 'B-100') }),
      callMovement({ token: users.admin.token, body: badgeLoan('T-09', 'B-300') }),
    ]);
    const statuses = [first.status, second.status].sort();

    assert.deepEqual(statuses, [200, 409]);

    const entries = (await historyDocs()).filter((entry) => entry.toolId === 'T-09');

    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, 'out');
    assert.equal((await readTool('T-09')).status, 'borrowed');
    record('MOVEMENT_CONCURRENT_LOAN', '1_SUCCESS_1_CONFLICT');
  });

  test('13 admin/padrão/legado/admin com flag: empréstimo por crachá resolvido no servidor', async () => {
    for (const [key, toolId, badge, collaboratorId, name, role] of [
      ['admin', 'T-10', 'B-100', 'c1', 'Colaborador Alfa', 'Operador'],
      ['standard', 'T-11', 'B-300', 'c3', 'Colaborador Gama', 'Supervisor'],
      ['legacy', 'T-12', 'B-600', 'c6', 'Colaborador Zeta', ''],
      ['adminflag', 'T-13', 'B-300', 'c3', 'Colaborador Gama', 'Supervisor'],
    ]) {
      await assertLoanRecorded({
        result: await callMovement({ token: users[key].token, body: badgeLoan(toolId, badge) }),
        toolId,
        collaboratorId,
        name,
        role,
        operator: key,
      });

      const returned = await callMovement({
        token: users[key].token,
        body: { action: 'return', toolId, device },
      });

      assert.equal(returned.status, 200, `${key} devolução`);
    }

    record('MOVEMENT_ALL_PROFILES_BADGE_SERVER_SIDE', 'PASS');
  });

  test('14 empréstimo oficial -> cliente não devolve nem troca o colaborador direto -> devolução oficial grava in', async () => {
    const toolId = 'T-08';

    await assertLoanRecorded({
      result: await callMovement({ token: users.admin.token, body: badgeLoan(toolId, 'B-100') }),
      toolId,
      collaboratorId: 'c1',
      name: 'Colaborador Alfa',
      role: 'Operador',
      operator: 'admin',
    });

    const loaned = JSON.stringify(await readTool(toolId));
    const historyBefore = (await historyDocs()).length;

    // SDK cliente autenticado como admin: as regras recusam sair de borrowed e trocar o empréstimo.
    for (const [label, fields] of [
      ['borrowed -> available', { status: 'available' }],
      [
        'devolução falsa',
        { status: 'available', currentUser: null, currentCollaboratorId: null },
      ],
      ['borrowed -> maintenance', { status: 'maintenance' }],
      ['trocar colaborador', { currentCollaboratorId: 'c3', currentUser: 'Colaborador Gama' }],
      ['trocar lastAction', { lastAction: new Date().toISOString() }],
    ]) {
      await assert.rejects(
        () => updateDoc(doc(users.admin.db, `${BASE}/tools/${toolId}`), fields),
        (error) => error?.code === 'permission-denied',
        label
      );
    }

    assert.equal(JSON.stringify(await readTool(toolId)), loaned);
    assert.equal((await historyDocs()).length, historyBefore);

    // A devolução oficial (Admin SDK) não depende das regras do cliente.
    const returned = await callMovement({
      token: users.admin.token,
      body: { action: 'return', toolId, device },
    });

    assert.equal(returned.status, 200);
    assert.equal(returned.body.message, 'Devolução registrada.');

    const stored = await readTool(toolId);

    assert.equal(stored.status, 'available');
    assert.equal(stored.currentUser, null);
    assert.equal(stored.currentCollaboratorId, null);

    const entries = (await historyDocs()).filter((entry) => entry.toolId === toolId);

    assert.deepEqual(
      entries.map((entry) => entry.type).sort(),
      ['in', 'out']
    );

    const inEntry = entries.find((entry) => entry.type === 'in');

    assert.equal(inEntry.collaboratorId, 'c1');
    assert.equal(inEntry.user, 'Colaborador Alfa');
    assert.equal(inEntry.date, stored.lastAction);
    record('MOVEMENT_CLIENT_DIRECT_RETURN', 'DENIED');
    record('MOVEMENT_OFFICIAL_RETURN_CREATES_IN', true);
    record('MOVEMENT_ADMIN_SDK_UNAFFECTED_BY_RULES', true);
  });

  test('15 emprestada não é excluída pelo cliente; após a devolução oficial a exclusão volta a ser permitida', async () => {
    const toolId = 'T-06';
    const toolDoc = () => doc(users.admin.db, `${BASE}/tools/${toolId}`);

    await assertLoanRecorded({
      result: await callMovement({ token: users.standard.token, body: badgeLoan(toolId, 'B-300') }),
      toolId,
      collaboratorId: 'c3',
      name: 'Colaborador Gama',
      role: 'Supervisor',
      operator: 'standard',
    });

    const historyBefore = await historyDocs();

    for (const key of ['admin', 'standard', 'restricted']) {
      await assert.rejects(
        () => deleteDoc(doc(users[key].db, `${BASE}/tools/${toolId}`)),
        (error) => error?.code === 'permission-denied',
        `${key}: delete borrowed`
      );
    }

    // Nada mudou: a ferramenta segue emprestada e nenhum movimento (nem `in` falso) foi criado.
    assert.equal((await readTool(toolId)).status, 'borrowed');
    assert.deepEqual(await historyDocs(), historyBefore);

    const returned = await callMovement({
      token: users.restricted.token,
      body: { action: 'return', toolId, device },
    });

    assert.equal(returned.status, 200);
    assert.equal((await readTool(toolId)).status, 'available');

    const entries = (await historyDocs()).filter((entry) => entry.toolId === toolId);

    assert.deepEqual(entries.map((entry) => entry.type).sort(), ['in', 'out']);

    await deleteDoc(toolDoc());
    assert.equal(await readTool(toolId), undefined);
    // O histórico do empréstimo encerrado permanece.
    assert.equal((await historyDocs()).filter((entry) => entry.toolId === toolId).length, 2);
    record('MOVEMENT_DELETE_BORROWED', 'DENIED');
    record('MOVEMENT_RETURN_THEN_DELETE', 'ALLOWED');
  });

  test('16 nenhuma conexão de rede não local durante os testes', () => {
    const remote = networkAttempts.filter((attempt) => attempt.remote);

    assert.equal(remote.length, 0);
    record('REAL_FIREBASE_CONTACTS', remote.length);
  });
});
