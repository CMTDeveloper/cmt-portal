import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveKioskFamily: vi.fn(),
  autoEnrollBalaVihar: vi.fn(),
  markDoorAttendance: vi.fn(),
  portalFirestore: vi.fn(),
}));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore: mocks.portalFirestore }));
vi.mock('../resolve-kiosk-family', () => ({ resolveKioskFamily: mocks.resolveKioskFamily }));
vi.mock('../auto-enroll-bala-vihar', () => ({ autoEnrollBalaVihar: mocks.autoEnrollBalaVihar }));
vi.mock('../mark-door-attendance', () => ({ markDoorAttendance: mocks.markDoorAttendance }));

import { markSelfCheckInAttendance } from '../self-check-in-attendance';

let membersDocs: Array<{ data: () => Record<string, unknown> }>;
function member(mid: string, legacySid: string | null) {
  return { data: () => ({ mid, legacySid }) };
}
function makeDb() {
  return {
    collection: () => ({ doc: () => ({ collection: () => ({ get: async () => ({ docs: membersDocs }) }) }) }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  membersDocs = [
    member('CMT-A-01', '900'),
    member('CMT-A-03', '903'),
    member('CMT-A-04', '904'),
  ];
  mocks.portalFirestore.mockImplementation(() => makeDb());
  mocks.autoEnrollBalaVihar.mockResolvedValue({ enrolled: true, created: false, eid: 'e1' });
  mocks.markDoorAttendance.mockResolvedValue({ marked: 2, skipped: 0 });
});

describe('markSelfCheckInAttendance', () => {
  it('resolves the Setu family, maps present legacy sids → mids, auto-enrolls, marks attendance', async () => {
    mocks.resolveKioskFamily.mockResolvedValue({ fid: 'CMT-A', location: 'Brampton' });
    const res = await markSelfCheckInAttendance({ legacyFamilyId: '477', presentLegacySids: ['903', '904'] });
    expect(mocks.resolveKioskFamily).toHaveBeenCalledWith('477');
    expect(mocks.autoEnrollBalaVihar).toHaveBeenCalledWith({ fid: 'CMT-A', location: 'Brampton' });
    // Legacy sids 903/904 map to member mids CMT-A-03/04; the 900-sid member is excluded.
    expect(mocks.markDoorAttendance).toHaveBeenCalledWith({
      fid: 'CMT-A',
      location: 'Brampton',
      presentMids: ['CMT-A-03', 'CMT-A-04'],
    });
    expect(res).toEqual({ marked: 2 });
  });

  it('is a no-op when the family is not in Setu', async () => {
    mocks.resolveKioskFamily.mockResolvedValue(null);
    const res = await markSelfCheckInAttendance({ legacyFamilyId: '999', presentLegacySids: ['903'] });
    expect(res).toEqual({ marked: 0 });
    expect(mocks.markDoorAttendance).not.toHaveBeenCalled();
  });

  it('no matching members → no enroll, no mark', async () => {
    mocks.resolveKioskFamily.mockResolvedValue({ fid: 'CMT-A', location: 'Brampton' });
    const res = await markSelfCheckInAttendance({ legacyFamilyId: '477', presentLegacySids: ['no-such-sid'] });
    expect(res).toEqual({ marked: 0 });
    expect(mocks.autoEnrollBalaVihar).not.toHaveBeenCalled();
    expect(mocks.markDoorAttendance).not.toHaveBeenCalled();
  });

  it('empty present list → no resolve, no-op', async () => {
    const res = await markSelfCheckInAttendance({ legacyFamilyId: '477', presentLegacySids: [] });
    expect(res).toEqual({ marked: 0 });
    expect(mocks.resolveKioskFamily).not.toHaveBeenCalled();
  });

  it('never throws — a resolve error returns marked 0', async () => {
    mocks.resolveKioskFamily.mockRejectedValue(new Error('firestore down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await markSelfCheckInAttendance({ legacyFamilyId: '477', presentLegacySids: ['903'] });
    expect(res).toEqual({ marked: 0 });
    errSpy.mockRestore();
  });

  it('still marks attendance even if auto-enroll fails', async () => {
    mocks.resolveKioskFamily.mockResolvedValue({ fid: 'CMT-A', location: 'Brampton' });
    mocks.autoEnrollBalaVihar.mockRejectedValue(new Error('offering-disabled'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await markSelfCheckInAttendance({ legacyFamilyId: '477', presentLegacySids: ['903'] });
    expect(mocks.markDoorAttendance).toHaveBeenCalled();
    expect(res).toEqual({ marked: 2 });
    errSpy.mockRestore();
  });
});
