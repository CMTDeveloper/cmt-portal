import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const mockAuth = {
  getUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
};
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(() => mockAuth),
}));

const mockRevoke = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/auth/revoke-sessions', () => ({ revokeUidSessions: mockRevoke }));

import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.setCustomUserClaims.mockResolvedValue(undefined);
  mockRevoke.mockResolvedValue(undefined);
});

describe('DELETE /api/check-in/admin/welcome-team/:uid', () => {
  it('returns 400 without a uid', async () => {
    await testApiHandler({
      appHandler,
      params: { uid: '' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'DELETE' });
        expect(res.status).toBe(400);
      },
    });
  });

  it('returns 409 when the target is not welcome-team (no revoke)', async () => {
    mockAuth.getUser.mockResolvedValue({ customClaims: { role: 'family-member' } });
    await testApiHandler({
      appHandler,
      params: { uid: 'u1' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'DELETE' });
        expect(res.status).toBe(409);
      },
    });
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('removes the capability AND revokes sessions on success', async () => {
    mockAuth.getUser.mockResolvedValue({
      customClaims: { role: 'family-manager', extraRoles: ['welcome-team'] },
    });
    await testApiHandler({
      appHandler,
      params: { uid: 'u1' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'DELETE' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.claims.role).toBe('family-manager');
        expect(body.claims.extraRoles).toBeUndefined();
      },
    });
    expect(mockAuth.setCustomUserClaims).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ role: 'family-manager' }),
    );
    expect(mockRevoke).toHaveBeenCalledWith('u1');
  });

  it('returns 404 when the auth user does not exist', async () => {
    mockAuth.getUser.mockRejectedValue({ code: 'auth/user-not-found' });
    await testApiHandler({
      appHandler,
      params: { uid: 'u1' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'DELETE' });
        expect(res.status).toBe(404);
      },
    });
    expect(mockRevoke).not.toHaveBeenCalled();
  });
});
