import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getDatabase, type Database } from 'firebase-admin/database';
import { readAdminEnv } from './env';

let cachedApp: App | undefined;

export function getAdminApp(): App {
  if (cachedApp) return cachedApp;

  const env = readAdminEnv();
  const existing = getApps().find((a) => a.name === '[DEFAULT]');
  if (existing) {
    cachedApp = existing;
    return cachedApp;
  }

  cachedApp = initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      // Private keys can have escaped newlines from env files; restore them.
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
    databaseURL: env.FIREBASE_DATABASE_URL,
  });

  return cachedApp;
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminDatabase(): Database {
  return getDatabase(getAdminApp());
}
