import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const mockAuth = {
  listUsers: vi.fn(),
};
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: vi.fn(() => mockAuth),
}));

vi.mock('@cmt/firebase-shared/admin/claims', () => ({
  getOrCreateAdminUser: vi.fn(),
}));

import { getOrCreateAdminUser } from '@cmt/firebase-shared/admin/claims';
import * as appHandler from '../route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/check-in/admin/users', () => {
  it('returns users filtered to role=admin', async () => {
    mockAuth.listUsers.mockResolvedValueOnce({
      users: [
        { uid: 'u1', email: 'a@a.com', customClaims: { role: 'admin' } },
        { uid: 'u2', email: 'b@b.com', customClaims: { role: 'teacher' } },
        { uid: 'u3', email: 'c@c.com', customClaims: { role: 'admin' } },
      ],
      pageToken: undefined,
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.users).toHaveLength(2);
        expect(body.users.map((u: { uid: string }) => u.uid)).toEqual(['u1', 'u3']);
      },
    });
  });
});

describe('POST /api/check-in/admin/users', () => {
  it('returns 400 on invalid body', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'not-email' }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it('creates an admin and returns uid+email', async () => {
    (getOrCreateAdminUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uid: 'new-uid',
      email: 'new@cmt.org',
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'new@cmt.org', password: 'TempPass123!' }),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.uid).toBe('new-uid');
        expect(body.email).toBe('new@cmt.org');
      },
    });
    expect(getOrCreateAdminUser).toHaveBeenCalledWith('new@cmt.org', 'TempPass123!');
  });
});
