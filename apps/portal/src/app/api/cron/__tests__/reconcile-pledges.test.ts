import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

vi.mock('@/features/setu/pledges/reconcile-pledges', () => ({ reconcilePledges: vi.fn() }));

const flagsMock = vi.hoisted(() => ({ setuPledge: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

import { reconcilePledges } from '@/features/setu/pledges/reconcile-pledges';
import * as appHandler from '../reconcile-pledges/route';

const SECRET = 'a'.repeat(32);
const EMPTY = { scanned: 0, activated: 0, failed: 0, processing: 0, errored: 0, stale: [], unverified: [] };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  flagsMock.setuPledge = true;
  vi.mocked(reconcilePledges).mockResolvedValue(EMPTY);
});

describe('/api/cron/reconcile-pledges - the guard', () => {
  it('401s without a bearer, and reconciles nothing', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => expect((await fetch({ method: 'GET' })).status).toBe(401),
    });
    expect(reconcilePledges).not.toHaveBeenCalled();
  });

  it('401s on a wrong bearer', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: `Bearer ${'b'.repeat(32)}` } });
        expect(res.status).toBe(401);
      },
    });
    expect(reconcilePledges).not.toHaveBeenCalled();
  });

  it('401s when CRON_SECRET is unset, rather than letting anyone in', async () => {
    delete process.env.CRON_SECRET;
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: 'Bearer ' } });
        expect(res.status).toBe(401);
      },
    });
    expect(reconcilePledges).not.toHaveBeenCalled();
  });
});

describe('/api/cron/reconcile-pledges - the run', () => {
  it('runs on GET, which is how Vercel Cron actually triggers', async () => {
    // Exporting only POST silently 405'd every scheduled run of an earlier cron,
    // so reminders never went out even with the flag on. Pin the verb.
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: `Bearer ${SECRET}` } });
        expect(res.status).toBe(200);
      },
    });
    expect(reconcilePledges).toHaveBeenCalledTimes(1);
  });

  it('also runs on POST, for manual invocation', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', headers: { authorization: `Bearer ${SECRET}` } });
        expect(res.status).toBe(200);
      },
    });
    expect(reconcilePledges).toHaveBeenCalledTimes(1);
  });

  it('reports the counts, so a run that did nothing is distinguishable from one that did not happen', async () => {
    vi.mocked(reconcilePledges).mockResolvedValue({
      scanned: 3, activated: 1, failed: 1, processing: 1, errored: 0,
      stale: [{ pid: 'PLG-OLD', fid: 'CMT-A', daysStarted: 20 }],
      unverified: ['PLG-ORPHAN'],
    });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: `Bearer ${SECRET}` } });
        expect(await res.json()).toMatchObject({ success: true, scanned: 3, activated: 1, stale: 1, unverified: 1 });
      },
    });
  });

  it('does nothing at all while the feature is dark', async () => {
    // /pad/* is Stripe TEST mode until the flag is flipped. A cron that called
    // the provider anyway would be doing so on behalf of pledges that only exist
    // because the feature is being tested.
    flagsMock.setuPledge = false;
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: `Bearer ${SECRET}` } });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ success: true, disabled: true });
      },
    });
    expect(reconcilePledges).not.toHaveBeenCalled();
  });

  it('surfaces a run that blew up as a 500 rather than a silent success', async () => {
    // A cron reporting {success:true} while throwing would be invisible: the
    // orphan mandates it exists to repair would pile up unnoticed.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(reconcilePledges).mockRejectedValue(new Error('boom'));
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: `Bearer ${SECRET}` } });
        expect(res.status).toBe(500);
      },
    });
    spy.mockRestore();
  });
});
