import { adminAuth, adminDb } from '../../server/firebase-admin.js';
import {
  getHttpStatus,
  requireActiveAdmin,
  USERS_COLLECTION_PATH
} from '../../server/admin-authorization.js';

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

function normalizeUid(value) {
  const uid = String(value || '').trim();

  if (!uid) {
    throw createHttpError(400, 'O UID do usuário é obrigatório.');
  }

  if (uid.length > 128) {
    throw createHttpError(400, 'O UID do usuário é inválido.');
  }

  return uid;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      success: false,
      message: 'Método não permitido.'
    });
  }

  let deletedProfile = null;
  let targetProfileRef = null;

  try {
    const currentAdmin = await requireActiveAdmin(req);
    const body = parseRequestBody(req);
    const targetUid = normalizeUid(body.uid);

    if (targetUid === currentAdmin.uid) {
      throw createHttpError(
        409,
        'Você não pode excluir a própria conta administrativa.'
      );
    }

    await adminAuth.getUser(targetUid);

    targetProfileRef = adminDb.doc(
      `${USERS_COLLECTION_PATH}/${targetUid}`
    );

    await adminDb.runTransaction(async (transaction) => {
      const targetProfileSnapshot = await transaction.get(
        targetProfileRef
      );

      if (!targetProfileSnapshot.exists) {
        throw createHttpError(
          404,
          'Perfil do usuário não encontrado.'
        );
      }

      const targetProfile = targetProfileSnapshot.data();

      if (
        targetProfile.status === 'Ativo' &&
        targetProfile.accessLevel === 'Administrador'
      ) {
        const usersSnapshot = await transaction.get(
          adminDb.collection(USERS_COLLECTION_PATH)
        );

        const activeAdministratorCount =
          usersSnapshot.docs.filter((documentSnapshot) => {
            const profile = documentSnapshot.data();

            return (
              profile.status === 'Ativo' &&
              profile.accessLevel === 'Administrador'
            );
          }).length;

        if (activeAdministratorCount <= 1) {
          throw createHttpError(
            409,
            'O último administrador ativo não pode ser excluído.'
          );
        }
      }

      deletedProfile = targetProfile;
      transaction.delete(targetProfileRef);
    });

    try {
      await adminAuth.deleteUser(targetUid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') {
        try {
          await targetProfileRef.create(deletedProfile);
        } catch (rollbackError) {
          console.error(
            'Falha ao restaurar o perfil após erro no Authentication:',
            rollbackError
          );

          throw createHttpError(
            500,
            'Falha ao excluir a conta e restaurar o perfil do usuário.'
          );
        }

        throw error;
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Usuário excluído com sucesso.',
      data: {
        uid: targetUid
      }
    });
  } catch (error) {
    let statusCode = getHttpStatus(error);
    let message =
      error?.message ||
      'Não foi possível excluir o usuário.';

    if (error?.code === 'auth/user-not-found') {
      statusCode = 404;
      message =
        'Conta do usuário não encontrada no Authentication.';
    }

    if (statusCode >= 500) {
      console.error('Erro ao excluir usuário:', error);
      message = 'Erro interno ao excluir o usuário.';
    }

    return res.status(statusCode).json({
      success: false,
      message
    });
  }
}
