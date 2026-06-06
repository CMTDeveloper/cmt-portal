import { it, expect, vi, beforeEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const chain: Record<string, unknown> = {};
  chain.collection = vi.fn(() => chain);
  chain.doc = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.get = mockGet;
  return { portalFirestore: () => chain, FieldValue: { serverTimestamp: () => 'ts' } };
});

import { getMemberAchievements } from '../get-achievements';

beforeEach(() => { mockGet.mockReset(); });

it('maps docs to ChildAchievement[] with awardedAt as ISO', async () => {
  mockGet.mockResolvedValue({
    docs: [
      { data: () => ({ achId: 'a1', mid: 'CMT-F1-02', fid: 'CMT-F1', title: 'Om Award', description: 'Nice', programKey: 'bala-vihar', awardedByName: null, awardedAt: { toDate: () => new Date('2026-05-01T00:00:00Z') } }) },
      { data: () => ({ achId: 'a2', mid: 'CMT-F1-02', fid: 'CMT-F1', title: 'Gita L2', description: null, programKey: null, awardedByName: 'Acharya', awardedAt: { toDate: () => new Date('2026-04-01T00:00:00Z') } }) },
    ],
  });
  const out = await getMemberAchievements('CMT-F1', 'CMT-F1-02');
  expect(out).toEqual([
    { achId: 'a1', title: 'Om Award', description: 'Nice', programKey: 'bala-vihar', awardedByName: null, awardedAt: '2026-05-01T00:00:00.000Z' },
    { achId: 'a2', title: 'Gita L2', description: null, programKey: null, awardedByName: 'Acharya', awardedAt: '2026-04-01T00:00:00.000Z' },
  ]);
});

it('returns [] when there are no achievements', async () => {
  mockGet.mockResolvedValue({ docs: [] });
  expect(await getMemberAchievements('CMT-F1', 'CMT-F1-02')).toEqual([]);
});
