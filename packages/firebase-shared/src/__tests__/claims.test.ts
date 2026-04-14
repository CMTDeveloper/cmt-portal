import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn((_c, name) => ({ name })),
  cert: vi.fn((c) => c),
  getApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

const mockAuth = {
  setCustomUserClaims: vi.fn(),
  getUser: vi.fn(),
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  createCustomToken: vi.fn(),
};
vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => mockAuth),
}));

import {
  setPortalUserClaims,
  getPortalUserWithClaims,
  getOrCreateSharedTeacherUser,
  createPortalCustomToken,
} from '../admin/claims';

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(mockAuth).forEach((fn) => fn.mockReset());
  process.env.PORTAL_FIREBASE_PROJECT_ID = 'p';
  process.env.PORTAL_FIREBASE_CLIENT_EMAIL = 'sa@p.iam.gserviceaccount.com';
  process.env.PORTAL_FIREBASE_PRIVATE_KEY = 'key';
});

describe('setPortalUserClaims', () => {
  it('sets custom claims on a user', async () => {
    await setPortalUserClaims('uid-1', { role: 'admin' });
    expect(mockAuth.setCustomUserClaims).toHaveBeenCalledWith('uid-1', { role: 'admin' });
  });
});

describe('getPortalUserWithClaims', () => {
  it('returns the user with custom claims', async () => {
    mockAuth.getUser.mockResolvedValueOnce({
      uid: 'u1',
      email: 'a@b.com',
      customClaims: { role: 'admin' },
    });
    const user = await getPortalUserWithClaims('u1');
    expect(user.claims).toEqual({ role: 'admin' });
    expect(user.uid).toBe('u1');
  });

  it('returns empty claims when none set', async () => {
    mockAuth.getUser.mockResolvedValueOnce({ uid: 'u2', email: 'c@d.com' });
    const user = await getPortalUserWithClaims('u2');
    expect(user.claims).toEqual({});
  });
});

describe('getOrCreateSharedTeacherUser', () => {
  it('returns existing teacher user when it exists', async () => {
    mockAuth.getUser.mockResolvedValueOnce({ uid: 'teacher-shared-v1' });
    const user = await getOrCreateSharedTeacherUser();
    expect(user.uid).toBe('teacher-shared-v1');
    expect(mockAuth.createUser).not.toHaveBeenCalled();
  });

  it('creates the teacher user when it does not exist', async () => {
    mockAuth.getUser.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    mockAuth.createUser.mockResolvedValueOnce({ uid: 'teacher-shared-v1' });
    const user = await getOrCreateSharedTeacherUser();
    expect(mockAuth.createUser).toHaveBeenCalledWith({
      uid: 'teacher-shared-v1',
      disabled: false,
    });
    expect(user.uid).toBe('teacher-shared-v1');
  });

  it('sets the teacher role claim on every call', async () => {
    mockAuth.getUser.mockResolvedValueOnce({ uid: 'teacher-shared-v1' });
    await getOrCreateSharedTeacherUser();
    expect(mockAuth.setCustomUserClaims).toHaveBeenCalledWith('teacher-shared-v1', {
      role: 'teacher',
    });
  });
});

describe('createPortalCustomToken', () => {
  it('delegates to Admin SDK createCustomToken', async () => {
    mockAuth.createCustomToken.mockResolvedValueOnce('custom-tok');
    const token = await createPortalCustomToken('uid-x', { role: 'family', familyId: '42' });
    expect(mockAuth.createCustomToken).toHaveBeenCalledWith('uid-x', {
      role: 'family',
      familyId: '42',
    });
    expect(token).toBe('custom-tok');
  });
});
