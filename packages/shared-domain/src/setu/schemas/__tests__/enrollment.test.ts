import { describe, it, expect } from 'vitest';
import { EnrollmentDocSchema, PostEnrollmentBodySchema } from '../enrollment';

const base = {
  eid: 'e1', fid: 'f1', oid: 'bala-vihar-brampton-2025-26', programKey: 'bala-vihar',
  programLabel: 'Bala Vihar', termLabel: '2025-26', location: 'Brampton',
  enrolledAt: new Date(), enrolledVia: 'family-initiated', enrolledByMid: 'f1-01',
  enrolledMids: ['f1-02'], suggestedAmountSnapshot: 500, suggestedAmountOverride: null,
  status: 'active', cancelledAt: null, cancelledReason: null,
};
describe('EnrollmentDoc', () => {
  it('accepts oid + enrolledMids + null location', () => {
    expect(EnrollmentDocSchema.safeParse(base).success).toBe(true);
    expect(EnrollmentDocSchema.safeParse({ ...base, location: null }).success).toBe(true);
  });
});
describe('EnrollmentDocSchema.enrolledVia', () => {
  it("accepts 'kiosk' as an enrolledVia value", () => {
    const parsed = EnrollmentDocSchema.parse({ ...base, enrolledVia: 'kiosk' });
    expect(parsed.enrolledVia).toBe('kiosk');
  });
});
describe('PostEnrollmentBodySchema', () => {
  it('requires oid (was pid)', () => {
    expect(PostEnrollmentBodySchema.safeParse({ oid: 'x' }).success).toBe(true);
    expect(PostEnrollmentBodySchema.safeParse({ pid: 'x' }).success).toBe(false);
  });
});
