import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../get-opportunities', () => ({
  getOpportunity: vi.fn(),
  serializeOpportunity: (o: unknown) => o,
}));
vi.mock('../get-signups', () => ({ listSignupsForOpp: vi.fn() }));
vi.mock('@/features/setu/members/get-family-by-fid', () => ({ getFamilyByFid: vi.fn() }));

import { getOpportunityRoster } from '../get-opportunity-roster';
import { getOpportunity } from '../get-opportunities';
import { listSignupsForOpp } from '../get-signups';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';

const opp = { oppId: 'o1', title: 'Hall setup', defaultHours: 3, sevaYear: '2025-26', status: 'open' };
function signup(over: Record<string, unknown>) {
  return {
    signupId: 'o1__F1', oppId: 'o1', fid: 'F1', mid: null, sevaYear: '2025-26',
    status: 'signed-up', hoursAwarded: 0, signedUpAt: new Date('2026-01-02T00:00:00Z'),
    signedUpByMid: 'F1-01', confirmedAt: null, confirmedBy: null, ...over,
  };
}
function family(fid: string, name: string, members: { mid: string; firstName: string; lastName: string }[] = []) {
  return { family: { fid, name, location: '', legacyFid: null, createdAt: new Date(), managers: [], searchKeys: [] }, members };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOpportunity).mockResolvedValue(opp as never);
});

describe('getOpportunityRoster', () => {
  it('returns null for a missing opportunity', async () => {
    vi.mocked(getOpportunity).mockResolvedValue(null);
    expect(await getOpportunityRoster('nope')).toBeNull();
  });

  it('joins family + member names, excludes cancelled, sorts by status', async () => {
    vi.mocked(listSignupsForOpp).mockResolvedValue([
      signup({ signupId: 'o1__F2', fid: 'F2', status: 'completed', hoursAwarded: 3 }),
      signup({ signupId: 'o1__F1', fid: 'F1', mid: 'F1-02' }),
      signup({ signupId: 'o1__F3', fid: 'F3', status: 'cancelled' }),
    ] as never);
    vi.mocked(getFamilyByFid).mockImplementation(async (fid: string) => {
      if (fid === 'F1') return family('F1', 'Sharma', [{ mid: 'F1-02', firstName: 'Ravi', lastName: 'Sharma' }]) as never;
      if (fid === 'F2') return family('F2', 'Patel') as never;
      return null;
    });
    const res = await getOpportunityRoster('o1');
    expect(res).not.toBeNull();
    expect(res!.rows.map((r) => r.signupId)).toEqual(['o1__F1', 'o1__F2']);
    expect(res!.rows[0]).toMatchObject({ fid: 'F1', familyName: 'Sharma', memberName: 'Ravi Sharma', status: 'signed-up' });
    expect(res!.rows[1]).toMatchObject({ fid: 'F2', familyName: 'Patel', memberName: null, hoursAwarded: 3 });
    expect(typeof res!.rows[0]!.signedUpAt).toBe('string');
  });

  it('falls back to fid when the family is missing and degrades a stale member credit', async () => {
    vi.mocked(listSignupsForOpp).mockResolvedValue([
      signup({ signupId: 'o1__F9', fid: 'F9', mid: 'F9-09' }),
    ] as never);
    vi.mocked(getFamilyByFid).mockResolvedValue(null as never);
    const res = await getOpportunityRoster('o1');
    expect(res!.rows[0]).toMatchObject({ familyName: 'F9', memberName: null });
  });
});
