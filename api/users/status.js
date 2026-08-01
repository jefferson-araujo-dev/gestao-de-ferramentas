import { adminAuth, adminDb } from '../../server/firebase-admin.js';
import {
  getHttpStatus,
  requireActiveAdmin,
  USERS_COLLECTION_PATH
} from '../../server/admin-authorization.js';

const ALLOWED_STATUSES = new Set(['Ativo', 'Inativo']);

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

function normalizeStatus(value) {
  const status = String(value || '').trim();

  if (!ALLOWED_STATUSES.has(status)) {
    throw createHttpError(400, 'Status inválido.');
  }

  return status;
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
    const currentAdmin = await requireActiveAdmin(req);
    const body = parseRequestBody(req);
    const targetUid = normalizeUid(body.uid);
    const newStatus = normalizeStatus(body.status);

    if (targetUid === currentAdmin.uid && newStatus === 'Inativo') {
      throw createHttpError(
        409,
        'Você não pode desativar a própria conta administrativa.'
      );
    }

    const targetProfileRef = adminDb.doc(
      `${USERS_COLLECTION_PATH}/${targetUid}`
    );

    const [targetProfileSnapshot, targetUserRecord] = await Promise.all([
      targetProfileRef.get(),
      adminAuth.getUser(targetUid)
    ]);

    if (!targetProfileSnapshot.exists) {
      throw createHttpError(404, 'Perfil do usuário não encontrado.');
    }

    const targetProfile = targetProfileSnapshot.data();
    const currentStatus = targetProfile.status;

    if (!ALLOWED_STATUSES.has(currentStatus)) {
      throw createHttpError(
        409,
        'O perfil possui um status atual inválido.'
      );
    }

    const shouldDisable = newStatus === 'Inativo';
    const authenticationChanged =
      targetUserRecord.disabled !== shouldDisable;

    if (authenticationChanged) {
      await adminAuth.updateUser(targetUid, {
        disabled: shouldDisable
      });
    }

    try {
      await adminDb.runTransaction(async (transaction) => {
        const freshProfileSnapshot = await transaction.get(
          targetProfileRef
        );

        if (!freshProfileSnapshot.exists) {
          throw createHttpError(
            404,
            'Perfil do usuário não encontrado.'
          );
        }

        const freshProfile = freshProfileSnapshot.data();

        if (
          newStatus === 'Inativo' &&
          freshProfile.status === 'Ativo' &&
          freshProfile.accessLevel === 'Administrador'
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
              'O último administrador ativo não pode ser desativado.'
            );
          }
        }

        transaction.update(targetProfileRef, {
          status: newStatus
        });
      });
    } catch (error) {
      if (authenticationChanged) {
        try {
          await adminAuth.updateUser(targetUid, {
            disabled: targetUserRecord.disabled
          });
        } catch (rollbackError) {
          console.error(
            'Falha ao restaurar o status do Authentication:',
            rollbackError
          );
        }
      }

      throw error;
    }

    return res.status(200).json({
      success: true,
      message:
        newStatus === 'Ativo'
          ? 'Usuário ativado com sucesso.'
          : 'Usuário desativado com sucesso.',
      data: {
        uid: targetUid,
        status: newStatus
      }
    });
  } catch (error) {
    let statusCode = getHttpStatus(error);
    let message =
      error?.message ||
      'Não foi possível alterar o status do usuário.';

    if (error?.code === 'auth/user-not-found') {
      statusCode = 404;
      message = 'Conta do usuário não encontrada no Authentication.';
    }

    if (statusCode >= 500) {
      console.error(
        'Erro ao alterar o status do usuário:',
        error
      );

      message =
        'Erro interno ao alterar o status do usuário.';
    }

    return res.status(statusCode).json({
      success: false,
      message
    });
  }
}
