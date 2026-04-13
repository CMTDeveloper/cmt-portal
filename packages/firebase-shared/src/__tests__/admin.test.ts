import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const VALID_ENV = {
  FIREBASE_PROJECT_ID: 'chinmaya-setu-715b8-test',
  FIREBASE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ\\n-----END PRIVATE KEY-----',
  FIREBASE_DATABASE_URL: 'https://chinmaya-setu-715b8-test.firebaseio.com',
};

const mockApp = { name: '[DEFAULT]' };

vi.mock('firebase-admin/app', () => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => mockApp),
  cert: vi.fn((creds) => creds),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
}));

vi.mock('firebase-admin/database', () => ({
  getDatabase: vi.fn(),
}));

describe('getAdminApp', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    Object.assign(process.env, VALID_ENV);
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('returns a Firebase app instance when env vars are valid', async () => {
    const { getAdminApp } = await import('../admin');
    const app = getAdminApp();
    expect(app).toBeDefined();
    expect(app.name).toBeDefined();
  });

  it('throws when FIREBASE_PROJECT_ID is missing', async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    const { getAdminApp } = await import('../admin');
    expect(() => getAdminApp()).toThrow(/Missing or invalid Firebase admin env vars/);
  });

  it('memoizes the app instance across calls', async () => {
    const { getAdminApp } = await import('../admin');
    const a = getAdminApp();
    const b = getAdminApp();
    expect(a).toBe(b);
  });
});
