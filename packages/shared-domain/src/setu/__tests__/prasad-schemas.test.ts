import { describe, it, expect } from 'vitest';
import {
  PrasadAssignmentDocSchema,
  PrasadConfigDocSchema,
  PrasadPreviewBodySchema,
  PrasadMoveBodySchema,
  PrasadAdminReassignBodySchema,
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
