import { adminDb } from '../../server/firebase-admin.js';
import {
  getHttpStatus,
  requireActiveAdmin
} from '../../server/admin-authorization.js';

const DB_BASE_PATH =
  'artifacts/gestao-ferramentas-coeng-2026/public/data';
const TOOLS_COLLECTION_PATH = `${DB_BASE_PATH}/tools`;
const HISTORY_COLLECTION_PATH = `${DB_BASE_PATH}/history`;

const MAX_DOCUMENT_ID_LENGTH = 128;
const MAX_NOTES_LENGTH = 1000;
const MAX_DEVICE_LENGTH = 160;
const MAX_IP_LENGTH = 128;

const APP_TIME_ZONE = 'America/Sao_Paulo';
const UNKNOWN_IP = 'IP Desconhecido';
const INVALID_MAINTENANCE_MESSAGE = 'Dados da manutenção inválidos.';

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseRequestBody(req) {
  if (!req.body) {
    throw createHttpError(400, INVALID_MAINTENANCE_MESSAGE);
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      throw createHttpError(400, INVALID_MAINTENANCE_MESSAGE);
    }
  }

  if (typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw createHttpError(400, INVALID_MAINTENANCE_MESSAGE);
  }

  return req.body;
}

function hasExactKeys(keys, expectedKeys) {
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => keys.includes(key))
  );
}

function parseRequiredString(value, maxLength) {
  if (typeof value !== 'string') {
    throw createHttpError(400, INVALID_MAINTENANCE_MESSAGE);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue || normalizedValue.length > maxLength) {
    throw createHttpError(400, INVALID_MAINTENANCE_MESSAGE);
  }

  return normalizedValue;
}

function parseOptionalString(value, maxLength) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value !== 'string') {
    throw createHttpError(400, INVALID_MAINTENANCE_MESSAGE);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length > maxLength) {
    throw createHttpError(400, INVALID_MAINTENANCE_MESSAGE);
  }

  return normalizedValue;
}

function parseDocumentId(value) {
  const documentId = parseRequiredString(
    value,
    MAX_DOCUMENT_ID_LENGTH
  );

  if (documentId.includes('/')) {
    throw createHttpError(400, INVALID_MAINTENANCE_MESSAGE);
  }

  return documentId;
}

function parseDateOnly(value, required = true) {
  if (!required && (value === null || value === '')) {
    return null;
  }

  if (typeof value !== 'string') {
    throw createHttpError(400, INVALID_MAINTENANCE_MESSAGE);
  }

  const normalizedValue = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    throw createHttpError(400, INVALID_MAINTENANCE_MESSAGE);
  }

  const [year, month, day] = normalizedValue.split('-').map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    throw createHttpError(400, INVALID_MAINTENANCE_MESSAGE);
  }

  return normalizedValue;
}

function getCurrentDateOnly() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const dateParts = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function parseStoredRequiredString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw createHttpError(
      500,
      `Dados inválidos no campo armazenado: ${fieldName}.`
    );
  }

  return value.trim();
}

function parseMaintenance(req) {
  const body = parseRequestBody(req);
  const expectedKeys = [
    'toolId',
    'performedAt',
    'nextMaintenance',
    'notes',
    'device'
  ];

  if (!hasExactKeys(Object.keys(body), expectedKeys)) {
    throw createHttpError(400, INVALID_MAINTENANCE_MESSAGE);
  }

  const maintenance = {
    toolId: parseDocumentId(body.toolId),
    performedAt: parseDateOnly(body.performedAt),
    nextMaintenance: parseDateOnly(body.nextMaintenance, false),
    notes: parseOptionalString(body.notes, MAX_NOTES_LENGTH),
    device: parseRequiredString(body.device, MAX_DEVICE_LENGTH)
  };

  if (maintenance.performedAt > getCurrentDateOnly()) {
    throw createHttpError(
      400,
      'A data da manutenção não pode estar no futuro.'
    );
  }

  if (
    maintenance.nextMaintenance &&
    maintenance.nextMaintenance < maintenance.performedAt
  ) {
    throw createHttpError(
      400,
      'A próxima manutenção não pode ser anterior à manutenção realizada.'
    );
  }

  return maintenance;
}

function removeControlCharacters(value) {
  return Array.from(String(value || ''))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('');
}

function normalizeIp(value) {
  const normalizedValue = removeControlCharacters(value).trim();

  if (!normalizedValue) {
    return UNKNOWN_IP;
  }

  return normalizedValue.slice(0, MAX_IP_LENGTH);
}

function getRequestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];

  if (Array.isArray(forwardedFor)) {
    return normalizeIp(forwardedFor[0]);
  }

  if (typeof forwardedFor === 'string') {
    return normalizeIp(forwardedFor.split(',')[0]);
  }

  return normalizeIp(
    req.headers['x-real-ip'] ||
      req.socket?.remoteAddress ||
      UNKNOWN_IP
  );
}

function isTransactionConflict(error) {
  const code = String(error?.code || '').toLowerCase();
  return code === '10' || code === 'aborted';
}

async function registerMaintenance(
  maintenance,
  authorization,
  ip
) {
  const toolRef = adminDb.doc(
    `${TOOLS_COLLECTION_PATH}/${maintenance.toolId}`
  );
  const historyRef = adminDb
    .collection(HISTORY_COLLECTION_PATH)
    .doc();

  return adminDb.runTransaction(async (transaction) => {
    const toolSnapshot = await transaction.get(toolRef);

    if (!toolSnapshot.exists) {
      throw createHttpError(404, 'Ferramenta não encontrada.');
    }

    const tool = toolSnapshot.data();
    const toolCode = parseStoredRequiredString(
      tool.code,
      'tool.code'
    );
    const toolName = parseStoredRequiredString(
      tool.name,
      'tool.name'
    );

    if (tool.status === 'borrowed') {
      throw createHttpError(
        409,
        'Não é possível registrar manutenção de uma ferramenta emprestada.'
      );
    }

    const registeredAt = new Date().toISOString();
    const administratorName =
      String(authorization.profile?.name || '').trim() ||
      authorization.email;

    const updatedTool = {
      id: toolSnapshot.id,
      status: 'available',
      currentUser: null,
      currentCollaboratorId: null,
      lastAction: registeredAt,
      lastMaintenance: maintenance.performedAt,
      nextMaintenance: maintenance.nextMaintenance,
      lastMaintenanceNotes: maintenance.notes,
      lastMaintenanceBy: administratorName
    };

    transaction.update(toolRef, {
      status: updatedTool.status,
      currentUser: updatedTool.currentUser,
      currentCollaboratorId: updatedTool.currentCollaboratorId,
      lastAction: updatedTool.lastAction,
      lastMaintenance: updatedTool.lastMaintenance,
      nextMaintenance: updatedTool.nextMaintenance,
      lastMaintenanceNotes: updatedTool.lastMaintenanceNotes,
      lastMaintenanceBy: updatedTool.lastMaintenanceBy
    });

    transaction.create(historyRef, {
      date: registeredAt,
      type: 'maintenance',
      toolId: maintenance.toolId,
      toolCode,
      toolName,
      user: administratorName,
      performedAt: maintenance.performedAt,
      nextMaintenance: maintenance.nextMaintenance,
      notes: maintenance.notes,
      ip,
      device: maintenance.device,
      operatorUid: authorization.uid,
      operatorEmail: authorization.email
    });

    return updatedTool;
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      success: false,
      message: 'Método não permitido.'
    });
  }

  try {
    const authorization = await requireActiveAdmin(req);
    const maintenance = parseMaintenance(req);
    const ip = getRequestIp(req);

    const tool = await registerMaintenance(
      maintenance,
      authorization,
      ip
    );

    return res.status(200).json({
      success: true,
      message: 'Manutenção registrada com sucesso.',
      data: {
        tool
      }
    });
  } catch (error) {
    if (isTransactionConflict(error)) {
      return res.status(409).json({
        success: false,
        message: 'Conflito de atualização. Tente novamente.'
      });
    }

    const statusCode = getHttpStatus(error);

    if (statusCode < 500) {
      return res.status(statusCode).json({
        success: false,
        message: error.message
      });
    }

    console.error(
      'Erro ao registrar manutenção de ferramenta:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao registrar a manutenção.'
    });
  }
}
