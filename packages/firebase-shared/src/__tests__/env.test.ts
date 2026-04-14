import { describe, it, expect, beforeEach } from 'vitest';
import {
  portalAdminEnvSchema,
  masterAdminEnvSchema,
  portalClientEnvSchema,
  masterClientEnvSchema,
  readPortalAdminEnv,
  readMasterAdminEnv,
} from '../env';

describe('portalAdminEnvSchema', () => {
  it('parses valid portal admin env', () => {
    const result = portalAdminEnvSchema.safeParse({
      PORTAL_FIREBASE_PROJECT_ID: 'chinmaya-setu-uat',
      PORTAL_FIREBASE_CLIENT_EMAIL: 'sa@chinmaya-setu-uat.iam.gserviceaccount.com',
      PORTAL_FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing private key', () => {
    const result = portalAdminEnvSchema.safeParse({
      PORTAL_FIREBASE_PROJECT_ID: 'chinmaya-setu-uat',
      PORTAL_FIREBASE_CLIENT_EMAIL: 'sa@chinmaya-setu-uat.iam.gserviceaccount.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid client email', () => {
    const result = portalAdminEnvSchema.safeParse({
      PORTAL_FIREBASE_PROJECT_ID: 'chinmaya-setu-uat',
      PORTAL_FIREBASE_CLIENT_EMAIL: 'not-an-email',
      PORTAL_FIREBASE_PRIVATE_KEY: 'key',
    });
    expect(result.success).toBe(false);
  });
});

describe('masterAdminEnvSchema', () => {
  it('parses valid master admin env with database URL', () => {
    const result = masterAdminEnvSchema.safeParse({
      MASTER_FIREBASE_PROJECT_ID: 'chinmaya-setu-715b8',
      MASTER_FIREBASE_CLIENT_EMAIL: 'sa@chinmaya-setu-715b8.iam.gserviceaccount.com',
      MASTER_FIREBASE_PRIVATE_KEY: 'key',
      MASTER_FIREBASE_DATABASE_URL: 'https://chinmaya-setu-715b8-default-rtdb.firebaseio.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing database URL', () => {
    const result = masterAdminEnvSchema.safeParse({
      MASTER_FIREBASE_PROJECT_ID: 'chinmaya-setu-715b8',
      MASTER_FIREBASE_CLIENT_EMAIL: 'sa@chinmaya-setu-715b8.iam.gserviceaccount.com',
      MASTER_FIREBASE_PRIVATE_KEY: 'key',
    });
    expect(result.success).toBe(false);
  });
});

describe('readPortalAdminEnv', () => {
  beforeEach(() => {
    delete process.env.PORTAL_FIREBASE_PROJECT_ID;
    delete process.env.PORTAL_FIREBASE_CLIENT_EMAIL;
    delete process.env.PORTAL_FIREBASE_PRIVATE_KEY;
  });

  it('throws a clear error when PRIVATE_KEY is missing', () => {
    process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
    process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
    expect(() => readPortalAdminEnv()).toThrow(/PORTAL_FIREBASE_PRIVATE_KEY/);
  });

  it('returns parsed env when all vars are present', () => {
    process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
    process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
    process.env.PORTAL_FIREBASE_PRIVATE_KEY = 'key';
    const env = readPortalAdminEnv();
    expect(env.PORTAL_FIREBASE_PROJECT_ID).toBe('p');
  });
});

describe('readMasterAdminEnv', () => {
  it('throws when DATABASE_URL is missing', () => {
    delete process.env.MASTER_FIREBASE_DATABASE_URL;
    process.env.MASTER_FIREBASE_PROJECT_ID = 'm';
    process.env.MASTER_FIREBASE_CLIENT_EMAIL = 'sa@m.iam.gserviceaccount.com';
    process.env.MASTER_FIREBASE_PRIVATE_KEY = 'key';
    expect(() => readMasterAdminEnv()).toThrow(/MASTER_FIREBASE_DATABASE_URL/);
    delete process.env.MASTER_FIREBASE_PROJECT_ID;
    delete process.env.MASTER_FIREBASE_CLIENT_EMAIL;
    delete process.env.MASTER_FIREBASE_PRIVATE_KEY;
  });
});

describe('portalClientEnvSchema', () => {
  it('parses public portal firebase env', () => {
    const result = portalClientEnvSchema.safeParse({
      NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY: 'AIza...',
      NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN: 'p.firebaseapp.com',
      NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID: 'p',
      NEXT_PUBLIC_PORTAL_FIREBASE_STORAGE_BUCKET: 'p.firebasestorage.app',
      NEXT_PUBLIC_PORTAL_FIREBASE_MESSAGING_SENDER_ID: '123',
      NEXT_PUBLIC_PORTAL_FIREBASE_APP_ID: '1:123:web:abc',
    });
    expect(result.success).toBe(true);
  });
});

describe('masterClientEnvSchema', () => {
  it('parses master firebase db url', () => {
    const result = masterClientEnvSchema.safeParse({
      NEXT_PUBLIC_MASTER_FIREBASE_DATABASE_URL: 'https://m-default-rtdb.firebaseio.com',
    });
    expect(result.success).toBe(true);
  });
});
