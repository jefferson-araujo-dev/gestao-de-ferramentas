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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      success: false,
      message: 'Método não permitido.'
    });
  }

  let createdUid = null;

  try {
    await requireActiveAdmin(req);

    const body = parseRequestBody(req);
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

    const userRecord = await adminAuth.createUser({
      email,
      displayName: name,
      disabled: false,
      emailVerified: false
    });

    createdUid = userRecord.uid;

    await adminDb.doc(`${USERS_COLLECTION_PATH}/${createdUid}`).create({
      name,
      email,
      accessLevel,
      department,
      status: 'Ativo',
      isRestricted: false,
      createdAt: FieldValue.serverTimestamp(),
      lastLogin: null,
      lastIp: null,
      lastDevice: null
    });

    return res.status(201).json({
      success: true,
      message: 'Usuário cadastrado com sucesso.',
      data: {
        uid: createdUid,
        email
      }
    });
  } catch (error) {
    if (createdUid) {
      try {
        await adminAuth.deleteUser(createdUid);
      } catch (rollbackError) {
        console.error('Falha ao reverter usuário do Authentication:', rollbackError);
      }
    }

    let statusCode = getHttpStatus(error);
    let message = error?.message || 'Não foi possível cadastrar o usuário.';

    if (error?.code === 'auth/email-already-exists') {
      statusCode = 409;
      message = 'Já existe uma conta com este e-mail.';
    }

    if (statusCode >= 500) {
      console.error('Erro ao cadastrar usuário:', error);
      message = 'Erro interno ao cadastrar o usuário.';
    }

    return res.status(statusCode).json({
      success: false,
      message
    });
  }
}
