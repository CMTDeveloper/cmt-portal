import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getDatabase, type Database } from 'firebase/database';
import { readClientEnv } from './env';

let cachedApp: FirebaseApp | undefined;

export function getClientApp(): FirebaseApp {
  if (cachedApp) return cachedApp;

  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return cachedApp;
  }

  const env = readClientEnv();
  cachedApp = initializeApp({
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    databaseURL: env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
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
