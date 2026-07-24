import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, dayDocResolver, guestListResolver, guestDayResolver, portalGuestResolver } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  // Routes a `family-check-ins/{legacyFid}/checkIns/{date}.get()` read by the
  // captured legacyFid + date. Default: { exists: false }. Per-fid tests set it.
  dayDocResolver: { fn: (_legacyFid: string, _date: string) => ({ exists: false }) as unknown },
  // guest-families list: returns docs [{ id: emailLower }]
  guestListResolver: { fn: () => ({ docs: [] as Array<{ id: string }> }) as unknown },
  // guest-families/{email}/checkIns/{date} day doc
  guestDayResolver: { fn: (_email: string, _date: string) => ({ exists: false }) as unknown },
  // portal `guest_check_ins` where('date','==',date): returns docs [{ data() }]
  portalGuestResolver: { fn: (_date: string) => ({ docs: [] as Array<{ data: () => Record<string, unknown> }> }) as unknown },
}));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: (name: string) => {
      if (name === 'guest_check_ins') {
        return { where: (_f: string, _op: string, val: string) => ({ get: async () => portalGuestResolver.fn(val) }) };
      }
      return {};
    },
  }),
}));
vi.mock('../check-in-source', () => ({
  checkInSourceFirestore: () => ({
    collection: (name: string) => {
      if (name === 'guest-families') {
        return {
          get: async () => guestListResolver.fn(),
          doc: (email: string) => ({
            collection: () => ({ doc: (date: string) => ({ get: async () => guestDayResolver.fn(email, date) }) }),
          }),
        };
      }
      // family-check-ins (unchanged shape used by getCheckInAttendance + readDoorPresentSids)
      return {
        doc: (legacyFid: string) => ({
          collection: () => ({
            // getCheckInAttendance reads the whole `checkIns` subcollection.
            get: mockGet,
            // readDoorPresentSids reads a single day doc; route by fid + date.
            doc: (date: string) => ({ get: async () => dayDocResolver.fn(legacyFid, date) }),
          }),
        }),
      };
    },
  }),
}));

import {
  getCheckInAttendance,
  readDoorPresentSids,
  readDoorGuestCheckIns,
  readPortalGuestChildren,
  summarizeFamilyCheckIns,
  summarizeMemberCheckIns,
  type CheckInRecord,
} from '../check-in-attendance';

function doc(date: string, students: Array<{ sid: string; isCheckedIn: boolean }>, checkedInBy = 'teacher') {
  return { id: date, data: () => ({ date, checkedInBy, students }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  dayDocResolver.fn = () => ({ exists: false });
  guestListResolver.fn = () => ({ docs: [] });
  guestDayResolver.fn = () => ({ exists: false });
  portalGuestResolver.fn = () => ({ docs: [] });
});

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

describe('readDoorPresentSids', () => {
  it('readDoorPresentSids collects checked-in sids for a date across families', async () => {
    dayDocResolver.fn = (legacyFid, date) => {
      if (date !== '2026-01-04') return { exists: false };
      if (legacyFid === '4421') {
        return { exists: true, data: () => ({ students: [{ sid: 'S9', isCheckedIn: true }, { sid: 'S8', isCheckedIn: false }] }) };
      }
      if (legacyFid === '7000') {
        return { exists: true, data: () => ({ students: [{ sid: 'S1', isCheckedIn: true }] }) };
      }
      return { exists: false };
    };
    const out = await readDoorPresentSids(['4421', '7000'], '2026-01-04');
    expect(out).toEqual(new Set(['S9', 'S1'])); // only checked-in sids, deduped across families
  });

  it('readDoorPresentSids ignores a missing day-doc and dedupes the input fids', async () => {
    dayDocResolver.fn = (legacyFid, date) => {
      if (date === '2026-01-04' && legacyFid === '4421') {
        return { exists: true, data: () => ({ students: [{ sid: 'S9', isCheckedIn: true }] }) };
      }
      return { exists: false }; // 9999 missing
    };
    const out = await readDoorPresentSids(['4421', '4421', '9999'], '2026-01-04');
    expect(out).toEqual(new Set(['S9']));
  });
});

describe('readDoorGuestCheckIns', () => {
  it('returns one entry per checked-in child for the date, coercing grade to string', async () => {
    guestListResolver.fn = () => ({ docs: [{ id: 'mom@x.com' }, { id: 'dad@y.com' }] });
    guestDayResolver.fn = (email, date) => {
      if (date !== '2026-01-04') return { exists: false };
      if (email === 'mom@x.com') {
        return { exists: true, data: () => ({
          parentName: 'Mom X', phone: '416', email: 'mom@x.com',
          children: [
            { name: 'Arjun X', grade: 2, isCheckedIn: true },
            { name: 'Maya X', grade: '3', isCheckedIn: false }, // not checked in → skipped
          ],
        }) };
      }
      if (email === 'dad@y.com') {
        return { exists: true, data: () => ({
          parentName: null, phone: null, email: 'dad@y.com',
          children: [{ name: 'Ravi Y', grade: 'Grade 1', isCheckedIn: true }],
        }) };
      }
      return { exists: false };
    };
    const out = await readDoorGuestCheckIns('2026-01-04');
    expect(out).toEqual([
      { name: 'Arjun X', grade: '2', parentEmail: 'mom@x.com', parentName: 'Mom X', phone: '416' },
      { name: 'Ravi Y', grade: 'Grade 1', parentEmail: 'dad@y.com', parentName: null, phone: null },
    ]);
  });

  it('skips families with no day-doc and tolerates a per-family read error', async () => {
    guestListResolver.fn = () => ({ docs: [{ id: 'a@x.com' }, { id: 'boom@x.com' }] });
    guestDayResolver.fn = (email, date) => {
      if (email === 'boom@x.com') throw new Error('read failed');
      if (email === 'a@x.com' && date === '2026-01-04') {
        return { exists: true, data: () => ({ email: 'a@x.com', children: [{ name: 'Sam', grade: '', isCheckedIn: true }] }) };
      }
      return { exists: false };
    };
    const out = await readDoorGuestCheckIns('2026-01-04');
    expect(out).toEqual([{ name: 'Sam', grade: '', parentEmail: 'a@x.com', parentName: null, phone: null }]);
  });

  it('returns [] when the guest-families list read fails', async () => {
    guestListResolver.fn = () => { throw new Error('list failed'); };
    expect(await readDoorGuestCheckIns('2026-01-04')).toEqual([]);
  });
});

describe('readPortalGuestChildren', () => {
  it('flattens every portal guest doc child for the date into DoorGuestChild rows', async () => {
    portalGuestResolver.fn = (date) => {
      if (date !== '2026-01-04') return { docs: [] };
      return {
        docs: [
          { data: () => ({
            firstName: 'Carol', lastName: 'Visitor', email: 'c@v.com', phone: '+16475550100',
            children: [
              { name: 'Aarav Visitor', grade: '2' },
              { name: 'Diya Visitor', grade: 2 }, // numeric grade coerced to string
            ],
          }) },
          { data: () => ({
            firstName: 'Sam', lastName: 'Solo', email: 's@solo.com', phone: '+16475550111',
            children: [], // adults-only visit contributes no children
          }) },
        ],
      };
    };
    const out = await readPortalGuestChildren('2026-01-04');
    expect(out).toEqual([
      { name: 'Aarav Visitor', grade: '2', parentEmail: 'c@v.com', parentName: 'Carol Visitor', phone: '+16475550100' },
      { name: 'Diya Visitor', grade: '2', parentEmail: 'c@v.com', parentName: 'Carol Visitor', phone: '+16475550100' },
    ]);
  });

  it('returns [] (not throw) when the portal query fails', async () => {
    portalGuestResolver.fn = () => { throw new Error('query failed'); };
    expect(await readPortalGuestChildren('2026-01-04')).toEqual([]);
  });
});
