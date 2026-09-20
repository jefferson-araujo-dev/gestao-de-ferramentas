import { adminDb } from '../../server/firebase-admin.js';
import { getHttpStatus, requireActiveAdmin } from '../../server/admin-authorization.js';
import {
  BackupOperationError,
  RESET_CONFIRMATION,
  executeReset
} from '../../server/backup-operations.js';

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseRequestBody(req) {
  if (!req.body) {
    throw createHttpError(400, 'Corpo da requisição ausente.');
  }

  let body = req.body;

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      throw createHttpError(400, 'Corpo JSON inválido.');
    }
  }

  if (typeof body !== 'object' || Array.isArray(body)) {
    throw createHttpError(400, 'Corpo da requisição inválido.');
  }

  return body;
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
    await requireActiveAdmin(req);

    const body = parseRequestBody(req);

    if (body.confirmation !== RESET_CONFIRMATION) {
      throw createHttpError(400, 'Confirmação de reset ausente ou inválida.');
    }

    const result = await executeReset({ db: adminDb });

    return res.status(200).json({
      success: true,
      message: 'Dados operacionais apagados e verificados.',
      data: result
    });
  } catch (error) {
    const statusCode = getHttpStatus(error);

    if (statusCode >= 500) {
      console.error('Falha no reset operacional:', error?.name, error?.code);
    }

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode >= 500 && !(error instanceof BackupOperationError)
          ? 'Erro interno ao resetar os dados operacionais.'
          : error.message,
      ...(error instanceof BackupOperationError ? error.publicDetails : {})
    });
  }
}
