import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const mockAuth = {
  setCustomUserClaims: vi.fn(),
  updateUser: vi.fn(),
};
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(() => mockAuth),
}));

import * as appHandler from '../[uid]/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DELETE /api/check-in/admin/users/:uid', () => {
  it('returns 401 without caller uid header', async () => {
    await testApiHandler({
      appHandler,
      params: { uid: 'target' },
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'DELETE' });
        expect(res.status).toBe(401);
      },
    });
  });

  it('returns 400 on self-delete attempt', async () => {
    await testApiHandler({
      appHandler,
      params: { uid: 'caller' },
      requestPatcher: (req) => req.headers.set('x-portal-uid', 'caller'),
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'DELETE' });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('cannot-self-delete');
      },
    });
  });

  it('clears claims and disables the user on happy path', async () => {
    await testApiHandler({
      appHandler,
      params: { uid: 'target' },
      requestPatcher: (req) => req.headers.set('x-portal-uid', 'caller'),
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'DELETE' });
        expect(res.status).toBe(200);
      },
    });
    expect(mockAuth.setCustomUserClaims).toHaveBeenCalledWith('target', null);
    expect(mockAuth.updateUser).toHaveBeenCalledWith('target', { disabled: true });
  });
});
