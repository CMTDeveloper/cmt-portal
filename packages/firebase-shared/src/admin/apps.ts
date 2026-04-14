import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { readPortalAdminEnv, readMasterAdminEnv } from '../env';

let portalApp: App | undefined;
let masterApp: App | undefined;

/** Reset cached app references — only for use in tests via vi.resetModules(). */
export function _resetAppsForTesting(): void {
  portalApp = undefined;
  masterApp = undefined;
}

export function getPortalApp(): App {
  if (portalApp) return portalApp;
  const existing = getApps().find((a) => a.name === 'portal');
  if (existing) {
    portalApp = existing;
    return portalApp;
  }

  const env = readPortalAdminEnv();
  portalApp = initializeApp(
    {
      credential: cert({
        projectId: env.PORTAL_FIREBASE_PROJECT_ID,
        clientEmail: env.PORTAL_FIREBASE_CLIENT_EMAIL,
        privateKey: env.PORTAL_FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    },
    'portal',
  );
  return portalApp;
}

export function getMasterApp(): App {
  if (masterApp) return masterApp;
  const existing = getApps().find((a) => a.name === 'master');
  if (existing) {
    masterApp = existing;
    return masterApp;
  }

  const env = readMasterAdminEnv();
  masterApp = initializeApp(
    {
      credential: cert({
        projectId: env.MASTER_FIREBASE_PROJECT_ID,
        clientEmail: env.MASTER_FIREBASE_CLIENT_EMAIL,
        privateKey: env.MASTER_FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      databaseURL: env.MASTER_FIREBASE_DATABASE_URL,
    },
    'master',
  );
  return masterApp;
}
