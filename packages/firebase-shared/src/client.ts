import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getDatabase, type Database } from 'firebase/database';
import { portalClientEnvSchema } from './env';

let cachedApp: FirebaseApp | undefined;

export function getClientApp(): FirebaseApp {
  if (cachedApp) return cachedApp;

  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return cachedApp;
  }

  const parsed = portalClientEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `[firebase-shared] Missing or invalid portal client env vars: ${parsed.error.message}`,
    );
  }
  const env = parsed.data;

  cachedApp = initializeApp({
    apiKey: env.NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID,
    storageBucket: env.NEXT_PUBLIC_PORTAL_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.NEXT_PUBLIC_PORTAL_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.NEXT_PUBLIC_PORTAL_FIREBASE_APP_ID,
  });

  return cachedApp;
}

export function getClientAuth(): Auth {
  return getAuth(getClientApp());
}

export function getClientFirestore(): Firestore {
  return getFirestore(getClientApp());
}

export function getClientDatabase(): Database {
  return getDatabase(getClientApp());
}
