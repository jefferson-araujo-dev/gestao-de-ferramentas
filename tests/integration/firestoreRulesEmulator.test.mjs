// Testes das regras do Firestore (firestore.rules) contra o Firebase Emulator Suite, com o SDK
// cliente autenticado no Auth Emulator. Sem Firebase remoto; as regras NÃO são publicadas.
//
// Executar:  npm run test:rules:emulator   (firebase emulators:exec)
//
// Contrato de leitura de colaboradores: ADMIN e PADRÃO (ativos) leem; RESTRITO não lê nem lista
// nem busca por crachá (a resolução do crachá é feita pelo servidor, com o Admin SDK).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  BASE,
  adminDb,
  anonymousClient,
  closeEmulatorClients,
  createUserFixture,
  networkAttempts,
  signIn,
} from './support/emulator.mjs';

const {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} = await import('firebase/firestore');

const evidence = {};
const record = (key, value) => {
  evidence[key] = value;
};

const isDenied = (error) => error?.code === 'permission-denied';

async function assertAllowed(operation, label) {
  try {
    return await operation();
  } catch (error) {
    assert.fail(`${label}: deveria ser permitido, mas falhou (${error?.code ?? 'sem código'})`);
  }
}

async function assertDenied(operation, label) {
  try {
    await operation();
  } catch (error) {
    assert.ok(isDenied(error), `${label}: esperado permission-denied, veio ${error?.code}`);
    return;
  }

  assert.fail(`${label}: deveria ser negado, mas foi permitido`);
}

const collaboratorsPath = `${BASE}/collaborators`;
const users = {};
let anonymous;

async function seed() {
  const batch = adminDb.batch();

  batch.set(adminDb.doc(`${BASE}/tools/t1`), {
    code: 'T-1',
    name: 'Furadeira',
    category: 'Elétrica',
    status: 'available',
  });
  batch.set(adminDb.doc(`${BASE}/history/h1`), {
    date: '2026-09-01T10:00:00.000Z',
    type: 'out',
    toolCode: 'T-1',
    toolName: 'Furadeira',
    user: 'Colaborador Alfa',
  });

  for (const [id, badge, name] of [
    ['c1', 'B-100', 'Colaborador Alfa'],
    ['c2', 'B-200', 'Colaborador Beta'],
    ['c3', 'B-300', 'Colaborador Gama'],
  ]) {
    batch.set(adminDb.doc(`${collaboratorsPath}/${id}`), {
      name,
      badge,
      role: 'Operador',
      status: 'active',
    });
  }

  await batch.commit();
}

// Perfis com leitura de colaboradores permitida.
const READERS = [
  ['ADMIN', 'admin'],
  ['PADRÃO', 'standard'],
  ['PADRÃO legado (sem o campo isRestricted)', 'legacy'],
  ['ADMIN com a flag isRestricted (continua administrador)', 'adminflag'],
];

describe('firestore.rules: colaboradores por perfil (Auth + Firestore Emulator)', () => {
  before(async () => {
    const definitions = [
      ['admin', { accessLevel: 'Administrador', extra: { isRestricted: false } }],
      ['standard', { accessLevel: 'Usuário Padrão', extra: { isRestricted: false } }],
      ['restricted', { accessLevel: 'Usuário Padrão', extra: { isRestricted: true } }],
      ['legacy', { accessLevel: 'Usuário Padrão' }],
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

    anonymous = anonymousClient();
    await seed();
  });

  after(async () => {
    await closeEmulatorClients();

    for (const key of Object.keys(evidence).sort()) {
      console.log(`EVIDENCE ${key}=${evidence[key]}`);
    }
  });

  for (const [label, key] of READERS) {
    test(`${label}: lista, lê por ID e busca por crachá em collaborators`, async () => {
      const { db } = users[key];
      const listed = await assertAllowed(() => getDocs(collection(db, collaboratorsPath)), 'list');

      assert.equal(listed.size, 3);
      await assertAllowed(() => getDoc(doc(db, `${collaboratorsPath}/c1`)), 'get');

      const byBadge = await assertAllowed(
        () => getDocs(query(collection(db, collaboratorsPath), where('badge', '==', 'B-100'))),
        'query por crachá'
      );

      assert.equal(byBadge.size, 1);
    });
  }

  test('RESTRITO: list de collaborators NEGADO', async () => {
    const { db } = users.restricted;

    await assertDenied(() => getDocs(collection(db, collaboratorsPath)), 'list');
    await assertDenied(() => getDocs(query(collection(db, collaboratorsPath), limit(1))), 'list limit');
    record('RESTRICTED_LIST_COLLABORATORS', 'DENIED');
  });

  test('RESTRITO: get direto de collaborator NEGADO (existente e inexistente, sem oráculo)', async () => {
    const { db } = users.restricted;

    await assertDenied(() => getDoc(doc(db, `${collaboratorsPath}/c1`)), 'get existente');
    await assertDenied(() => getDoc(doc(db, `${collaboratorsPath}/nao-existe`)), 'get inexistente');
    record('RESTRICTED_GET_COLLABORATOR', 'DENIED');
  });

  test('RESTRITO: busca por crachá/nome e collection group NEGADAS', async () => {
    const { db } = users.restricted;

    await assertDenied(
      () => getDocs(query(collection(db, collaboratorsPath), where('badge', '==', 'B-100'))),
      'query por crachá'
    );
    await assertDenied(
      () =>
        getDocs(
          query(collection(db, collaboratorsPath), where('name', '==', 'Colaborador Alfa'))
        ),
      'query por nome'
    );
    await assertDenied(() => getDocs(collectionGroup(db, 'collaborators')), 'collection group');
    record('RESTRICTED_QUERY_COLLABORATORS', 'DENIED');
  });

  test('RESTRITO: nunca escreve em collaborators (create/update/delete)', async () => {
    const { db } = users.restricted;

    await assertDenied(() => setDoc(doc(db, `${collaboratorsPath}/novo`), { name: 'X' }), 'create');
    await assertDenied(() => updateDoc(doc(db, `${collaboratorsPath}/c1`), { name: 'X' }), 'update');
    await assertDenied(() => deleteDoc(doc(db, `${collaboratorsPath}/c1`)), 'delete');
  });

  test('RESTRITO: continua lendo ferramentas e o próprio perfil (Scanner e devolução)', async () => {
    const { db } = users.restricted;
    const tools = await assertAllowed(() => getDocs(collection(db, `${BASE}/tools`)), 'tools');

    assert.equal(tools.size, 1);
    await assertAllowed(() => getDoc(doc(db, `${BASE}/users/${users.restricted.uid}`)), 'perfil');
    await assertDenied(() => updateDoc(doc(db, `${BASE}/tools/t1`), { status: 'borrowed' }), 'tools write');
    await assertDenied(() => getDocs(collection(db, `${BASE}/history`)), 'history');
    await assertDenied(() => getDocs(collection(db, `${BASE}/users`)), 'users list');
    await assertDenied(() => getDoc(doc(db, `${BASE}/users/${users.admin.uid}`)), 'perfil alheio');
    record('RESTRICTED_TOOLS_READ', 'ALLOWED');
  });

  test('ADMIN: lê e escreve em collaborators (contrato atual preservado)', async () => {
    const { db } = users.admin;
    const scratch = doc(db, `${collaboratorsPath}/escrita-admin`);

    await assertAllowed(() => setDoc(scratch, { name: 'Temp', badge: 'B-TMP', status: 'active' }), 'create');
    await assertAllowed(() => updateDoc(scratch, { role: 'Auxiliar' }), 'update');
    await assertAllowed(() => deleteDoc(scratch), 'delete');
    await assertAllowed(() => getDocs(collection(db, `${BASE}/history`)), 'history do admin');
    record('ADMIN_COLLABORATORS_CONTRACT', 'PRESERVED');
  });

  test('PADRÃO: só lê collaborators (escrita, histórico e lista de usuários seguem negados)', async () => {
    const { db } = users.standard;

    await assertDenied(() => setDoc(doc(db, `${collaboratorsPath}/novo`), { name: 'X' }), 'create');
    await assertDenied(() => updateDoc(doc(db, `${collaboratorsPath}/c1`), { name: 'X' }), 'update');
    await assertDenied(() => deleteDoc(doc(db, `${collaboratorsPath}/c1`)), 'delete');
    await assertDenied(() => getDocs(collection(db, `${BASE}/history`)), 'history');
    await assertDenied(() => getDocs(collection(db, `${BASE}/users`)), 'users list');
    record('STANDARD_COLLABORATORS_CONTRACT', 'PRESERVED');
  });

  test('a regra segue a flag do perfil gravada no servidor (liga/desliga)', async () => {
    const { db } = users.standard;
    const profile = adminDb.doc(`${BASE}/users/${users.standard.uid}`);

    try {
      await profile.update({ isRestricted: true });
      await assertDenied(() => getDocs(collection(db, collaboratorsPath)), 'flag ligada');
      await profile.update({ isRestricted: false });
      await assertAllowed(() => getDocs(collection(db, collaboratorsPath)), 'flag desligada');
    } finally {
      await profile.update({ isRestricted: false });
    }
  });

  test('perfil inativo (mesmo restrito) e não autenticado: tudo negado', async () => {
    const inactive = users.inactiverestricted.db;

    for (const [label, db] of [
      ['inativo', inactive],
      ['anônimo', anonymous.db],
    ]) {
      await assertDenied(() => getDocs(collection(db, collaboratorsPath)), `${label}: collaborators`);
      await assertDenied(() => getDocs(collection(db, `${BASE}/tools`)), `${label}: tools`);
      await assertDenied(() => getDocs(collection(db, `${BASE}/history`)), `${label}: history`);
    }
  });

  test('PADRÃO: nunca escreve em tools (contrato preservado)', async () => {
    const { db } = users.standard;

    await assertDenied(() => updateDoc(doc(db, `${BASE}/tools/t1`), { status: 'maintenance' }), 'update');
    await assertDenied(
      () => setDoc(doc(db, `${BASE}/tools/novo`), { code: 'X', name: 'X', status: 'available' }),
      'create'
    );
  });

  // -------------------------------------------------------------------------
  // Integridade de empréstimo em tools/{toolId} (Gate 1-F3.2B). 'borrowed' só é um estado
  // legítimo quando produzido pelo Movement API (Admin SDK, que não passa por estas Rules).
  // Mesma sessão de usuários/emulator do describe acima (evita reautenticar e reabrir clientes).
  // -------------------------------------------------------------------------
  const toolsPath = `${BASE}/tools`;

  async function seedTool(id, data) {
    await adminDb.doc(`${toolsPath}/${id}`).set({
      code: id,
      name: 'Ferramenta de teste',
      category: 'Elétrica',
      currentUser: null,
      currentCollaboratorId: null,
      lastAction: null,
      ...data,
    });
  }

  test('1/2 create: status available permitido; status borrowed negado', async () => {
    const { db } = users.admin;

    await assertAllowed(
      () => setDoc(doc(db, `${toolsPath}/loan-t-create-ok`), {
        code: 'loan-t-create-ok',
        name: 'Furadeira',
        category: 'Elétrica',
        status: 'available',
      }),
      'create available'
    );
    await assertDenied(
      () => setDoc(doc(db, `${toolsPath}/loan-t-create-borrowed`), {
        code: 'loan-t-create-borrowed',
        name: 'Furadeira',
        category: 'Elétrica',
        status: 'borrowed',
      }),
      'create borrowed'
    );
  });

  test('3/4 available <-> maintenance: permitido nos dois sentidos', async () => {
    await seedTool('loan-t-flip', { status: 'available' });
    const ref = doc(users.admin.db, `${toolsPath}/loan-t-flip`);

    await assertAllowed(() => updateDoc(ref, { status: 'maintenance' }), 'available -> maintenance');
    await assertAllowed(() => updateDoc(ref, { status: 'available' }), 'maintenance -> available');
  });

  test('5 available -> borrowed direto (client) é negado, mesmo para admin', async () => {
    await seedTool('loan-t-direct-borrow', { status: 'available' });

    await assertDenied(
      () => updateDoc(doc(users.admin.db, `${toolsPath}/loan-t-direct-borrow`), { status: 'borrowed' }),
      'available -> borrowed'
    );
  });

  test('6/7 ferramenta já borrowed: mudar status para available/maintenance é negado', async () => {
    await seedTool('loan-t-frozen-status', {
      status: 'borrowed',
      currentUser: 'Colaborador Alfa',
      currentCollaboratorId: 'c1',
      lastAction: '2026-09-01T10:00:00.000Z',
    });
    const ref = doc(users.admin.db, `${toolsPath}/loan-t-frozen-status`);

    await assertDenied(() => updateDoc(ref, { status: 'available' }), 'borrowed -> available');
    await assertDenied(() => updateDoc(ref, { status: 'maintenance' }), 'borrowed -> maintenance');
  });

  test('8/9/10 ferramenta borrowed: campos do empréstimo ficam congelados para o cliente', async () => {
    await seedTool('loan-t-frozen-fields', {
      status: 'borrowed',
      currentUser: 'Colaborador Alfa',
      currentCollaboratorId: 'c1',
      lastAction: '2026-09-01T10:00:00.000Z',
    });
    const ref = doc(users.admin.db, `${toolsPath}/loan-t-frozen-fields`);

    await assertDenied(() => updateDoc(ref, { currentCollaboratorId: 'c3' }), 'currentCollaboratorId');
    await assertDenied(() => updateDoc(ref, { currentUser: 'Outro Nome' }), 'currentUser');
    await assertDenied(() => updateDoc(ref, { lastAction: '2026-09-20T00:00:00.000Z' }), 'lastAction');
  });

  test('11 ferramenta borrowed: metadado não protegido continua editável', async () => {
    await seedTool('loan-t-metadata', {
      status: 'borrowed',
      currentUser: 'Colaborador Alfa',
      currentCollaboratorId: 'c1',
      lastAction: '2026-09-01T10:00:00.000Z',
      notes: 'original',
    });
    const ref = doc(users.admin.db, `${toolsPath}/loan-t-metadata`);

    await assertAllowed(() => updateDoc(ref, { notes: 'revisada em campo' }), 'notes');
    await assertAllowed(() => updateDoc(ref, { category: 'Hidráulica' }), 'category');
  });

  test('12 delete de ferramenta borrowed é negado, mesmo para admin', async () => {
    await seedTool('loan-t-delete-borrowed', {
      status: 'borrowed',
      currentUser: 'Colaborador Alfa',
      currentCollaboratorId: 'c1',
      lastAction: '2026-09-01T10:00:00.000Z',
    });

    await assertDenied(
      () => deleteDoc(doc(users.admin.db, `${toolsPath}/loan-t-delete-borrowed`)),
      'delete borrowed'
    );
  });

  test('13 devolução oficial (Admin SDK) não é controlada por estas Rules', async () => {
    await seedTool('loan-t-official-return', {
      status: 'borrowed',
      currentUser: 'Colaborador Alfa',
      currentCollaboratorId: 'c1',
      lastAction: '2026-09-01T10:00:00.000Z',
    });

    // Simula o efeito da devolução oficial feita pelo Movement API (Admin SDK): não passa pelas
    // Rules do cliente, então não é bloqueada pelo congelamento de campos acima.
    await adminDb.doc(`${toolsPath}/loan-t-official-return`).update({
      status: 'available',
      currentUser: null,
      currentCollaboratorId: null,
      lastAction: '2026-09-02T00:00:00.000Z',
    });

    const afterReturn = await adminDb.doc(`${toolsPath}/loan-t-official-return`).get();

    assert.equal(afterReturn.data().status, 'available');
  });

  test('14 delete permitido após devolução/available', async () => {
    await seedTool('loan-t-delete-after-return', { status: 'available' });

    await assertAllowed(
      () => deleteDoc(doc(users.admin.db, `${toolsPath}/loan-t-delete-after-return`)),
      'delete available'
    );
  });

  test('Standard/Restricted continuam sem client-write em tools sob a nova política', async () => {
    await seedTool('loan-t-no-client-write', { status: 'available' });

    for (const key of ['standard', 'restricted']) {
      const { db } = users[key];

      await assertDenied(
        () => updateDoc(doc(db, `${toolsPath}/loan-t-no-client-write`), { status: 'maintenance' }),
        `${key}: update`
      );
      await assertDenied(
        () => setDoc(doc(db, `${toolsPath}/loan-t-no-client-write-2`), {
          code: 'x',
          name: 'x',
          status: 'available',
        }),
        `${key}: create`
      );
      await assertDenied(
        () => deleteDoc(doc(db, `${toolsPath}/loan-t-no-client-write`)),
        `${key}: delete`
      );
    }

    record('LOAN_INTEGRITY_RULES_STANDARD_RESTRICTED_NO_WRITE', 'DENIED');
  });

  test('nenhuma conexão de rede não local durante os testes', () => {
    const remote = networkAttempts.filter((attempt) => attempt.remote);

    assert.equal(remote.length, 0);
    record('REAL_FIREBASE_CONTACTS', remote.length);
  });
});
