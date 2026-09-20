import { adminDb } from '../../server/firebase-admin.js';
import { getHttpStatus, requireActiveAdmin } from '../../server/admin-authorization.js';
import {
  BackupOperationError,
  MAX_RESTORE_BODY_BYTES,
  RESTORE_CONFIRMATION,
  executeRestore
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

    if (body.confirmation !== RESTORE_CONFIRMATION) {
      throw createHttpError(400, 'Confirmação de restauração ausente ou inválida.');
    }

    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_RESTORE_BODY_BYTES) {
      throw createHttpError(413, 'O backup excede o tamanho máximo aceito por esta API.');
    }

    const result = await executeRestore({ db: adminDb, input: body.backup });

    return res.status(200).json({
      success: true,
      message: 'Restauração concluída e verificada.',
      data: result
    });
  } catch (error) {
    const statusCode = getHttpStatus(error);

    if (statusCode >= 500) {
      console.error('Falha no restore operacional:', error?.name, error?.code);
    }

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode >= 500 && !(error instanceof BackupOperationError)
          ? 'Erro interno ao restaurar o backup.'
          : error.message,
      ...(error instanceof BackupOperationError ? error.publicDetails : {})
    });
  }
}
