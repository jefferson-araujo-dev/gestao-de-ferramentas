// Integração REAL do handler /api/tools/movement contra o Firebase Emulator Suite
// (Firestore + Auth), sem Firebase remoto e sem Vercel.
//
// Executar:  npm run test:movement:emulator   (firebase emulators:exec)
//
// Cobre o contrato unificado do empréstimo (Gate 1-F3.2B): TODOS os perfis (Admin, Padrão,
// Restrito) enviam toolId + toolCode + collaboratorBadge + device; o colaborador é sempre
// resolvido no servidor por crachá, dentro da mesma transação. Nenhum perfil pode enviar
// collaboratorId. O perfil RESTRITO mantém resposta de falha genérica (anti-enumeração); Admin e
// Padrão continuam com mensagens específicas (404/409), já que ambos enxergam a lista de
// colaboradores nas próprias telas do sistema.
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
import { MIN_APP_VERSION } from '../../server/app-version.js';

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
async function callMovement({ method = 'POST', token, authorization, body, appVersion } = {}) {
  const headers = {};
  const header = authorization ?? (token ? `Bearer ${token}` : undefined);

  if (header) {
    headers.authorization = header;
  }
  if (appVersion !== undefined) {
    headers['x-app-version'] = appVersion;
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
  // Gate 1-F4.C3 — devolução: fixtures dedicadas para conferência de crachá.
  'T-13': tool('T-13', 'Chave de Fenda', 'borrowed', {
    currentUser: 'Colaborador Beta',
    currentCollaboratorId: 'c2', // c2 é inativo: cobre a decisão 4 (inativo confere).
    lastAction: '2026-09-01T10:00:00.000Z',
  }),
  'T-14': tool('T-14', 'Talhadeira', 'borrowed', {
    currentUser: 'Não informado',
    currentCollaboratorId: null, // empréstimo antigo sem ID: sempre NÃO CONFERE no fluxo comum.
    lastAction: '2026-09-01T10:00:00.000Z',
  }),
  'T-15': tool('T-15', 'Marreta', 'borrowed', {
    currentUser: 'Colaborador Alfa',
    currentCollaboratorId: 'c1', // reservada para o teste de rate limit da devolução.
    lastAction: '2026-09-01T10:00:00.000Z',
  }),
});

const TOOLS = FIXED_TOOLS();

const FIXED_COLLABORATORS = {
  c1: { name: 'Colaborador Alfa', badge: 'B-100', role: 'Operador', status: 'active' },
  c2: { name: 'Colaborador Beta', badge: 'B-200', role: 'Auxiliar', status: 'inactive' },
  c3: { name: 'Colaborador Gama', badge: 'B-300', role: 'Supervisor', status: 'active' },
  c4: { name: 'Colaborador Delta', badge: 'B-DUP', role: 'Operador', status: 'active' },
  c5: { name: 'Colaborador Epsilon', badge: 'B-DUP', role: 'Operador', status: 'active' },
  c6: { name: 'Colaborador Zeta', badge: 'B-600', status: 'active' },
  c7: { name: 'Colaborador Eta', badge: '', role: 'Operador', status: 'active' },
};

// Contrato único de loan (Admin/Padrão/Restrito): toolId + toolCode + collaboratorBadge + device.
const loan = (toolId, collaboratorBadge, extra = {}) => ({
  action: 'loan',
  toolId,
  toolCode: TOOLS[toolId]?.code,
  collaboratorBadge,
  device,
  ...extra,
});

// Gate 1-F4.C3: devolução comum, com conferência de crachá (Admin/Padrão/Restrito).
const ret = (toolId, collaboratorBadge, extra = {}) => ({
  action: 'return',
  toolId,
  collaboratorBadge,
  device,
  ...extra,
});

// Gate 1-F4.C3: devolução administrativa, sem conferência de crachá (Admin/Padrão, não Restrito).
const retAdmin = (toolId, reason, extra = {}) => ({
  action: 'return_admin',
  toolId,
  device,
  reason,
  ...extra,
});

// O rate limit do oráculo de crachá (empréstimo + devolução) é um único contador por uid; para
// isolar os testes que exercitam o limite dos demais, zera o contador do uid antes de cada um.
const resetBadgeRateLimit = (uid) =>
  adminDb.doc(`${BASE}/badgeRateLimits/${uid}`).delete();

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

// Nada do que segue pode aparecer em respostas de falha nem em logs do perfil restrito. A partir
// do Gate 1-F4.C2, também não pode aparecer em NENHUMA resposta ao Restrito, inclusive sucesso.
// A partir do Gate 1-F4.C3, a resposta de CONFERE/NÃO CONFERE da devolução também não pode conter
// nenhum destes valores, para NENHUM perfil (Admin, Padrão, Restrito).
const SENSITIVE = [
  'Colaborador Alfa',
  'Colaborador Beta',
  'Colaborador Gama',
  'Colaborador Delta',
  'Colaborador Zeta',
  'Operador',
  'Auxiliar',
  'Supervisor',
  'B-100',
  'B-200',
  'B-300',
  'B-DUP',
  'c1',
  'c2',
  'c3',
  'c6',
];

function assertNoLeak(result, label) {
  // Gate 1-F4.C4: o log de versão (cliente sem X-App-Version) leva o uid aleatório do emulator,
  // que pode conter por acaso 'c1', 'c2'... da lista: o uid é mascarado antes da busca.
  const logged = Object.values(users).reduce(
    (text, user) => text.replaceAll(user.uid, '<uid>'),
    result.logged
  );
  const serialized = JSON.stringify(result.body ?? {}) + logged;

  for (const value of SENSITIVE) {
    assert.ok(!serialized.includes(value), `${label}: vazou dado sensível`);
  }
}

// Gate 1-F4.C2: lista fechada de campos por perfil. Restrito não recebe `collaborator` na
// resposta (Divergência 1 de C.2); `data.tool` fica reduzido a `id`/`status`/`lastAction` para
// todos os perfis, porque nenhum cliente lê `currentUser`/`currentCollaboratorId` da resposta.
function assertLoanSuccessShape(result, label, { restricted = false } = {}) {
  assert.equal(result.status, 200, label);
  assert.equal(result.body.success, true, label);
  assert.deepEqual(
    Object.keys(result.body.data).sort(),
    restricted ? ['action', 'tool'] : ['action', 'collaborator', 'tool'],
    label
  );
  assert.deepEqual(
    Object.keys(result.body.data.tool).sort(),
    ['id', 'lastAction', 'status'],
    label
  );
  assert.equal(result.body.data.tool.status, 'borrowed', label);

  if (restricted) {
    assertNoLeak(result, label);
  } else {
    assert.deepEqual(Object.keys(result.body.data.collaborator).sort(), ['name', 'role'], label);
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
    const body = loan('T-01', 'B-100');

    assert.equal((await callMovement({ body })).status, 401);
    assert.equal((await callMovement({ authorization: 'Basic abc', body })).status, 401);
    assert.equal((await callMovement({ token: 'token-invalido', body })).status, 401);
    assert.equal((await callMovement({ method: 'GET', token: users.restricted.token })).status, 405);
    assert.equal((await callMovement({ token: users.inactiverestricted.token, body })).status, 403);
    assert.equal((await readTool('T-01')).status, 'available');
    assert.equal(await collaboratorsDigest(), digestBefore);
    record('MOVEMENT_UNAUTHENTICATED_401', true);
  });

  test('03 [A] admin + crachá válido + toolCode correto: empréstimo registrado', async () => {
    const result = await callMovement({
      token: users.admin.token,
      body: loan('T-10', 'B-100'),
    });

    assertLoanSuccessShape(result, 'admin');
    assert.deepEqual(result.body.data.collaborator, { name: 'Colaborador Alfa', role: 'Operador' });

    const stored = await readTool('T-10');

    assert.equal(stored.status, 'borrowed');
    assert.equal(stored.currentUser, 'Colaborador Alfa');
    assert.equal(stored.currentCollaboratorId, 'c1');

    const entries = (await historyDocs()).filter((entry) => entry.toolId === 'T-10');

    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, 'out');
    assert.equal(entries[0].collaboratorId, 'c1');
    assert.equal(entries[0].operatorUid, users.admin.uid);
    record('MOVEMENT_ADMIN_BADGE_LOAN', 'PASS');
  });

  test('04 [B] padrão + crachá válido + toolCode correto: empréstimo registrado', async () => {
    const result = await callMovement({
      token: users.standard.token,
      body: loan('T-11', 'B-300'),
    });

    assertLoanSuccessShape(result, 'standard');
    assert.deepEqual(result.body.data.collaborator, { name: 'Colaborador Gama', role: 'Supervisor' });
    assert.equal((await readTool('T-11')).currentCollaboratorId, 'c3');
    record('MOVEMENT_STANDARD_BADGE_LOAN', 'PASS');
  });

  test('05 [C][K] restrito + crachá válido + toolCode correto: resposta mínima', async () => {
    const result = await callMovement({
      token: users.restricted.token,
      body: loan('T-01', 'B-100'),
    });

    assertLoanSuccessShape(result, 'restricted', { restricted: true });

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
    record('MOVEMENT_RESTRICTED_RESPONSE_FIELDS', 'data.tool{id,lastAction,status}');
  });

  test('06 restrito + crachá com espaços nas pontas: aparado e aceito; sem função = string vazia', async () => {
    const result = await callMovement({
      token: users.restricted.token,
      body: loan('T-02', '  B-600  '),
    });

    assertLoanSuccessShape(result, 'restricted trim', { restricted: true });

    const stored = await readTool('T-02');

    assert.equal(stored.currentUser, 'Colaborador Zeta');
  });

  test('07 [D] collaboratorId em loan é rejeitado (400) para todos os perfis', async () => {
    for (const key of ['admin', 'standard', 'restricted', 'legacy']) {
      const withId = await callMovement({
        token: users[key].token,
        body: { action: 'loan', toolId: 'T-06', toolCode: 'T-06', collaboratorId: 'c1', device },
      });

      assert.equal(withId.status, 400, key);
      assert.equal(withId.body.message, 'Dados da movimentação inválidos.', key);

      const withBoth = await callMovement({
        token: users[key].token,
        body: {
          action: 'loan',
          toolId: 'T-06',
          toolCode: 'T-06',
          collaboratorId: 'c1',
          collaboratorBadge: 'B-100',
          device,
        },
      });

      assert.equal(withBoth.status, 400, `${key} com ambos`);
    }

    assert.equal((await readTool('T-06')).status, 'available');
    record('MOVEMENT_COLLABORATOR_ID_REJECTED_ALL_PROFILES', true);
  });

  test('08 [E] nome do colaborador no lugar do crachá é rejeitado (não substitui o badge)', async () => {
    const admin = await callMovement({
      token: users.admin.token,
      body: loan('T-06', 'Colaborador Alfa'),
    });
    const restricted = await callMovement({
      token: users.restricted.token,
      body: loan('T-06', 'Colaborador Alfa'),
    });

    assert.equal(admin.status, 404, 'admin: nome não é um crachá válido');
    assert.equal(admin.body.message, 'Colaborador não encontrado.');
    assert.equal(restricted.status, 422, 'restrito: mesma resposta genérica de crachá inválido');
    assert.equal(restricted.body.code, 'LOAN_NOT_AUTHORIZED');
    assert.equal((await readTool('T-06')).status, 'available');
    record('MOVEMENT_NAME_DOES_NOT_SUBSTITUTE_BADGE', true);
  });

  test('09 [F] crachá inexistente é rejeitado (específico para admin/padrão, genérico para restrito)', async () => {
    const admin = await callMovement({ token: users.admin.token, body: loan('T-06', 'B-999') });
    const standard = await callMovement({ token: users.standard.token, body: loan('T-06', 'B-999') });
    const restricted = await callMovement({ token: users.restricted.token, body: loan('T-06', 'B-999') });

    assert.equal(admin.status, 404);
    assert.equal(admin.body.message, 'Colaborador não encontrado.');
    assert.equal(standard.status, 404);
    assert.equal(restricted.status, 422);
    assert.equal(restricted.body.code, 'LOAN_NOT_AUTHORIZED');
    assert.equal((await readTool('T-06')).status, 'available');
    record('MOVEMENT_UNKNOWN_BADGE_REJECTED', true);
  });

  test('10 [G] crachá de colaborador inativo é rejeitado', async () => {
    const admin = await callMovement({ token: users.admin.token, body: loan('T-06', 'B-200') });
    const restricted = await callMovement({ token: users.restricted.token, body: loan('T-06', 'B-200') });

    assert.equal(admin.status, 409);
    assert.equal(admin.body.message, 'Colaborador inativo.');
    assert.equal(restricted.status, 422);
    assert.equal(restricted.body.code, 'LOAN_NOT_AUTHORIZED');
    assert.equal((await readTool('T-06')).status, 'available');
    record('MOVEMENT_INACTIVE_BADGE_REJECTED', true);
  });

  test('11 [H] crachá duplicado falha fechado (específico para admin/padrão, genérico para restrito)', async () => {
    const admin = await callMovement({ token: users.admin.token, body: loan('T-06', 'B-DUP') });
    const restricted = await callMovement({ token: users.restricted.token, body: loan('T-06', 'B-DUP') });

    assert.equal(admin.status, 409);
    assert.equal(admin.body.message, 'Crachá duplicado. Contate o administrador.');
    assert.equal(restricted.status, 422);
    assert.equal(restricted.body.code, 'LOAN_NOT_AUTHORIZED');
    assert.equal((await readTool('T-06')).status, 'available');
    record('MOVEMENT_DUPLICATE_BADGE_FAIL_CLOSED', true);
  });

  test('12 [I] toolId inexistente é rejeitado (404), independente do crachá', async () => {
    const valid = await callMovement({
      token: users.admin.token,
      body: { action: 'loan', toolId: 'T-99', toolCode: 'T-99', collaboratorBadge: 'B-100', device },
    });
    const invalid = await callMovement({
      token: users.admin.token,
      body: { action: 'loan', toolId: 'T-99', toolCode: 'T-99', collaboratorBadge: 'B-999', device },
    });

    assert.equal(valid.status, 404);
    assert.equal(valid.body.message, 'Ferramenta não encontrada.');
    assert.deepEqual(invalid.body, valid.body);
    record('MOVEMENT_UNKNOWN_TOOL_REJECTED', true);
  });

  test('13 [J] toolCode incorreto (não corresponde ao code armazenado) é rejeitado', async () => {
    const result = await callMovement({
      token: users.admin.token,
      body: { action: 'loan', toolId: 'T-06', toolCode: 'CODIGO-ERRADO', collaboratorBadge: 'B-100', device },
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.message, 'Patrimônio informado não corresponde à ferramenta.');
    assert.equal((await readTool('T-06')).status, 'available');
    record('MOVEMENT_WRONG_TOOL_CODE_REJECTED', true);
  });

  test('14 [L][M][N] ferramenta já emprestada, em manutenção ou com revisão vencida: rejeitadas, independente do crachá', async () => {
    for (const [toolId, status] of [
      ['T-03', 409], // já emprestada (L)
      ['T-04', 409], // manutenção (M)
      ['T-05', 409], // revisão vencida (N)
      ['T-99', 404],
    ]) {
      // T-99 não existe em TOOLS: informamos toolCode explicitamente para passar da validação de
      // formato e exercitar de fato o caminho "ferramenta não encontrada" (404), não um 400 de
      // corpo malformado por toolCode ausente.
      const validBody = TOOLS[toolId]
        ? loan(toolId, 'B-300')
        : { action: 'loan', toolId, toolCode: toolId, collaboratorBadge: 'B-300', device };
      const invalidBody = TOOLS[toolId]
        ? loan(toolId, 'B-999')
        : { action: 'loan', toolId, toolCode: toolId, collaboratorBadge: 'B-999', device };
      const valid = await callMovement({ token: users.restricted.token, body: validBody });
      const invalid = await callMovement({ token: users.restricted.token, body: invalidBody });

      assert.equal(valid.status, status, `${toolId} com crachá válido`);
      assert.deepEqual(invalid.body, valid.body, `${toolId}: mesma resposta com crachá inválido`);
      assertNoLeak(valid, toolId);
    }
  });

  test('15 [O] duas retiradas concorrentes da mesma ferramenta -> uma só vence (atômico)', async () => {
    const [first, second] = await Promise.all([
      callMovement({ token: users.restricted.token, body: loan('T-09', 'B-100') }),
      callMovement({ token: users.admin.token, body: loan('T-09', 'B-300') }),
    ]);
    const statuses = [first.status, second.status].sort();

    assert.deepEqual(statuses, [200, 409]);

    const entries = (await historyDocs()).filter((entry) => entry.toolId === 'T-09');

    assert.equal(entries.length, 1);
    assert.equal((await readTool('T-09')).status, 'borrowed');
    record('MOVEMENT_CONCURRENCY_ATOMIC', true);
  });

  test('16 [R] devolução exige conferência de crachá (contrato reescrito no Gate 1-F4.C3)', async () => {
    // Sem crachá: contrato antigo (sem collaboratorBadge) agora é rejeitado com 400, para todos os
    // perfis — o teste 16 original ("devolução continua funcionando... sem crachá") é substituído
    // por este, conforme a especificação da seção E.5.
    const semCracha = await callMovement({
      token: users.restricted.token,
      body: { action: 'return', toolId: 'T-01', device },
    });

    assert.equal(semCracha.status, 400);
    assert.equal((await readTool('T-01')).status, 'borrowed');

    // Com crachá correto: CONFERE, devolução concluída.
    const result = await callMovement({
      token: users.restricted.token,
      body: ret('T-01', 'B-100'),
    });

    assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(result.body.data).sort(), ['action', 'tool']);
    assert.deepEqual(Object.keys(result.body.data.tool).sort(), ['id', 'lastAction', 'status']);
    assert.equal(result.body.data.tool.status, 'available');
    assertNoLeak(result, 'restricted return');
    assert.equal((await readTool('T-01')).status, 'available');

    // T-01 já tem um registro "out" do empréstimo (teste 05): filtra especificamente o "in" desta
    // devolução, sem presumir ordem de retorno da consulta.
    const entries = (await historyDocs()).filter(
      (entry) => entry.toolId === 'T-01' && entry.type === 'in'
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0].collaboratorId, 'c1');
    assert.equal(entries[0].operatorUid, users.restricted.uid);
    assert.equal(entries[0].returnMethod, 'badge_verified');
    record('MOVEMENT_RETURN_CONTRACT_REWRITTEN', 'PASS');
  });

  test('17 restrito: falhas de crachá são genéricas e idênticas (sem PII, sem escrita)', async () => {
    await resetBadgeRateLimit(users.restricted.uid);
    const digestBefore = await collaboratorsDigest();
    const toolsBefore = JSON.stringify(await readTool('T-06'));
    const historyBefore = (await historyDocs()).length;
    const attempts = {
      inexistente: loan('T-06', 'B-999'),
      inativo: loan('T-06', 'B-200'),
      duplicado: loan('T-06', 'B-DUP'),
      caixaDiferente: loan('T-06', 'b-100'),
      nomeNoLugarDoCracha: loan('T-06', 'Colaborador Alfa'),
      prefixo: loan('T-06', 'B-1'),
      vazio: loan('T-06', ''),
      espacos: loan('T-06', '   '),
      longo: loan('T-06', 'B'.repeat(51)),
      numero: loan('T-06', undefined, { collaboratorBadge: 100 }),
      nulo: loan('T-06', undefined, { collaboratorBadge: null }),
      objeto: loan('T-06', undefined, { collaboratorBadge: { $ne: '' } }),
    };
    const results = {};

    // Cada tentativa reseta o contador do rate limit antes de rodar: este teste cobre a
    // genericidade/ausência de vazamento entre CAUSAS diferentes de falha, não o rate limit em si
    // (coberto em testes dedicados) — sem o reset, a 6ª+ tentativa devolveria 429, não 422.
    for (const [label, body] of Object.entries(attempts)) {
      await resetBadgeRateLimit(users.restricted.uid);
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

  test('18 restrito: corpo malformado devolve 400 sem tocar colaboradores', async () => {
    const digest = await collaboratorsDigest();

    for (const body of [
      undefined,
      [],
      { action: 'loan' },
      { action: 'loan', toolId: 'T-08', device },
      { action: 'loan', toolId: 'T-08', toolCode: 'T-08', device },
      { action: 'transfer', toolId: 'T-08', toolCode: 'T-08', collaboratorBadge: 'B-300', device },
      { ...loan('T-08', 'B-300'), isRestricted: true },
      { ...loan('T-08', 'B-300'), accessLevel: 'Administrador' },
    ]) {
      const result = await callMovement({ token: users.restricted.token, body });

      assert.equal(result.status, 400);
      assert.equal(result.body.message, 'Dados da movimentação inválidos.');
    }

    assert.equal((await readTool('T-08')).status, 'available');
    assert.equal(await collaboratorsDigest(), digest);
  });

  test('19 restrito: sem PII nos logs do servidor em qualquer falha de crachá', async () => {
    // Cliente atual (envia X-App-Version >= mínima): nenhuma saída de console.
    const result = await callMovement({
      token: users.restricted.token,
      body: loan('T-08', 'B-200'),
      appVersion: MIN_APP_VERSION,
    });

    assert.equal(result.status, 422);
    assert.equal(result.logged, '', 'nenhuma saída de console em falha de crachá');

    // Gate 1-F4.C4 (Decisão 7/D4): cliente sem o cabeçalho (anterior ao C4) gera SÓ o evento de
    // versão, com uid de autenticação e nenhum dado do colaborador nem do operador.
    const legacyClient = await callMovement({
      token: users.restricted.token,
      body: loan('T-08', 'B-200'),
    });

    assert.equal(legacyClient.status, 422);
    assert.deepEqual(legacyClient.body, result.body);
    assert.deepEqual(JSON.parse(legacyClient.logged), {
      event: 'client_app_version_outdated',
      endpoint: 'tools/movement',
      uid: users.restricted.uid,
      reason: 'absent',
      appVersion: null,
      minAppVersion: MIN_APP_VERSION,
    });
    assertNoLeak(legacyClient, 'log de versão na falha de crachá');
    assert.ok(!legacyClient.logged.includes(users.restricted.email));
    record('MOVEMENT_RESTRICTED_NO_PII_LOGS', true);
  });

  test('20 legado (sem isRestricted) segue o contrato padrão (crachá, sem oráculo restrito)', async () => {
    const result = await callMovement({
      token: users.legacy.token,
      body: loan('T-12', 'B-600'),
    });

    assertLoanSuccessShape(result, 'legacy');
    // Colaborador sem `role` cadastrado: cobertura da resolução role-ausente -> string vazia,
    // antes verificada via perfil Restrito (teste 06), que deixou de receber `collaborator`.
    assert.deepEqual(result.body.data.collaborator, { name: 'Colaborador Zeta', role: '' });
    assert.equal((await readTool('T-12')).currentCollaboratorId, 'c6');
    record('MOVEMENT_LEGACY_PROFILE_PRESERVED', 'PASS');
  });

  test('21 administrador com a flag isRestricted continua administrador (mensagens específicas)', async () => {
    const result = await callMovement({
      token: users.adminflag.token,
      body: loan('T-07', 'B-300'),
    });

    assertLoanSuccessShape(result, 'adminflag');

    const badgeAttempt = await callMovement({
      token: users.adminflag.token,
      body: loan('T-06', 'B-999'),
    });

    // Mesma mensagem específica de admin/padrão, não a genérica do restrito.
    assert.equal(badgeAttempt.status, 404);
    assert.equal(badgeAttempt.body.message, 'Colaborador não encontrado.');
  });

  // ------------------------------------------------------------------------------------------
  // Gate 1-F4.C3 — conferência de crachá na devolução, devolução administrativa, rate limit.
  // ------------------------------------------------------------------------------------------

  test('22 [Gate 1-F4.C3] devolução CONFERE para Admin e Padrão (Restrito já coberto no teste 16)', async () => {
    const admin = await callMovement({ token: users.admin.token, body: ret('T-10', 'B-100') });

    assert.equal(admin.status, 200);
    assert.deepEqual(Object.keys(admin.body.data).sort(), ['action', 'tool']);
    assert.equal(admin.body.data.tool.status, 'available');
    assertNoLeak(admin, 'admin return confere');
    assert.equal((await readTool('T-10')).status, 'available');

    const standard = await callMovement({ token: users.standard.token, body: ret('T-11', 'B-300') });

    assert.equal(standard.status, 200);
    assert.equal(standard.body.data.tool.status, 'available');
    assertNoLeak(standard, 'standard return confere');
    assert.equal((await readTool('T-11')).status, 'available');

    // T-10/T-11 já têm um registro "out" dos empréstimos (testes 03/04): filtra o "in" desta
    // devolução, sem presumir ordem de retorno da consulta.
    const entriesAdmin = (await historyDocs()).filter(
      (entry) => entry.toolId === 'T-10' && entry.type === 'in'
    );
    const entriesStandard = (await historyDocs()).filter(
      (entry) => entry.toolId === 'T-11' && entry.type === 'in'
    );

    assert.equal(entriesAdmin[0].returnMethod, 'badge_verified');
    assert.equal(entriesAdmin[0].collaboratorId, 'c1');
    assert.equal(entriesStandard[0].returnMethod, 'badge_verified');
    assert.equal(entriesStandard[0].collaboratorId, 'c3');
    record('MOVEMENT_RETURN_CONFIRMED_ALL_PROFILES', 'PASS');
  });

  test('23 [Gate 1-F4.C3] devolução NÃO CONFERE para os três perfis: mesma resposta genérica, ferramenta permanece emprestada', async () => {
    const restricted = await callMovement({
      token: users.restricted.token,
      body: ret('T-02', 'B-100'), // crachá de outra pessoa
    });
    const admin = await callMovement({
      token: users.admin.token,
      body: ret('T-07', 'B-999'), // crachá inexistente
    });
    const standard = await callMovement({
      token: users.standard.token,
      body: ret('T-12', 'B-300'), // crachá de outra pessoa
    });

    for (const [result, label, toolId] of [
      [restricted, 'restricted', 'T-02'],
      [admin, 'admin', 'T-07'],
      [standard, 'standard', 'T-12'],
    ]) {
      assert.equal(result.status, 422, label);
      assert.equal(result.body.success, false, label);
      assert.equal(result.body.code, 'RETURN_NOT_CONFIRMED', label);
      assert.equal(result.body.message, 'Crachá não confere com o registro do empréstimo.', label);
      assert.deepEqual(Object.keys(result.body).sort(), ['code', 'message', 'success'], label);
      assertNoLeak(result, label);
      assert.equal((await readTool(toolId)).status, 'borrowed', label);
    }

    // As três respostas são idênticas byte a byte: nenhum perfil recebe mensagem diferenciada.
    assert.deepEqual(restricted.body, admin.body);
    assert.deepEqual(restricted.body, standard.body);
    record('MOVEMENT_RETURN_NOT_CONFIRMED_ALL_PROFILES_IDENTICAL', true);
  });

  test('24 [Gate 1-F4.C3] devolução CONFERE com colaborador cadastrado como inativo (decisão 4)', async () => {
    const result = await callMovement({ token: users.admin.token, body: ret('T-13', 'B-200') });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.tool.status, 'available');
    assertNoLeak(result, 'return inactive collaborator confere');
    assert.equal((await readTool('T-13')).status, 'available');

    const entries = (await historyDocs()).filter((entry) => entry.toolId === 'T-13');

    assert.equal(entries[0].collaboratorId, 'c2');
    assert.equal(entries[0].returnMethod, 'badge_verified');
    record('MOVEMENT_RETURN_INACTIVE_COLLABORATOR_CONFIRMED', 'PASS');
  });

  test('25 [Gate 1-F4.C3] empréstimo sem currentCollaboratorId: fluxo comum de devolução sempre NÃO CONFERE', async () => {
    const result = await callMovement({ token: users.restricted.token, body: ret('T-14', 'B-100') });

    assert.equal(result.status, 422);
    assert.equal(result.body.code, 'RETURN_NOT_CONFIRMED');
    assertNoLeak(result, 'return legacy no id');
    assert.equal((await readTool('T-14')).status, 'borrowed');
    record('MOVEMENT_RETURN_LEGACY_NO_ID_ALWAYS_NOT_CONFIRMED', 'PASS');
  });

  test('26 [Gate 1-F4.C3] devolução administrativa: Admin e Padrão concluem sem conferência de crachá; reason obrigatório', async () => {
    // Admin resolve o empréstimo antigo sem currentCollaboratorId (não confirmável pelo fluxo comum
    // — teste 25) pela via administrativa.
    const admin = await callMovement({
      token: users.admin.token,
      body: retAdmin('T-14', 'Colaborador não está presente; devolução por terceiro autorizado.'),
    });

    assert.equal(admin.status, 200);
    assert.equal(admin.body.data.tool.status, 'available');
    assertNoLeak(admin, 'admin return administrativo');
    assert.equal((await readTool('T-14')).status, 'available');

    const adminEntries = (await historyDocs()).filter(
      (entry) => entry.toolId === 'T-14' && entry.type === 'in'
    );

    assert.equal(adminEntries[0].returnMethod, 'administrative');
    assert.equal(
      adminEntries[0].reason,
      'Colaborador não está presente; devolução por terceiro autorizado.'
    );
    assert.equal(adminEntries[0].collaboratorId, null);
    assert.equal(adminEntries[0].operatorUid, users.admin.uid);

    // Padrão: mesmo caminho, disponível (decisão do Cowork) — ferramenta ainda emprestada após a
    // tentativa de NÃO CONFERE do teste 23.
    const standard = await callMovement({
      token: users.standard.token,
      body: retAdmin('T-07', 'Ferramenta devolvida por outro colaborador do setor.'),
    });

    assert.equal(standard.status, 200);
    assert.equal(standard.body.data.tool.status, 'available');
    assertNoLeak(standard, 'standard return administrativo');
    assert.equal((await readTool('T-07')).status, 'available');

    // T-07 já tem um registro "out" do empréstimo (teste 21): filtra o "in" desta devolução.
    const standardEntries = (await historyDocs()).filter(
      (entry) => entry.toolId === 'T-07' && entry.type === 'in'
    );

    assert.equal(standardEntries[0].returnMethod, 'administrative');
    assert.equal(standardEntries[0].collaboratorId, 'c3');
    assert.equal(standardEntries[0].operatorUid, users.standard.uid);

    // Sem reason (curto demais): 400, nenhuma leitura de ferramenta chega a ocorrer com sucesso.
    const semReason = await callMovement({
      token: users.admin.token,
      body: retAdmin('T-08', 'curto'),
    });

    assert.equal(semReason.status, 400);
    assert.equal((await readTool('T-08')).status, 'available');
    record('MOVEMENT_RETURN_ADMINISTRATIVE_ADMIN_AND_STANDARD', 'PASS');
  });

  test('27 [Gate 1-F4.C3] devolução administrativa é negada ao Restrito antes de qualquer leitura', async () => {
    const before = await readTool('T-08');
    const result = await callMovement({
      token: users.restricted.token,
      body: retAdmin('T-08', 'Motivo de teste com mais de dez caracteres.'),
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.message, 'Acesso não permitido para este perfil.');
    assertNoLeak(result, 'restricted return administrativo negado');
    assert.deepEqual(await readTool('T-08'), before);
    record('MOVEMENT_RETURN_ADMINISTRATIVE_DENIED_RESTRICTED', 'PASS');
  });

  test('28 [Gate 1-F4.C3] rate limit do oráculo de crachá no empréstimo: bloqueia após exceder o limite', async () => {
    // BADGE_RATE_LIMIT_MAX_ATTEMPTS em api/tools/movement.js: manter em sincronia.
    const MAX_ATTEMPTS = 5;

    await resetBadgeRateLimit(users.standard.uid);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const result = await callMovement({ token: users.standard.token, body: loan('T-06', 'B-999') });

      assert.equal(result.status, 404, `tentativa ${attempt}`);
    }

    const blocked = await callMovement({ token: users.standard.token, body: loan('T-06', 'B-999') });

    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.code, 'BADGE_RATE_LIMITED');
    assertNoLeak(blocked, 'loan rate limited');
    assert.equal((await readTool('T-06')).status, 'available');
    record('MOVEMENT_BADGE_RATE_LIMIT_LOAN_BLOCKS', 'PASS');
  });

  test('29 [Gate 1-F4.C3] rate limit do oráculo de crachá é compartilhado entre empréstimo e devolução', async () => {
    await resetBadgeRateLimit(users.standard.uid);

    // 2 falhas no empréstimo + 3 falhas na devolução = 5 falhas acumuladas no mesmo contador.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await callMovement({ token: users.standard.token, body: loan('T-06', 'B-999') });

      assert.equal(result.status, 404, `empréstimo ${attempt}`);
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await callMovement({ token: users.standard.token, body: ret('T-15', 'B-999') });

      assert.equal(result.status, 422, `devolução ${attempt}`);
    }

    const blocked = await callMovement({ token: users.standard.token, body: ret('T-15', 'B-999') });

    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.code, 'BADGE_RATE_LIMITED');
    assertNoLeak(blocked, 'return rate limited (shared counter)');
    assert.equal((await readTool('T-06')).status, 'available');
    assert.equal((await readTool('T-15')).status, 'borrowed');
    record('MOVEMENT_BADGE_RATE_LIMIT_SHARED_LOAN_AND_RETURN', 'PASS');
  });

  test('29.1 [Gate 1-F4.C4] versão mínima: só registra ausente/inválida/desatualizada; nunca altera status ou corpo', async () => {
    const cases = [
      [undefined, 'absent'],
      ['abc', 'invalid'],
      ['0.0.1', 'outdated'],
      [MIN_APP_VERSION, null],
    ];
    const requests = [
      // Restrito na devolução administrativa: 403 antes de qualquer leitura (invariante do C3).
      [users.restricted, retAdmin('T-08', 'Motivo de teste com mais de dez caracteres.')],
      // Corpo inválido: 400.
      [users.standard, { action: 'loan' }],
    ];

    for (const [user, body] of requests) {
      const reference = await callMovement({ token: user.token, body, appVersion: MIN_APP_VERSION });

      for (const [appVersion, reason] of cases) {
        const label = `${body.action} ${JSON.stringify(appVersion)}`;
        const result = await callMovement({ token: user.token, body, appVersion });

        assert.equal(result.status, reference.status, label);
        assert.deepEqual(result.body, reference.body, label);
        assertNoLeak(result, label);

        const lines = result.logged
          .split('\n')
          .filter((line) => line.includes('client_app_version'));

        if (reason) {
          assert.equal(lines.length, 1, label);
          assert.deepEqual(JSON.parse(lines[0]), {
            event: 'client_app_version_outdated',
            endpoint: 'tools/movement',
            uid: user.uid,
            reason,
            appVersion: appVersion ?? null,
            minAppVersion: MIN_APP_VERSION,
          });
          assert.ok(!lines[0].includes(user.email), label);
        } else {
          assert.deepEqual(lines, [], label);
        }
      }
    }

    // Cliente sem cabeçalho (anterior ao C4) continua emprestando normalmente.
    await resetBadgeRateLimit(users.standard.uid);
    assertLoanSuccessShape(
      await callMovement({ token: users.standard.token, body: loan('T-08', 'B-300') }),
      'loan sem X-App-Version'
    );
    record('MOVEMENT_APP_VERSION_OBSERVE_ONLY', 'PASS');
  });

  test('30 nenhuma conexão de rede não local durante os testes', () => {
    const remote = networkAttempts.filter((attempt) => attempt.remote);

    assert.equal(remote.length, 0);
    record('REAL_FIREBASE_CONTACTS', remote.length);
  });
});
