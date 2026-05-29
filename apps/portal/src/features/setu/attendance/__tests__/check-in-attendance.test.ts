import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: () => ({ doc: () => ({ collection: () => ({ get: mockGet }) }) }),
  }),
}));

import {
  getCheckInAttendance,
  summarizeFamilyCheckIns,
  summarizeMemberCheckIns,
  type CheckInRecord,
} from '../check-in-attendance';

function doc(date: string, students: Array<{ sid: string; isCheckedIn: boolean }>, checkedInBy = 'teacher') {
  return { id: date, data: () => ({ date, checkedInBy, students }) };
}

beforeEach(() => vi.clearAllMocks());

describe('getCheckInAttendance', () => {
  it('returns [] with no legacyFid (no read)', async () => {
    expect(await getCheckInAttendance(null)).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('maps records newest-first and coerces sid to string', async () => {
    mockGet.mockResolvedValue({
      docs: [
        doc('2025-09-07', [{ sid: 101, isCheckedIn: true } as unknown as { sid: string; isCheckedIn: boolean }]),
        doc('2025-09-14', [{ sid: '101', isCheckedIn: false }]),
      ],
    });
    const out = await getCheckInAttendance('1234');
    expect(out[0]!.date).toBe('2025-09-14'); // newest first
    expect(out[1]!.students[0]!.sid).toBe('101'); // coerced from number
  });

  it('returns [] (not throw) on read error', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    expect(await getCheckInAttendance('1234')).toEqual([]);
  });
});

const RECORDS: CheckInRecord[] = [
  { date: '2025-09-14', checkedInBy: 'teacher', students: [{ sid: '101', isCheckedIn: false }, { sid: '102', isCheckedIn: true }] },
  { date: '2025-09-07', checkedInBy: 'family', students: [{ sid: '101', isCheckedIn: true }, { sid: '102', isCheckedIn: true }] },
  { date: '2025-09-21', checkedInBy: 'teacher', students: [{ sid: '101', isCheckedIn: false }] },
];

describe('summarizeFamilyCheckIns', () => {
  it('counts a date as attended if any student was present, sorted ascending', () => {
    const s = summarizeFamilyCheckIns(RECORDS);
    // 09-07 (both present) + 09-14 (102 present) = 2 attended; 09-21 (none) = absent
    expect(s.attended).toBe(2);
    expect(s.recorded).toBe(3);
    expect(s.lastDate).toBe('2025-09-21');
    expect(s.marks.map((m) => m.date)).toEqual(['2025-09-07', '2025-09-14', '2025-09-21']);
    expect(s.marks.map((m) => m.present)).toEqual([true, true, false]);
  });
});

describe('summarizeMemberCheckIns', () => {
  it('tracks only the dates where the member sid appears', () => {
    const s101 = summarizeMemberCheckIns(RECORDS, '101'); // appears all 3 dates: T,F,F
    expect(s101.recorded).toBe(3);
    expect(s101.attended).toBe(1);

    const s102 = summarizeMemberCheckIns(RECORDS, '102'); // appears 2 dates: present both
    expect(s102.recorded).toBe(2);
    expect(s102.attended).toBe(2);
  });

  it('empty summary for a null sid', () => {
    expect(summarizeMemberCheckIns(RECORDS, null)).toEqual({ attended: 0, recorded: 0, lastDate: null, marks: [] });
  });
});
