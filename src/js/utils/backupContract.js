/* eslint-disable comma-dangle -- o Prettier (trailingComma: es5) controla as vírgulas finais deste arquivo. */
/**
 * backupContract - Contrato canônico v4 de backup/restore (módulo puro).
 *
 * Sem dependência de DOM ou Firebase: roda no navegador, no Node (API/CLI) e nos testes.
 *
 * Contrato v4:
 *   { schemaVersion, exportedAt, source, summary, data, reference }
 *   - data: somente tools, collaborators e history (RESTORABLE_COLLECTIONS);
 *   - reference.users: referência administrativa redigida, NUNCA restaurável;
 *   - registros planos { id, ...campos } com Timestamps no formato explícito
 *     { __type: 'timestamp', seconds, nanoseconds };
 *   - summary.dataSha256: SHA-256 (hex maiúsculo) do JSON canônico de `data`.
 *
 * Adaptador legado: aceita o backup 3.0 ({ exportDate, version: '3.0', data }) e o converte
 * para v4 (users saem de `data`, collaborators sem status recebem "active").
 */

export const BACKUP_SCHEMA_VERSION = '4.0';
export const LEGACY_BACKUP_VERSION = '3.0';
export const BACKUP_APP_ID = 'gestao-de-ferramentas-3f8f1';
export const RESTORABLE_COLLECTIONS = Object.freeze(['tools', 'collaborators', 'history']);
export const BACKUP_GENERATORS = Object.freeze(['browser', 'cli', 'legacy-adapter']);
// 'borrowed' continua aceito: o restore (somente admin, Admin SDK) recupera o estado salvo, com os
// empréstimos que já existiam. Não é um novo empréstimo; esse só acontece pela API de movimentação.
export const TOOL_STATUSES = Object.freeze(['available', 'borrowed', 'maintenance']);
export const COLLABORATOR_STATUSES = Object.freeze(['active', 'inactive']);
export const HISTORY_TYPES = Object.freeze(['out', 'in', 'maintenance']);
export const USER_REFERENCE_FIELDS = Object.freeze([
  'id',
  'name',
  'email',
  'accessLevel',
  'department',
  'status',
  'isRestricted',
  'createdAt',
  'updatedAt',
  'lastLogin',
]);
export const MAX_DOCUMENT_BYTES = 1048576;
export const TIMESTAMP_TYPE = 'timestamp';

const LEGACY_TIMESTAMP_TYPE = 'firestore/timestamp/1.0';
const MAX_NANOSECONDS = 999999999;
const MAX_DOCUMENT_ID_BYTES = 1500;
const MAX_REPORTED_ERRORS = 50;
const SHA256_HEX = /^[0-9A-F]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const V4_KEYS = ['schemaVersion', 'exportedAt', 'source', 'summary', 'data', 'reference'];
const LEGACY_KEYS = ['exportDate', 'version', 'data'];
const LEGACY_COLLECTIONS = ['tools', 'users', 'collaborators', 'history'];

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const compareCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const utf8Length = (text) => new TextEncoder().encode(text).length;
const hasExactKeys = (object, keys) => {
  const actual = Object.keys(object).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const normalizeText = (value) =>
  String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

export function makeTimestamp(seconds, nanoseconds) {
  return { __type: TIMESTAMP_TYPE, seconds, nanoseconds };
}

function isValidTimestampParts(seconds, nanoseconds) {
  return (
    Number.isInteger(seconds) &&
    Number.isInteger(nanoseconds) &&
    nanoseconds >= 0 &&
    nanoseconds <= MAX_NANOSECONDS
  );
}

/** Timestamp no formato explícito do contrato v4. */
export function isExplicitTimestamp(value) {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ['__type', 'seconds', 'nanoseconds']) &&
    value.__type === TIMESTAMP_TYPE &&
    isValidTimestampParts(value.seconds, value.nanoseconds)
  );
}

/** Instância de Timestamp do Firestore (cliente ou Admin) ou objeto compatível. */
function isTimestampInstance(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.toDate === 'function' &&
    isValidTimestampParts(value.seconds, value.nanoseconds)
  );
}

/**
 * Formatos legados de Timestamp serializado:
 *  - navegador (SDK 11.x): { seconds, nanoseconds }
 *  - npm firebase 12.x:    { type: 'firestore/timestamp/1.0', seconds, nanoseconds }
 */
function isLegacyTimestampObject(value) {
  if (!isPlainObject(value)) {
    return false;
  }

  const isBrowserShape = hasExactKeys(value, ['seconds', 'nanoseconds']);
  const isNpmShape =
    hasExactKeys(value, ['type', 'seconds', 'nanoseconds']) && value.type === LEGACY_TIMESTAMP_TYPE;

  return (isBrowserShape || isNpmShape) && isValidTimestampParts(value.seconds, value.nanoseconds);
}

/**
 * Normaliza recursivamente um valor para a representação canônica:
 * Timestamps do Firestore -> formato explícito; com `legacy`, também os formatos legados.
 * Strings ISO permanecem strings.
 */
export function normalizeValue(value, { legacy = false } = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, { legacy }));
  }

  if (isTimestampInstance(value)) {
    return makeTimestamp(value.seconds, value.nanoseconds);
  }

  if (legacy && isLegacyTimestampObject(value)) {
    return makeTimestamp(value.seconds, value.nanoseconds);
  }

  if (isPlainObject(value)) {
    const result = {};

    for (const key of Object.keys(value)) {
      if (value[key] !== undefined) {
        result[key] = normalizeValue(value[key], { legacy });
      }
    }

    return result;
  }

  return value;
}

/** Procura objetos marcados como timestamp (__type) que não sigam o formato explícito. */
function containsInvalidTimestamp(value) {
  if (Array.isArray(value)) {
    return value.some(containsInvalidTimestamp);
  }

  if (isPlainObject(value)) {
    if (hasOwn(value, '__type')) {
      return !isExplicitTimestamp(value);
    }

    return Object.values(value).some(containsInvalidTimestamp);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Canonicalização e hash
// ---------------------------------------------------------------------------

/** JSON compacto com chaves ordenadas por code unit em todos os níveis. */
export function canonicalStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item === undefined ? null : item)).join(',')}]`;
  }

  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort(compareCodeUnits)
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

/**
 * JSON canônico de `data`: collections em ordem fixa (tools, collaborators, history),
 * registros ordenados por id (comparação simples de code units, sem localeCompare).
 */
export function canonicalDataString(data) {
  const parts = RESTORABLE_COLLECTIONS.map((name) => {
    const records = [...(data?.[name] ?? [])].sort((a, b) => compareCodeUnits(a.id, b.id));
    return `${JSON.stringify(name)}:${canonicalStringify(records)}`;
  });

  return `{${parts.join(',')}}`;
}

/** SHA-256 (hex maiúsculo) via Web Crypto. */
export async function sha256HexUpper(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function computeDataSha256(data) {
  return sha256HexUpper(canonicalDataString(data));
}

/** Confere summary.dataSha256 contra o hash recalculado de `data`. */
export async function verifyBackupDataHash(backup) {
  const actual = await computeDataSha256(backup.data);
  const expected = backup.summary?.dataSha256 ?? null;

  return { ok: expected !== null && expected === actual, expected, actual };
}

// ---------------------------------------------------------------------------
// Validação de ids e registros
// ---------------------------------------------------------------------------

export function isValidDocumentId(id) {
  return (
    isNonEmptyString(id) &&
    !id.includes('/') &&
    id !== '.' &&
    id !== '..' &&
    !/^__.*__$/.test(id) &&
    utf8Length(id) <= MAX_DOCUMENT_ID_BYTES
  );
}

function createErrorCollector() {
  const errors = [];
  let total = 0;

  return {
    add(code, details = {}) {
      total += 1;

      if (errors.length < MAX_REPORTED_ERRORS) {
        errors.push({ code, ...details });
      }
    },
    get errors() {
      return errors;
    },
    get total() {
      return total;
    },
  };
}

function isValidIsoDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

function validateCollectionRecords(name, list, { legacy }, collector) {
  const records = [];
  const seenIds = new Set();
  let statusDefaulted = 0;

  list.forEach((item, index) => {
    const at = { collection: name, index };

    if (!isPlainObject(item)) {
      collector.add('INVALID_RECORD', at);
      return;
    }

    if (!isValidDocumentId(item.id)) {
      collector.add('INVALID_DOCUMENT_ID', at);
      return;
    }

    if (seenIds.has(item.id)) {
      collector.add('DUPLICATE_DOCUMENT_ID', at);
      return;
    }

    seenIds.add(item.id);

    const record = normalizeValue(item, { legacy });

    if (containsInvalidTimestamp(record)) {
      collector.add('INVALID_TIMESTAMP', at);
    }

    const fields = { ...record };
    delete fields.id;

    if (utf8Length(JSON.stringify(fields)) > MAX_DOCUMENT_BYTES) {
      collector.add('DOCUMENT_TOO_LARGE', at);
    }

    if (name === 'tools') {
      if (record.id !== record.code) {
        collector.add('TOOL_ID_CODE_MISMATCH', at);
      }

      if (!TOOL_STATUSES.includes(record.status)) {
        collector.add('INVALID_TOOL_STATUS', at);
      }
    }

    if (name === 'collaborators') {
      if (legacy && !hasOwn(record, 'status')) {
        record.status = 'active';
        statusDefaulted += 1;
      }

      if (!COLLABORATOR_STATUSES.includes(record.status)) {
        collector.add('INVALID_COLLABORATOR_STATUS', at);
      }
    }

    if (name === 'history' && !HISTORY_TYPES.includes(record.type)) {
      collector.add('INVALID_HISTORY_TYPE', at);
    }

    records.push(record);
  });

  records.sort((a, b) => compareCodeUnits(a.id, b.id));

  return { records, statusDefaulted };
}

function validateHistoryReferences(data, collector) {
  const toolIds = new Set(data.tools.map((tool) => tool.id));
  const toolCodes = new Set(
    data.tools.map((tool) => normalizeText(tool.code)).filter((code) => code !== '')
  );
  const collaboratorIds = new Set(data.collaborators.map((collaborator) => collaborator.id));

  data.history.forEach((entry, index) => {
    const at = { collection: 'history', index };
    const hasToolId = isNonEmptyString(entry.toolId);

    if (hasToolId) {
      if (!toolIds.has(entry.toolId)) {
        collector.add('ORPHAN_HISTORY_TOOL', at);
      }
    } else if (isNonEmptyString(entry.toolCode)) {
      if (!toolCodes.has(normalizeText(entry.toolCode))) {
        collector.add('ORPHAN_HISTORY_TOOL', at);
      }
    } else {
      collector.add('HISTORY_WITHOUT_TOOL_REFERENCE', at);
    }

    if (entry.collaboratorId !== undefined && entry.collaboratorId !== null) {
      if (!isNonEmptyString(entry.collaboratorId) || !collaboratorIds.has(entry.collaboratorId)) {
        collector.add('ORPHAN_HISTORY_COLLABORATOR', at);
      }
    }
  });
}

/** Redige um perfil de usuário para reference.users (sem lastIp/lastDevice e demais campos). */
export function redactUserReference(user, { legacy = false } = {}) {
  const normalized = normalizeValue(user, { legacy });
  const reference = {};

  for (const field of USER_REFERENCE_FIELDS) {
    if (hasOwn(normalized, field)) {
      reference[field] = normalized[field];
    }
  }

  return reference;
}

function buildReference(users, { legacy }, collector) {
  if (users === undefined) {
    return [];
  }

  if (!Array.isArray(users)) {
    collector.add('INVALID_REFERENCE_USERS');
    return [];
  }

  const references = [];

  users.forEach((user, index) => {
    if (!isPlainObject(user)) {
      collector.add('INVALID_REFERENCE_USERS', { collection: 'reference.users', index });
      return;
    }

    references.push(redactUserReference(user, { legacy }));
  });

  return references.sort((a, b) => compareCodeUnits(String(a.id ?? ''), String(b.id ?? '')));
}

function checkCollections(dataKeys, allowed, collector) {
  for (const key of dataKeys) {
    if (!allowed.includes(key)) {
      collector.add(key === 'users' ? 'USERS_IN_DATA' : 'UNEXPECTED_COLLECTION');
    }
  }
}

function readCollectionArray(data, name, collector) {
  if (!Array.isArray(data[name])) {
    collector.add('MISSING_COLLECTION', { collection: name });
    return [];
  }

  return data[name];
}

function validateV4Envelope(input, collector) {
  for (const key of Object.keys(input)) {
    if (!V4_KEYS.includes(key)) {
      collector.add('UNEXPECTED_TOP_LEVEL_FIELD');
    }
  }

  if (!isValidIsoDate(input.exportedAt)) {
    collector.add('INVALID_EXPORTED_AT');
  }

  const source = input.source;

  if (
    !isPlainObject(source) ||
    !hasExactKeys(source, ['appId', 'generator']) ||
    source.appId !== BACKUP_APP_ID ||
    !BACKUP_GENERATORS.includes(source.generator)
  ) {
    collector.add('INVALID_SOURCE');
  }

  if (!isPlainObject(input.summary)) {
    collector.add('INVALID_SUMMARY');
  }

  if (input.reference !== undefined) {
    if (!isPlainObject(input.reference) || !hasExactKeys(input.reference, ['users'])) {
      collector.add('INVALID_REFERENCE');
    }
  }
}

function validateV4Summary(summary, backup, collector) {
  if (!isPlainObject(summary)) {
    return;
  }

  const counts = backup.summary.collections;
  const declared = summary.collections;
  const countsMatch =
    isPlainObject(declared) &&
    hasExactKeys(declared, RESTORABLE_COLLECTIONS) &&
    RESTORABLE_COLLECTIONS.every((name) => declared[name] === counts[name]);

  if (!countsMatch || summary.totalRecords !== backup.summary.totalRecords) {
    collector.add('SUMMARY_COUNT_MISMATCH');
  }

  if (summary.usersReferenceCount !== backup.summary.usersReferenceCount) {
    collector.add('SUMMARY_COUNT_MISMATCH');
  }

  if (typeof summary.dataSha256 !== 'string' || !SHA256_HEX.test(summary.dataSha256)) {
    collector.add('INVALID_DATA_SHA256');
  }
}

/**
 * Valida e normaliza um backup (v4 ou legado 3.0) para o contrato interno v4.
 * Nunca lança para entrada inválida: devolve { ok:false, errors } e nada é escrito.
 * Não verifica o hash (assíncrono no navegador): use verifyBackupDataHash / hash do servidor.
 *
 * Erros contêm somente código/collection/índice, nunca dados (PII).
 */
export function normalizeBackup(input, { requireNonEmpty = false } = {}) {
  const collector = createErrorCollector();
  const failure = () => ({
    ok: false,
    errors: collector.errors,
    errorCount: collector.total,
    backup: null,
    meta: null,
  });

  if (!isPlainObject(input)) {
    collector.add('INVALID_BACKUP_SHAPE');
    return failure();
  }

  let legacy = false;

  if (hasOwn(input, 'schemaVersion')) {
    if (input.schemaVersion !== BACKUP_SCHEMA_VERSION) {
      collector.add('UNSUPPORTED_SCHEMA_VERSION');
      return failure();
    }
  } else if (input.version === LEGACY_BACKUP_VERSION) {
    legacy = true;
  } else {
    collector.add('UNSUPPORTED_VERSION');
    return failure();
  }

  let exportedAt;
  let referenceUsers;

  if (legacy) {
    for (const key of Object.keys(input)) {
      if (!LEGACY_KEYS.includes(key)) {
        collector.add('UNEXPECTED_TOP_LEVEL_FIELD');
      }
    }

    if (!isValidIsoDate(input.exportDate)) {
      collector.add('INVALID_EXPORTED_AT');
    }

    exportedAt = input.exportDate;
  } else {
    validateV4Envelope(input, collector);
    exportedAt = input.exportedAt;
    referenceUsers = input.reference?.users;
  }

  if (!isPlainObject(input.data)) {
    collector.add('INVALID_DATA_CONTAINER');
    return failure();
  }

  const allowed = legacy ? LEGACY_COLLECTIONS : RESTORABLE_COLLECTIONS;
  checkCollections(Object.keys(input.data), allowed, collector);

  const data = {};
  let statusDefaulted = 0;

  for (const name of RESTORABLE_COLLECTIONS) {
    const list = readCollectionArray(input.data, name, collector);
    const result = validateCollectionRecords(name, list, { legacy }, collector);

    data[name] = result.records;
    statusDefaulted += result.statusDefaulted;
  }

  if (legacy) {
    referenceUsers = input.data.users;
  }

  const reference = buildReference(referenceUsers, { legacy }, collector);

  if (collector.total === 0) {
    validateHistoryReferences(data, collector);
  }

  const counts = Object.fromEntries(
    RESTORABLE_COLLECTIONS.map((name) => [name, data[name].length])
  );
  const totalRecords = RESTORABLE_COLLECTIONS.reduce((sum, name) => sum + counts[name], 0);

  if (requireNonEmpty && totalRecords === 0) {
    collector.add('EMPTY_BACKUP');
  }

  const backup = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    source: legacy
      ? { appId: BACKUP_APP_ID, generator: 'legacy-adapter' }
      : { appId: input.source?.appId, generator: input.source?.generator },
    summary: {
      totalRecords,
      collections: counts,
      usersReferenceCount: reference.length,
      dataSha256: legacy ? null : (input.summary?.dataSha256 ?? null),
    },
    data,
    reference: { users: reference },
  };

  if (!legacy) {
    validateV4Summary(input.summary, backup, collector);
  }

  if (collector.total > 0) {
    return failure();
  }

  return {
    ok: true,
    errors: [],
    errorCount: 0,
    backup,
    meta: {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      sourceSchema: legacy ? LEGACY_BACKUP_VERSION : BACKUP_SCHEMA_VERSION,
      legacy,
      statusDefaulted,
      exportedAt,
      counts,
      totalRecords,
      usersReferenceCount: reference.length,
    },
  };
}

/**
 * Monta o backup v4 a partir de leituras do Firestore (registros { id, ...campos }).
 * Não valida: um backup deve refletir o estado atual como está. Use normalizeBackup para
 * saber se o arquivo passaria na validação de restauração.
 */
export async function buildBackupV4(
  { tools = [], collaborators = [], history = [], users = [] },
  { generator = 'browser', exportedAt = new Date().toISOString() } = {}
) {
  const sortById = (list) => [...list].sort((a, b) => compareCodeUnits(a.id, b.id));
  const data = {
    tools: sortById(tools.map((record) => normalizeValue(record))),
    collaborators: sortById(collaborators.map((record) => normalizeValue(record))),
    history: sortById(history.map((record) => normalizeValue(record))),
  };
  const references = users.map((user) => redactUserReference(user));
  const counts = Object.fromEntries(
    RESTORABLE_COLLECTIONS.map((name) => [name, data[name].length])
  );

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    source: { appId: BACKUP_APP_ID, generator },
    summary: {
      totalRecords: RESTORABLE_COLLECTIONS.reduce((sum, name) => sum + counts[name], 0),
      collections: counts,
      usersReferenceCount: references.length,
      dataSha256: await computeDataSha256(data),
    },
    data,
    reference: { users: sortById(references) },
  };
}
