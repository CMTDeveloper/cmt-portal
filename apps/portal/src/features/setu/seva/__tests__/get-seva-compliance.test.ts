import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockCollection = vi.fn(() => ({ get: mockGet }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({ collection: mockCollection })),
}));

const requirementMock = vi.hoisted(() => ({ getSevaRequirement: vi.fn() }));
vi.mock('@/lib/seva-requirement', () => requirementMock);

const signupsMock = vi.hoisted(() => ({ listCompletedSignupsForYear: vi.fn() }));
vi.mock('../get-signups', () => signupsMock);

import { getSevaCompliance } from '../get-seva-compliance';

const familyDocs = (rows: Array<{ fid: string; name: string }>) => ({
  docs: rows.map((r) => ({ id: r.fid, data: () => ({ fid: r.fid, name: r.name }) })),
});

beforeEach(() => {
  vi.clearAllMocks();
  requirementMock.getSevaRequirement.mockResolvedValue({ hoursPerYear: 5, currentSevaYear: '2025-26' });
  signupsMock.listCompletedSignupsForYear.mockResolvedValue([]);
  mockGet.mockResolvedValue(familyDocs([]));
});

describe('getSevaCompliance', () => {
  it('returns an empty report when no seva year is set', async () => {
    requirementMock.getSevaRequirement.mockResolvedValue({ hoursPerYear: 20, currentSevaYear: null });
    const res = await getSevaCompliance();
    expect(res).toEqual({
      currentSevaYear: null,
      hoursPerYear: 20,
      rows: [],
      summary: { totalFamilies: 0, metCount: 0, shortCount: 0 },
    });
    // Never touches Firestore / signups when there is no active year.
    expect(mockGet).not.toHaveBeenCalled();
    expect(signupsMock.listCompletedSignupsForYear).not.toHaveBeenCalled();
  });

  it('left-joins every family against completed signups, short-first', async () => {
    mockGet.mockResolvedValue(
      familyDocs([
        { fid: 'F1', name: 'Sharma' },
        { fid: 'F2', name: 'Patel' },
      ]),
    );
    signupsMock.listCompletedSignupsForYear.mockResolvedValue([
      { fid: 'F1', hoursAwarded: 3 },
      { fid: 'F1', hoursAwarded: 4 },
    ]);

    const res = await getSevaCompliance();

    expect(res.currentSevaYear).toBe('2025-26');
    expect(res.hoursPerYear).toBe(5);
    // Short-first: F2 (0 hrs) before F1 (7 hrs).
    expect(res.rows.map((r) => r.fid)).toEqual(['F2', 'F1']);

    const f2 = res.rows[0]!;
    expect(f2).toEqual({ fid: 'F2', name: 'Patel', hoursEarned: 0, met: false });

    const f1 = res.rows[1]!;
    expect(f1).toEqual({ fid: 'F1', name: 'Sharma', hoursEarned: 7, met: true });

    expect(res.summary).toEqual({ totalFamilies: 2, metCount: 1, shortCount: 1 });
  });
});
