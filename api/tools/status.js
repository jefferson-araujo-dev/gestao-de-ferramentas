import { adminDb } from '../../server/firebase-admin.js';
import {
  getHttpStatus,
  requireActiveUser
} from '../../server/admin-authorization.js';
import { logOutdatedClientVersion } from '../../server/app-version.js';

const DB_BASE_PATH =
  'artifacts/gestao-de-ferramentas-3f8f1/public/data';
const TOOLS_COLLECTION_PATH = `${DB_BASE_PATH}/tools`;
// Mesma coleção do rate limit de crachá (api/tools/movement.js, Gate 1-F4.C3, Decisão 11), com chave
// de documento distinta: os dois contadores nunca se somam nem se bloqueiam mutuamente.
const RATE_LIMIT_COLLECTION_PATH = `${DB_BASE_PATH}/badgeRateLimits`;
const RATE_LIMIT_KEY_PREFIX = 'tool-status:';
const MAX_CODE_LENGTH = 128;
const TOOL_NOT_FOUND_MESSAGE = 'Ferramenta não encontrada.';
const TOOL_CODE_DUPLICATED_MESSAGE = 'Patrimônio duplicado. Contate o administrador.';
const INVALID_REQUEST_MESSAGE = 'Dados da consulta inválidos.';
const LOOKUP_RATE_LIMIT_REASON = 'TOOL_LOOKUP_RATE_LIMITED';
const LOOKUP_RATE_LIMIT_MESSAGE =
  'Muitas consultas sem resultado. Aguarde e tente novamente.';
// Proposta do Claude Code (Gate 1-F4.C4, Decisão D3), sujeita à aprovação do Cowork: só contam as
// falhas que sinalizam enumeração (404 e 409); sucesso não grava nada. Mais folgado que o limite de
// crachá (5/60 s) porque o oráculo aqui não devolve dado pessoal, e leituras ruins de câmera/USB
// podem gerar vários códigos inexistentes seguidos em uso legítimo.
const LOOKUP_RATE_LIMIT_MAX_FAILURES = 10;
const LOOKUP_RATE_LIMIT_WINDOW_MS = 60 * 1000;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createRateLimitedError() {
  const error = createHttpError(429, LOOKUP_RATE_LIMIT_MESSAGE);
  error.reason = LOOKUP_RATE_LIMIT_REASON;
  return error;
}

function parseToolCode(value) {
  if (typeof value !== 'string') {
    throw createHttpError(400, INVALID_REQUEST_MESSAGE);
  }

  const code = value.trim();

  if (!code || code.length > MAX_CODE_LENGTH) {
    throw createHttpError(400, INVALID_REQUEST_MESSAGE);
  }

  return code;
}

function optionalString(value) {
  return typeof value === 'string' ? value : null;
}

// Resposta: lista fechada de campos de B1 (docs/design/USERS_AUDIT_SCREEN.md, seção E.2), igual
// para qualquer perfil que chame este endpoint (Gate 1-F4.C4, Decisões 1 e D2) — nunca
// `currentUser`, `currentCollaboratorId`, `lastMaintenanceBy` nem qualquer outro dado de pessoa.
// Campos selecionados um a um a partir do documento, nunca por remoção, para que um campo novo em
// `tools` não vaze por omissão de filtro. `imageUrl` (data URL JPEG gerado por canvas em
// tools.js) e `nextMaintenance` ('AAAA-MM-DD') seguem o mesmo valor que Admin/Padrão recebem pelo
// listener; qualquer tipo que não seja texto vira `null`, para não repassar objeto aninhado.
function buildToolStatusResponse(id, tool) {
  return {
    id,
    code: tool.code,
    name: tool.name,
    category: tool.category,
    status: tool.status,
    imageUrl: optionalString(tool.imageUrl),
    nextMaintenance: optionalString(tool.nextMaintenance)
  };
}

// Rate limit de consultas sem resultado (Gate 1-F4.C4, Decisão D3): mesmo mecanismo de janela fixa
// do contador de crachá (api/tools/movement.js), em documento próprio por uid. Só uid, contagem e
// janela de tempo — nunca o código consultado nem dado de colaborador.
function lookupRateLimitRef(uid) {
  return adminDb.doc(`${RATE_LIMIT_COLLECTION_PATH}/${RATE_LIMIT_KEY_PREFIX}${uid}`);
}

async function assertLookupRateLimit(uid) {
  const snapshot = await lookupRateLimitRef(uid).get();

  if (!snapshot.exists) {
    return;
  }

  const data = snapshot.data();
  const windowStart = typeof data.windowStart === 'number' ? data.windowStart : 0;
  const count = typeof data.count === 'number' ? data.count : 0;
  const withinWindow = Date.now() - windowStart < LOOKUP_RATE_LIMIT_WINDOW_MS;

  if (withinWindow && count >= LOOKUP_RATE_LIMIT_MAX_FAILURES) {
    throw createRateLimitedError();
  }
}

async function registerLookupFailure(uid) {
  const ref = lookupRateLimitRef(uid);

  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const now = Date.now();
    const data = snapshot.exists ? snapshot.data() : null;
    const windowStart = typeof data?.windowStart === 'number' ? data.windowStart : 0;
    const withinWindow = Boolean(data) && now - windowStart < LOOKUP_RATE_LIMIT_WINDOW_MS;
    const previousCount = typeof data?.count === 'number' ? data.count : 0;

    transaction.set(ref, {
      count: withinWindow ? previousCount + 1 : 1,
      windowStart: withinWindow ? windowStart : now,
      updatedAt: now
    });
  });
}

async function findToolByCode(code) {
  const snapshot = await adminDb
    .collection(TOOLS_COLLECTION_PATH)
    .where('code', '==', code)
    .limit(2)
    .get();

  if (snapshot.size === 0) {
    throw createHttpError(404, TOOL_NOT_FOUND_MESSAGE);
  }

  if (snapshot.size > 1) {
    throw createHttpError(409, TOOL_CODE_DUPLICATED_MESSAGE);
  }

  return snapshot.docs[0];
}

export default async function handler(req, res) {
  // Obrigatoriamente POST, nunca GET: o service worker grava em CacheStorage todo GET da mesma
  // origem, inclusive `/api/*` (src/sw.js), e esse cache é compartilhado entre usuários do mesmo
  // navegador — um GET aqui poderia reservir status de ferramenta de uma sessão para a próxima
  // (docs/design/USERS_AUDIT_SCREEN.md, seção E.2, opção B1). O cliente sempre envia
  // `cache: 'no-store'` nesta chamada, no mesmo padrão de `api/tools/movement.js`.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      success: false,
      message: 'Método não permitido.'
    });
  }

  try {
    const authorization = await requireActiveUser(req);

    // Só observação (Decisão 7/D4): nunca altera status nem corpo desta resposta.
    logOutdatedClientVersion('tools/status', authorization.uid, req.headers?.['x-app-version']);

    const body = req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw createHttpError(400, INVALID_REQUEST_MESSAGE);
    }

    const code = parseToolCode(body.code);

    await assertLookupRateLimit(authorization.uid);

    let toolDoc;

    try {
      toolDoc = await findToolByCode(code);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 409) {
        await registerLookupFailure(authorization.uid);
      }

      throw error;
    }

    return res.status(200).json({
      success: true,
      data: {
        tool: buildToolStatusResponse(toolDoc.id, toolDoc.data())
      }
    });
  } catch (error) {
    const statusCode = getHttpStatus(error);

    if (statusCode < 500) {
      return res.status(statusCode).json({
        success: false,
        message: error.message,
        ...(error.reason === LOOKUP_RATE_LIMIT_REASON ? { code: error.reason } : {})
      });
    }

    console.error('Erro ao consultar status da ferramenta:', error);

    return res.status(500).json({
      success: false,
      message: 'Erro interno ao consultar a ferramenta.'
    });
  }
}
