import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/flags', () => ({ flags: { setuAuth: true } }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

const { getOfferingProgramKey, getFamilyByFid, getEnrollments, resolveTeacherAssignedMids, enrollFamily } =
  vi.hoisted(() => ({
    getOfferingProgramKey: vi.fn(),
    getFamilyByFid: vi.fn(),
    getEnrollments: vi.fn(),
    resolveTeacherAssignedMids: vi.fn(),
    enrollFamily: vi.fn(),
  }));
vi.mock('@/features/setu/enrollment/get-offering', () => ({ getOfferingProgramKey }));
vi.mock('@/features/setu/members/get-family-by-fid', () => ({ getFamilyByFid }));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({ getEnrollments }));
vi.mock('@/features/setu/adult-class/load-gate-data', () => ({ resolveTeacherAssignedMids }));
vi.mock('@/features/setu/enrollment/enroll-family', () => ({ enrollFamily }));

import { POST } from '../route';

const FID = 'CMT-AB12CD34';
const ASC_OID = 'adult-study-class-2026-27';
const BV_OID = 'bala-vihar-2026-27';
const MANAGER = { role: 'family-manager', fid: FID, mid: `${FID}-01` };

const MEMBERS = [
  { mid: `${FID}-01`, firstName: 'A', lastName: 'One', type: 'Adult' },
  { mid: `${FID}-02`, firstName: 'B', lastName: 'Two', type: 'Adult' },
  { mid: `${FID}-09`, firstName: 'C', lastName: 'Kid', type: 'Child' },
];

function bvEnrollment() {
  return {
    eid: `${FID}-${BV_OID}`, oid: BV_OID, programKey: 'bala-vihar', status: 'active',
    enrolledMids: [`${FID}-09`], suggestedAmountOverride: null, offering: { paymentSource: 'portal' },
  };
}

function makeRequest(oid: string) {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('x-portal-role', MANAGER.role);
  headers.set('x-portal-fid', MANAGER.fid);
  headers.set('x-portal-mid', MANAGER.mid);
  return new Request('http://localhost/api/setu/enrollments', {
    method: 'POST', headers, body: JSON.stringify({ oid }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getOfferingProgramKey.mockResolvedValue('adult-study-class');
  getFamilyByFid.mockResolvedValue({ family: { fid: FID }, members: MEMBERS });
  getEnrollments.mockResolvedValue([bvEnrollment()]);
  resolveTeacherAssignedMids.mockResolvedValue(new Set([`${FID}-02`]));
  enrollFamily.mockResolvedValue({ created: true, eid: `${FID}-${ASC_OID}`, suggestedAmountSnapshot: 101 });
});

describe('POST /api/setu/enrollments - the adult-class door', () => {
  it('waives the fee and enrolls only the non-teaching adult', async () => {
    const res = await POST(makeRequest(ASC_OID));
    expect(res.status).toBe(201);
    expect(enrollFamily).toHaveBeenCalledWith({
      fid: FID,
      oid: ASC_OID,
      enrolledVia: 'family-initiated',
      enrolledByMid: `${FID}-01`,
      enrolledMids: [`${FID}-01`],
      membershipMode: 'manual',
      suggestedAmountOverride: 0,
    });
  });

  it('bills a family with no Bala Vihar enrollment', async () => {
    getEnrollments.mockResolvedValue([]);
    await POST(makeRequest(ASC_OID));
    expect(enrollFamily.mock.calls[0]![0].suggestedAmountOverride).toBeNull();
  });

  // Step 3b: never retroactively rewrite an amount the family already paid.
  it('omits the override entirely when one is already stored', async () => {
    getEnrollments.mockResolvedValue([
      bvEnrollment(),
      { eid: `${FID}-${ASC_OID}`, oid: ASC_OID, programKey: 'adult-study-class', status: 'active', enrolledMids: [`${FID}-01`], suggestedAmountOverride: 101, offering: {} },
    ]);
    await POST(makeRequest(ASC_OID));
    expect(enrollFamily.mock.calls[0]![0]).not.toHaveProperty('suggestedAmountOverride');
  });

  it('422s when every adult in the household teaches', async () => {
    resolveTeacherAssignedMids.mockResolvedValue(new Set([`${FID}-01`, `${FID}-02`]));
    const res = await POST(makeRequest(ASC_OID));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'no-selectable-adults' });
    expect(enrollFamily).not.toHaveBeenCalled();
  });
});

// ── THE REGRESSION HALF. This route enrolls every program; the adult-class
//    branch must be invisible to all of them. ────────────────────────────────
describe('POST /api/setu/enrollments - every other program is untouched', () => {
  it.each(['bala-vihar', 'tabla', 'adult-study-class-lookalike'])(
    'passes NONE of the three extra params for %s',
    async (programKey) => {
      getOfferingProgramKey.mockResolvedValue(programKey);
      await POST(makeRequest('some-oid'));
      const call = enrollFamily.mock.calls[0]![0];
      expect(call).toEqual({
        fid: FID,
        oid: 'some-oid',
        enrolledVia: 'family-initiated',
        enrolledByMid: `${FID}-01`,
      });
    },
  );

  it('reads neither the family nor the teacher set for a non-adult-class offering', async () => {
    getOfferingProgramKey.mockResolvedValue('bala-vihar');
    await POST(makeRequest(BV_OID));
    expect(getFamilyByFid).not.toHaveBeenCalled();
    expect(resolveTeacherAssignedMids).not.toHaveBeenCalled();
  });

  // A missing offering doc must not be mistaken for the adult class; enrollFamily
  // is left to raise its own typed offering-not-found.
  it('treats an unknown offering as not-adult-class', async () => {
    getOfferingProgramKey.mockResolvedValue(null);
    await POST(makeRequest('ghost-oid'));
    expect(enrollFamily.mock.calls[0]![0]).not.toHaveProperty('enrolledMids');
  });
});
