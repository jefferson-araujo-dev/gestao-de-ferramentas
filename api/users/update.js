import { FieldValue } from 'firebase-admin/firestore';

import { adminAuth, adminDb } from '../../server/firebase-admin.js';
import {
  getHttpStatus,
  requireActiveAdmin,
  USERS_COLLECTION_PATH
} from '../../server/admin-authorization.js';

const ALLOWED_ACCESS_LEVELS = new Set(['Usuário Padrão', 'Administrador']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseRequestBody(req) {
  if (!req.body) {
    throw createHttpError(400, 'Corpo da requisição ausente.');
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      throw createHttpError(400, 'Corpo JSON inválido.');
    }
  }

  if (typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw createHttpError(400, 'Corpo da requisição inválido.');
  }

  return req.body;
}

function normalizeRequiredString(value, fieldName, maxLength) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    throw createHttpError(400, `O campo ${fieldName} é obrigatório.`);
  }

  if (normalized.length > maxLength) {
    throw createHttpError(
      400,
      `O campo ${fieldName} deve ter no máximo ${maxLength} caracteres.`
    );
  }

  return normalized;
}

function normalizeOptionalString(value, fieldName, maxLength) {
  const normalized = String(value || '').trim();

  if (normalized.length > maxLength) {
    throw createHttpError(
      400,
      `O campo ${fieldName} deve ter no máximo ${maxLength} caracteres.`
    );
  }

  return normalized;
}

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({
      success: false,
      message: 'Método não permitido.'
    });
  }

  let authUpdated = false;
  let originalAuthData = null;
  let targetUid = null;

  try {
    const actor = await requireActiveAdmin(req);
    const body = parseRequestBody(req);

    targetUid = normalizeRequiredString(body.uid, 'UID', 128);
    const name = normalizeRequiredString(body.name, 'Nome', 160);
    const email = normalizeRequiredString(body.email, 'E-mail', 254).toLowerCase();
    const department = normalizeOptionalString(body.department, 'Departamento', 120);
    const accessLevel = normalizeRequiredString(body.accessLevel, 'Nível de acesso', 40);

    if (!EMAIL_PATTERN.test(email)) {
      throw createHttpError(400, 'E-mail inválido.');
    }

    if (!ALLOWED_ACCESS_LEVELS.has(accessLevel)) {
      throw createHttpError(400, 'Nível de acesso inválido.');
    }

    const targetRef = adminDb.doc(`${USERS_COLLECTION_PATH}/${targetUid}`);
    const [targetSnapshot, targetRecord] = await Promise.all([
      targetRef.get(),
      adminAuth.getUser(targetUid)
    ]);

    if (!targetSnapshot.exists) {
      throw createHttpError(404, 'Perfil do usuário não encontrado.');
    }

    const currentProfile = targetSnapshot.data();
    const currentEmail = String(targetRecord.email || '').trim().toLowerCase();

    if (actor.uid === targetUid && accessLevel !== 'Administrador') {
      throw createHttpError(409, 'Você não pode remover o próprio acesso de administrador.');
    }

    if (actor.uid === targetUid && email !== currentEmail) {
      throw createHttpError(409, 'O administrador conectado não pode alterar o próprio e-mail.');
    }

    originalAuthData = {
      email: targetRecord.email,
      displayName: targetRecord.displayName ?? null
    };

    await adminAuth.updateUser(targetUid, {
      email,
      displayName: name
    });
    authUpdated = true;

    await targetRef.update({
      name,
      email,
      accessLevel,
      department,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid
    });

    return res.status(200).json({
      success: true,
      message: 'Usuário atualizado com sucesso.',
      data: {
        uid: targetUid,
        email,
        accessLevel,
        status: currentProfile.status || 'Ativo'
      }
    });
  } catch (error) {
    if (authUpdated && targetUid && originalAuthData) {
      try {
        await adminAuth.updateUser(targetUid, originalAuthData);
      } catch (rollbackError) {
        console.error('Falha ao reverter atualização do Authentication:', rollbackError);
      }
    }

    let statusCode = getHttpStatus(error);
    let message = error?.message || 'Não foi possível atualizar o usuário.';

    if (error?.code === 'auth/user-not-found') {
      statusCode = 404;
      message = 'Conta do usuário não encontrada no Authentication.';
    }

    if (error?.code === 'auth/email-already-exists') {
      statusCode = 409;
      message = 'Já existe uma conta com este e-mail.';
    }

    if (statusCode >= 500) {
      console.error('Erro ao atualizar usuário:', error);
      message = 'Erro interno ao atualizar o usuário.';
    }

    return res.status(statusCode).json({
      success: false,
      message
    });
  }
}
