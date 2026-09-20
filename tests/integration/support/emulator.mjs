// Ambiente compartilhado dos testes de integração contra o Firebase Emulator Suite
// (Firestore + Auth), sem Firebase remoto.
//
// Falha fechado: recusa carregar sem os hosts do emulator, com host não local ou com
// GOOGLE_APPLICATION_CREDENTIALS definido. Toda conexão de rede não local é bloqueada e
// registrada. Nenhuma credencial real é usada: a chave RSA do Admin SDK é efêmera (memória).
// Somente contagens, status e booleanos devem ser impressos pelos testes: nada de tokens,
// senhas ou dados pessoais.
import { generateKeyPairSync } from 'node:crypto';
import net from 'node:net';

export const PROJECT_ID = 'gestao-de-ferramentas-3f8f1';
export const BASE = `artifacts/${PROJECT_ID}/public/data`;
export const FIXTURE_PASSWORD = 'Senha-De-Teste-Emulator-1';

function parseLocalHost(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ausente: este teste roda somente dentro do Firebase Emulator.`);
  }

  const match = /^([^:/\s]+):(\d{2,5})$/.exec(value);

  if (!match || !['127.0.0.1', 'localhost'].includes(match[1].toLowerCase())) {
    throw new Error(`${name} deve apontar somente para 127.0.0.1 ou localhost.`);
  }

  return { host: match[1], port: Number(match[2]) };
}

function assertSafeEnvironment() {
  const firestore = parseLocalHost('FIRESTORE_EMULATOR_HOST');
  const auth = parseLocalHost('FIREBASE_AUTH_EMULATOR_HOST');

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS definido: nenhuma credencial real pode existir neste teste.'
    );
  }

  return { firestore, auth };
}

export const environment = assertSafeEnvironment();

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export const networkAttempts = [];

const originalConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function connectGuard(...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  let host = 'localhost';
  let ipc = false;

  if (first !== null && typeof first === 'object') {
    ipc = typeof first.path === 'string';
    host = first.host ?? 'localhost';
  } else if (typeof first === 'string' && Number.isNaN(Number(first))) {
    ipc = true;
  } else if (typeof normalized[1] === 'string') {
    host = normalized[1];
  }

  const remote = !ipc && !LOOPBACK.has(String(host).toLowerCase());

  networkAttempts.push({ host: ipc ? 'ipc' : String(host), remote });

  if (remote) {
    throw new Error('Conexao de rede nao local bloqueada pelo teste de integracao.');
  }

  return originalConnect.apply(this, args);
};

// Chave RSA efêmera, só em memória, apenas para o bootstrap do Admin SDK apontar ao emulator.
const { privateKey: ephemeralPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
process.env.FIREBASE_CLIENT_EMAIL = `emulator-test@${PROJECT_ID}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = ephemeralPrivateKey;

const { deleteApp, initializeApp } = await import('firebase/app');
const { connectAuthEmulator, getAuth, signInWithEmailAndPassword } =
  await import('firebase/auth');
const { connectFirestoreEmulator, getFirestore, terminate } = await import('firebase/firestore');
const { Timestamp } = await import('firebase-admin/firestore');
const { deleteApp: deleteAdminApp, getApp: getAdminApp } = await import('firebase-admin/app');
const { adminAuth, adminDb } = await import('../../../server/firebase-admin.js');

export { Timestamp, adminAuth, adminDb };

const clients = [];

export const withTimeout = (promise, label, ms = 20000) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`timeout: ${label}`)), ms).unref();
    }),
  ]);

// Cria a conta no Auth Emulator + o perfil no Firestore (Admin SDK: fixture, não a API testada).
export async function createUserFixture(key, { accessLevel, status = 'Ativo', extra = {} }) {
  const email = `${key.toLowerCase()}.integration@emulator.local`;
  const created = await adminAuth.createUser({
    email,
    password: FIXTURE_PASSWORD,
    emailVerified: true,
  });

  await adminDb.doc(`${BASE}/users/${created.uid}`).set({
    name: `Usuario ${key}`,
    email,
    accessLevel,
    department: 'Teste',
    status,
    createdAt: Timestamp.fromMillis(1700000000000),
    lastLogin: Timestamp.fromMillis(1700000100000),
    ...extra,
  });

  return { key, email, uid: created.uid };
}

// Login real no Auth Emulator: devolve token de ID e um cliente Firestore autenticado.
export async function signIn(user) {
  const app = initializeApp(
    {
      apiKey: 'emulator-fake-api-key',
      projectId: PROJECT_ID,
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
    },
    `client-${user.key}`
  );
  const auth = getAuth(app);

  connectAuthEmulator(auth, `http://${environment.auth.host}:${environment.auth.port}`, {
    disableWarnings: true,
  });

  const credential = await withTimeout(
    signInWithEmailAndPassword(auth, user.email, FIXTURE_PASSWORD),
    `login ${user.key}`
  );
  const db = getFirestore(app);

  connectFirestoreEmulator(db, environment.firestore.host, environment.firestore.port);

  const client = { app, db, token: await credential.user.getIdToken() };

  clients.push(client);

  return client;
}

// Cliente Firestore SEM login (request.auth == null).
export function anonymousClient() {
  const app = initializeApp({ apiKey: 'emulator-fake-api-key', projectId: PROJECT_ID }, 'anonymous');
  const db = getFirestore(app);

  connectFirestoreEmulator(db, environment.firestore.host, environment.firestore.port);

  const client = { app, db };

  clients.push(client);

  return client;
}

export async function closeEmulatorClients() {
  for (const client of clients) {
    await terminate(client.db).catch(() => {});
    await deleteApp(client.app).catch(() => {});
  }

  await adminDb.terminate().catch(() => {});
  await deleteAdminApp(getAdminApp()).catch(() => {});
}
