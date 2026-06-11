import { describe, it, expect } from 'vitest';
import {
  PRASAD_STATUSES,
  PrasadAssignmentDocSchema,
  PrasadConfigDocSchema,
  PrasadPreviewBodySchema,
  PrasadMoveBodySchema,
  PrasadAdminReassignBodySchema,
  PrasadConfirmBodySchema,
  PrasadAssignRemainingBodySchema,
} from '../prasad';

const baseDoc = {
  paid: 'bv-brampton-2025-26-CMT-ABC',
  pid: 'bv-brampton-2025-26',
  fid: 'CMT-ABC',
  familyName: 'Patel',
  location: 'Brampton',
  date: '2026-03-22',
  youngestMid: 'CMT-ABC-02',
  youngestName: 'Aarav',
  birthMonth: 3,
  reason: 'birthday-month',
  source: 'auto',
  status: 'assigned',
  assignedAt: new Date(),
  movedFrom: null,
  movedAt: null,
  movedBy: null,
  remindedAt: { weekBefore: null, twoDayBefore: null },
};

describe('prasad schemas', () => {
  it('parses a full assignment doc', () => {
    expect(PrasadAssignmentDocSchema.parse(baseDoc).paid).toBe('bv-brampton-2025-26-CMT-ABC');
  });
  it('rejects an off-range birthMonth', () => {
    expect(PrasadAssignmentDocSchema.safeParse({ ...baseDoc, birthMonth: 13 }).success).toBe(false);
  });
  it('rejects a malformed date', () => {
    expect(PrasadAssignmentDocSchema.safeParse({ ...baseDoc, date: '03/22/2026' }).success).toBe(false);
  });
  it('parses config + request bodies', () => {
    expect(PrasadConfigDocSchema.parse({ pid: 'x', capPerSunday: 10, publishedAt: new Date(), publishedBy: 'm1' }).capPerSunday).toBe(10);
    expect(PrasadPreviewBodySchema.parse({ pid: 'x', cap: 10 }).cap).toBe(10);
    expect(PrasadPreviewBodySchema.parse({ pid: 'x' }).cap).toBeUndefined();
    expect(PrasadMoveBodySchema.safeParse({ date: 'nope' }).success).toBe(false);
    expect(PrasadAdminReassignBodySchema.parse({ paid: 'p', date: '2026-03-22' }).date).toBe('2026-03-22');
  });
});

describe('propose→confirm lifecycle', () => {
  const lifecycleDoc = {
    ...baseDoc,
    status: 'proposed' as const,
    confirmedAt: null,
    confirmedBy: null,
    proposalNotifiedAt: null,
  };

  it('accepts proposed status and the lifecycle fields', () => {
    expect(PRASAD_STATUSES).toContain('proposed');
    const parsed = PrasadAssignmentDocSchema.parse(lifecycleDoc);
    expect(parsed.status).toBe('proposed');
    expect(parsed.confirmedBy).toBeNull();
  });

  it('round-trips confirmedBy family|admin (no silent strip)', () => {
    const parsed = PrasadAssignmentDocSchema.parse({
      ...lifecycleDoc, status: 'assigned', confirmedAt: new Date(), confirmedBy: 'admin',
      proposalNotifiedAt: new Date(),
    });
    expect(parsed.confirmedBy).toBe('admin');
    expect(parsed.proposalNotifiedAt).toBeInstanceOf(Date);
  });

  it('rejects unknown confirmedBy', () => {
    expect(() => PrasadAssignmentDocSchema.parse({ ...lifecycleDoc, confirmedBy: 'sevak' })).toThrow();
  });

  it('confirm body: empty {} and {date} both valid; bad date rejected', () => {
    expect(PrasadConfirmBodySchema.parse({})).toEqual({});
    expect(PrasadConfirmBodySchema.parse({ date: '2026-04-05' }).date).toBe('2026-04-05');
    expect(() => PrasadConfirmBodySchema.parse({ date: 'nope' })).toThrow();
  });

  it('assign-remaining body requires pid', () => {
    expect(PrasadAssignRemainingBodySchema.parse({ pid: 'bv-brampton-2025-26' }).pid).toBe('bv-brampton-2025-26');
    expect(() => PrasadAssignRemainingBodySchema.parse({})).toThrow();
  });

  it('admin reassign body accepts assign:true', () => {
    const p = PrasadAdminReassignBodySchema.parse({ paid: 'x-y', assign: true });
    expect(p.assign).toBe(true);
  });
});
