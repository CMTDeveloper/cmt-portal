import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('firebase-admin/app', () => {
  const apps: Array<{ name: string }> = [];
  return {
    initializeApp: vi.fn((_config, name: string) => {
      const app = { name };
      apps.push(app);
      return app;
    }),
    cert: vi.fn((c) => c),
    getApp: vi.fn((name: string) => apps.find((a) => a.name === name)),
    getApps: vi.fn(() => apps),
  };
});

import { initializeApp, getApps } from 'firebase-admin/app';
import { getPortalApp, getMasterApp, _resetAppsForTesting } from '../admin/apps';

beforeEach(() => {
  vi.clearAllMocks();
  _resetAppsForTesting();
  (getApps as unknown as ReturnType<typeof vi.fn>).mockReturnValue([]);
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
  process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
  process.env.PORTAL_FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n';
  process.env.MASTER_FIREBASE_PROJECT_ID = 'm';
  process.env.MASTER_FIREBASE_CLIENT_EMAIL = 'sa@m.iam.gserviceaccount.com';
  process.env.MASTER_FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nxyz\\n-----END PRIVATE KEY-----\\n';
  process.env.MASTER_FIREBASE_DATABASE_URL = 'https://m-default-rtdb.firebaseio.com';
});

afterEach(() => {
  vi.resetModules();
});

describe('getPortalApp', () => {
  it('initializes a portal-named Firebase Admin app', () => {
    const app = getPortalApp();
    expect(app.name).toBe('portal');
    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: expect.objectContaining({ projectId: 'p' }),
      }),
      'portal',
    );
  });

  it('returns the existing app on subsequent calls', () => {
    const first = getPortalApp();
    const second = getPortalApp();
    expect(first).toBe(second);
    expect(initializeApp).toHaveBeenCalledTimes(1);
  });

  it('restores escaped newlines in the private key', () => {
    getPortalApp();
    const call = (initializeApp as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.credential.privateKey).toContain('\n');
    expect(call.credential.privateKey).not.toContain('\\n');
  });
});

describe('getMasterApp', () => {
  it('initializes a master-named Firebase Admin app with databaseURL', () => {
    const app = getMasterApp();
    expect(app.name).toBe('master');
    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: expect.objectContaining({ projectId: 'm' }),
        databaseURL: 'https://m-default-rtdb.firebaseio.com',
      }),
      'master',
    );
  });
});
