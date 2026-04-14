import { describe, it, expect } from 'vitest';
import { portalEnvSchema } from '../env';

const base = {
  PORTAL_FIREBASE_PROJECT_ID: 'p',
  PORTAL_FIREBASE_CLIENT_EMAIL: 'sa@p.iam.gserviceaccount.com',
  PORTAL_FIREBASE_PRIVATE_KEY: 'key',
  NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY: 'AIza',
  NEXT_PUBLIC_PORTAL_FIREBASE_AUTH_DOMAIN: 'p.firebaseapp.com',
  NEXT_PUBLIC_PORTAL_FIREBASE_PROJECT_ID: 'p',
  NEXT_PUBLIC_PORTAL_FIREBASE_STORAGE_BUCKET: 'p.firebasestorage.app',
  NEXT_PUBLIC_PORTAL_FIREBASE_MESSAGING_SENDER_ID: '123',
  NEXT_PUBLIC_PORTAL_FIREBASE_APP_ID: '1:123:web:abc',
  MASTER_FIREBASE_PROJECT_ID: 'm',
  MASTER_FIREBASE_CLIENT_EMAIL: 'sa@m.iam.gserviceaccount.com',
  MASTER_FIREBASE_PRIVATE_KEY: 'key',
  MASTER_FIREBASE_DATABASE_URL: 'https://m-default-rtdb.firebaseio.com',
  NEXT_PUBLIC_MASTER_FIREBASE_DATABASE_URL: 'https://m-default-rtdb.firebaseio.com',
  TEACHER_PASSPHRASE: 'TeacherOM!',
};

describe('portalEnvSchema', () => {
  it('parses a complete valid env', () => {
    const result = portalEnvSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('defaults SESSION_COOKIE_EXPIRES_DAYS to 5', () => {
    const result = portalEnvSchema.parse(base);
    expect(result.SESSION_COOKIE_EXPIRES_DAYS).toBe(5);
  });

  it('coerces SESSION_COOKIE_EXPIRES_DAYS from string', () => {
    const result = portalEnvSchema.parse({ ...base, SESSION_COOKIE_EXPIRES_DAYS: '7' });
    expect(result.SESSION_COOKIE_EXPIRES_DAYS).toBe(7);
  });

  it('rejects SESSION_COOKIE_EXPIRES_DAYS > 14', () => {
    const result = portalEnvSchema.safeParse({ ...base, SESSION_COOKIE_EXPIRES_DAYS: '30' });
    expect(result.success).toBe(false);
  });

  it('rejects TEACHER_PASSPHRASE shorter than 6 chars', () => {
    const result = portalEnvSchema.safeParse({ ...base, TEACHER_PASSPHRASE: 'abc' });
    expect(result.success).toBe(false);
  });

  it('rejects missing PORTAL_FIREBASE_PRIVATE_KEY with a message mentioning the field', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { PORTAL_FIREBASE_PRIVATE_KEY: _omit, ...withoutKey } = base;
    const result = portalEnvSchema.safeParse(withoutKey);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('PORTAL_FIREBASE_PRIVATE_KEY'))).toBe(
        true,
      );
    }
  });

  it('defaults feature flags to false', () => {
    const result = portalEnvSchema.parse(base);
    expect(result.NEXT_PUBLIC_FEATURE_CHECK_IN).toBe('false');
    expect(result.NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN).toBe('false');
  });

  it('parses feature flag true strings', () => {
    const result = portalEnvSchema.parse({
      ...base,
      NEXT_PUBLIC_FEATURE_CHECK_IN: 'true',
      NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN: 'true',
    });
    expect(result.NEXT_PUBLIC_FEATURE_CHECK_IN).toBe('true');
    expect(result.NEXT_PUBLIC_FEATURE_CHECK_IN_ADMIN).toBe('true');
  });

  it('defaults AWS_SES_REGION to ca-central-1', () => {
    const result = portalEnvSchema.parse(base);
    expect(result.AWS_SES_REGION).toBe('ca-central-1');
  });

  it('defaults AWS_SNS_REGION to us-east-1', () => {
    const result = portalEnvSchema.parse(base);
    expect(result.AWS_SNS_REGION).toBe('us-east-1');
  });
});
