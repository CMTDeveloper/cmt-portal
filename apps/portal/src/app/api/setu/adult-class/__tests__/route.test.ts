import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true, setuAdultClass: true } }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

const { getFamilyByFid, loadAdultClassGateDataOrThrow, enrollFamily } = vi.hoisted(() => ({
  getFamilyByFid: vi.fn(),
  loadAdultClassGateDataOrThrow: vi.fn(),
  enrollFamily: vi.fn(),
}));
vi.mock('@/features/setu/members/get-family-by-fid', () => ({ getFamilyByFid }));
vi.mock('@/features/setu/adult-class/load-gate-data', () => ({ loadAdultClassGateDataOrThrow }));
vi.mock('@/features/setu/enrollment/enroll-family', () => ({ enrollFamily }));

import { revalidateTag } from 'next/cache';
import { POST } from '../route';

const FID = 'CMT-AB12CD34';
const ASC_OID = 'adult-study-class-brampton-2026-27';
const BV_EID = `${FID}-bala-vihar-brampton-2026-27`;

const MANAGER = { role: 'family-manager', fid: FID, mid: `${FID}-01` };
const MEMBER = { role: 'family-member', fid: FID, mid: `${FID}-02` };

function adult(mid: string, over: Record<string, unknown> = {}) {
  return { mid, firstName: 'A', lastName: 'Parent', type: 'Adult', ...over };
}
function child(mid: string) {
  return { mid, firstName: 'C', lastName: 'Kid', type: 'Child' };
}

const MEMBERS = [adult(`${FID}-01`), adult(`${FID}-02`), adult(`${FID}-03`), child(`${FID}-09`)];

/** Loader output for a family whose BV is PAID and where -03 teaches. */
function gateData(over: Record<string, unknown> = {}) {
  return {
    isManager: true,
    members: MEMBERS,
    enrollments: [
      {
        eid: BV_EID,
        oid: 'bala-vihar-brampton-2026-27',
        programKey: 'bala-vihar',
        status: 'active',
        offering: { paymentSource: 'portal' },
      },
    ],
    donations: [{ status: 'completed', eid: BV_EID, amountCAD: 500 }],
    currentOffering: { oid: ASC_OID },
    teacherAssignedMids: new Set([`${FID}-03`]),
    legacyPaymentStatus: 'unknown',
    ...over,
  };
}

function makeRequest(body: unknown, session: typeof MANAGER | null = MANAGER) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (session) {
    headers.set('x-portal-role', session.role);
    headers.set('x-portal-fid', session.fid);
    headers.set('x-portal-mid', session.mid);
  }
  return new Request('http://localhost/api/setu/adult-class', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getFamilyByFid.mockResolvedValue({ family: { fid: FID, location: 'Brampton' }, members: MEMBERS });
  loadAdultClassGateDataOrThrow.mockResolvedValue(gateData());
  enrollFamily.mockResolvedValue({ created: true, eid: `${FID}-${ASC_OID}`, suggestedAmountSnapshot: 0 });
});

describe('POST /api/setu/adult-class - authorization', () => {
  it('401 when not signed in', async () => {
    expect((await POST(makeRequest({ mids: [`${FID}-01`] }, null))).status).toBe(401);
  });

  // The gate only fires for managers, and the selection is a family-level
  // decision like disclaimers. A plain member must not be able to commit one.
  it('403 for a family-member', async () => {
    const res = await POST(makeRequest({ mids: [`${FID}-01`] }, MEMBER));
    expect(res.status).toBe(403);
    expect(enrollFamily).not.toHaveBeenCalled();
  });
});

describe('POST /api/setu/adult-class - body validation', () => {
  it('400 on an empty selection', async () => {
    expect((await POST(makeRequest({ mids: [] }))).status).toBe(400);
    expect(enrollFamily).not.toHaveBeenCalled();
  });

  // enrollFamily writes enrolledMids verbatim, so a duplicate would list the
  // same person twice on the teacher roster.
  it('400 on duplicate mids', async () => {
    const res = await POST(makeRequest({ mids: [`${FID}-01`, `${FID}-01`] }));
    expect(res.status).toBe(400);
    expect(enrollFamily).not.toHaveBeenCalled();
  });

  // THE ONE THAT MATTERS: fid must come from the session. A body carrying one
  // must be rejected outright, never merged.
  it('400 on an unknown key such as fid, rather than honouring it', async () => {
    const res = await POST(makeRequest({ mids: [`${FID}-01`], fid: 'CMT-SOMEONEELSE' }));
    expect(res.status).toBe(400);
    expect(enrollFamily).not.toHaveBeenCalled();
  });
});

describe('POST /api/setu/adult-class - mid validation', () => {
  // enroll-family.ts:223-224 takes a supplied list VERBATIM and skips the member
  // read entirely, so nothing downstream validates these. This route is the only
  // place that can.
  it('422 for a teacher-assigned adult - they are running a class that hour', async () => {
    const res = await POST(makeRequest({ mids: [`${FID}-03`] }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'mid-not-selectable' });
    expect(enrollFamily).not.toHaveBeenCalled();
  });

  it('422 for a child', async () => {
    expect((await POST(makeRequest({ mids: [`${FID}-09`] }))).status).toBe(422);
    expect(enrollFamily).not.toHaveBeenCalled();
  });

  it('422 for a mid belonging to another family', async () => {
    expect((await POST(makeRequest({ mids: ['CMT-OTHER-01'] }))).status).toBe(422);
    expect(enrollFamily).not.toHaveBeenCalled();
  });

  it('422 when ONE of several mids is not selectable - never a partial enroll', async () => {
    const res = await POST(makeRequest({ mids: [`${FID}-01`, `${FID}-03`] }));
    expect(res.status).toBe(422);
    expect(enrollFamily).not.toHaveBeenCalled();
  });
});

describe('POST /api/setu/adult-class - the enrollment', () => {
  it('enrolls the chosen adults into the CURRENT offering, manual mode', async () => {
    const res = await POST(makeRequest({ mids: [`${FID}-01`, `${FID}-02`] }));
    expect(res.status).toBe(201);
    expect(enrollFamily).toHaveBeenCalledWith({
      fid: FID,
      oid: ASC_OID,
      enrolledVia: 'family-initiated',
      enrolledByMid: `${FID}-01`,
      enrolledMids: [`${FID}-01`, `${FID}-02`],
      suggestedAmountOverride: 0,
      membershipMode: 'manual',
    });
  });

  // The BV-paid waiver. `0` is a real value, distinguished from "no override"
  // by undefined, never by falsiness (enroll-family.ts:61-65).
  it('waives the donation with an override of 0 when Bala Vihar is paid', async () => {
    await POST(makeRequest({ mids: [`${FID}-01`] }));
    expect(enrollFamily.mock.calls[0]![0].suggestedAmountOverride).toBe(0);
  });

  it('leaves the override null when Bala Vihar is NOT paid', async () => {
    loadAdultClassGateDataOrThrow.mockResolvedValue(gateData({ donations: [] }));
    await POST(makeRequest({ mids: [`${FID}-01`] }));
    expect(enrollFamily.mock.calls[0]![0].suggestedAmountOverride).toBeNull();
  });

  // Threshold-free (owner decision, issue #23): a PARTIAL donation still counts.
  it('waives on a partial donation - amount is irrelevant', async () => {
    loadAdultClassGateDataOrThrow.mockResolvedValue(
      gateData({ donations: [{ status: 'completed', eid: BV_EID, amountCAD: 5 }] }),
    );
    await POST(makeRequest({ mids: [`${FID}-01`] }));
    expect(enrollFamily.mock.calls[0]![0].suggestedAmountOverride).toBe(0);
  });

  it('invalidates the family cache so /family reflects the choice', async () => {
    await POST(makeRequest({ mids: [`${FID}-01`] }));
    expect(revalidateTag).toHaveBeenCalledWith(`family-${FID}`, 'max');
  });

  it('returns 200, not 201, when reconciling an existing enrollment', async () => {
    enrollFamily.mockResolvedValue({ created: false, reconciled: true, eid: `${FID}-${ASC_OID}`, suggestedAmountSnapshot: 0 });
    expect((await POST(makeRequest({ mids: [`${FID}-01`] }))).status).toBe(200);
  });
});

describe('POST /api/setu/adult-class - nothing to enroll into', () => {
  // The loader returns null for "no open offering" or "nobody selectable". It
  // THROWS on a read failure, so null here is never a transient error.
  it('409 when the loader reports there is no adult-class question', async () => {
    loadAdultClassGateDataOrThrow.mockResolvedValue(null);
    const res = await POST(makeRequest({ mids: [`${FID}-01`] }));
    expect(res.status).toBe(409);
    expect(enrollFamily).not.toHaveBeenCalled();
  });

  // The route deliberately has NO try/catch around the loader: a read failure
  // must 500 and be retried, never masquerade as "there is nothing to enroll
  // into" and leave the family on a screen whose Save silently refuses.
  it('lets a loader READ FAILURE propagate rather than reporting 409', async () => {
    loadAdultClassGateDataOrThrow.mockRejectedValue(new Error('FAILED_PRECONDITION: index'));
    await expect(POST(makeRequest({ mids: [`${FID}-01`] }))).rejects.toThrow('FAILED_PRECONDITION');
    expect(enrollFamily).not.toHaveBeenCalled();
  });

  it('404 when the family doc is gone', async () => {
    getFamilyByFid.mockResolvedValue(null);
    expect((await POST(makeRequest({ mids: [`${FID}-01`] }))).status).toBe(404);
  });
});

describe('POST /api/setu/adult-class - enrollFamily error mapping', () => {
  it.each([
    ['offering-not-found', 404],
    ['offering-disabled', 422],
    ['offering-expired', 422],
    ['program-not-available', 422],
    ['no-eligible-members', 400],
    ['family-not-found', 404],
  ])('maps %s to %i', async (msg, status) => {
    enrollFamily.mockRejectedValue(new Error(msg));
    expect((await POST(makeRequest({ mids: [`${FID}-01`] }))).status).toBe(status);
  });

  it('rethrows an unexpected error rather than reporting a bad request', async () => {
    enrollFamily.mockRejectedValue(new Error('boom'));
    await expect(POST(makeRequest({ mids: [`${FID}-01`] }))).rejects.toThrow('boom');
  });
});
