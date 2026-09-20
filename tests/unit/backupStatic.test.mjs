import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (relativePath) => readFileSync(new URL(relativePath, root), 'utf8');
const exists = (relativePath) => existsSync(new URL(relativePath, root));

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assert.ok(start >= 0 && end > start, `marcadores nao encontrados: ${startMarker} .. ${endMarker}`);
  return source.slice(start, end);
}

const AUTH_MUTATION_PATTERN =
  /adminAuth|firebase-admin\/auth|getAuth\(|createUser|deleteUser|updateUser|setCustomUserClaims|revokeRefreshTokens|generatePasswordResetLink|importUsers/;
const SECRET_PATTERN = /BEGIN (RSA |EC )?PRIVATE KEY|private_key|AIza[0-9A-Za-z_-]{20,}|client_secret/;

const restoreApi = read('api/backup/restore.js');
const resetApi = read('api/backup/reset.js');
const serverCore = read('server/backup-operations.js');
const contract = read('src/js/utils/backupContract.js');
const dataModule = read('src/js/modules/data.js');
const cli = read('scripts/backup-database.mjs');

describe('seguranca estatica - APIs de backup', () => {
  for (const [name, source] of [
    ['restore', restoreApi],
    ['reset', resetApi],
  ]) {
    test(`${name}: somente POST e requireActiveAdmin antes de ler o corpo`, () => {
      assert.match(source, /req\.method !== 'POST'/);
      assert.match(source, /requireActiveAdmin\(req\)/);
      assert.ok(source.indexOf('requireActiveAdmin(req)') < source.indexOf('parseRequestBody(req);'));
      assert.doesNotMatch(source, /requireActiveUser/);
    });

    test(`${name}: nenhum caminho/collection derivado da entrada`, () => {
      assert.doesNotMatch(source, /body\.(collection|path|collections|db)/);
      assert.doesNotMatch(source, /\.collection\(|\.doc\(/);
    });
  }

  test('restore/reset exigem a confirmacao explicita esperada', () => {
    assert.match(restoreApi, /body\.confirmation !== RESTORE_CONFIRMATION/);
    assert.match(resetApi, /body\.confirmation !== RESET_CONFIRMATION/);
    assert.match(serverCore, /RESTORE_CONFIRMATION = 'RESTORE_OPERATIONAL_DATA'/);
    assert.match(serverCore, /RESET_CONFIRMATION = 'RESET_OPERATIONAL_DATA'/);
  });

  test('AUTH_MUTATIONS_IN_BACKUP_APIS=0', () => {
    for (const [file, source] of [
      ['api/backup/restore.js', restoreApi],
      ['api/backup/reset.js', resetApi],
      ['server/backup-operations.js', serverCore],
      ['src/js/utils/backupContract.js', contract],
    ]) {
      assert.doesNotMatch(source, AUTH_MUTATION_PATTERN, file);
    }
  });

  test('nenhum segredo embutido nos arquivos novos', () => {
    for (const [file, source] of [
      ['api/backup/restore.js', restoreApi],
      ['api/backup/reset.js', resetApi],
      ['server/backup-operations.js', serverCore],
      ['src/js/utils/backupContract.js', contract],
      ['scripts/backup-database.mjs', cli],
    ]) {
      assert.doesNotMatch(source, SECRET_PATTERN, file);
    }
  });
});

describe('seguranca estatica - nucleo server-side', () => {
  test('imports restritos (sem firebase-admin.js, sem Auth)', () => {
    const imports = [...serverCore.matchAll(/from '([^']+)'/g)].map((match) => match[1]).sort();

    assert.deepEqual(imports, [
      '../src/js/utils/backupContract.js',
      'firebase-admin/firestore',
      'node:crypto',
    ]);
  });

  test('DB path fixo e limite de 500 mutacoes', () => {
    assert.match(
      serverCore,
      /BACKUP_BASE_PATH = 'artifacts\/gestao-de-ferramentas-3f8f1\/public\/data'/
    );
    assert.match(serverCore, /MAX_ATOMIC_MUTATIONS = 500/);
    assert.doesNotMatch(serverCore, /\breq\b|\bbody\b/);
  });

  test('exatamente uma WriteBatch e um commit por plano (applyPlan)', () => {
    assert.equal((serverCore.match(/db\.batch\(\)/g) ?? []).length, 1);
    assert.equal((serverCore.match(/batch\.commit\(\)/g) ?? []).length, 1);
    assert.equal((serverCore.match(/batch\.set\(/g) ?? []).length, 1);
    assert.equal((serverCore.match(/batch\.delete\(/g) ?? []).length, 1);
    assert.doesNotMatch(serverCore, /batch\.(update|create)\(|runTransaction|bulkWriter|recursiveDelete/);
  });

  test('mutacoes nunca alcancam users: applyPlan usa somente collections restauraveis', () => {
    const applyPlan = sliceBetween(serverCore, 'async function applyPlan', 'async function verifyState');

    assert.doesNotMatch(applyPlan, /users|USERS_COLLECTION|allowUsers/i);
    assert.match(applyPlan, /collectionRef\(db, item\.collection\)/);
    assert.equal((serverCore.match(/allowUsers: true/g) ?? []).length, 1);
    assert.match(serverCore, /readCollection\(db, USERS_COLLECTION, \{ allowUsers: true \}\)/);
  });

  test('whitelist de collections vem do contrato (tools, collaborators, history)', () => {
    assert.match(contract, /RESTORABLE_COLLECTIONS = Object\.freeze\(\['tools', 'collaborators', 'history'\]\)/);
    assert.match(serverCore, /assertKnownCollection/);
  });
});

describe('cliente - restore/reset sem escrita direta no Firestore', () => {
  const importJson = sliceBetween(dataModule, '  importJSON: async function', '  exportExcel: async function');
  const resetAll = sliceBetween(dataModule, '  resetAllData: async function', '  exportJSON: async function');
  const exportJson = sliceBetween(dataModule, '  exportJSON: async function', '  latestKnownActivity: function');
  const FIRESTORE_WRITES = /\b(deleteDoc|setDoc|updateDoc|addDoc|writeBatch|runTransaction)\s*\(/;

  test('importJSON e resetAllData nao chamam deleteDoc/setDoc/etc.', () => {
    assert.doesNotMatch(importJson, FIRESTORE_WRITES);
    assert.doesNotMatch(resetAll, FIRESTORE_WRITES);
    assert.doesNotMatch(dataModule.slice(0, dataModule.indexOf('export const AppData')), /\bsetDoc\b/);
  });

  test('guarda canBackupData, chamada de API e reinit com permissions', () => {
    for (const source of [importJson, resetAll, exportJson]) {
      assert.match(source, /canBackupData !== true/);
    }

    assert.match(importJson, /\/api\/backup\/restore/);
    assert.match(resetAll, /\/api\/backup\/reset/);

    for (const source of [importJson, resetAll]) {
      assert.match(source, /window\.App\.Data\.init\(window\.App\.Auth\.permissions\)/);
      assert.doesNotMatch(source, /\.init\(\s*\)/);
    }
  });

  test('backup de seguranca automatico antes de restore e de reset', () => {
    assert.match(importJson, /filenamePrefix: 'pre_restore'/);
    assert.match(resetAll, /filenamePrefix: 'pre_reset'/);
    assert.ok(importJson.indexOf("filenamePrefix: 'pre_restore'") < importJson.indexOf('/api/backup/restore'));
    assert.ok(resetAll.indexOf("filenamePrefix: 'pre_reset'") < resetAll.indexOf('/api/backup/reset'));
  });

  test('importJSON valida localmente com o contrato antes de qualquer chamada', () => {
    assert.match(importJson, /normalizeBackup\(parsed, \{ requireNonEmpty: true \}\)/);
    assert.ok(importJson.indexOf('normalizeBackup(') < importJson.indexOf('requestBackupApi('));
  });

  test('exportJSON gera somente o schema v4 e restringe o prefixo do nome', () => {
    assert.match(exportJson, /buildBackupV4\(/);
    assert.match(dataModule, /SAFETY_BACKUP_PREFIXES = Object\.freeze\(\['pre_restore', 'pre_reset'\]\)/);
    assert.match(dataModule, /BACKUP_FILENAME_BASE = 'backup_gestao_ferramentas_v4'/);
  });

  test('rotulo do botao de reset atualizado', () => {
    assert.match(read('src/partials/layout/header.html'), /Resetar dados operacionais/);
    assert.doesNotMatch(read('src/partials/layout/header.html'), /Resetar Dados/);
  });
});

describe('limpeza - codigo morto, CLI e versionamento', () => {
  test('AutoBackupManager e config morta removidos', () => {
    assert.equal(exists('src/js/core/AutoBackupManager.js'), false);
    const constants = read('src/js/config/constants.js');

    assert.doesNotMatch(constants, /ENABLE_AUTO_BACKUP|AUTO_BACKUP_INTERVAL/);
    assert.doesNotMatch(read('src/js/core/index.js'), /AutoBackup/);
  });

  test('CLI unico: falha em erro de leitura, v4, fora do repositorio', () => {
    assert.equal(exists('scripts/export-firebase-data.mjs'), false);
    const pkg = JSON.parse(read('package.json'));

    assert.equal(pkg.scripts.export, undefined);
    assert.doesNotMatch(JSON.stringify(pkg.scripts), /export-firebase-data/);
    assert.equal(pkg.scripts.backup, 'node scripts/backup-database.mjs');
    assert.doesNotMatch(cli, /=\s*\[\];?\s*\n\s*\}/);
    assert.match(cli, /process\.exit\(1\)/);
    assert.match(cli, /buildBackupV4/);
    assert.match(cli, /BACKUP_OUTPUT_DIR/);
    assert.match(cli, /isInsideRepository/);
  });

  test('gitignore cobre os padroes de backup', () => {
    const gitignore = read('.gitignore');

    for (const pattern of [
      'backup-*.json',
      'backup_*.json',
      'backup_gestao_ferramentas*.json',
      'firebase-data-export.json',
    ]) {
      assert.ok(gitignore.split(/\r?\n/).includes(pattern), pattern);
    }
  });

  test('nenhum backup JSON versionado', (t) => {
    let files;

    try {
      files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/);
    } catch {
      t.skip('git indisponivel neste ambiente');
      return;
    }

    const offenders = files.filter((file) =>
      /(^|\/)(backup[-_][^/]*|firebase-data-export|pre_(restore|reset)_[^/]*)\.json$/.test(file)
    );

    assert.deepEqual(offenders, []);
  });
});
