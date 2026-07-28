import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFlags, mockStart, mockFamily, mockEnrollments } = vi.hoisted(() => ({
  mockFlags: { setuPledge: true },
  mockStart: vi.fn(),
  mockFamily: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock('@/lib/flags', () => ({ flags: mockFlags }));
vi.mock('@/features/setu/pledges/start-pledge', () => ({ startPledge: mockStart }));
vi.mock('@/features/setu/members/get-family-by-fid', () => ({ getFamilyByFid: mockFamily }));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({ getEnrollments: mockEnrollments }));

const BV_ENROLLMENT = { eid: 'CMT-A-bv-2026', programKey: 'bala-vihar', status: 'active' };

import { POST } from '../route';

function req(headers: Record<string, string>, body: unknown = {}) {
  return new Request('https://portal.test/api/pledges/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const MANAGER = {
  'x-portal-role': 'family-manager',
  'x-portal-fid': 'CMT-A',
  'x-portal-mid': 'CMT-A-01',
  'x-portal-email': 'a@b.com',
};

beforeEach(() => {
  mockFlags.setuPledge = true;
  mockStart.mockReset();
  mockStart.mockResolvedValue({ created: true, pid: 'PLG-1', checkoutUrl: 'https://stripe.test/cs_1' });
  mockFamily.mockReset();
  mockFamily.mockResolvedValue({ family: { fid: 'CMT-A', name: 'Apple Family' } });
  mockEnrollments.mockReset();
  mockEnrollments.mockResolvedValue([BV_ENROLLMENT]);
});

describe('POST /api/pledges/start', () => {
  it('returns 201 and the hosted url for a manager', async () => {
    const res = await POST(req(MANAGER));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ pid: 'PLG-1', checkoutUrl: 'https://stripe.test/cs_1' });
  });

  it('404s when the feature is dark - it should look absent, not forbidden', async () => {
    mockFlags.setuPledge = false;
    const res = await POST(req(MANAGER));
    expect(res.status).toBe(404);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('takes fid from the SESSION and ignores any fid in the body', async () => {
    // Otherwise a manager could start a recurring debit against another family.
    await POST(req(MANAGER, { fid: 'CMT-VICTIM', pid: 'anything' }));
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ fid: 'CMT-A' }));
    expect(mockStart).not.toHaveBeenCalledWith(expect.objectContaining({ fid: 'CMT-VICTIM' }));
  });

  it('403s a non-manager even if middleware let it through', async () => {
    const res = await POST(req({ ...MANAGER, 'x-portal-role': 'family-member' }));
    expect(res.status).toBe(403);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('401s with no session', async () => {
    expect((await POST(req({}))).status).toBe(401);
  });

  it('409s when a pledge is already in play, rather than pretending it created one', async () => {
    mockStart.mockResolvedValue({ created: false, reason: 'already-active', pid: 'PLG-OLD' });
    const res = await POST(req(MANAGER));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already-active', pid: 'PLG-OLD' });
  });

  // ── The mandate must have something to fund ────────────────────────────────
  //
  // Reported 2026-07-28: a UAT family with ZERO children held a `started`
  // pledge. The enroll page offered "Give $51 monthly" beside "Add a child to
  // enroll", and this route asked only "are you a manager with an email?" - so
  // a bank mandate was authorised for a family that could not be in Bala Vihar
  // at all. The portal has no cancel endpoint, so the refusal has to happen
  // BEFORE the hosted page, not after.
  //
  // The rule lives here rather than only in the UI because three screens can
  // reach this route and each would otherwise re-implement it - the same shape
  // as the double-charge that went unnoticed for weeks.
  describe('requires an active Bala Vihar enrollment', () => {
    it('409s a family with no enrollments at all', async () => {
      mockEnrollments.mockResolvedValue([]);
      const res = await POST(req(MANAGER));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'enrollment-required' });
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('409s when the only Bala Vihar enrollment is cancelled', async () => {
      mockEnrollments.mockResolvedValue([{ ...BV_ENROLLMENT, status: 'cancelled' }]);
      const res = await POST(req(MANAGER));
      expect(res.status).toBe(409);
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('409s when the family is enrolled in a DIFFERENT program only', async () => {
      // The monthly plan funds Bala Vihar specifically. A Tabla enrollment is
      // not a Bala Vihar contribution to spread.
      mockEnrollments.mockResolvedValue([{ eid: 'CMT-A-tabla', programKey: 'tabla', status: 'active' }]);
      const res = await POST(req(MANAGER));
      expect(res.status).toBe(409);
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('proceeds when a Bala Vihar enrollment sits behind a newer one', async () => {
      // N=2: `getEnrollments` sorts enrolledAt DESC, so the newest active
      // enrollment may not be the Bala Vihar one. Finding it must not depend on
      // position.
      mockEnrollments.mockResolvedValue([
        { eid: 'CMT-A-tabla', programKey: 'tabla', status: 'active' },
        BV_ENROLLMENT,
      ]);
      expect((await POST(req(MANAGER))).status).toBe(201);
    });
  });

  it('503s on a provider failure WITHOUT echoing the provider error', async () => {
    mockStart.mockRejectedValue(new Error('stripe says: customer cus_123 bank rejected'));
    const res = await POST(req(MANAGER));
    expect(res.status).toBe(503);
    const body = JSON.stringify(await res.json());
    expect(body).toBe('{"error":"provider-unavailable"}');
    // The provider message can name customers and payment state; it belongs on
    // the pledge doc for an operator, never in a client response.
    expect(body).not.toContain('cus_123');
    expect(body).not.toContain('bank');
  });
});
