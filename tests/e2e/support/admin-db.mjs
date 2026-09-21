// Leitura/limpeza direta no Firestore do EMULATOR, para provar persistência real nos specs
// destrutivos. Falha fechado pelo mesmo guard do seed: sem os hosts locais do emulator (ou com
// credenciais reais no ambiente) nada aqui roda. Nunca toca Firebase remoto.
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { DB_BASE_PATH, PROJECT_ID, assertEmulatorOnlyEnvironment } from './env.mjs';

let sequence = 0;

async function withDb(run) {
  assertEmulatorOnlyEnvironment();

  sequence += 1;

  const app = initializeApp({ projectId: PROJECT_ID }, `e2e-admin-${sequence}`);
  const db = getFirestore(app);

  try {
    return await run(db);
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

/** Todos os colaboradores persistidos, como { firebaseId, ...dados }. */
export function readCollaborators() {
  return withDb(async (db) => {
    const snapshot = await db.collection(`${DB_BASE_PATH}/collaborators`).get();

    return snapshot.docs.map((doc) => ({ firebaseId: doc.id, ...doc.data() }));
  });
}

/** Remove documentos por id (limpeza do que o próprio spec criou). */
export function deleteCollaborators(ids) {
  if (!ids.length) {
    return Promise.resolve();
  }

  return withDb(async (db) => {
    const batch = db.batch();

    ids.forEach((id) => batch.delete(db.doc(`${DB_BASE_PATH}/collaborators/${id}`)));

    await batch.commit();
  });
}
