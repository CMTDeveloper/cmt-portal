import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFlags, mockStart, mockFamily, mockEnrollments, mockClear } = vi.hoisted(() => ({
  mockFlags: { setuPledge: true },
  mockStart: vi.fn(),
  mockFamily: vi.fn(),
  mockEnrollments: vi.fn(),
  mockClear: vi.fn(),
}));

vi.mock('@/lib/flags', () => ({ flags: mockFlags }));
vi.mock('@/features/setu/pledges/start-pledge', () => ({ startPledge: mockStart }));
vi.mock('@/features/setu/members/get-family-by-fid', () => ({ getFamilyByFid: mockFamily }));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({ getEnrollments: mockEnrollments }));
vi.mock('@/features/setu/pledges/clear-abandoned-pledge', () => ({ clearAbandonedPledge: mockClear }));

// A realistic enrollment NAMES its members. The earlier fixture omitted
// `enrolledMids` entirely, so it could not have caught an enrollment that has
// been emptied - which is exactly the state a Child→Adult conversion leaves
// behind (`syncActiveEnrollmentMemberships` prunes the converted child and
// deliberately allows an empty list).
const BV_ENROLLMENT = {
  eid: 'CMT-A-bv-2026',
  programKey: 'bala-vihar',
  status: 'active',
  enrolledMids: ['CMT-A-02'],
};

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
  // Realistic shape: getFamilyByFid returns `{ family, members }` (FamilyAndMembers),
  // and the earlier fixture omitted `members` entirely - so it could not have caught
  // the customer-name change reading the roster. Two members on purpose (N=2): the
  // manager must be selected by session mid, not by being first.
  mockFamily.mockResolvedValue({
    // publicFid is a STRING on the family doc (`z.string().nullable().optional()`),
    // not a number - the fixture said 5001 and typed the route's own contract wrong.
    family: { fid: 'CMT-A', name: 'Apple Family', publicFid: '5001' },
    // The signed-in manager (mid CMT-A-01) is deliberately NOT first. Codex
    // review: the previous order put them at members[0], so a `members[0]`
    // implementation would have satisfied the assertion the comment claimed
    // would catch it.
    members: [
      { mid: 'CMT-A-02', firstName: 'Bala', lastName: 'Apple' },
      { mid: 'CMT-A-01', firstName: 'Anita', lastName: 'Apple' },
    ],
  });
  mockEnrollments.mockReset();
  mockEnrollments.mockResolvedValue([BV_ENROLLMENT]);
  mockClear.mockReset();
  mockClear.mockResolvedValue('none');
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

  // ── The Stripe Customer names the PERSON, not the family ──────────────────
  //
  // Vaibhav, 2026-07-31, reading the first REAL Customer record: it said "Rana
  // family" beside his personal email. A pre-authorized debit is an agreement
  // with an account holder and a CRA receipt names an individual, and the
  // one-time donation path already stored `donorName: "Vaibhav Rana"` - so the
  // two payment paths were labelling the same donor differently. He asked for
  // the parent's name plus the Family ID.
  //
  // Asserted HERE and not only in the helper's own unit tests: without this,
  // the route could silently go back to `fam.family.name` and every test would
  // still pass.
  it('sends the signed-in PERSON plus the public Family ID to Stripe', async () => {
    await POST(req(MANAGER));
    expect(mockStart).toHaveBeenCalledWith(
      // 'Anita Apple' is mid CMT-A-01, the session's mid, and sits SECOND in
      // the fixture - so a members[0] implementation would produce
      // "Bala Apple (5001)" and fail here.
      expect.objectContaining({ name: 'Anita Apple (5001)' }),
    );
  });

  // Vaibhav, same sitting, reading the metadata of that live call: it carried
  // only `fid: "CMT-HTNO0TEG"`. The public id has to reach startPledge for the
  // Stripe metadata to be able to name it.
  it('passes the public Family ID through for the Stripe metadata', async () => {
    await POST(req(MANAGER));
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ publicFid: '5001' }));
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

    // ── …and that enrollment must name somebody ────────────────────────────
    //
    // The hole the enrollment check left open. `syncActiveEnrollmentMemberships`
    // re-derives `enrolledMids` after every member change and DELIBERATELY
    // allows the result to be empty ("an active enrollment naming nobody" is the
    // truthful state, and keeping stale mids would put a departed child on a
    // teacher's roster). So converting an only child to Adult - which the member
    // edit screen has always permitted - leaves an ACTIVE Bala Vihar enrollment
    // with zero members. Every check above passes for that family, and they can
    // authorise a recurring bank mandate to fund nobody. There is no cancel
    // endpoint, so this has to be refused before the hosted page.
    it('409s when the active Bala Vihar enrollment has been emptied', async () => {
      mockEnrollments.mockResolvedValue([{ ...BV_ENROLLMENT, enrolledMids: [] }]);
      const res = await POST(req(MANAGER));
      expect(res.status).toBe(409);
      // A DISTINCT code from `enrollment-required`: this family IS enrolled, so
      // "enroll in Bala Vihar first" would be false and would read as the button
      // doing nothing.
      expect(await res.json()).toEqual({ error: 'no-enrolled-members' });
      expect(mockStart).not.toHaveBeenCalled();
      expect(mockClear).not.toHaveBeenCalled();
    });

    it('409s when the enrollment carries no enrolledMids field at all', async () => {
      // A legacy/partial doc must fail CLOSED - the guard asks "is there anyone
      // to fund?", and an absent list is not a yes.
      const noMids: Record<string, unknown> = { ...BV_ENROLLMENT };
      delete noMids['enrolledMids'];
      mockEnrollments.mockResolvedValue([noMids]);
      expect((await POST(req(MANAGER))).status).toBe(409);
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('proceeds when the emptied enrollment is a DIFFERENT program (N=2)', async () => {
      // Only the Bala Vihar enrollment's roster decides this. An emptied Tabla
      // enrollment sitting alongside must not block a funded Bala Vihar one.
      mockEnrollments.mockResolvedValue([
        { eid: 'CMT-A-tabla', programKey: 'tabla', status: 'active', enrolledMids: [] },
        BV_ENROLLMENT,
      ]);
      expect((await POST(req(MANAGER))).status).toBe(201);
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

  // ── A stale attempt must not block the retry ───────────────────────────────
  //
  // Vaibhav backed out of the hosted page; that session answers `pending`
  // forever, so without this the retry hits `already-started` from a mandate
  // that does not exist. Asserted with ORDERING because the call only helps if
  // it lands BEFORE startPledge's duplicate guard reads the collection.
  //
  // This test exists because a Codex review pointed out the route had NO
  // coverage of the wiring at all: the real `clearAbandonedPledge` swallows its
  // own Firestore-init failure under test, and the route discards the return
  // value, so deleting the call outright left this suite green.
  it('clears an abandoned attempt BEFORE starting a new one', async () => {
    await POST(req(MANAGER));
    // `notify: false` is required, not incidental: this route clears a stale
    // attempt as the family is STARTING payment again, so the "your donation is
    // not finished" letter would be false on arrival - and would burn the 7-day
    // cooldown the genuine abandonment needs later. It is the only suppression
    // of that letter in the codebase.
    expect(mockClear).toHaveBeenCalledWith('CMT-A', { notify: false });
    const clearedAt = mockClear.mock.invocationCallOrder[0]!;
    const startedAt = mockStart.mock.invocationCallOrder[0]!;
    expect(clearedAt, 'startPledge ran before the stale attempt was cleared').toBeLessThan(startedAt);
  });

  it('does not bother clearing when the family cannot pledge anyway', async () => {
    // No Bala Vihar enrollment: the request is refused before any repair.
    mockEnrollments.mockResolvedValue([]);
    await POST(req(MANAGER));
    expect(mockClear).not.toHaveBeenCalled();
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
