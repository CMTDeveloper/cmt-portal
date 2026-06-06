import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/seva-requirement', () => ({ getSevaRequirement: vi.fn() }));
vi.mock('../get-opportunities', () => ({
  listOpportunities: vi.fn(),
  serializeOpportunity: vi.fn((o: Record<string, unknown>) => ({ ...o, date: 'ISO', createdAt: 'ISO', updatedAt: 'ISO' })),
}));
vi.mock('../get-signups', () => ({
  listFamilySignups: vi.fn(),
  listSignupsForOpp: vi.fn(),
  serializeSignup: vi.fn((s: Record<string, unknown>) => ({ ...s, signedUpAt: 'ISO', confirmedAt: null })),
  isActiveSignup: (s: { status: string }) => s.status === 'signed-up' || s.status === 'completed',
}));

import { getFamilySevaView } from '../get-family-seva-view';
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listOpportunities } from '../get-opportunities';
import { listFamilySignups, listSignupsForOpp } from '../get-signups';

const opp = (over = {}) => ({ oppId: 'o1', title: 'Setup', capacity: null, sevaYear: '2025-26', status: 'open', date: new Date(), createdAt: new Date(), updatedAt: new Date(), defaultHours: 4, description: '', location: '', createdBy: 'u', updatedBy: 'u', ...over });
const sg = (over = {}) => ({ signupId: 'o1__F', oppId: 'o1', fid: 'F', mid: null, sevaYear: '2025-26', status: 'signed-up', hoursAwarded: 0, signedUpAt: new Date(), signedUpByMid: null, confirmedAt: null, confirmedBy: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSevaRequirement).mockResolvedValue({ hoursPerYear: 20, currentSevaYear: '2025-26' });
  vi.mocked(listOpportunities).mockResolvedValue([opp()] as never);
  vi.mocked(listFamilySignups).mockResolvedValue([]);
  vi.mocked(listSignupsForOpp).mockResolvedValue([]);
});

describe('getFamilySevaView', () => {
  it('returns empty when no seva year is set', async () => {
    vi.mocked(getSevaRequirement).mockResolvedValue({ hoursPerYear: 20, currentSevaYear: null });
    const v = await getFamilySevaView('F');
    expect(v.currentSevaYear).toBeNull();
    expect(v.opportunities).toEqual([]);
    expect(v.mySignups).toEqual([]);
    expect(v.hoursEarned).toBe(0);
  });
  it('sets mySignupStatus null + spotsLeft null for an uncapped opp with no signup', async () => {
    const v = await getFamilySevaView('F');
    expect(v.opportunities[0]!.mySignupStatus).toBeNull();
    expect(v.opportunities[0]!.spotsLeft).toBeNull();
  });
  it('reflects the family signup status and joins the opportunity in mySignups', async () => {
    vi.mocked(listFamilySignups).mockResolvedValue([sg({ status: 'signed-up' })] as never);
    const v = await getFamilySevaView('F');
    expect(v.opportunities[0]!.mySignupStatus).toBe('signed-up');
    expect(v.mySignups).toHaveLength(1);
    expect(v.mySignups[0]!.opportunity).not.toBeNull();
  });
  it('excludes cancelled signups from mySignups', async () => {
    vi.mocked(listFamilySignups).mockResolvedValue([sg({ status: 'cancelled' })] as never);
    const v = await getFamilySevaView('F');
    expect(v.mySignups).toHaveLength(0);
  });
  it('computes spotsLeft for a capped opp (active = signed-up + completed)', async () => {
    vi.mocked(listOpportunities).mockResolvedValue([opp({ capacity: 3 })] as never);
    vi.mocked(listSignupsForOpp).mockResolvedValue([
      sg({ signupId: 'a', fid: 'X', status: 'signed-up' }),
      sg({ signupId: 'b', fid: 'Y', status: 'completed' }),
      sg({ signupId: 'c', fid: 'Z', status: 'cancelled' }),
    ] as never);
    const v = await getFamilySevaView('F');
    expect(v.opportunities[0]!.spotsLeft).toBe(1);
  });
  it('sums hoursAwarded over completed signups into hoursEarned (no-show counts 0)', async () => {
    vi.mocked(listFamilySignups).mockResolvedValue([
      sg({ signupId: 's1', oppId: 'o1', status: 'completed', hoursAwarded: 4 }),
      sg({ signupId: 's2', oppId: 'o2', status: 'no-show', hoursAwarded: 0 }),
    ] as never);
    const v = await getFamilySevaView('F');
    expect(v.hoursEarned).toBe(4);
  });
  it('joins a since-closed opportunity into mySignups (all-statuses query backs the join)', async () => {
    const open = opp({ oppId: 'o1', status: 'open' });
    const closed = opp({ oppId: 'o2', status: 'closed' });
    vi.mocked(listOpportunities).mockImplementation(async (f) =>
      (f?.status === 'open' ? [open] : [open, closed]) as never,
    );
    vi.mocked(listFamilySignups).mockResolvedValue([
      sg({ signupId: 's2', oppId: 'o2', status: 'completed', hoursAwarded: 4 }),
    ] as never);
    const v = await getFamilySevaView('F');
    expect(v.mySignups).toHaveLength(1);
    expect(v.mySignups[0]!.opportunity).not.toBeNull();
    expect(v.mySignups[0]!.opportunity!.oppId).toBe('o2');
  });
});
