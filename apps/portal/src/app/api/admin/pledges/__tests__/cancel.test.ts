import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const flagsMock = vi.hoisted(() => ({ setuPledge: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

const mockCancel = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/pledges/cancel-pledge', () => ({ cancelPledgeRecord: mockCancel }));

import * as appHandler from '../[pid]/cancel/route';

/** Middleware has already verified the session; these are the headers it sets. */
function headers(role: string, extra = '', uid = 'uid-1') {
  return {
    'x-portal-role': role,
    'x-portal-extra-roles': extra,
    'x-portal-uid': uid,
    'x-portal-mid': 'CMT-Z-01',
  };
}

const params = { pid: 'PLG-1' };

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuPledge = true;
  mockCancel.mockResolvedValue({ ok: true });
});

describe('POST /api/admin/pledges/[pid]/cancel - who may call it', () => {
  it('401s with no session', async () => {
    await testApiHandler({
      appHandler,
      params,
      test: async ({ fetch }) => expect((await fetch({ method: 'POST' })).status).toBe(401),
    });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it.each([['family-manager'], ['welcome-team'], ['coordinator'], ['teacher']])(
    '403s a %s - this is an admin action, and the /api/admin catch-all is the only gate above it',
    async (role) => {
      await testApiHandler({
        appHandler,
        params,
        test: async ({ fetch }) => {
          const res = await fetch({ method: 'POST', headers: headers(role) });
          expect(res.status).toBe(403);
        },
      });
      expect(mockCancel).not.toHaveBeenCalled();
    },
  );

  it('allows an admin', async () => {
    await testApiHandler({
      appHandler,
      params,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', headers: headers('admin') });
        expect(res.status).toBe(200);
      },
    });
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('allows a family-manager whose extraRoles carry admin', async () => {
    // isAdmin() is helper-based for exactly this: an admin who is also a parent
    // has `family-manager` as their PRIMARY role.
    await testApiHandler({
      appHandler,
      params,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', headers: headers('family-manager', 'admin') });
        expect(res.status).toBe(200);
      },
    });
  });

  it('refuses a session with no uid, rather than writing an audit row naming nobody', async () => {
    await testApiHandler({
      appHandler,
      params,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', headers: { ...headers('admin'), 'x-portal-uid': '' } });
        expect(res.status).toBe(401);
      },
    });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('404s while the feature is dark, before checking anything else', async () => {
    flagsMock.setuPledge = false;
    await testApiHandler({
      appHandler,
      params,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', headers: headers('admin') });
        expect(res.status).toBe(404);
      },
    });
    expect(mockCancel).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/pledges/[pid]/cancel - what it passes on', () => {
  it('names the actor AND their other roles', async () => {
    await testApiHandler({
      appHandler,
      params,
      test: async ({ fetch }) => { await fetch({ method: 'POST', headers: headers('admin', 'welcome-team') }); },
    });
    expect(mockCancel).toHaveBeenCalledWith({
      pid: 'PLG-1',
      actor: { uid: 'uid-1', mid: 'CMT-Z-01', role: 'admin', extraRoles: ['welcome-team'] },
    });
  });

  it('404s a pledge that does not exist', async () => {
    mockCancel.mockResolvedValue({ ok: false, reason: 'not-found' });
    await testApiHandler({
      appHandler,
      params,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', headers: headers('admin') });
        expect(res.status).toBe(404);
      },
    });
  });

  it.each([['already-cancelled'], ['not-cancellable']])(
    '409s on %s, so the screen can say something more useful than "not found"',
    async (reason) => {
      mockCancel.mockResolvedValue({ ok: false, reason });
      await testApiHandler({
        appHandler,
        params,
        test: async ({ fetch }) => {
          const res = await fetch({ method: 'POST', headers: headers('admin') });
          expect(res.status).toBe(409);
          expect(await res.json()).toEqual({ error: reason });
        },
      });
    },
  );
});
