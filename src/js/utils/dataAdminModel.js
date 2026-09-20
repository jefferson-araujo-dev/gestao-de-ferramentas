/**
 * dataAdminModel - regras PURAS da tela "Dados e backup" (Gate 1-F1). Sem DOM e sem Firebase:
 * roda no navegador e nos testes de unidade.
 *
 * Não altera o contrato v4 (backupContract.js): apenas o usa. Nenhuma função aqui registra o
 * conteúdo do backup (PII): mensagens e códigos de erro não carregam dados.
 */
import { LEGACY_BACKUP_VERSION, normalizeBackup, verifyBackupDataHash } from './backupContract.js';

export const MAX_RESTORE_FILE_BYTES = 4000000;
export const HISTORY_RETENTION_DAYS = 30;
// Palavras digitadas na confirmação reforçada (a confirmação exigida pela API é outra, interna).
export const RESTORE_CONFIRM_WORD = 'RESTAURAR';
export const RESET_CONFIRM_WORD = 'RESETAR';

export const INSPECTION_STAGES = Object.freeze([
  'extension',
  'size',
  'json',
  'schema',
  'hash',
  'ready'
]);

export function formatFileSize(bytes) {
  const size = Number(bytes);

  if (!Number.isFinite(size) || size < 0) {
    return '—';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1).replace('.', ',')} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function formatDateTime(iso) {
  const time = Date.parse(iso);

  return Number.isNaN(time) ? '—' : new Date(time).toLocaleString('pt-BR');
}

// Backup mais antigo que a atividade mais recente registrada: restaurá-lo apaga essa atividade.
export function isStaleBackup(exportedAt, latestActivity) {
  const exported = Date.parse(exportedAt);

  return latestActivity !== null && !Number.isNaN(exported) && latestActivity > exported;
}

const SCHEMA_MESSAGES = Object.freeze({
  UNSUPPORTED_SCHEMA_VERSION: 'Versão de schema não suportada. Aceitos: 4.0 e o legado 3.0.',
  UNSUPPORTED_VERSION: 'Formato não reconhecido. Aceitos: schema 4.0 e o legado 3.0.',
  INVALID_BACKUP_SHAPE: 'O conteúdo não tem a estrutura de um backup do sistema.',
  EMPTY_BACKUP: 'O backup não contém ferramentas, colaboradores nem histórico.'
});

/**
 * Inspeciona um arquivo de backup SEM enviá-lo a lugar nenhum: extensão, tamanho, JSON, schema
 * (contrato v4 / adaptador legado 3.0) e hash. `file` precisa de { name, size, text() }.
 *
 * Devolve { ok, stage, message, codes, errorCount, fileName, fileSize, meta, stale, payload }.
 * `payload` é o JSON lido (necessário para a restauração) e nunca deve ser exibido nem logado.
 */
export async function inspectBackupFile(file, { latestActivity = null } = {}) {
  const fileName = String(file?.name ?? '');
  const fileSize = Number(file?.size ?? 0);
  const base = {
    fileName,
    fileSize,
    meta: null,
    stale: false,
    payload: null,
    codes: [],
    errorCount: 0
  };
  const fail = (stage, message, extra = {}) => ({ ...base, ok: false, stage, message, ...extra });

  if (!fileName.toLowerCase().endsWith('.json')) {
    return fail('extension', 'Selecione um arquivo com a extensão .json.');
  }

  if (fileSize > MAX_RESTORE_FILE_BYTES) {
    return fail(
      'size',
      `O arquivo excede o tamanho máximo aceito para restauração (${formatFileSize(MAX_RESTORE_FILE_BYTES)}).`
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return fail('json', 'O arquivo não é um JSON válido.');
  }

  const validation = normalizeBackup(parsed, { requireNonEmpty: true });

  if (!validation.ok) {
    const codes = [...new Set(validation.errors.map((error) => error.code))];
    const known = codes.find((code) => SCHEMA_MESSAGES[code]);
    const message = known
      ? SCHEMA_MESSAGES[known]
      : `Backup inválido: ${validation.errorCount} problema(s) (${codes.join(', ')}).`;

    return fail('schema', message, { codes, errorCount: validation.errorCount });
  }

  const { meta } = validation;

  if (!meta.legacy && !(await verifyBackupDataHash(validation.backup)).ok) {
    return fail(
      'hash',
      'O hash do backup não confere: o arquivo pode ter sido alterado ou corrompido.',
      {
        meta
      }
    );
  }

  return {
    ...base,
    ok: true,
    stage: 'ready',
    message: '',
    meta,
    stale: isStaleBackup(meta.exportedAt, latestActivity),
    payload: parsed
  };
}

// Linhas do que a restauração fará (ConfirmDialog e revisão): concretas, sem "Tem certeza?".
export function restoreDetails(meta, { fileName = '' } = {}) {
  const lines = [];

  if (fileName) {
    lines.push(`Arquivo: ${fileName}`);
  }

  lines.push(
    `Formato ${meta.sourceSchema}, exportado em ${formatDateTime(meta.exportedAt)}.`,
    `Serão restaurados: ${meta.counts.tools} ferramenta(s), ${meta.counts.collaborators} colaborador(es) e ${meta.counts.history} registro(s) de histórico.`
  );

  if (meta.legacy) {
    lines.push(
      `Backup legado ${LEGACY_BACKUP_VERSION}: será adaptado; ${meta.statusDefaulted} colaborador(es) sem status receberão "active".`
    );
  }

  lines.push(
    'Ferramentas, colaboradores e histórico atuais serão SUBSTITUÍDOS pelo conteúdo do arquivo.',
    'Usuários e contas de acesso são preservados: os usuários do backup nunca são restaurados.',
    'Um backup de segurança do estado atual é baixado antes de qualquer alteração.'
  );

  return lines;
}

// Resultado de um erro da API de backup, sem exibir nada além do que o servidor já publica.
export function describeBackupApiError(error, actionLabel) {
  const details = error?.details;

  if (details?.incident === true) {
    return {
      kind: 'incident',
      message: `INCIDENTE na ${actionLabel}: o servidor não conseguiu reverter ao estado anterior. Não repita a operação, guarde o backup de segurança baixado e avise um administrador do sistema.`,
      persistent: true
    };
  }

  if (details?.rolledBack === true) {
    return {
      kind: 'rolled-back',
      message: `A ${actionLabel} falhou na verificação e o estado anterior foi restaurado automaticamente. Nenhum dado foi perdido.`,
      duration: 10000
    };
  }

  if (details?.applied === false) {
    return {
      kind: 'not-applied',
      message: `A ${actionLabel} não foi aplicada. Nenhum dado foi alterado.`,
      duration: 10000
    };
  }

  return {
    kind: 'error',
    message: `Erro na ${actionLabel}: ${error?.message || error}`,
    duration: 10000
  };
}
