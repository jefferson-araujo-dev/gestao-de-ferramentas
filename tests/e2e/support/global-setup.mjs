// Semeia o Firebase Emulator (Auth + Firestore) com estado sintético determinístico.
// Recusa rodar fora do emulator local (assertEmulatorOnlyEnvironment) e nunca usa credenciais.
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

import { DB_BASE_PATH, PROJECT_ID, assertEmulatorOnlyEnvironment } from './env.mjs';
import {
  E2E_COLLABORATORS,
  E2E_HISTORY,
  E2E_PASSWORD,
  E2E_TOOLS,
  E2E_USERS,
} from './seed-data.mjs';

async function upsertAuthUser(auth, email) {
  try {
    return (await auth.getUserByEmail(email)).uid;
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') {
      throw error;
    }
  }

  return (await auth.createUser({ email, password: E2E_PASSWORD, emailVerified: true })).uid;
}

export default async function globalSetup() {
  assertEmulatorOnlyEnvironment();

  const app = initializeApp({ projectId: PROJECT_ID }, 'e2e-seed');
  const auth = getAuth(app);
  const db = getFirestore(app);
  const batch = db.batch();

  for (const user of Object.values(E2E_USERS)) {
    const uid = await upsertAuthUser(auth, user.email);

    batch.set(db.doc(`${DB_BASE_PATH}/users/${uid}`), {
      name: user.name,
      email: user.email,
      accessLevel: user.accessLevel,
      department: user.department,
      status: user.status,
      isRestricted: user.isRestricted,
      createdAt: '2026-01-15T12:00:00.000Z',
      lastLogin: null,
    });
  }

  for (const [id, data] of Object.entries(E2E_TOOLS)) {
    batch.set(db.doc(`${DB_BASE_PATH}/tools/${id}`), data);
  }

  for (const [id, data] of Object.entries(E2E_COLLABORATORS)) {
    batch.set(db.doc(`${DB_BASE_PATH}/collaborators/${id}`), data);
  }

  for (const [id, data] of Object.entries(E2E_HISTORY)) {
    batch.set(db.doc(`${DB_BASE_PATH}/history/${id}`), data);
  }

  await batch.commit();
  await db.terminate();
  await deleteApp(app);
}
