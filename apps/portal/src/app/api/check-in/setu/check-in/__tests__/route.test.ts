import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const flagsMock = vi.hoisted(() => ({ checkInKiosk: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

const mocks = vi.hoisted(() => ({
  resolveKioskFamily: vi.fn(),
  autoEnrollBalaVihar: vi.fn(),
  added: [] as Record<string, unknown>[],
}));
vi.mock('@/features/setu/check-in/resolve-kiosk-family', () => ({
  resolveKioskFamily: mocks.resolveKioskFamily,
}));
vi.mock('@/features/setu/check-in/auto-enroll-bala-vihar', () => ({
  autoEnrollBalaVihar: mocks.autoEnrollBalaVihar,
}));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: vi.fn(() => ({
      add: vi.fn(async (doc: Record<string, unknown>) => {
        mocks.added.push(doc);
        return { id: `ci-${mocks.added.length}` };
      }),
    })),
  })),
}));

import * as appHandler from '../route';

const resolvedFamily = {
  fid: 'CMT-A',
  publicFid: '1075',
  legacyFid: '477',
  location: 'Brampton' as const,
  name: 'Rana family',
  matchedOn: 'publicFid' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.checkInKiosk = true;
  mocks.added.length = 0;
});

describe('POST /api/check-in/setu/check-in', () => {
  it('resolves, records a check-in, and auto-enrolls', async () => {
    mocks.resolveKioskFamily.mockResolvedValue(resolvedFamily);
    mocks.autoEnrollBalaVihar.mockResolvedValue({ enrolled: true, created: true, eid: 'CMT-A-bv' });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: '1075', students: { 'CMT-A-02': true } }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.family).toMatchObject({ fid: 'CMT-A', publicFid: '1075', legacyFid: '477', name: 'Rana family' });
        expect(body.enroll).toEqual({ enrolled: true, created: true, eid: 'CMT-A-bv' });
        expect(body.checkInIds).toHaveLength(1);
      },
    });
    expect(mocks.autoEnrollBalaVihar).toHaveBeenCalledWith({ fid: 'CMT-A', location: 'Brampton' });
    expect(mocks.added).toHaveLength(1);
  });

  it('keys check_in_events by legacyFid (bridges existing dashboards) and writes one event per student', async () => {
    mocks.resolveKioskFamily.mockResolvedValue(resolvedFamily);
    mocks.autoEnrollBalaVihar.mockResolvedValue({ enrolled: false, reason: 'no-open-offering' });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: '1075', students: { 'CMT-A-02': true, 'CMT-A-03': false } }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.checkInIds).toHaveLength(2);
      },
    });
    expect(mocks.added).toHaveLength(2);
    // legacyFid ('477') wins over publicFid - existing check_in_events dashboards read by the legacy id.
    expect(mocks.added[0]).toMatchObject({ fid: '477', sid: 'CMT-A-02', status: 'present', checkedInBy: 'sevak' });
    expect(mocks.added[1]).toMatchObject({ fid: '477', sid: 'CMT-A-03', status: 'absent', checkedInBy: 'sevak' });
  });

  it('falls back to publicFid then fid when legacyFid is absent', async () => {
    mocks.resolveKioskFamily.mockResolvedValue({ ...resolvedFamily, legacyFid: null });
    mocks.autoEnrollBalaVihar.mockResolvedValue({ enrolled: true, created: false, eid: 'CMT-A-bv' });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: '1075', students: { 'CMT-A-02': true } }),
        });
      },
    });
    expect(mocks.added[0]).toMatchObject({ fid: '1075' });
  });

  it('404s when the id resolves to no Setu family', async () => {
    mocks.resolveKioskFamily.mockResolvedValue(null);
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: '999', students: {} }),
        });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('family-not-found');
      },
    });
    expect(mocks.autoEnrollBalaVihar).not.toHaveBeenCalled();
    expect(mocks.added).toHaveLength(0);
  });

  it('400s on a malformed body', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 5 }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('bad-request');
      },
    });
    expect(mocks.resolveKioskFamily).not.toHaveBeenCalled();
  });

  it('404s when the kiosk flag is off', async () => {
    flagsMock.checkInKiosk = false;
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: '1075', students: { 'CMT-A-02': true } }),
        });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('not-found');
      },
    });
    expect(mocks.resolveKioskFamily).not.toHaveBeenCalled();
  });

  it('is best-effort on auto-enroll: an unexpected enroll error still returns 200 with the check-in recorded', async () => {
    mocks.resolveKioskFamily.mockResolvedValue(resolvedFamily);
    mocks.autoEnrollBalaVihar.mockRejectedValue(new Error('offering-disabled'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: '1075', students: { 'CMT-A-02': true } }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        // The check-in (kiosk's primary job) is recorded even though enroll blew up.
        expect(body.checkInIds).toHaveLength(1);
        expect(body.enroll).toEqual({ enrolled: false, reason: 'error' });
      },
    });
    expect(mocks.added).toHaveLength(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
