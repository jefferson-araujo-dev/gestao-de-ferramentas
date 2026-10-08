// Autorização dos endpoints administrativos e de sessão contra o Firebase Emulator Suite
// (Firestore + Auth), sem Firebase remoto e sem Vercel.
//
// Executar:  npm run test:authz:emulator   (firebase emulators:exec)
//
// Gate ENV-AUTHZ-TESTS-1: users/create, users/delete, users/status, users/update,
// session/last-login e tools/maintenance. Para cada um: sem token, cabeçalho/token inválido,
// usuário inativo, papel insuficiente (Padrão e Restrito), papel forjado no corpo e sucesso
// mínimo do papel autorizado. Toda negação confere que Firestore (users, tools, history) e Auth
// ficaram exatamente iguais.
//
// O guard fail-closed de ambiente vem de tests/integration/support/emulator.mjs (importado
// primeiro): sem FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST locais o arquivo nem
// carrega, e conexões não locais são bloqueadas e registradas em `networkAttempts`.
//
// Proteção do último admin: só o comportamento já presente no código é afirmado (bloqueio de
// excluir, desativar ou rebaixar a própria conta). As lacunas do review de endpoints (F4, F5)
// ficam como test.todo, nunca como teste que as aprova.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  BASE,
  adminAuth,
  adminDb,
  closeEmulatorClients,
  createUserFixture,
  networkAttempts,
  signIn,
} from './support/emulator.mjs';

const createApi = (await import('../../api/users/create.js')).default;
const deleteApi = (await import('../../api/users/delete.js')).default;
const userStatusApi = (await import('../../api/users/status.js')).default;
const updateApi = (await import('../../api/users/update.js')).default;
const lastLoginApi = (await import('../../api/session/last-login.js')).default;
const maintenanceApi = (await import('../../api/tools/maintenance.js')).default;

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

async function callHandler(api, { method = 'POST', token, authorization, body } = {}) {
  const headers = {};
  const header = authorization ?? (token ? `Bearer ${token}` : undefined);

  if (header) {
    headers.authorization = header;
  }

  const res = createResponse();
  const originals = {};

  // Os handlers registram erros 500 no console; aqui só o status e o corpo interessam.
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    originals[level] = console[level];
    console[level] = () => {};
  }

  try {
    await api({ method, headers, body }, res);
  } finally {
    Object.assign(console, originals);
  }

  return { status: res.statusCode, body: res.body };
}

// Estado completo que um endpoint negado não pode tocar.
async function snapshotState() {
  const firestore = {};

  for (const name of ['users', 'tools', 'history']) {
    const { docs } = await adminDb.collection(`${BASE}/${name}`).get();

    firestore[name] = Object.fromEntries(docs.map((document) => [document.id, document.data()]));
  }

  const auth = (await adminAuth.listUsers(1000)).users
    .map(({ uid, email, displayName, disabled }) => ({
      uid,
      email,
      displayName: displayName ?? null,
      disabled,
    }))
    .sort((a, b) => a.uid.localeCompare(b.uid));

  return { firestore, auth };
}

async function expectDenied(api, request, status, message, label) {
  const initial = await snapshotState();
  const result = await callHandler(api, request);

  assert.equal(result.status, status, label);
  assert.deepEqual(result.body, { success: false, message }, label);
  assert.deepEqual(await snapshotState(), initial, `${label}: efeito colateral`);
}

const MISSING_TOKEN = 'Token de autenticação ausente.';
const BAD_HEADER = 'Cabeçalho de autenticação inválido.';
const BAD_TOKEN = 'Token de autenticação inválido ou expirado.';
const INACTIVE = 'Usuário inativo.';
const NOT_ADMIN = 'Acesso permitido somente para administradores.';

// Papel forjado no corpo: o servidor só pode usar o perfil do Firestore do dono do token.
const FORGED_ROLE = {
  accessLevel: 'Administrador',
  role: 'Administrador',
  isAdmin: true,
  isRestricted: false,
  status: 'Ativo',
};

const users = {};
const TOOL_ID = 'authz-tool-1';

const ENDPOINTS = [
  {
    name: 'users/create',
    api: createApi,
    method: 'POST',
    adminOnly: true,
    body: () => ({
      name: 'Negado Authz',
      email: 'negado.authz@emulator.local',
      department: 'Teste',
      accessLevel: 'Administrador',
    }),
  },
  {
    name: 'users/delete',
    api: deleteApi,
    method: 'POST',
    adminOnly: true,
    body: () => ({ uid: users.targetDelete.uid }),
  },
  {
    name: 'users/status',
    api: userStatusApi,
    method: 'POST',
    adminOnly: true,
    body: () => ({ uid: users.targetStatus.uid, status: 'Inativo' }),
  },
  {
    // Autopromoção: o Padrão tenta virar Administrador pelo próprio cadastro.
    name: 'users/update',
    api: updateApi,
    method: 'PATCH',
    adminOnly: true,
    body: () => ({
      uid: users.standard.uid,
      name: 'Usuario standard',
      email: users.standard.email,
      department: 'Teste',
      accessLevel: 'Administrador',
    }),
  },
  {
    name: 'session/last-login',
    api: lastLoginApi,
    method: 'POST',
    adminOnly: false,
    body: () => ({ device: 'Navegador de Teste' }),
  },
  {
    name: 'tools/maintenance',
    api: maintenanceApi,
    method: 'POST',
    adminOnly: true,
    body: () => ({
      toolId: TOOL_ID,
      performedAt: '2025-01-15',
      nextMaintenance: '2099-01-15',
      notes: 'Teste authz',
      device: 'Navegador de Teste',
    }),
  },
];

function deniedCases(endpoint) {
  const cases = [
    ['sem token', () => ({}), 401, MISSING_TOKEN],
    ['cabeçalho não Bearer', () => ({ authorization: 'Basic abc' }), 401, BAD_HEADER],
    ['token inválido', () => ({ token: 'token-invalido' }), 401, BAD_TOKEN],
    // Administrador inativo: o status é checado antes do papel.
    ['usuário inativo', () => ({ token: users.inactiveAdmin.token }), 403, INACTIVE],
  ];

  if (endpoint.adminOnly) {
    cases.push(
      ['papel Padrão', () => ({ token: users.standard.token }), 403, NOT_ADMIN],
      ['papel Restrito', () => ({ token: users.restricted.token }), 403, NOT_ADMIN],
      [
        'papel forjado no corpo (Padrão)',
        () => ({ token: users.standard.token, body: { ...endpoint.body(), ...FORGED_ROLE } }),
        403,
        NOT_ADMIN,
      ],
      [
        'papel forjado no corpo (Restrito)',
        () => ({ token: users.restricted.token, body: { ...endpoint.body(), ...FORGED_ROLE } }),
        403,
        NOT_ADMIN,
      ]
    );
  } else {
    // last-login aceita qualquer usuário ativo e só o campo `device`: o papel extra é rejeitado.
    cases.push([
      'papel forjado no corpo (Padrão)',
      () => ({ token: users.standard.token, body: { ...endpoint.body(), ...FORGED_ROLE } }),
      400,
      'Descrição do dispositivo inválida.',
    ]);
  }

  return cases;
}

describe('Autorização dos endpoints contra Firebase Emulator (Firestore + Auth)', () => {
  before(async () => {
    const callers = [
      ['admin', { accessLevel: 'Administrador', extra: { isRestricted: false } }],
      ['standard', { accessLevel: 'Usuário Padrão', extra: { isRestricted: false } }],
      ['restricted', { accessLevel: 'Usuário Padrão', extra: { isRestricted: true } }],
      [
        'inactiveAdmin',
        { accessLevel: 'Administrador', status: 'Inativo', extra: { isRestricted: false } },
      ],
    ];

    for (const [key, options] of callers) {
      const user = await createUserFixture(key, options);

      users[key] = { ...user, ...(await signIn(user)) };
    }

    for (const key of ['targetDelete', 'targetStatus', 'targetUpdate']) {
      users[key] = await createUserFixture(key, {
        accessLevel: 'Usuário Padrão',
        extra: { isRestricted: false },
      });
    }

    await adminDb.doc(`${BASE}/tools/${TOOL_ID}`).set({
      code: 'AZ-01',
      name: 'Ferramenta Authz',
      category: 'Manual',
      status: 'available',
      currentUser: null,
      currentCollaboratorId: null,
      lastAction: null,
      nextMaintenance: null,
    });
  });

  after(async () => {
    await closeEmulatorClients();
  });

  for (const endpoint of ENDPOINTS) {
    for (const [caseName, request, status, message] of deniedCases(endpoint)) {
      const label = `${endpoint.name} | ${caseName}`;

      test(`${label} -> ${status}, sem efeito`, async () => {
        await expectDenied(
          endpoint.api,
          { method: endpoint.method, body: endpoint.body(), ...request() },
          status,
          message,
          label
        );
      });
    }
  }

  test('users/create | Administrador -> 201, conta e perfil criados', async () => {
    const result = await callHandler(createApi, {
      token: users.admin.token,
      body: {
        name: 'Criado Authz',
        email: 'Criado.Authz@emulator.local',
        department: 'Teste',
        accessLevel: 'Usuário Padrão',
      },
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.data.email, 'criado.authz@emulator.local');

    const record = await adminAuth.getUser(result.body.data.uid);
    const profile = (await adminDb.doc(`${BASE}/users/${record.uid}`).get()).data();

    assert.equal(record.email, 'criado.authz@emulator.local');
    assert.equal(record.disabled, false);
    assert.equal(profile.status, 'Ativo');
    assert.equal(profile.accessLevel, 'Usuário Padrão');
    assert.equal(profile.isRestricted, false);
  });

  test('users/delete | Administrador -> 200, conta e perfil removidos', async () => {
    const { uid } = users.targetDelete;
    const result = await callHandler(deleteApi, { token: users.admin.token, body: { uid } });

    assert.equal(result.status, 200);
    assert.equal((await adminDb.doc(`${BASE}/users/${uid}`).get()).exists, false);
    await assert.rejects(adminAuth.getUser(uid), { code: 'auth/user-not-found' });
  });

  test('users/status | Administrador -> 200, perfil Inativo e conta desabilitada', async () => {
    const { uid } = users.targetStatus;
    const result = await callHandler(userStatusApi, {
      token: users.admin.token,
      body: { uid, status: 'Inativo' },
    });

    assert.equal(result.status, 200);
    assert.equal((await adminDb.doc(`${BASE}/users/${uid}`).get()).data().status, 'Inativo');
    assert.equal((await adminAuth.getUser(uid)).disabled, true);
  });

  test('users/update | Administrador -> 200, perfil e conta atualizados', async () => {
    const { uid, email } = users.targetUpdate;
    const result = await callHandler(updateApi, {
      method: 'PATCH',
      token: users.admin.token,
      body: { uid, name: 'Nome Atualizado Authz', email, department: 'Teste', accessLevel: 'Usuário Padrão' },
    });
    const profile = (await adminDb.doc(`${BASE}/users/${uid}`).get()).data();

    assert.equal(result.status, 200);
    assert.equal(profile.name, 'Nome Atualizado Authz');
    assert.equal(profile.updatedBy, users.admin.uid);
    assert.equal((await adminAuth.getUser(uid)).displayName, 'Nome Atualizado Authz');
  });

  // Sem restrição de papel por desenho: cada usuário ativo grava só o próprio perfil (uid do token).
  test('session/last-login | qualquer ativo (Admin, Padrão, Restrito) -> 200, só o próprio perfil muda', async () => {
    for (const key of ['admin', 'standard', 'restricted']) {
      const initial = await snapshotState();
      const result = await callHandler(lastLoginApi, {
        token: users[key].token,
        body: { device: 'Navegador de Teste' },
      });
      const final = await snapshotState();
      const { uid } = users[key];
      const { lastLogin, lastIp, lastDevice, ...rest } = final.firestore.users[uid];
      const {
        lastLogin: _lastLogin,
        lastIp: _lastIp,
        lastDevice: _lastDevice,
        ...previous
      } = initial.firestore.users[uid];

      assert.equal(result.status, 200, key);
      assert.equal(lastDevice, 'Navegador de Teste', key);
      assert.ok(!Number.isNaN(Date.parse(lastLogin)), key);
      assert.equal(typeof lastIp, 'string', key);
      // Papel, status e demais campos do próprio perfil intactos.
      assert.deepEqual(rest, previous, key);

      delete initial.firestore.users[uid];
      delete final.firestore.users[uid];
      assert.deepEqual(final, initial, `${key}: alterou outro documento ou o Auth`);
    }
  });

  test('tools/maintenance | Administrador -> 200, ferramenta e histórico gravados', async () => {
    const result = await callHandler(maintenanceApi, {
      token: users.admin.token,
      body: ENDPOINTS.at(-1).body(),
    });
    const tool = (await adminDb.doc(`${BASE}/tools/${TOOL_ID}`).get()).data();
    const history = await adminDb
      .collection(`${BASE}/history`)
      .where('toolId', '==', TOOL_ID)
      .get();

    assert.equal(result.status, 200);
    assert.equal(tool.lastMaintenance, '2025-01-15');
    assert.equal(tool.nextMaintenance, '2099-01-15');
    assert.equal(history.size, 1);
    assert.equal(history.docs[0].data().type, 'maintenance');
    assert.equal(history.docs[0].data().operatorUid, users.admin.uid);
  });

  // Último admin: `admin` é o único Administrador ativo do fixture.
  test('último admin | users/delete da própria conta -> 409, sem efeito', async () => {
    await expectDenied(
      deleteApi,
      { token: users.admin.token, body: { uid: users.admin.uid } },
      409,
      'Você não pode excluir a própria conta administrativa.',
      'delete próprio'
    );
  });

  test('último admin | users/status desativando a própria conta -> 409, sem efeito', async () => {
    await expectDenied(
      userStatusApi,
      { token: users.admin.token, body: { uid: users.admin.uid, status: 'Inativo' } },
      409,
      'Você não pode desativar a própria conta administrativa.',
      'status próprio'
    );
  });

  test('último admin | users/update rebaixando a própria conta -> 409, sem efeito', async () => {
    await expectDenied(
      updateApi,
      {
        method: 'PATCH',
        token: users.admin.token,
        body: {
          uid: users.admin.uid,
          name: 'Usuario admin',
          email: users.admin.email,
          department: 'Teste',
          accessLevel: 'Usuário Padrão',
        },
      },
      409,
      'Você não pode remover o próprio acesso de administrador.',
      'update próprio'
    );
  });

  // Pendências: não afirmam o comportamento atual como correto.
  test.todo(
    'último admin | users/delete e users/status: contagem de admins ativos (delete.js:111, status.js:150) só é alcançável com operações concorrentes, sem teste determinístico'
  );
  test.todo(
    'F4 | users/status desativa a conta no Auth (status.js:110) antes de checar o último admin na transação (status.js:150), com rollback posterior'
  );
  test.todo(
    'F5 | users/update não verifica contagem de admins ativos ao rebaixar outro Administrador (update.js:113 cobre só a própria conta)'
  );

  test('isolamento | nenhuma conexão de rede não local foi tentada', () => {
    assert.deepEqual(networkAttempts.filter((attempt) => attempt.remote), []);
  });
});
