import { adminDb } from '../../server/firebase-admin.js';
import {
  getHttpStatus,
  requireActiveUser
} from '../../server/admin-authorization.js';

const DB_BASE_PATH =
  'artifacts/gestao-de-ferramentas-3f8f1/public/data';
const TOOLS_COLLECTION_PATH = `${DB_BASE_PATH}/tools`;
const COLLABORATORS_COLLECTION_PATH = `${DB_BASE_PATH}/collaborators`;
const HISTORY_COLLECTION_PATH = `${DB_BASE_PATH}/history`;
const MAX_DOCUMENT_ID_LENGTH = 128;
const MAX_DEVICE_LENGTH = 160;
const MAX_BADGE_LENGTH = 50;
const MAX_IP_LENGTH = 128;
const UNKNOWN_IP = 'IP Desconhecido';
const INVALID_MOVEMENT_MESSAGE = 'Dados da movimentação inválidos.';
const LOAN_NOT_AUTHORIZED_REASON = 'LOAN_NOT_AUTHORIZED';
// Única resposta para crachá inexistente, inválido, duplicado ou colaborador inativo (perfil
// restrito): não permite distinguir esses casos e não devolve nenhum dado do colaborador.
const LOAN_NOT_AUTHORIZED_MESSAGE =
  'Não foi possível autorizar a retirada. Confira o crachá informado.';
const RESTRICTED_BADGE_REQUIRED_MESSAGE =
  'Perfil restrito deve informar o crachá do colaborador.';

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createLoanNotAuthorizedError() {
  const error = createHttpError(422, LOAN_NOT_AUTHORIZED_MESSAGE);
  error.reason = LOAN_NOT_AUTHORIZED_REASON;
  return error;
}

// Perfil restrito = flag gravada no perfil (Firestore, somente via Admin SDK; as regras negam
// escrita em users). Nunca é derivado do corpo da requisição.
function isRestrictedOperator(profile) {
  return profile.isRestricted === true && profile.accessLevel !== 'Administrador';
}

function parseRequiredString(value, maxLength) {
  if (typeof value !== 'string') {
    throw createHttpError(400, INVALID_MOVEMENT_MESSAGE);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue || normalizedValue.length > maxLength) {
    throw createHttpError(400, INVALID_MOVEMENT_MESSAGE);
  }

  return normalizedValue;
}

function parseStoredRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw createHttpError(500, `Dados inválidos no campo armazenado: ${fieldName}.`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw createHttpError(500, `Dados inválidos no campo armazenado: ${fieldName}.`);
  }

  return normalizedValue;
}

function parseDocumentId(value) {
  const documentId = parseRequiredString(value, MAX_DOCUMENT_ID_LENGTH);

  if (documentId.includes('/')) {
    throw createHttpError(400, INVALID_MOVEMENT_MESSAGE);
  }

  return documentId;
}

function hasExactKeys(keys, expectedKeys) {
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => keys.includes(key))
  );
}

function parseBadge(value) {
  if (typeof value !== 'string') {
    throw createLoanNotAuthorizedError();
  }

  const badge = value.trim();

  if (!badge || badge.length > MAX_BADGE_LENGTH) {
    throw createLoanNotAuthorizedError();
  }

  return badge;
}

function parseMovement(req, restricted) {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createHttpError(400, INVALID_MOVEMENT_MESSAGE);
  }

  if (body.action !== 'loan' && body.action !== 'return') {
    throw createHttpError(400, INVALID_MOVEMENT_MESSAGE);
  }

  const restrictedLoan = restricted && body.action === 'loan';

  // O perfil restrito nunca escolhe o colaborador por ID: recusa antes de qualquer leitura.
  if (restrictedLoan && Object.hasOwn(body, 'collaboratorId')) {
    throw createHttpError(403, RESTRICTED_BADGE_REQUIRED_MESSAGE);
  }

  let expectedKeys = ['action', 'toolId', 'device'];

  if (body.action === 'loan') {
    expectedKeys = [
      'action',
      'toolId',
      restrictedLoan ? 'collaboratorBadge' : 'collaboratorId',
      'device'
    ];
  }

  if (!hasExactKeys(Object.keys(body), expectedKeys)) {
    throw createHttpError(400, INVALID_MOVEMENT_MESSAGE);
  }

  const movement = {
    action: body.action,
    toolId: parseDocumentId(body.toolId),
    device: parseRequiredString(body.device, MAX_DEVICE_LENGTH)
  };

  if (restrictedLoan) {
    movement.collaboratorBadge = parseBadge(body.collaboratorBadge);
  } else if (movement.action === 'loan') {
    movement.collaboratorId = parseDocumentId(body.collaboratorId);
  }

  return movement;
}

function removeControlCharacters(value) {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('');
}

function normalizeIp(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const firstValue = removeControlCharacters(value).split(',')[0].trim();
  const withoutIpv4MappedPrefix = firstValue.startsWith('::ffff:')
    ? firstValue.slice('::ffff:'.length)
    : firstValue;

  return withoutIpv4MappedPrefix.trim().slice(0, MAX_IP_LENGTH);
}

function getHeaderIp(req, headerName) {
  const headerValue = req.headers?.[headerName];
  const values = Array.isArray(headerValue) ? headerValue : [headerValue];

  for (const value of values) {
    const ip = normalizeIp(value);

    if (ip) {
      return ip;
    }
  }

  return '';
}

function getRequestIp(req) {
  const headerNames = [
    'x-vercel-forwarded-for',
    'x-forwarded-for',
    'x-real-ip'
  ];

  for (const headerName of headerNames) {
    const ip = getHeaderIp(req, headerName);

    if (ip) {
      return ip;
    }
  }

  const socketAddresses = [
    req.socket?.remoteAddress,
    req.connection?.remoteAddress
  ];

  for (const address of socketAddresses) {
    const ip = normalizeIp(address);

    if (ip) {
      return ip;
    }
  }

  return UNKNOWN_IP;
}

function getMaintenanceDate(value) {
  if (!value) {
    return null;
  }

  const date =
    typeof value?.toDate === 'function' ? value.toDate() : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function isTransactionConflict(error) {
  const code = String(error?.code || '').toLowerCase();

  return code === '10' || code === 'aborted';
}

function assertToolAvailableForLoan(tool, now) {
  if (tool.status !== 'available') {
    throw createHttpError(409, 'Ferramenta indisponível para empréstimo.');
  }

  const maintenanceDate = getMaintenanceDate(tool.nextMaintenance);

  if (maintenanceDate && maintenanceDate < now) {
    throw createHttpError(409, 'Ferramenta com manutenção vencida.');
  }
}

function recordLoan(transaction, details) {
  const {
    toolRef,
    historyRef,
    toolSnapshot,
    toolCode,
    toolName,
    collaboratorId,
    collaboratorName,
    movement,
    authorization,
    ip,
    now
  } = details;
  const lastAction = now.toISOString();
  const currentUser = collaboratorName;
  const updatedTool = {
    id: toolSnapshot.id,
    status: 'borrowed',
    currentUser,
    currentCollaboratorId: collaboratorId,
    lastAction
  };

  transaction.update(toolRef, {
    status: updatedTool.status,
    currentUser: updatedTool.currentUser,
    currentCollaboratorId: updatedTool.currentCollaboratorId,
    lastAction: updatedTool.lastAction
  });

  transaction.create(historyRef, {
    date: lastAction,
    toolCode,
    toolName,
    type: 'out',
    user: currentUser,
    ip,
    device: movement.device,
    toolId: movement.toolId,
    collaboratorId,
    operatorUid: authorization.uid,
    operatorEmail: authorization.email
  });

  return updatedTool;
}

async function registerLoan(movement, authorization, ip) {
  const toolRef = adminDb.doc(`${TOOLS_COLLECTION_PATH}/${movement.toolId}`);
  const collaboratorRef = adminDb.doc(
    `${COLLABORATORS_COLLECTION_PATH}/${movement.collaboratorId}`
  );
  const historyRef = adminDb.collection(HISTORY_COLLECTION_PATH).doc();

  return adminDb.runTransaction(async (transaction) => {
    const toolSnapshot = await transaction.get(toolRef);
    const collaboratorSnapshot = await transaction.get(collaboratorRef);

    if (!toolSnapshot.exists) {
      throw createHttpError(404, 'Ferramenta não encontrada.');
    }

    if (!collaboratorSnapshot.exists) {
      throw createHttpError(404, 'Colaborador não encontrado.');
    }

    const tool = toolSnapshot.data();
    const collaborator = collaboratorSnapshot.data();
    const toolCode = parseStoredRequiredString(tool.code, 'tool.code');
    const toolName = parseStoredRequiredString(tool.name, 'tool.name');
    const collaboratorName = parseStoredRequiredString(
      collaborator.name,
      'collaborator.name'
    );

    if (collaborator.status !== 'active') {
      throw createHttpError(409, 'Colaborador inativo.');
    }

    const now = new Date();

    assertToolAvailableForLoan(tool, now);

    return recordLoan(transaction, {
      toolRef,
      historyRef,
      toolSnapshot,
      toolCode,
      toolName,
      collaboratorId: movement.collaboratorId,
      collaboratorName,
      movement,
      authorization,
      ip,
      now
    });
  });
}

// Empréstimo do perfil restrito: o crachá exato é resolvido aqui, dentro da mesma transação
// da movimentação (Admin SDK), então o cliente nunca lê a coleção de colaboradores. As falhas
// de ferramenta independem do crachá e vêm primeiro; toda falha do colaborador é genérica.
async function registerRestrictedLoan(movement, authorization, ip) {
  const toolRef = adminDb.doc(`${TOOLS_COLLECTION_PATH}/${movement.toolId}`);
  const badgeQuery = adminDb
    .collection(COLLABORATORS_COLLECTION_PATH)
    .where('badge', '==', movement.collaboratorBadge)
    .limit(2);
  const historyRef = adminDb.collection(HISTORY_COLLECTION_PATH).doc();

  return adminDb.runTransaction(async (transaction) => {
    const toolSnapshot = await transaction.get(toolRef);
    const badgeSnapshot = await transaction.get(badgeQuery);

    if (!toolSnapshot.exists) {
      throw createHttpError(404, 'Ferramenta não encontrada.');
    }

    const tool = toolSnapshot.data();
    const toolCode = parseStoredRequiredString(tool.code, 'tool.code');
    const toolName = parseStoredRequiredString(tool.name, 'tool.name');
    const now = new Date();

    assertToolAvailableForLoan(tool, now);

    // Zero resultados = crachá desconhecido; dois = crachá duplicado (ambíguo): ambos falham fechado.
    const collaboratorSnapshot = badgeSnapshot.size === 1 ? badgeSnapshot.docs[0] : null;
    const collaborator = collaboratorSnapshot?.data();
    const collaboratorName =
      typeof collaborator?.name === 'string' ? collaborator.name.trim() : '';

    if (!collaboratorSnapshot || collaborator.status !== 'active' || !collaboratorName) {
      throw createLoanNotAuthorizedError();
    }

    const updatedTool = recordLoan(transaction, {
      toolRef,
      historyRef,
      toolSnapshot,
      toolCode,
      toolName,
      collaboratorId: collaboratorSnapshot.id,
      collaboratorName,
      movement,
      authorization,
      ip,
      now
    });

    // Somente o necessário para confirmação e recibo: o nome (toast, cartão e termo) e a função
    // (termo). O crachá o cliente já possui (foi ele quem o digitou; a busca é exata).
    return {
      tool: updatedTool,
      collaborator: {
        name: collaboratorName,
        role: typeof collaborator.role === 'string' ? collaborator.role.trim() : ''
      }
    };
  });
}

async function registerReturn(movement, authorization, ip) {
  const toolRef = adminDb.doc(`${TOOLS_COLLECTION_PATH}/${movement.toolId}`);
  const historyRef = adminDb.collection(HISTORY_COLLECTION_PATH).doc();

  return adminDb.runTransaction(async (transaction) => {
    const toolSnapshot = await transaction.get(toolRef);

    if (!toolSnapshot.exists) {
      throw createHttpError(404, 'Ferramenta não encontrada.');
    }

    const tool = toolSnapshot.data();
    const toolCode = parseStoredRequiredString(tool.code, 'tool.code');
    const toolName = parseStoredRequiredString(tool.name, 'tool.name');

    if (tool.status !== 'borrowed') {
      throw createHttpError(409, 'Ferramenta não está emprestada.');
    }

    const currentUser = String(tool.currentUser || '').trim() || 'Não informado';
    const currentCollaboratorId =
      typeof tool.currentCollaboratorId === 'string'
        ? tool.currentCollaboratorId.trim() || null
        : null;
    const lastAction = new Date().toISOString();
    const updatedTool = {
      id: toolSnapshot.id,
      status: 'available',
      currentUser: null,
      currentCollaboratorId: null,
      lastAction
    };

    transaction.update(toolRef, {
      status: updatedTool.status,
      currentUser: updatedTool.currentUser,
      currentCollaboratorId: updatedTool.currentCollaboratorId,
      lastAction: updatedTool.lastAction
    });

    transaction.create(historyRef, {
      date: lastAction,
      toolCode,
      toolName,
      type: 'in',
      user: currentUser,
      ip,
      device: movement.device,
      toolId: movement.toolId,
      collaboratorId: currentCollaboratorId,
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
    const authorization = await requireActiveUser(req);
    const movement = parseMovement(req, isRestrictedOperator(authorization.profile));
    const ip = getRequestIp(req);

    if (movement.collaboratorBadge !== undefined) {
      const { tool, collaborator } = await registerRestrictedLoan(
        movement,
        authorization,
        ip
      );

      return res.status(200).json({
        success: true,
        message: 'Empréstimo registrado.',
        data: {
          action: movement.action,
          tool,
          collaborator
        }
      });
    }

    const tool =
      movement.action === 'loan'
        ? await registerLoan(movement, authorization, ip)
        : await registerReturn(movement, authorization, ip);

    return res.status(200).json({
      success: true,
      message:
        movement.action === 'loan'
          ? 'Empréstimo registrado.'
          : 'Devolução registrada.',
      data: {
        action: movement.action,
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
        message: error.message,
        ...(error.reason === LOAN_NOT_AUTHORIZED_REASON
          ? { code: LOAN_NOT_AUTHORIZED_REASON }
          : {})
      });
    }

    console.error('Erro ao registrar movimentação de ferramenta:', error);

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao registrar a movimentação.'
    });
  }
}
