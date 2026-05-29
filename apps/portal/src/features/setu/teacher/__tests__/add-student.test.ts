import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLevelGet, txnGet, txnSet, mockRunTxn, mockMarkGuest } = vi.hoisted(() => ({
  mockLevelGet: vi.fn(),
  txnGet: vi.fn(),
  txnSet: vi.fn(),
  mockRunTxn: vi.fn(),
  mockMarkGuest: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => {
  const docRef = (c: string, id: string) => ({
    __c: c,
    __id: id,
    get: c === 'levels' ? mockLevelGet : vi.fn(),
    collection: (sub: string) => ({ __c: sub, doc: (sid: string) => ({ __c: sub, __id: sid }) }),
  });
  return {
    FieldValue: { serverTimestamp: () => 'SERVER_TS' },
    portalFirestore: () => ({
      collection: (c: string) => ({ doc: (id: string) => docRef(c, id) }),
      runTransaction: mockRunTxn,
    }),
  };
});
vi.mock('@/features/setu/registration/generate-fid', () => ({ generateFid: () => 'CMT-NEW1' }));
vi.mock('@/features/setu/registration/hash-contact-key', () => ({ hashContactKey: (t: string, v: string) => `hash:${t}:${v}` }));
vi.mock('../guests', () => ({ markGuest: mockMarkGuest }));

import { addStudentOnPrompt } from '../add-student';

const PARAMS = {
  levelId: 'brampton-level-2-bv-brampton-2025-26',
  date: '2025-09-07',
  firstName: 'New',
  lastName: 'Kid',
  schoolGrade: 'Grade 2',
  gender: 'PreferNotToSay' as const,
  parentEmail: 'parent@example.com',
  parentPhone: null,
  markedByUid: 'uid-t',
  markedByMid: 'CMT-T-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockLevelGet.mockResolvedValue({ exists: true, data: () => ({ levelId: PARAMS.levelId, location: 'Brampton', pid: 'bv-brampton-2025-26' }) });
  mockMarkGuest.mockResolvedValue({ ok: true, aid: 'a1', autoEnrolled: true });
  // runTransaction invokes the callback with our txn stub
  mockRunTxn.mockImplementation(async (cb: (t: { get: typeof txnGet; set: typeof txnSet }) => Promise<unknown>) => cb({ get: txnGet, set: txnSet }));
});

describe('addStudentOnPrompt', () => {
  it('level-not-found when the level is missing', async () => {
    mockLevelGet.mockResolvedValue({ exists: false });
    expect(await addStudentOnPrompt(PARAMS)).toEqual({ ok: false, reason: 'level-not-found' });
  });

  it('creates a NEW pending family (manager = parent email) when the email is unclaimed', async () => {
    txnGet.mockResolvedValueOnce({ exists: false }); // contactKeys lookup → unclaimed
    const res = await addStudentOnPrompt(PARAMS);
    expect(res).toMatchObject({ ok: true, fid: 'CMT-NEW1', childMid: 'CMT-NEW1-02', createdFamily: true, autoEnrolled: true });
    // family + manager + child + email contactKey written (4 sets, no phone)
    expect(txnSet).toHaveBeenCalledTimes(4);
    // child guest-marked after the txn
    expect(mockMarkGuest).toHaveBeenCalledWith(expect.objectContaining({ mid: 'CMT-NEW1-02', status: 'present', levelId: PARAMS.levelId }));
  });

  it('writes a phone contactKey too when a parent phone is given', async () => {
    txnGet.mockResolvedValueOnce({ exists: false });
    await addStudentOnPrompt({ ...PARAMS, parentPhone: '416-555-0100' });
    expect(txnSet).toHaveBeenCalledTimes(5); // + phone contactKey
  });

  it('appends the child to the parent’s EXISTING family when the email already claims one', async () => {
    txnGet
      .mockResolvedValueOnce({ exists: true, data: () => ({ fid: 'CMT-EXIST' }) }) // contactKeys → existing fid
      .mockResolvedValueOnce({ size: 3 }); // members collection size → next mid -04
    const res = await addStudentOnPrompt(PARAMS);
    expect(res).toMatchObject({ ok: true, fid: 'CMT-EXIST', childMid: 'CMT-EXIST-04', createdFamily: false });
    // only the child member is written (no new family/manager/contactKey)
    expect(txnSet).toHaveBeenCalledTimes(1);
    expect(mockMarkGuest).toHaveBeenCalledWith(expect.objectContaining({ mid: 'CMT-EXIST-04' }));
  });
});
