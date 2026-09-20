import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { buildBackupV4 } from '../../src/js/utils/backupContract.js';
import {
  HISTORY_RETENTION_DAYS,
  MAX_RESTORE_FILE_BYTES,
  RESET_CONFIRM_WORD,
  RESTORE_CONFIRM_WORD,
  describeBackupApiError,
  formatFileSize,
  inspectBackupFile,
  isStaleBackup,
  restoreDetails,
} from '../../src/js/utils/dataAdminModel.js';

// Modelo puro da tela "Dados e backup" (Gate 1-F1). Sem navegador, sem Firebase, sem rede.
const SENTINEL_NAME = 'Fulano Sentinela';
const EXPORTED_AT = '2026-09-20T12:00:00.000Z';

const parts = () => ({
  tools: [{ id: 'T-001', code: 'T-001', name: 'Furadeira', category: 'Eletrica', status: 'available' }],
  collaborators: [{ id: 'c1', name: SENTINEL_NAME, badge: '10', role: 'Operador', status: 'active' }],
  history: [
    {
      id: 'h1',
      date: '2026-09-01T10:00:00.000Z',
      type: 'maintenance',
      toolId: 'T-001',
      toolCode: 'T-001',
      toolName: 'Furadeira',
      user: 'Admin',
    },
  ],
  users: [
    {
      id: 'u1',
      name: 'Admin',
      email: 'admin@example.test',
      accessLevel: 'Administrador',
      department: 'TI',
      status: 'Ativo',
      isRestricted: false,
    },
  ],
});

const fileOf = (name, text, size = Buffer.byteLength(text)) => ({ name, size, text: async () => text });

const v4File = async (name = 'backup.json') => {
  const backup = await buildBackupV4(parts(), { exportedAt: EXPORTED_AT });

  return { backup, file: fileOf(name, JSON.stringify(backup)) };
};

describe('inspectBackupFile: etapas SELECIONAR -> VALIDAR (nada é enviado)', () => {
  test('backup v4 válido: pronto, com resumo e sem alterar o payload', async () => {
    const { backup, file } = await v4File('meu-backup.json');
    const result = await inspectBackupFile(file);

    assert.equal(result.ok, true);
    assert.equal(result.stage, 'ready');
    assert.equal(result.fileName, 'meu-backup.json');
    assert.equal(result.meta.sourceSchema, '4.0');
    assert.equal(result.meta.legacy, false);
    assert.deepEqual(result.meta.counts, { tools: 1, collaborators: 1, history: 1 });
    assert.deepEqual(result.payload, backup);
    assert.equal(result.stale, false);
  });

  test('extensão diferente de .json é recusada sem ler o arquivo', async () => {
    let read = false;
    const file = { name: 'backup.txt', size: 10, text: async () => ((read = true), '{}') };
    const result = await inspectBackupFile(file);

    assert.equal(result.ok, false);
    assert.equal(result.stage, 'extension');
    assert.equal(read, false);
    assert.equal(result.payload, null);
  });

  test('arquivo acima do limite é recusado sem ler o conteúdo', async () => {
    let read = false;
    const file = {
      name: 'grande.json',
      size: MAX_RESTORE_FILE_BYTES + 1,
      text: async () => ((read = true), '{}'),
    };
    const result = await inspectBackupFile(file);

    assert.equal(result.stage, 'size');
    assert.match(result.message, /tamanho máximo/);
    assert.equal(read, false);
  });

  test('JSON inválido e arquivo vazio', async () => {
    for (const text of ['{ quebrado', '']) {
      const result = await inspectBackupFile(fileOf('x.json', text));

      assert.equal(result.ok, false);
      assert.equal(result.stage, 'json');
      assert.equal(result.message, 'O arquivo não é um JSON válido.');
    }
  });

  test('schema desconhecido, versão não suportada e forma inválida têm mensagem útil', async () => {
    const unknown = await inspectBackupFile(fileOf('x.json', JSON.stringify({ hello: 'world' })));
    const future = await inspectBackupFile(fileOf('x.json', JSON.stringify({ schemaVersion: '999.0' })));
    const shape = await inspectBackupFile(fileOf('x.json', JSON.stringify([1, 2, 3])));

    assert.equal(unknown.stage, 'schema');
    assert.match(unknown.message, /Formato não reconhecido/);
    assert.deepEqual(unknown.codes, ['UNSUPPORTED_VERSION']);
    assert.match(future.message, /Versão de schema não suportada/);
    assert.match(shape.message, /estrutura de um backup/);
  });

  test('backup vazio é recusado (requireNonEmpty)', async () => {
    const empty = await buildBackupV4({}, { exportedAt: EXPORTED_AT });
    const result = await inspectBackupFile(fileOf('vazio.json', JSON.stringify(empty)));

    assert.equal(result.ok, false);
    assert.equal(result.stage, 'schema');
    assert.deepEqual(result.codes, ['EMPTY_BACKUP']);
  });

  test('hash adulterado: recusa o arquivo por integridade', async () => {
    const { backup } = await v4File();

    backup.data.tools[0].name = 'Adulterada';

    const result = await inspectBackupFile(fileOf('adulterado.json', JSON.stringify(backup)));

    assert.equal(result.ok, false);
    assert.ok(['hash', 'schema'].includes(result.stage));
    assert.equal(result.payload, null);
  });

  test('backup legado 3.0 continua aceito (adaptador) e é sinalizado', async () => {
    const legacy = {
      exportDate: EXPORTED_AT,
      version: '3.0',
      data: {
        tools: parts().tools,
        users: [{ id: 'u1', name: 'Admin', email: 'a@example.test', accessLevel: 'Administrador' }],
        collaborators: [{ id: 'c1', name: SENTINEL_NAME, badge: '10', role: 'Operador' }],
        history: parts().history,
      },
    };
    const result = await inspectBackupFile(fileOf('legado.json', JSON.stringify(legacy)));

    assert.equal(result.ok, true, JSON.stringify(result.codes));
    assert.equal(result.meta.legacy, true);
    assert.equal(result.meta.sourceSchema, '3.0');
    assert.equal(result.meta.statusDefaulted, 1);
    // Users do backup legado nunca entram nos dados restauráveis.
    assert.equal(result.payload.data.users.length, 1);
    assert.ok(restoreDetails(result.meta).some((line) => line.includes('legado 3.0')));
  });

  test('backup mais antigo que a atividade mais recente é marcado como stale', async () => {
    const { file } = await v4File();
    const newer = Date.parse(EXPORTED_AT) + 60_000;
    const older = Date.parse(EXPORTED_AT) - 60_000;

    assert.equal((await inspectBackupFile(file, { latestActivity: newer })).stale, true);
    assert.equal((await inspectBackupFile(file, { latestActivity: older })).stale, false);
    assert.equal((await inspectBackupFile(file, { latestActivity: null })).stale, false);
  });

  test('nenhuma mensagem de erro carrega dados do backup (PII)', async () => {
    const backup = await buildBackupV4(parts(), { exportedAt: EXPORTED_AT });

    backup.data.collaborators[0].status = 'valor-invalido';

    const result = await inspectBackupFile(fileOf('x.json', JSON.stringify(backup)));

    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify({ ...result, payload: null }), new RegExp(SENTINEL_NAME));
    assert.doesNotMatch(result.message, /admin@example\.test/);
  });
});

describe('utilitários da tela', () => {
  test('formatFileSize', () => {
    assert.equal(formatFileSize(0), '0 B');
    assert.equal(formatFileSize(1023), '1023 B');
    assert.equal(formatFileSize(1536), '1,5 KB');
    assert.equal(formatFileSize(3 * 1024 * 1024), '3,0 MB');
    assert.equal(formatFileSize(-1), '—');
    assert.equal(formatFileSize('abc'), '—');
  });

  test('isStaleBackup', () => {
    assert.equal(isStaleBackup(EXPORTED_AT, Date.parse(EXPORTED_AT) + 1), true);
    assert.equal(isStaleBackup(EXPORTED_AT, Date.parse(EXPORTED_AT)), false);
    assert.equal(isStaleBackup(EXPORTED_AT, null), false);
    assert.equal(isStaleBackup('data ruim', 1), false);
  });

  test('palavras da confirmação reforçada e retenção do histórico', () => {
    assert.equal(RESTORE_CONFIRM_WORD, 'RESTAURAR');
    assert.equal(RESET_CONFIRM_WORD, 'RESETAR');
    assert.equal(HISTORY_RETENTION_DAYS, 30);
    assert.notEqual(RESTORE_CONFIRM_WORD, 'RESTORE_OPERATIONAL_DATA');
    assert.notEqual(RESET_CONFIRM_WORD, 'RESET_OPERATIONAL_DATA');
  });

  test('restoreDetails descreve o efeito concreto (substitui, users preservados, backup de segurança)', async () => {
    const { file } = await v4File();
    const { meta } = await inspectBackupFile(file);
    const text = restoreDetails(meta, { fileName: 'meu.json' }).join('\n');

    assert.match(text, /Arquivo: meu\.json/);
    assert.match(text, /1 ferramenta\(s\), 1 colaborador\(es\) e 1 registro\(s\) de histórico/);
    assert.match(text, /SUBSTITUÍDOS/);
    assert.match(text, /nunca são restaurados/);
    assert.match(text, /backup de segurança/);
    assert.doesNotMatch(text, /Tem certeza/i);
    assert.doesNotMatch(text, new RegExp(SENTINEL_NAME));
  });
});

describe('describeBackupApiError: mensagens da API sem inventar detalhes', () => {
  const err = (details, message = 'falha') => Object.assign(new Error(message), { details });

  test('incidente é persistente; rollback e não aplicada informam o estado dos dados', () => {
    const incident = describeBackupApiError(err({ incident: true }), 'restauração');
    const rolled = describeBackupApiError(err({ rolledBack: true }), 'restauração');
    const notApplied = describeBackupApiError(err({ applied: false }), 'reset');
    const generic = describeBackupApiError(err(undefined, 'Sem rede'), 'reset');

    assert.equal(incident.kind, 'incident');
    assert.equal(incident.persistent, true);
    assert.match(incident.message, /INCIDENTE na restauração/);
    assert.equal(rolled.kind, 'rolled-back');
    assert.match(rolled.message, /Nenhum dado foi perdido/);
    assert.equal(notApplied.kind, 'not-applied');
    assert.match(notApplied.message, /Nenhum dado foi alterado/);
    assert.equal(generic.kind, 'error');
    assert.match(generic.message, /Erro na reset: Sem rede/);
    assert.notEqual(generic.persistent, true);
  });
});

describe('tela Dados e backup: só tokens do design system (claro/escuro sem dark: ad hoc)', () => {
  const read = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');
  const css = read('css/data-admin.css');
  const tokens = read('css/tokens.css');
  const screen = read('js/modules/dataAdmin.js');
  const sources = {
    'css/data-admin.css': css,
    'js/modules/dataAdmin.js': screen,
    'partials/tabs/tab-data.html': read('partials/tabs/tab-data.html'),
  };

  test('sem dark:, sem !important, sem cor literal e sem onclick inline', () => {
    for (const [file, source] of Object.entries(sources)) {
      assert.doesNotMatch(source, /\bdark:/, `${file}: dark: ad hoc`);
      assert.doesNotMatch(source, /onclick=/, `${file}: onclick inline`);
    }

    assert.doesNotMatch(css, /!important/);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'cor literal no CSS da tela');
  });

  test('todo var(--token) usado existe em tokens.css', () => {
    const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]))];

    assert.ok(used.length > 10);

    for (const name of used) {
      assert.ok(tokens.includes(`${name}:`), `${name} ausente em tokens.css`);
    }
  });

  test('toda classe de layout da tela tem regra no CSS', () => {
    const classes = new Set(
      [...screen.matchAll(/class="(data-[a-z_-]+)/g)].map((match) => match[1])
    );

    assert.ok(classes.size >= 8);

    for (const name of classes) {
      assert.ok(css.includes(`.${name}`), `${name} sem regra em data-admin.css`);
    }
  });
});
