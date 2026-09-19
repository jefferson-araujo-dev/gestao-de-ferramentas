import { adminAuth, adminDb } from './firebase-admin.js';

export const USERS_COLLECTION_PATH =
  'artifacts/gestao-de-ferramentas-3f8f1/public/data/users';

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getBearerToken(req) {
  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;

  if (!authorization) {
    throw createHttpError(401, 'Token de autenticação ausente.');
  }

  const [scheme, token, extra] = authorization.trim().split(/\s+/);

  if (scheme !== 'Bearer' || !token || extra) {
    throw createHttpError(401, 'Cabeçalho de autenticação inválido.');
  }

  return token;
}

export async function requireActiveUser(req) {
  let decodedToken;

  try {
    decodedToken = await adminAuth.verifyIdToken(getBearerToken(req));
  } catch (error) {
    if (error?.statusCode) {
      throw error;
    }

    throw createHttpError(401, 'Token de autenticação inválido ou expirado.');
  }

  const profileRef = adminDb.doc(`${USERS_COLLECTION_PATH}/${decodedToken.uid}`);
  const profileSnapshot = await profileRef.get();

  if (!profileSnapshot.exists) {
    throw createHttpError(403, 'Perfil de usuário não encontrado.');
  }

  const profile = profileSnapshot.data();

  if (profile.status !== 'Ativo') {
    throw createHttpError(403, 'Usuário inativo.');
  }

  const profileEmail = String(profile.email || '').trim().toLowerCase();
  const tokenEmail = String(decodedToken.email || '').trim().toLowerCase();

  if (!profileEmail || profileEmail !== tokenEmail) {
    throw createHttpError(403, 'E-mail do perfil não corresponde à conta autenticada.');
  }

  return {
    uid: decodedToken.uid,
    email: tokenEmail,
    profile,
    profileRef
  };
}

export async function requireActiveAdmin(req) {
  const authorization = await requireActiveUser(req);

  if (authorization.profile.accessLevel !== 'Administrador') {
    throw createHttpError(403, 'Acesso permitido somente para administradores.');
  }

  return authorization;
}

export function getHttpStatus(error) {
  return Number.isInteger(error?.statusCode) ? error.statusCode : 500;
}
