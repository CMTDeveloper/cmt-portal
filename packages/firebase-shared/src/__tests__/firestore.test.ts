import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn((_c, name) => ({ name })),
  cert: vi.fn((c) => c),
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn((app) => ({ app, type: 'Firestore' })),
}));

import { getFirestore } from 'firebase-admin/firestore';
import { portalFirestore } from '../admin/firestore';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
  process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
  process.env.PORTAL_FIREBASE_PRIVATE_KEY = 'key';
});

describe('portalFirestore', () => {
  it('returns Firestore bound to the portal app', () => {
    const fs = portalFirestore();
    expect(getFirestore).toHaveBeenCalledWith(expect.objectContaining({ name: 'portal' }));
    expect(fs).toEqual(expect.objectContaining({ type: 'Firestore' }));
  });
});
