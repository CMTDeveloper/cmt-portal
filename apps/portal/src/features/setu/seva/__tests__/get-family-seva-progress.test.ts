import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/seva-requirement', () => ({ getSevaRequirement: vi.fn() }));
vi.mock('../get-signups', () => ({ listFamilySignups: vi.fn() }));
import { getFamilySevaProgress, deriveSevaCardView } from '../get-family-seva-progress';
import { getSevaRequirement } from '@/lib/seva-requirement';
import { listFamilySignups } from '../get-signups';

function su(over: Record<string, unknown>) {
  return { signupId: 'x', oppId: 'o', fid: 'F1', mid: null, sevaYear: '2025-26', status: 'completed', hoursAwarded: 0, signedUpAt: new Date(), signedUpByMid: null, confirmedAt: null, confirmedBy: null, ...over };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getSevaRequirement).mockResolvedValue({ hoursPerYear: 20, currentSevaYear: '2025-26' }); });

describe('getFamilySevaProgress', () => {
  it('returns zero + skips the signup read when no seva year', async () => {
    vi.mocked(getSevaRequirement).mockResolvedValue({ hoursPerYear: 20, currentSevaYear: null });
    const p = await getFamilySevaProgress('F1');
    expect(p).toEqual({ currentSevaYear: null, hoursPerYear: 20, hoursEarned: 0 });
    expect(listFamilySignups).not.toHaveBeenCalled();
  });
  it('sums only completed signups in the current year', async () => {
    vi.mocked(listFamilySignups).mockResolvedValue([
      su({ status: 'completed', hoursAwarded: 3 }),
      su({ status: 'completed', hoursAwarded: 2 }),
      su({ status: 'signed-up', hoursAwarded: 0 }),
      su({ status: 'no-show', hoursAwarded: 0 }),
      su({ status: 'cancelled', hoursAwarded: 9 }),
      su({ status: 'completed', hoursAwarded: 7, sevaYear: '2024-25' }),
    ] as never);
    expect((await getFamilySevaProgress('F1')).hoursEarned).toBe(5);
  });
});

describe('deriveSevaCardView', () => {
  it('hidden when no seva year', () => {
    expect(deriveSevaCardView({ currentSevaYear: null, hoursPerYear: 20, hoursEarned: 0 })).toEqual({ show: false, pct: 0, remaining: 20, complete: false });
  });
  it('partial progress', () => {
    expect(deriveSevaCardView({ currentSevaYear: '2025-26', hoursPerYear: 20, hoursEarned: 5 })).toEqual({ show: true, pct: 25, remaining: 15, complete: false });
  });
  it('complete + capped at 100', () => {
    expect(deriveSevaCardView({ currentSevaYear: '2025-26', hoursPerYear: 20, hoursEarned: 22 })).toEqual({ show: true, pct: 100, remaining: 0, complete: true });
  });
});
