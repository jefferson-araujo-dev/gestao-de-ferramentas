import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const REQUIRED_ENV_VARS = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY'
];

function getServiceAccount() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(', ')}`);
  }

  return {
    projectId: process.env.FIREBASE_PROJECT_ID.trim(),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  };
}

const adminApp =
  getApps().length > 0
    ? getApp()
    : initializeApp({
        credential: cert(getServiceAccount())
      });

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
