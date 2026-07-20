import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiHandler } from 'next-test-api-route-handler';

const flagsMock = vi.hoisted(() => ({ checkInKiosk: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

vi.mock('@/features/check-in/shared', () => ({
  findFamilyByContact: vi.fn(),
}));
vi.mock('@/features/setu/check-in/resolve-kiosk-family', () => ({
  resolveKioskFamily: vi.fn(),
}));

import { findFamilyByContact } from '@/features/check-in/shared';
import { resolveKioskFamily } from '@/features/setu/check-in/resolve-kiosk-family';
import * as appHandler from '../route';

const mockFindFamily = findFamilyByContact as unknown as ReturnType<typeof vi.fn>;
const mockResolveKiosk = resolveKioskFamily as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.checkInKiosk = true;
  // Default: no Setu family / no minted publicFid.
  mockResolveKiosk.mockResolvedValue(null);
});

describe('POST /api/check-in/lookup', () => {
  it('returns 404 when kiosk flag is off', async () => {
    flagsMock.checkInKiosk = false;
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(404);
      },
    });
    expect(findFamilyByContact).not.toHaveBeenCalled();
  });

  it('returns 200 with familyId (publicFid null) on hit when the family has no new id', async () => {
    mockFindFamily.mockResolvedValueOnce({ fid: '42' });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.familyId).toBe('42');
        expect(body.publicFid).toBeNull();
      },
    });
    // The Setu family is looked up by the legacy id we matched.
    expect(mockResolveKiosk).toHaveBeenCalledWith('42');
  });

  it('returns the Setu publicFid alongside the legacy id when one is minted', async () => {
    mockFindFamily.mockResolvedValueOnce({ fid: '477' });
    mockResolveKiosk.mockResolvedValueOnce({ publicFid: '5891', legacyFid: '477' });
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ familyId: '477', publicFid: '5891' });
      },
    });
  });

  it('degrades to legacy-only when the Setu lookup fails (never 500s the lookup)', async () => {
    mockFindFamily.mockResolvedValueOnce({ fid: '477' });
    mockResolveKiosk.mockRejectedValueOnce(new Error('firestore down'));
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'email', value: 'a@b.com' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ familyId: '477', publicFid: null });
      },
    });
  });
});
