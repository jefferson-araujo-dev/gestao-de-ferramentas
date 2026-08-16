#!/usr/bin/env node
/**
 * Popula o Firebase Emulator Suite local com um conjunto mínimo e
 * determinístico de dados para validação manual de fluxos de negócio
 * (Gate 17 - Fase 1). Nunca toca produção: recusa-se a rodar se as
 * variáveis de ambiente do emulador não estiverem definidas.
 *
 * Uso: suba o emulador (`npm run emulators`) e, em outro terminal, rode
 * `npm run seed:emulator`. Seguro rodar mais de uma vez (todos os
 * documentos usam IDs fixos e são sobrescritos, não duplicados).
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'gestao-ferramentas-coeng-2026';
const DB_BASE_PATH = `artifacts/${PROJECT_ID}/public/data`;

const ADMIN_EMAIL = 'admin.teste@emulador.local';
const ADMIN_PASSWORD = 'SenhaTeste123!-NAO-USAR-EM-PRODUCAO';
const COLLAB_ID = 'seed-collab-001';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error(
    'Este script só deve rodar contra o Firebase Emulator Suite local.\n' +
      'Defina FIRESTORE_EMULATOR_HOST e FIREBASE_AUTH_EMULATOR_HOST antes de executar, por exemplo:\n' +
      '  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed:emulator'
  );
  process.exit(1);
}

const app = initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);
const db = getFirestore(app);

async function upsertAuthUser(email, password) {
  try {
    const existing = await auth.getUserByEmail(email);
    return existing.uid;
  } catch (err) {
    if (err.code !== 'auth/user-not-found') {
      throw err;
    }
  }
  const created = await auth.createUser({ email, password, emailVerified: true });
  return created.uid;
}

async function seed() {
  const adminUid = await upsertAuthUser(ADMIN_EMAIL, ADMIN_PASSWORD);

  await db.doc(`${DB_BASE_PATH}/users/${adminUid}`).set({
    name: 'Administrador de Teste',
    email: ADMIN_EMAIL,
    accessLevel: 'Administrador',
    department: 'TI',
    status: 'Ativo',
    isRestricted: false,
    createdAt: new Date().toISOString(),
    lastLogin: null,
    lastIp: null,
    lastDevice: null
  });

  await db.doc(`${DB_BASE_PATH}/collaborators/${COLLAB_ID}`).set({
    badge: 'SEED-001',
    name: 'Colaborador de Teste',
    role: 'Operador',
    phone: '(00) 00000-0000',
    status: 'active',
    imageUrl: null
  });

  await db.doc(`${DB_BASE_PATH}/tools/SEED-TOOL-AVAILABLE`).set({
    code: 'SEED-TOOL-AVAILABLE',
    name: 'Furadeira de Teste',
    category: 'Elétrica',
    status: 'available',
    currentUser: null,
    lastAction: null,
    imageUrl: null,
    condition: 'Boa',
    nextMaintenance: null,
    notes: 'Item de seed para o Emulator Suite.',
    manualUrl: null,
    manualName: null
  });

  await db.doc(`${DB_BASE_PATH}/tools/SEED-TOOL-BORROWED`).set({
    code: 'SEED-TOOL-BORROWED',
    name: 'Parafusadeira de Teste',
    category: 'Elétrica',
    status: 'borrowed',
    currentUser: 'Colaborador de Teste',
    currentCollaboratorId: COLLAB_ID,
    lastAction: new Date().toISOString(),
    imageUrl: null,
    condition: 'Boa',
    nextMaintenance: null,
    notes: 'Item de seed para o Emulator Suite (para testar devolução).',
    manualUrl: null,
    manualName: null
  });

  console.log('Seed concluído no Firebase Emulator Suite (projeto: %s):', PROJECT_ID);
  console.log(`  Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (uid: ${adminUid})`);
  console.log(`  Colaborador: SEED-001 (id: ${COLLAB_ID})`);
  console.log('  Ferramentas: SEED-TOOL-AVAILABLE (available), SEED-TOOL-BORROWED (borrowed)');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Falha ao popular o emulador:', err);
    process.exit(1);
  });
