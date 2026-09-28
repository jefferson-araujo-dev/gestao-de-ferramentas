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
const BADGE_RATE_LIMIT_COLLECTION_PATH = `${DB_BASE_PATH}/badgeRateLimits`;
const MAX_DOCUMENT_ID_LENGTH = 128;
const MAX_DEVICE_LENGTH = 160;
const MAX_BADGE_LENGTH = 50;
const MAX_IP_LENGTH = 128;
const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;
const UNKNOWN_IP = 'IP Desconhecido';
const INVALID_MOVEMENT_MESSAGE = 'Dados da movimentação inválidos.';
const LOAN_NOT_AUTHORIZED_REASON = 'LOAN_NOT_AUTHORIZED';
// Única resposta para crachá inexistente, inválido, duplicado ou colaborador inativo (perfil
// restrito): não permite distinguir esses casos e não devolve nenhum dado do colaborador.
const LOAN_NOT_AUTHORIZED_MESSAGE =
  'Não foi possível autorizar a retirada. Confira o crachá informado.';
// Devolução (Gate 1-F4.C3): mesma resposta CONFERE/NÃO CONFERE para todos os perfis (Admin,
// Padrão, Restrito) — nunca nome, crachá, função ou ID do colaborador correto, em nenhum caso.
const RETURN_NOT_CONFIRMED_REASON = 'RETURN_NOT_CONFIRMED';
const RETURN_NOT_CONFIRMED_MESSAGE =
  'Crachá não confere com o registro do empréstimo.';
const ADMIN_RETURN_FORBIDDEN_MESSAGE =
  'Acesso não permitido para este perfil.';
const BADGE_RATE_LIMIT_REASON = 'BADGE_RATE_LIMITED';
const BADGE_RATE_LIMIT_MESSAGE =
  'Muitas tentativas de identificação por crachá. Aguarde e tente novamente.';
// Proposta do Claude Code (Gate 1-F4.C3): não há referência de rate limit já implementada em
// nenhum endpoint do projeto (busca prévia no código não encontrou nenhuma). Limite conservador
// por uid, compartilhado entre empréstimo e devolução, pois ambos consultam o mesmo oráculo de
// crachá. Valor sujeito a ajuste pelo Cowork.
const BADGE_RATE_LIMIT_MAX_ATTEMPTS = 5;
const BADGE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
// Códigos de erro seguros para expor ao cliente em `data.code`: nenhum contém ou implica dado
// pessoal do colaborador.
const EXPOSED_ERROR_REASONS = new Set([
  LOAN_NOT_AUTHORIZED_REASON,
  RETURN_NOT_CONFIRMED_REASON,
  BADGE_RATE_LIMIT_REASON
]);

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createLoanNotAuthorizedError() {
  const error = createHttpError(422, LOAN_NOT_AUTHORIZED_MESSAGE);
  error.reason = LOAN_NOT_AUTHORIZED_REASON;
  error.isBadgeFailure = true;
  return error;
}

function createReturnNotConfirmedError() {
  const error = createHttpError(422, RETURN_NOT_CONFIRMED_MESSAGE);
  error.reason = RETURN_NOT_CONFIRMED_REASON;
  error.isBadgeFailure = true;
  return error;
}

function createRateLimitedError() {
  const error = createHttpError(429, BADGE_RATE_LIMIT_MESSAGE);
  error.reason = BADGE_RATE_LIMIT_REASON;
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

function parseBadge(value, createError = createLoanNotAuthorizedError) {
  // Formato malformado (tipo errado, vazio, longo demais) recebe a MESMA resposta genérica usada
  // para crachá inexistente/duplicado/inativo (empréstimo: LOAN_NOT_AUTHORIZED; devolução:
  // RETURN_NOT_CONFIRMED, via `createError`): nenhum perfil, incluindo Admin/Standard, deve
  // conseguir distinguir "campo mal formado" de "colaborador não localizado" a partir do
  // código/status HTTP, preservando a proteção anti-enumeração do Restrito mesmo agora que todos
  // os perfis compartilham o mesmo contrato de identificação por crachá.
  if (typeof value !== 'string') {
    throw createError();
  }

  const badge = value.trim();

  if (!badge || badge.length > MAX_BADGE_LENGTH) {
    throw createError();
  }

  return badge;
}

function parseReason(value) {
  if (typeof value !== 'string') {
    throw createHttpError(400, INVALID_MOVEMENT_MESSAGE);
  }

  const reason = value.trim();

  if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
    throw createHttpError(400, INVALID_MOVEMENT_MESSAGE);
  }

  return reason;
}

function parseToolCode(value) {
  if (typeof value !== 'string') {
    throw createHttpError(400, INVALID_MOVEMENT_MESSAGE);
  }

  const toolCode = value.trim();

  if (!toolCode || toolCode.length > MAX_DOCUMENT_ID_LENGTH) {
    throw createHttpError(400, INVALID_MOVEMENT_MESSAGE);
  }

  return toolCode;
}

// Contrato de loan é único para todos os perfis (Admin, Standard, Restricted): toolId, toolCode,
// collaboratorBadge e device. O colaborador é sempre resolvido no servidor por crachá; o cliente
// nunca mais escolhe um collaboratorId, e o crachá nunca é substituído por nome.
// Devolução (Gate 1-F4.C3): mesmo princípio — toolId, device e collaboratorBadge (agora
// obrigatório) para o fluxo comum, para todos os perfis. `return_admin` é o caminho de exceção
// (Admin/Padrão) que ignora a conferência de crachá; troca collaboratorBadge por reason.
function parseMovement(req) {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createHttpError(400, INVALID_MOVEMENT_MESSAGE);
  }

  if (
    body.action !== 'loan' &&
    body.action !== 'return' &&
    body.action !== 'return_admin'
  ) {
    throw createHttpError(400, INVALID_MOVEMENT_MESSAGE);
  }

  const expectedKeysByAction = {
    loan: ['action', 'toolId', 'toolCode', 'collaboratorBadge', 'device'],
    return: ['action', 'toolId', 'device', 'collaboratorBadge'],
    return_admin: ['action', 'toolId', 'device', 'reason']
  };

  if (!hasExactKeys(Object.keys(body), expectedKeysByAction[body.action])) {
    throw createHttpError(400, INVALID_MOVEMENT_MESSAGE);
  }

  const movement = {
    action: body.action,
    toolId: parseDocumentId(body.toolId),
    device: parseRequiredString(body.device, MAX_DEVICE_LENGTH)
  };

  if (movement.action === 'loan') {
    movement.toolCode = parseToolCode(body.toolCode);
    movement.collaboratorBadge = parseBadge(body.collaboratorBadge);
  } else if (movement.action === 'return') {
    movement.collaboratorBadge = parseBadge(
      body.collaboratorBadge,
      createReturnNotConfirmedError
    );
  } else {
    movement.reason = parseReason(body.reason);
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

// Resposta HTTP de `data.tool`: lista fechada, igual para todos os perfis (Gate 1-F4.C2). Os
// campos são selecionados um a um a partir do objeto interno — nunca por remoção — para que um
// campo novo adicionado no futuro a `updatedTool` não vaze por omissão de filtro. `currentUser` e
// `currentCollaboratorId` continuam gravados normalmente no Firestore (recordLoan/registerReturn);
// eles só deixam de retornar no corpo HTTP, que nenhum cliente lê.
function buildToolResponse(tool) {
  return {
    id: tool.id,
    status: tool.status,
    lastAction: tool.lastAction
  };
}

// Rate limit do oráculo de crachá (Gate 1-F4.C3): cobre empréstimo e devolução com um único
// contador por uid do operador, já que os dois fluxos consultam a mesma coleção de colaboradores
// por crachá. Contador em `badgeRateLimits/{uid}`, nunca com dado de colaborador — só uid, contagem
// e janela de tempo. Sem Admin SDK/console: leitura e escrita passam pela mesma transação usada
// nos demais fluxos deste arquivo.
function badgeRateLimitRef(uid) {
  return adminDb.doc(`${BADGE_RATE_LIMIT_COLLECTION_PATH}/${uid}`);
}

async function assertBadgeRateLimit(uid) {
  const snapshot = await badgeRateLimitRef(uid).get();

  if (!snapshot.exists) {
    return;
  }

  const data = snapshot.data();
  const windowStart = typeof data.windowStart === 'number' ? data.windowStart : 0;
  const count = typeof data.count === 'number' ? data.count : 0;
  const withinWindow = Date.now() - windowStart < BADGE_RATE_LIMIT_WINDOW_MS;

  if (withinWindow && count >= BADGE_RATE_LIMIT_MAX_ATTEMPTS) {
    throw createRateLimitedError();
  }
}

async function registerBadgeFailure(uid) {
  const ref = badgeRateLimitRef(uid);

  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const now = Date.now();
    const data = snapshot.exists ? snapshot.data() : null;
    const windowStart = typeof data?.windowStart === 'number' ? data.windowStart : 0;
    const withinWindow = Boolean(data) && now - windowStart < BADGE_RATE_LIMIT_WINDOW_MS;
    const previousCount = typeof data?.count === 'number' ? data.count : 0;

    transaction.set(ref, {
      count: withinWindow ? previousCount + 1 : 1,
      windowStart: withinWindow ? windowStart : now,
      updatedAt: now
    });
  });
}

async function resetBadgeRateLimit(uid) {
  await badgeRateLimitRef(uid).delete();
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

function resolveCollaboratorFailure(restricted, badgeSnapshot) {
  // Perfil restrito: qualquer falha do colaborador (crachá desconhecido, duplicado ou inativo)
  // recebe a mesma resposta genérica, sem revelar qual caso ocorreu (anti-enumeração). Admin e
  // Standard já enxergam a lista de colaboradores nas próprias telas do sistema, então manter uma
  // mensagem mais específica para eles não reduz nada que já não seja visível a esse perfil, e
  // preserva a usabilidade que esses perfis já tinham antes desta mudança de contrato.
  if (restricted) {
    return createLoanNotAuthorizedError();
  }

  if (badgeSnapshot.size === 0) {
    const error = createHttpError(404, 'Colaborador não encontrado.');
    error.isBadgeFailure = true;
    return error;
  }

  if (badgeSnapshot.size > 1) {
    const error = createHttpError(409, 'Crachá duplicado. Contate o administrador.');
    error.isBadgeFailure = true;
    return error;
  }

  const error = createHttpError(409, 'Colaborador inativo.');
  error.isBadgeFailure = true;
  return error;
}

// Empréstimo: o crachá é sempre resolvido aqui, dentro da mesma transação da movimentação
// (Admin SDK), para TODOS os perfis (Admin, Standard, Restricted) — nenhum cliente lê a coleção
// de colaboradores para resolver a identidade do empréstimo. As falhas de ferramenta (não
// encontrada, patrimônio divergente, já emprestada, manutenção) independem do crachá e são
// verificadas primeiro; toda falha do colaborador do perfil restrito é genérica (ver
// resolveCollaboratorFailure).
async function registerLoan(movement, authorization, ip, restricted) {
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

    // O patrimônio informado deve corresponder à ferramenta identificada pelo toolId: não confiar
    // apenas no fato de que, hoje, o id do documento é criado igual ao code.
    if (toolCode !== movement.toolCode) {
      throw createHttpError(409, 'Patrimônio informado não corresponde à ferramenta.');
    }

    const now = new Date();

    assertToolAvailableForLoan(tool, now);

    // Zero resultados = crachá desconhecido; dois = crachá duplicado (ambíguo): ambos falham fechado.
    const collaboratorSnapshot = badgeSnapshot.size === 1 ? badgeSnapshot.docs[0] : null;
    const collaborator = collaboratorSnapshot?.data();
    const collaboratorName =
      typeof collaborator?.name === 'string' ? collaborator.name.trim() : '';

    if (!collaboratorSnapshot || collaborator.status !== 'active' || !collaboratorName) {
      throw resolveCollaboratorFailure(restricted, badgeSnapshot);
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

    // O cliente não resolve mais o colaborador localmente (nenhum perfil lê a coleção de
    // colaboradores para o loan), então o nome e a função voltam na resposta para confirmação e
    // recibo, para todos os perfis igualmente.
    return {
      tool: updatedTool,
      collaborator: {
        name: collaboratorName,
        role: typeof collaborator.role === 'string' ? collaborator.role.trim() : ''
      }
    };
  });
}

// Devolução comum (Gate 1-F4.C3): conferência de crachá igual para TODOS os perfis (Admin,
// Standard, Restricted) — mesmo contrato de identificação por crachá do empréstimo. CONFERE exige
// que o crachá resolva a exatamente um colaborador cujo ID seja igual a `currentCollaboratorId` do
// empréstimo em curso; o status ativo/inativo do colaborador NÃO entra na comparação (decisão do
// Cowork: quem está com a ferramenta pode devolvê-la mesmo cadastrado como inativo). A consulta ao
// crachá roda sempre, mesmo quando o empréstimo não tem `currentCollaboratorId`, para que o tempo
// de resposta não indique a causa do NÃO CONFERE. Em NÃO CONFERE, nada é gravado (nem tool, nem
// history).
async function registerReturn(movement, authorization, ip) {
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

    if (tool.status !== 'borrowed') {
      throw createHttpError(409, 'Ferramenta não está emprestada.');
    }

    const currentCollaboratorId =
      typeof tool.currentCollaboratorId === 'string'
        ? tool.currentCollaboratorId.trim() || null
        : null;
    const resolvedCollaboratorId =
      badgeSnapshot.size === 1 ? badgeSnapshot.docs[0].id : null;

    if (
      !currentCollaboratorId ||
      !resolvedCollaboratorId ||
      resolvedCollaboratorId !== currentCollaboratorId
    ) {
      throw createReturnNotConfirmedError();
    }

    const currentUser = String(tool.currentUser || '').trim() || 'Não informado';
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
      operatorEmail: authorization.email,
      returnMethod: 'badge_verified'
    });

    return updatedTool;
  });
}

// Devolução administrativa (Gate 1-F4.C3, decisão do Cowork): disponível para Admin e Padrão, não
// para o Restrito. Ignora a conferência de crachá (ex.: colaborador não está fisicamente presente).
// `reason` é obrigatório e vai para o registro de auditoria simples em `history`
// (`returnMethod: 'administrative'`) — não é a trilha de auditoria completa, que é escopo de D.
async function registerReturnAdmin(movement, authorization, ip) {
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
      operatorEmail: authorization.email,
      returnMethod: 'administrative',
      reason: movement.reason
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
    const restricted = isRestrictedOperator(authorization.profile);
    const movement = parseMovement(req);
    const ip = getRequestIp(req);

    if (movement.action === 'return_admin') {
      // Caminho de exceção (decisão do Cowork): Admin e Padrão, nunca o Restrito. Verificado antes
      // de qualquer leitura no Firestore.
      if (restricted) {
        throw createHttpError(403, ADMIN_RETURN_FORBIDDEN_MESSAGE);
      }

      const tool = await registerReturnAdmin(movement, authorization, ip);

      return res.status(200).json({
        success: true,
        message: 'Devolução registrada.',
        data: {
          action: movement.action,
          tool: buildToolResponse(tool)
        }
      });
    }

    if (movement.action === 'loan') {
      await assertBadgeRateLimit(authorization.uid);

      let loanResult;

      try {
        loanResult = await registerLoan(movement, authorization, ip, restricted);
      } catch (error) {
        if (error.isBadgeFailure) {
          await registerBadgeFailure(authorization.uid);
        }

        throw error;
      }

      await resetBadgeRateLimit(authorization.uid);

      const { tool, collaborator } = loanResult;
      const data = {
        action: movement.action,
        tool: buildToolResponse(tool)
      };

      // Restrito: requisito C.1 (docs/design/USERS_AUDIT_SCREEN.md, seção C.1) — a resposta da
      // própria API que o Restrito chamou não pode conter nome/função do colaborador.
      if (!restricted) {
        data.collaborator = collaborator;
      }

      return res.status(200).json({
        success: true,
        message: 'Empréstimo registrado.',
        data
      });
    }

    // action === 'return' (fluxo comum, com conferência de crachá, para todos os perfis).
    await assertBadgeRateLimit(authorization.uid);

    let tool;

    try {
      tool = await registerReturn(movement, authorization, ip);
    } catch (error) {
      if (error.isBadgeFailure) {
        await registerBadgeFailure(authorization.uid);
      }

      throw error;
    }

    await resetBadgeRateLimit(authorization.uid);

    return res.status(200).json({
      success: true,
      message: 'Devolução registrada.',
      data: {
        action: movement.action,
        tool: buildToolResponse(tool)
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
        ...(EXPOSED_ERROR_REASONS.has(error.reason) ? { code: error.reason } : {})
      });
    }

    console.error('Erro ao registrar movimentação de ferramenta:', error);

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao registrar a movimentação.'
    });
  }
}
