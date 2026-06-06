import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSet, mockGet, mockDelete, refSpy } = vi.hoisted(() => ({
  mockSet: vi.fn(), mockGet: vi.fn(), mockDelete: vi.fn(), refSpy: vi.fn(),
}));
vi.mock('node:crypto', () => {
  const randomUUID = () => 'ach-uuid';
  return { randomUUID, default: { randomUUID } };
});
vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const chain: Record<string, unknown> = {};
  chain.collection = vi.fn(() => chain);
  chain.doc = vi.fn((id?: string) => { if (id) refSpy(id); return chain; });
  chain.set = mockSet; chain.get = mockGet; chain.delete = mockDelete;
  return { portalFirestore: () => chain, FieldValue: { serverTimestamp: () => 'TS' } };
});

import { awardAchievement, revokeAchievement } from '../award-achievement';

beforeEach(() => { mockSet.mockReset(); mockGet.mockReset(); mockDelete.mockReset(); refSpy.mockReset(); });

describe('awardAchievement', () => {
  it('writes a doc with a generated achId, serverTimestamp, and the given fields', async () => {
    mockSet.mockResolvedValue(undefined);
    const out = await awardAchievement({
      fid: 'CMT-F1', mid: 'CMT-F1-02', title: 'Om Award', description: null,
      programKey: 'bala-vihar', awardedByUid: 'u-teacher', awardedByName: null,
    });
    expect(out).toEqual({ achId: 'ach-uuid' });
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      achId: 'ach-uuid', mid: 'CMT-F1-02', fid: 'CMT-F1', title: 'Om Award',
      description: null, programKey: 'bala-vihar', awardedByUid: 'u-teacher',
      awardedByName: null, awardedAt: 'TS',
    }));
  });
});

describe('revokeAchievement', () => {
  it('deletes when the doc exists → true', async () => {
    mockGet.mockResolvedValue({ exists: true });
    mockDelete.mockResolvedValue(undefined);
    expect(await revokeAchievement('CMT-F1', 'CMT-F1-02', 'ach-uuid')).toBe(true);
    expect(mockDelete).toHaveBeenCalled();
  });
  it('returns false and does not delete when the doc is missing', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await revokeAchievement('CMT-F1', 'CMT-F1-02', 'nope')).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
