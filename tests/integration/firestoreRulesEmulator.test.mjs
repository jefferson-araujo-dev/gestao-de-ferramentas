// Testes das regras do Firestore (firestore.rules) contra o Firebase Emulator Suite, com o SDK
// cliente autenticado no Auth Emulator. Sem Firebase remoto; as regras NÃO são publicadas.
//
// Executar:  npm run test:rules:emulator   (firebase emulators:exec)
//
// Contrato de leitura de colaboradores: ADMIN e PADRÃO (ativos) leem; RESTRITO não lê nem lista
// nem busca por crachá (a resolução do crachá é feita pelo servidor, com o Admin SDK).
// Ferramentas: nenhum cliente (nem o admin) cria ou leva uma ferramenta para 'borrowed'; o
// empréstimo é exclusivo da API de movimentação.
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

  // Empréstimo é exclusivo da API de movimentação (Admin SDK): nenhum cliente entra em 'borrowed'.
  describe('ferramentas: nenhum cliente leva uma ferramenta para borrowed', () => {
    const toolsPath = `${BASE}/tools`;
    const scratchIds = ['rb-available', 'rb-maintenance', 'rb-borrowed', 'rb-nova', 'rb-nova-admin'];

    before(async () => {
      const batch = adminDb.batch();
      const base = { category: 'Elétrica', currentUser: null, currentCollaboratorId: null };

      batch.set(adminDb.doc(`${toolsPath}/rb-available`), {
        ...base,
        code: 'rb-available',
        name: 'Disponível',
        status: 'available',
      });
      batch.set(adminDb.doc(`${toolsPath}/rb-maintenance`), {
        ...base,
        code: 'rb-maintenance',
        name: 'Manutenção',
        status: 'maintenance',
      });
      batch.set(adminDb.doc(`${toolsPath}/rb-borrowed`), {
        ...base,
        code: 'rb-borrowed',
        name: 'Emprestada',
        status: 'borrowed',
        currentUser: 'Colaborador Alfa',
        currentCollaboratorId: 'c1',
      });
      await batch.commit();
    });

    after(async () => {
      const batch = adminDb.batch();

      scratchIds.forEach((id) => batch.delete(adminDb.doc(`${toolsPath}/${id}`)));
      await batch.commit();
    });

    const borrowAttempts = (db) => [
      ['update available -> borrowed', () => updateDoc(doc(db, `${toolsPath}/rb-available`), { status: 'borrowed' })],
      [
        'update maintenance -> borrowed com colaborador',
        () =>
          updateDoc(doc(db, `${toolsPath}/rb-maintenance`), {
            status: 'borrowed',
            currentUser: 'Colaborador Gama',
            currentCollaboratorId: 'c3',
          }),
      ],
      [
        'setDoc sobrescrevendo available com borrowed',
        () =>
          setDoc(doc(db, `${toolsPath}/rb-available`), {
            code: 'rb-available',
            name: 'Disponível',
            category: 'Elétrica',
            status: 'borrowed',
          }),
      ],
      [
        'setDoc merge com borrowed',
        () => setDoc(doc(db, `${toolsPath}/rb-available`), { status: 'borrowed' }, { merge: true }),
      ],
      [
        'create já emprestada',
        () =>
          setDoc(doc(db, `${toolsPath}/rb-nova`), {
            code: 'rb-nova',
            name: 'Nova',
            category: 'Elétrica',
            status: 'borrowed',
            currentUser: 'Colaborador Alfa',
          }),
      ],
    ];

    for (const [label, key] of [
      ['ADMIN', 'admin'],
      ['ADMIN com a flag isRestricted', 'adminflag'],
      ['PADRÃO', 'standard'],
      ['PADRÃO legado', 'legacy'],
      ['RESTRITO', 'restricted'],
    ]) {
      test(`${label}: nenhuma escrita direta entra em borrowed`, async () => {
        for (const [attempt, operation] of borrowAttempts(users[key].db)) {
          await assertDenied(operation, `${label}: ${attempt}`);
        }

        assert.equal((await adminDb.doc(`${toolsPath}/rb-available`).get()).data().status, 'available');
        assert.equal(
          (await adminDb.doc(`${toolsPath}/rb-maintenance`).get()).data().status,
          'maintenance'
        );
        assert.equal((await adminDb.doc(`${toolsPath}/rb-nova`).get()).exists, false);
      });
    }

    test('PADRÃO e RESTRITO: nem alterações sem empréstimo são permitidas em tools', async () => {
      for (const key of ['standard', 'restricted']) {
        const { db } = users[key];

        await assertDenied(
          () => updateDoc(doc(db, `${toolsPath}/rb-available`), { status: 'maintenance' }),
          `${key}: status`
        );
        await assertDenied(
          () => updateDoc(doc(db, `${toolsPath}/rb-available`), { name: 'X' }),
          `${key}: nome`
        );
      }
    });

    test('ADMIN: alterações legítimas de ferramenta continuam permitidas', async () => {
      const { db } = users.admin;
      const available = doc(db, `${toolsPath}/rb-available`);

      await assertAllowed(() => updateDoc(available, { status: 'maintenance' }), 'available -> maintenance');
      await assertAllowed(() => updateDoc(available, { status: 'available' }), 'maintenance -> available');
      await assertAllowed(() => updateDoc(available, { name: 'Renomeada', category: 'Manual' }), 'editar');
      await assertAllowed(
        () =>
          setDoc(doc(db, `${toolsPath}/rb-nova-admin`), {
            code: 'rb-nova-admin',
            name: 'Cadastro',
            category: 'Elétrica',
            status: 'available',
            currentUser: null,
          }),
        'cadastro disponível'
      );
      // Ferramenta já emprestada: editar dados sem mudar o status não é um novo empréstimo.
      await assertAllowed(
        () => updateDoc(doc(db, `${toolsPath}/rb-borrowed`), { notes: 'Observação' }),
        'editar emprestada sem mudar status'
      );
      await assertAllowed(() => deleteDoc(doc(db, `${toolsPath}/rb-nova-admin`)), 'excluir');
      record('RULES_ADMIN_LEGIT_TOOL_WRITES', 'ALLOWED');
      record('RULES_CLIENT_BORROWED_WRITE', 'DENIED_ALL_PROFILES');
    });
  });

  test('nenhuma conexão de rede não local durante os testes', () => {
    const remote = networkAttempts.filter((attempt) => attempt.remote);

    assert.equal(remote.length, 0);
    record('REAL_FIREBASE_CONTACTS', remote.length);
  });
});
