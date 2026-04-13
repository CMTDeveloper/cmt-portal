import { describe, it, expect } from 'vitest';
import { adminEnvSchema, clientEnvSchema } from '../env';

describe('adminEnvSchema', () => {
  it('accepts a fully-populated admin env', () => {
    const result = adminEnvSchema.safeParse({
      FIREBASE_PROJECT_ID: 'chinmaya-setu-715b8',
      FIREBASE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----',
      FIREBASE_DATABASE_URL: 'https://chinmaya-setu-715b8.firebaseio.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing FIREBASE_PROJECT_ID', () => {
    const result = adminEnvSchema.safeParse({
      FIREBASE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: 'fake',
      FIREBASE_DATABASE_URL: 'https://example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed FIREBASE_DATABASE_URL', () => {
    const result = adminEnvSchema.safeParse({
      FIREBASE_PROJECT_ID: 'p',
      FIREBASE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: 'fake',
      FIREBASE_DATABASE_URL: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});

describe('clientEnvSchema', () => {
  it('accepts a fully-populated client env', () => {
    const result = clientEnvSchema.safeParse({
      NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaSyExample',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'chinmaya-setu-715b8.firebaseapp.com',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'chinmaya-setu-715b8',
      NEXT_PUBLIC_FIREBASE_DATABASE_URL: 'https://chinmaya-setu-715b8.firebaseio.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing NEXT_PUBLIC_FIREBASE_PROJECT_ID', () => {
    const result = clientEnvSchema.safeParse({
      NEXT_PUBLIC_FIREBASE_API_KEY: 'k',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'd.firebaseapp.com',
      NEXT_PUBLIC_FIREBASE_DATABASE_URL: 'https://example.com',
    });
    expect(result.success).toBe(false);
  });
});
