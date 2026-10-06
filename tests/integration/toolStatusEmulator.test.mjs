// Integração REAL do handler /api/tools/status contra o Firebase Emulator Suite (Firestore +
// Auth), sem Firebase remoto e sem Vercel.
//
// Executar:  npm run test:tools-status:emulator   (firebase emulators:exec)
//
// Gate 1-F4.C4, Decisão 1 (B1): endpoint dedicado para o Restrito consultar status/dados de uma
// ferramenta sem abrir o listener de `tools` (que grava `currentUser`/`currentCollaboratorId`,
// docs/design/USERS_AUDIT_SCREEN.md, seção C.2). A resposta é a MESMA lista fechada de campos de B1
// (`id`, `code`, `name`, `category`, `status`, `imageUrl`, `nextMaintenance`) para qualquer perfil
// que chame o endpoint — nunca dado de colaborador, em nenhum código de status, para nenhum perfil.
// Também cobre o rate limit das consultas sem resultado (Decisão D3) e a versão mínima só
// observável (Decisão 7/D4).
//
// O guard fail-closed de ambiente (host do emulator, ausência de GOOGLE_APPLICATION_CREDENTIALS)
// já é coberto uma vez, com subprocessos, em movementEmulator.test.mjs ("01 guardas fail-closed"):
// ele protege o módulo compartilhado tests/integration/support/emulator.mjs, importado aqui
// também, então não é duplicado neste arquivo.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  BASE,
  Timestamp,
  adminDb,
  closeEmulatorClients,
  createUserFixture,
  signIn,
} from './support/emulator.mjs';

import { MIN_APP_VERSION } from '../../server/app-version.js';

const statusApi = (await import('../../api/tools/status.js')).default;
const movementApi = (await import('../../api/tools/movement.js')).default;

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

async function callStatus(options = {}) {
  return callHandler(statusApi, options);
}

async function callHandler(api, { method = 'POST', token, authorization, body, appVersion } = {}) {
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
    await api({ method, headers, body }, res);
  } finally {
    Object.assign(console, originals);
  }

  return { status: res.statusCode, body: res.body, logged: logged.join('\n') };
}

// Nada do que segue pode aparecer em nenhuma resposta nem em log, para nenhum perfil: dado do
// colaborador vinculado, nome de quem fez a manutenção (`lastMaintenanceBy`) e e-mail/nome dos
// usuários de teste (o log de versão só pode levar o uid).
const SENSITIVE = [
  'Colaborador Sigma',
  'cs1',
  'Admin Sigma Manutencao',
  'integration@emulator.local',
  'Usuario ',
];

// Lista fechada de B1 (docs/design/USERS_AUDIT_SCREEN.md, seção E.2).
const B1_FIELDS = ['category', 'code', 'id', 'imageUrl', 'name', 'nextMaintenance', 'status'];

// Cobre o corpo inteiro e o log e, campo a campo, cada valor de `data.tool` — inclusive
// `imageUrl` e `nextMaintenance` — para nenhum dado sensível entrar por um campo permitido.
function assertNoLeak(result, label) {
  // O log de versão leva o uid aleatório do emulator, que pode conter por acaso um valor curto da
  // lista (ex.: 'cs1'): o uid é mascarado antes da busca.
  const logged = Object.values(users).reduce(
    (text, user) => text.replaceAll(user.uid, '<uid>'),
    result.logged
  );
  const serialized = JSON.stringify(result.body ?? {}) + logged;

  for (const value of SENSITIVE) {
    assert.ok(!serialized.includes(value), `${label}: vazou dado sensível`);
  }

  const tool = result.body?.data?.tool;

  if (tool) {
    assert.deepEqual(Object.keys(tool).sort(), B1_FIELDS, `${label}: campos fora de B1`);

    for (const field of B1_FIELDS) {
      const value = JSON.stringify(tool[field] ?? null);

      for (const sensitive of SENSITIVE) {
        assert.ok(!value.includes(sensitive), `${label}: ${field} carrega dado sensível`);
      }
    }
  }
}

function assertToolShape(result, label) {
  assert.equal(result.status, 200, label);
  assert.equal(result.body.success, true, label);
  assert.deepEqual(Object.keys(result.body.data.tool).sort(), B1_FIELDS, label);
}

const lookupRateLimitDoc = (uid) => adminDb.doc(`${BASE}/badgeRateLimits/tool-status:${uid}`);
const badgeRateLimitDoc = (uid) => adminDb.doc(`${BASE}/badgeRateLimits/${uid}`);

async function resetRateLimits() {
  for (const user of Object.values(users)) {
    await lookupRateLimitDoc(user.uid).delete();
    await badgeRateLimitDoc(user.uid).delete();
  }
}

// Imagem sintética mínima no mesmo formato gravado por tools.js (data URL JPEG gerado por canvas).
const SAMPLE_IMAGE_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJ';

const users = {};

async function seedTools() {
  const batch = adminDb.batch();

  for (const document of (await adminDb.collection(`${BASE}/tools`).get()).docs) {
    batch.delete(document.ref);
  }

  batch.set(adminDb.doc(`${BASE}/tools/ts-available-1`), {
    code: 'TS-01',
    name: 'Furadeira de Teste',
    category: 'Elétrica',
    status: 'available',
    currentUser: null,
    currentCollaboratorId: null,
    lastAction: null,
    nextMaintenance: '2099-12-31',
    imageUrl: SAMPLE_IMAGE_URL,
    lastMaintenanceBy: 'Admin Sigma Manutencao',
    notes: 'Observação interna',
  });
  batch.set(adminDb.doc(`${BASE}/tools/ts-borrowed-1`), {
    code: 'TS-02',
    name: 'Serra de Teste',
    category: 'Elétrica',
    status: 'borrowed',
    currentUser: 'Colaborador Sigma',
    currentCollaboratorId: 'cs1',
    lastAction: '2026-09-01T10:00:00.000Z',
    nextMaintenance: null,
    imageUrl: null,
    lastMaintenanceBy: 'Admin Sigma Manutencao',
  });
  // Manutenção vencida: o cliente do Restrito precisa de `nextMaintenance` para avisar e bloquear
  // antes de pedir o crachá, como Admin/Padrão (scanner.js). `imageUrl` com tipo não textual vira
  // null (nunca repassa objeto aninhado).
  batch.set(adminDb.doc(`${BASE}/tools/ts-overdue-1`), {
    code: 'TS-03',
    name: 'Nível de Teste',
    category: 'Medição',
    status: 'available',
    currentUser: null,
    currentCollaboratorId: null,
    lastAction: null,
    nextMaintenance: '2020-01-01',
    imageUrl: { owner: 'Colaborador Sigma' },
  });
  // Gate 1-F4.C4-FIX1: `name` e `category` com tipo não textual viram null; `status` não textual
  // é inconsistência de dados (500 genérico, nunca devolvido). Os objetos aninhados carregam dado
  // sensível de propósito, para o assertNoLeak pegar qualquer repasse.
  batch.set(adminDb.doc(`${BASE}/tools/ts-bad-fields-1`), {
    code: 'TS-04',
    name: 123,
    category: { owner: 'Colaborador Sigma' },
    status: 'available',
    currentUser: null,
    currentCollaboratorId: null,
    lastAction: null,
    nextMaintenance: null,
  });
  batch.set(adminDb.doc(`${BASE}/tools/ts-bad-status-1`), {
    code: 'TS-05',
    name: 'Status Objeto',
    category: 'Manual',
    status: { holder: 'Colaborador Sigma', id: 'cs1' },
    currentUser: 'Colaborador Sigma',
    currentCollaboratorId: 'cs1',
    lastAction: null,
    nextMaintenance: null,
  });
  batch.set(adminDb.doc(`${BASE}/tools/ts-bad-status-2`), {
    code: 'TS-06',
    name: 'Status Numérico',
    category: 'Manual',
    status: 1,
    currentUser: null,
    currentCollaboratorId: null,
    lastAction: null,
    nextMaintenance: null,
  });
  batch.set(adminDb.doc(`${BASE}/tools/ts-no-status-1`), {
    code: 'TS-07',
    name: 'Sem Status',
    category: 'Manual',
    currentUser: null,
    currentCollaboratorId: null,
    lastAction: null,
    nextMaintenance: null,
  });
  batch.set(adminDb.doc(`${BASE}/tools/ts-dup-a`), {
    code: 'TS-DUP',
    name: 'Duplicada A',
    category: 'Manual',
    status: 'available',
    currentUser: null,
    currentCollaboratorId: null,
    lastAction: null,
    nextMaintenance: null,
  });
  batch.set(adminDb.doc(`${BASE}/tools/ts-dup-b`), {
    code: 'TS-DUP',
    name: 'Duplicada B',
    category: 'Manual',
    status: 'available',
    currentUser: null,
    currentCollaboratorId: null,
    lastAction: null,
    nextMaintenance: null,
  });

  await batch.commit();
}

describe('POST /api/tools/status contra Firebase Emulator (Firestore + Auth)', () => {
  before(async () => {
    const definitions = [
      ['admin', { accessLevel: 'Administrador', extra: { isRestricted: false } }],
      ['standard', { accessLevel: 'Usuário Padrão', extra: { isRestricted: false } }],
      ['restricted', { accessLevel: 'Usuário Padrão', extra: { isRestricted: true } }],
      ['inactive', { accessLevel: 'Usuário Padrão', status: 'Inativo', extra: { isRestricted: true } }],
    ];

    for (const [key, options] of definitions) {
      const user = await createUserFixture(key, options);

      users[key] = { ...user, ...(await signIn(user)) };
    }

    await seedTools();
  });

  after(async () => {
    await closeEmulatorClients();
  });

  test('01 método: só POST é aceito', async () => {
    const result = await callStatus({ method: 'GET', token: users.admin.token, body: { code: 'TS-01' } });

    assert.equal(result.status, 405);
  });

  test('02 sem autenticação: 401 (sem token, cabeçalho inválido, token inválido)', async () => {
    assert.equal((await callStatus({ body: { code: 'TS-01' } })).status, 401);
    assert.equal(
      (await callStatus({ authorization: 'Basic abc', body: { code: 'TS-01' } })).status,
      401
    );
    assert.equal(
      (await callStatus({ token: 'token-invalido', body: { code: 'TS-01' } })).status,
      401
    );
  });

  test('03 usuário inativo: 403', async () => {
    const result = await callStatus({ token: users.inactive.token, body: { code: 'TS-01' } });

    assert.equal(result.status, 403);
  });

  test('04 validação: corpo ausente/inválido, code ausente/vazio/tipo errado/longo demais → 400', async () => {
    const cases = [
      undefined,
      {},
      { code: '' },
      { code: '   ' },
      { code: 123 },
      { code: 'x'.repeat(129) },
      [],
    ];

    for (const body of cases) {
      const result = await callStatus({ token: users.admin.token, body });

      assert.equal(result.status, 400, JSON.stringify(body));
    }
  });

  test('05 ferramenta não encontrada: 404, sem detalhe de colaborador', async () => {
    const result = await callStatus({ token: users.admin.token, body: { code: 'TS-INEXISTENTE' } });

    assert.equal(result.status, 404);
    assert.equal(result.body.success, false);
    assertNoLeak(result, '05');
  });

  test('06 patrimônio duplicado: 409', async () => {
    const result = await callStatus({ token: users.admin.token, body: { code: 'TS-DUP' } });

    assert.equal(result.status, 409);
  });

  test('07 sucesso, ferramenta disponível: lista fechada de campos, igual para os três perfis', async () => {
    for (const key of ['admin', 'standard', 'restricted']) {
      const result = await callStatus({ token: users[key].token, body: { code: 'TS-01' } });

      assertToolShape(result, key);
      assert.equal(result.body.data.tool.id, 'ts-available-1', key);
      assert.equal(result.body.data.tool.code, 'TS-01', key);
      assert.equal(result.body.data.tool.name, 'Furadeira de Teste', key);
      assert.equal(result.body.data.tool.category, 'Elétrica', key);
      assert.equal(result.body.data.tool.status, 'available', key);
      // D2: mesmos valores que Admin/Padrão recebem pelo listener (miniatura e manutenção).
      assert.equal(result.body.data.tool.imageUrl, SAMPLE_IMAGE_URL, key);
      assert.equal(result.body.data.tool.nextMaintenance, '2099-12-31', key);
      assertNoLeak(result, key);
    }
  });

  test('08 sucesso, ferramenta emprestada: nunca currentUser/currentCollaboratorId, para nenhum perfil', async () => {
    for (const key of ['admin', 'standard', 'restricted']) {
      const result = await callStatus({ token: users[key].token, body: { code: 'TS-02' } });

      assertToolShape(result, key);
      assert.equal(result.body.data.tool.status, 'borrowed', key);
      assert.ok(!('currentUser' in result.body.data.tool), key);
      assert.ok(!('currentCollaboratorId' in result.body.data.tool), key);
      assertNoLeak(result, key);
    }
  });

  test('09 manutenção vencida e imageUrl não textual: nextMaintenance devolvido, imageUrl null', async () => {
    for (const key of ['admin', 'standard', 'restricted']) {
      const result = await callStatus({ token: users[key].token, body: { code: 'TS-03' } });

      assertToolShape(result, key);
      assert.equal(result.body.data.tool.nextMaintenance, '2020-01-01', key);
      assert.ok(Date.parse(result.body.data.tool.nextMaintenance) < Date.now(), key);
      assert.equal(result.body.data.tool.imageUrl, null, key);
      assertNoLeak(result, key);
    }
  });

  test('10 versão mínima: só registra ausente/inválida/desatualizada; nunca altera status ou corpo', async () => {
    const cases = [
      [undefined, 'absent'],
      ['', 'absent'],
      ['abc', 'invalid'],
      ['9.9.9-teste', 'invalid'],
      ['1.2.3.4.5.6.7.8.9.0.1.2.3.4.5.6.7.8.9.0', 'invalid'],
      ['0.0.1', 'outdated'],
      [MIN_APP_VERSION, null],
      ['999.0.0', null],
    ];
    const reference = await callStatus({
      token: users.restricted.token,
      body: { code: 'TS-01' },
      appVersion: MIN_APP_VERSION,
    });

    for (const [appVersion, reason] of cases) {
      const label = JSON.stringify(appVersion);

      for (const code of ['TS-01', 'TS-INEXISTENTE']) {
        await resetRateLimits();

        const result = await callStatus({
          token: users.restricted.token,
          body: { code },
          appVersion,
        });

        if (code === 'TS-01') {
          assert.equal(result.status, reference.status, label);
          assert.deepEqual(result.body, reference.body, label);
        } else {
          assert.equal(result.status, 404, label);
          assert.deepEqual(result.body, { success: false, message: 'Ferramenta não encontrada.' }, label);
        }

        assertNoLeak(result, label);

        if (reason) {
          const lines = result.logged.split('\n').filter((line) => line.includes('client_app_version_outdated'));

          assert.equal(lines.length, 1, label);

          const entry = JSON.parse(lines[0]);

          assert.deepEqual(
            Object.keys(entry).sort(),
            ['appVersion', 'endpoint', 'event', 'minAppVersion', 'reason', 'uid'],
            label
          );
          assert.equal(entry.endpoint, 'tools/status', label);
          assert.equal(entry.uid, users.restricted.uid, label);
          assert.equal(entry.reason, reason, label);
          assert.ok(entry.appVersion === null || entry.appVersion.length <= 32, label);
        } else {
          assert.doesNotMatch(result.logged, /client_app_version/, label);
        }
      }
    }
  });

  test('11 rate limit: sucessos não gravam; 400 não conta; 404 e 409 contam; bloqueia com 429 genérico', async () => {
    await resetRateLimits();

    for (let index = 0; index < 15; index += 1) {
      assert.equal(
        (await callStatus({ token: users.restricted.token, body: { code: 'TS-01' } })).status,
        200
      );
    }
    assert.equal((await lookupRateLimitDoc(users.restricted.uid).get()).exists, false);

    for (let index = 0; index < 15; index += 1) {
      assert.equal(
        (await callStatus({ token: users.restricted.token, body: { code: '' } })).status,
        400
      );
    }
    assert.equal((await lookupRateLimitDoc(users.restricted.uid).get()).exists, false);

    for (let index = 0; index < 9; index += 1) {
      assert.equal(
        (await callStatus({ token: users.restricted.token, body: { code: `TS-X-${index}` } })).status,
        404
      );
    }
    assert.equal(
      (await callStatus({ token: users.restricted.token, body: { code: 'TS-DUP' } })).status,
      409
    );
    assert.equal((await lookupRateLimitDoc(users.restricted.uid).get()).data().count, 10);

    // Bloqueado: até uma consulta que daria certo recebe 429, sem dado nenhum.
    for (const code of ['TS-01', 'TS-02', 'TS-INEXISTENTE']) {
      const blocked = await callStatus({ token: users.restricted.token, body: { code } });

      assert.equal(blocked.status, 429, code);
      assert.deepEqual(
        blocked.body,
        {
          success: false,
          message: 'Muitas consultas sem resultado. Aguarde e tente novamente.',
          code: 'TOOL_LOOKUP_RATE_LIMITED',
        },
        code
      );
      assertNoLeak(blocked, code);
    }

    // O contador é por uid: outro usuário continua consultando normalmente.
    assert.equal(
      (await callStatus({ token: users.standard.token, body: { code: 'TS-01' } })).status,
      200
    );

    // Documento do contador: só contagem e janela, nunca o código consultado.
    assert.deepEqual(
      Object.keys((await lookupRateLimitDoc(users.restricted.uid).get()).data()).sort(),
      ['count', 'updatedAt', 'windowStart']
    );
  });

  test('12 rate limit: liberado após a janela de 60 s; a primeira falha nova reinicia a contagem', async () => {
    await resetRateLimits();
    await lookupRateLimitDoc(users.restricted.uid).set({
      count: 10,
      windowStart: Date.now() - 61 * 1000,
      updatedAt: Date.now() - 61 * 1000,
    });

    const released = await callStatus({ token: users.restricted.token, body: { code: 'TS-01' } });

    assertToolShape(released, 'liberado');

    assert.equal(
      (await callStatus({ token: users.restricted.token, body: { code: 'TS-INEXISTENTE' } })).status,
      404
    );
    assert.equal((await lookupRateLimitDoc(users.restricted.uid).get()).data().count, 1);

    // Ainda dentro da janela, mas abaixo do limite: não bloqueia.
    await lookupRateLimitDoc(users.restricted.uid).set({
      count: 9,
      windowStart: Date.now() - 30 * 1000,
      updatedAt: Date.now(),
    });
    assertToolShape(
      await callStatus({ token: users.restricted.token, body: { code: 'TS-01' } }),
      'abaixo do limite'
    );
  });

  test('13 rate limit não interfere no limite de crachá (e vice-versa)', async () => {
    await resetRateLimits();

    // Falhas de consulta não tocam o contador de crachá do mesmo uid.
    for (let index = 0; index < 10; index += 1) {
      await callStatus({ token: users.restricted.token, body: { code: `TS-Y-${index}` } });
    }
    assert.equal(
      (await callStatus({ token: users.restricted.token, body: { code: 'TS-01' } })).status,
      429
    );
    assert.equal((await badgeRateLimitDoc(users.restricted.uid).get()).exists, false);

    // Com a consulta bloqueada, a Movement API não responde 429 ao mesmo uid: segue para a própria
    // validação (ferramenta inexistente -> 404, que não é falha de crachá e não grava contador).
    const movement = await callHandler(movementApi, {
      token: users.restricted.token,
      body: {
        action: 'loan',
        toolId: 'ts-inexistente',
        toolCode: 'TS-INEXISTENTE',
        collaboratorBadge: 'B-INEXISTENTE',
        device: 'Navegador de Teste',
      },
    });

    assert.equal(movement.status, 404);
    assert.equal((await badgeRateLimitDoc(users.restricted.uid).get()).exists, false);

    // Contador de crachá esgotado não bloqueia a consulta de status.
    await resetRateLimits();
    await badgeRateLimitDoc(users.restricted.uid).set({
      count: 5,
      windowStart: Date.now(),
      updatedAt: Date.now(),
    });
    assertToolShape(
      await callStatus({ token: users.restricted.token, body: { code: 'TS-01' } }),
      'crachá bloqueado'
    );
    assert.equal((await lookupRateLimitDoc(users.restricted.uid).get()).exists, false);

    await resetRateLimits();
  });

  test('14 tipos: name e category não textuais viram null; code e status textuais preservados', async () => {
    for (const key of ['admin', 'standard', 'restricted']) {
      const result = await callStatus({ token: users[key].token, body: { code: 'TS-04' } });

      assertToolShape(result, key);
      assert.equal(result.body.data.tool.code, 'TS-04', key);
      assert.equal(result.body.data.tool.name, null, key);
      assert.equal(result.body.data.tool.category, null, key);
      assert.equal(result.body.data.tool.status, 'available', key);
      assertNoLeak(result, key);
    }
  });

  test('15 status não textual ou ausente: 500 genérico, log só com o id, sem contar no rate limit', async () => {
    await resetRateLimits();

    const cases = [
      ['TS-05', 'ts-bad-status-1'],
      ['TS-06', 'ts-bad-status-2'],
      ['TS-07', 'ts-no-status-1'],
    ];

    for (const [code, id] of cases) {
      for (const key of ['admin', 'standard', 'restricted']) {
        const label = `${code} ${key}`;
        const result = await callStatus({ token: users[key].token, body: { code } });

        assert.equal(result.status, 500, label);
        assert.deepEqual(
          result.body,
          { success: false, message: 'Erro interno ao consultar a ferramenta.' },
          label
        );
        assert.ok(!('data' in result.body), label);

        const errorLines = result.logged
          .split('\n')
          .filter((line) => line.startsWith('Status inválido no documento da ferramenta:'));

        assert.deepEqual(errorLines, [`Status inválido no documento da ferramenta: ${id}`], label);
        assertNoLeak(result, label);
        // Nem o nome da ferramenta nem o valor do status aparecem no log.
        assert.ok(!result.logged.includes('Status Objeto'), label);
        assert.ok(!result.logged.includes('holder'), label);
      }
    }

    // 500 por inconsistência de dados não é falha de enumeração: não grava contador.
    for (const key of ['admin', 'standard', 'restricted']) {
      assert.equal((await lookupRateLimitDoc(users[key].uid).get()).exists, false, key);
    }
  });

  // Gate 1-F4.C4-FIX2: Timestamp (gravado pelo Admin SDK) vira 'AAAA-MM-DD' pelo dia UTC, o mesmo
  // referencial do cliente (`new Date('AAAA-MM-DD')` = meia-noite UTC, scanner.js). O bloqueio de
  // empréstimo da Movement API compara o instante exato (getMaintenanceDate em movement.js): os dois
  // concordam no passado e no futuro; no mesmo dia, o cliente pode avisar antes do bloqueio, nunca
  // depois.
  test('16 nextMaintenance Timestamp: dia UTC "AAAA-MM-DD", coerente com o bloqueio da Movement API', async () => {
    await resetRateLimits();

    const now = Date.now();
    const startOfTodayUtc = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate()
    );
    const today = new Date(startOfTodayUtc).toISOString().slice(0, 10);
    const cases = [
      ['TS-TSP-PAST', 'ts-timestamp-past', Timestamp.fromMillis(Date.UTC(2020, 0, 15, 12)), '2020-01-15'],
      ['TS-TSP-FUTURE', 'ts-timestamp-future', Timestamp.fromMillis(Date.UTC(2099, 11, 31, 12)), '2099-12-31'],
      ['TS-TSP-TODAY-START', 'ts-timestamp-today-start', Timestamp.fromMillis(startOfTodayUtc), today],
      [
        'TS-TSP-TODAY-END',
        'ts-timestamp-today-end',
        Timestamp.fromMillis(startOfTodayUtc + 24 * 60 * 60 * 1000 - 1),
        today,
      ],
    ];

    for (const [code, id, nextMaintenance] of cases) {
      await adminDb.doc(`${BASE}/tools/${id}`).set({
        code,
        name: `Timestamp ${code}`,
        category: 'Manual',
        status: 'available',
        currentUser: 'Colaborador Sigma',
        currentCollaboratorId: 'cs1',
        lastAction: null,
        nextMaintenance,
        lastMaintenanceBy: 'Admin Sigma Manutencao',
      });
    }

    for (const [code, id, nextMaintenance, expected] of cases) {
      for (const key of ['admin', 'standard', 'restricted']) {
        const label = `${code} ${key}`;
        const result = await callStatus({ token: users[key].token, body: { code } });

        assertToolShape(result, label);
        assert.equal(result.body.data.tool.nextMaintenance, expected, label);
        assertNoLeak(result, label);
      }

      // Regra do cliente sobre o texto devolvido x bloqueio real do servidor para o mesmo Timestamp
      // (crachá inexistente: a manutenção é verificada antes do crachá, movement.js registerLoan).
      const clientOverdue = new Date(expected).getTime() < Date.now();
      const movement = await callHandler(movementApi, {
        token: users.admin.token,
        body: {
          action: 'loan',
          toolId: id,
          toolCode: code,
          collaboratorBadge: 'B-INEXISTENTE',
          device: 'Navegador de Teste',
        },
      });
      const serverBlocks = movement.body?.message === 'Ferramenta com manutenção vencida.';

      assert.equal(serverBlocks, nextMaintenance.toMillis() < Date.now(), `${code} servidor`);
      if (code === 'TS-TSP-TODAY-END') {
        // Mesmo dia, instante ainda futuro: o cliente já avisa; o servidor ainda não bloqueia.
        assert.equal(clientOverdue, true, code);
        assert.equal(serverBlocks, false, code);
      } else {
        assert.equal(clientOverdue, serverBlocks, code);
      }
      assert.ok(!serverBlocks || clientOverdue, `${code}: servidor bloqueia sem aviso no cliente`);
    }

    for (const [, id] of cases) {
      await adminDb.doc(`${BASE}/tools/${id}`).delete();
    }
    await resetRateLimits();
  });

  test('17 nextMaintenance de outro tipo: objeto, número, array e data inválida viram null; texto passa', async () => {
    const cases = [
      ['TS-NM-OBJECT', { owner: 'Colaborador Sigma', toDate: 'cs1' }, null],
      ['TS-NM-NUMBER', 1700000000000, null],
      ['TS-NM-ARRAY', ['2020-01-01', 'Colaborador Sigma'], null],
      ['TS-NM-MAP-DATE', { seconds: 1700000000, nanoseconds: 0 }, null],
      ['TS-NM-TEXT', '2031-05-20', '2031-05-20'],
    ];

    for (const [code, nextMaintenance] of cases) {
      await adminDb.doc(`${BASE}/tools/${code.toLowerCase()}`).set({
        code,
        name: `Tipo ${code}`,
        category: 'Manual',
        status: 'available',
        currentUser: null,
        currentCollaboratorId: null,
        lastAction: null,
        nextMaintenance,
      });
    }

    for (const [code, , expected] of cases) {
      for (const key of ['admin', 'standard', 'restricted']) {
        const label = `${code} ${key}`;
        const result = await callStatus({ token: users[key].token, body: { code } });

        assertToolShape(result, label);
        assert.equal(result.body.data.tool.nextMaintenance, expected, label);
        assertNoLeak(result, label);
      }
    }

    for (const [code] of cases) {
      await adminDb.doc(`${BASE}/tools/${code.toLowerCase()}`).delete();
    }
  });
});
