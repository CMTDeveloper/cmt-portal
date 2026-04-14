import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn((_c, name) => ({ name })),
  cert: vi.fn((c) => c),
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn((app) => ({ app, type: 'Auth' })),
}));

import { getAuth } from 'firebase-admin/auth';
import { portalAuth } from '../admin/auth';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
  process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
  process.env.PORTAL_FIREBASE_PRIVATE_KEY = 'key';
});

describe('portalAuth', () => {
  it('returns Auth bound to the portal Firebase app', () => {
    const auth = portalAuth();
    expect(getAuth).toHaveBeenCalledWith(expect.objectContaining({ name: 'portal' }));
    expect(auth).toEqual(expect.objectContaining({ type: 'Auth' }));
  });
});
