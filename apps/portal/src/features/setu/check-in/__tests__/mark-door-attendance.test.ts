import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attendanceAid } from '@cmt/shared-domain';
import { mostRecentSunday } from '@/features/setu/calendar/calendar';

const mocks = vi.hoisted(() => ({
  portalFirestore: vi.fn(),
  getOpenOfferingsForFamily: vi.fn(),
  fetchEnabledLevelsForPid: vi.fn(),
}));

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: mocks.portalFirestore,
  FieldValue: { serverTimestamp: () => 'TS' },
}));
vi.mock('@/features/setu/enrollment/get-open-offerings', () => ({
  getOpenOfferingsForFamily: mocks.getOpenOfferingsForFamily,
}));
// Keep the pure matchChildLevel real; mock only the Firestore-backed level fetch.
vi.mock('@/features/setu/enrollment/derive-child-level', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/setu/enrollment/derive-child-level')>();
  return { ...actual, fetchEnabledLevelsForPid: mocks.fetchEnabledLevelsForPid };
});

import { markDoorAttendance, DOOR_CHECKIN_MARKED_BY } from '../mark-door-attendance';

// Two brackets: grade 6 → Level 4, grade 1 → Level 1.
const LEVELS = [
  { levelId: 'L-4', levelName: 'Level 4', levelKind: 'level' as const, gradeBand: ['6'] },
  { levelId: 'L-1', levelName: 'Level 1', levelKind: 'level' as const, gradeBand: ['1'] },
];

// A Monday: mostRecentSunday(NOW) is the PRIOR Sunday (the class day the teacher
// views), NOT the raw calendar date — this is exactly the bug the switch fixes.
const NOW = new Date('2026-07-20T12:00:00Z');
const DATE = mostRecentSunday(NOW); // 2026-07-19

let created: Array<Record<string, unknown>>;
let existingAids: Set<string>;
let membersDocs: Array<{ data: () => Record<string, unknown> }>;

function member(mid: string, type: 'Adult' | 'Child', schoolGrade: string | null) {
  return { data: () => ({ mid, type, schoolGrade, birthMonthYear: null }) };
}

function makeDb() {
  return {
    collection: (name: string) => {
      if (name === 'families') {
        return { doc: () => ({ collection: () => ({ get: async () => ({ docs: membersDocs }) }) }) };
      }
      if (name === 'attendanceEvents') {
        return {
          doc: (aid: string) => ({
            create: async (data: Record<string, unknown>) => {
              if (existingAids.has(aid)) {
                const e = Object.assign(new Error('already exists'), { code: 6 });
                throw e;
              }
              created.push({ aid, ...data });
              return {};
            },
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  created = [];
  existingAids = new Set();
  membersDocs = [
    member('m1', 'Child', '6'),
    member('m2', 'Child', '1'),
    member('a1', 'Adult', null),
    member('m9', 'Child', '99'), // no level covers grade 99
  ];
  mocks.portalFirestore.mockImplementation(() => makeDb());
  mocks.getOpenOfferingsForFamily.mockResolvedValue([{ oid: 'oid-1' }]);
  mocks.fetchEnabledLevelsForPid.mockResolvedValue(LEVELS);
});

describe('markDoorAttendance', () => {
  it('marks present CHILDREN in their level (present-only), skipping adults and unmatched grades', async () => {
    const res = await markDoorAttendance({
      fid: 'CMT-A',
      location: 'Brampton',
      presentMids: ['m1', 'm2', 'a1', 'm9'],
      now: NOW,
    });

    expect(res).toEqual({ marked: 2, skipped: 2 }); // a1 adult + m9 no-level skipped
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      aid: attendanceAid('L-4', 'm1', DATE),
      levelId: 'L-4',
      mid: 'm1',
      fid: 'CMT-A',
      pid: 'oid-1',
      date: DATE,
      status: 'present',
      isGuest: false,
      markedByUid: DOOR_CHECKIN_MARKED_BY,
      markedByMid: null,
    });
    expect(created[1]).toMatchObject({ levelId: 'L-1', mid: 'm2', status: 'present' });
    // Uses the family's location to resolve the current Bala Vihar offering.
    expect(mocks.getOpenOfferingsForFamily).toHaveBeenCalledWith('bala-vihar', 'Brampton');
  });

  it('never overwrites an existing mark (create-only): an already-marked student is respected', async () => {
    existingAids.add(attendanceAid('L-4', 'm1', DATE)); // teacher already marked m1
    const res = await markDoorAttendance({
      fid: 'CMT-A',
      location: 'Brampton',
      presentMids: ['m1', 'm2'],
      now: NOW,
    });

    expect(res).toEqual({ marked: 1, skipped: 1 });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ mid: 'm2', status: 'present' });
  });

  it('off-season (no open offering) marks nobody', async () => {
    mocks.getOpenOfferingsForFamily.mockResolvedValue([]);
    const res = await markDoorAttendance({
      fid: 'CMT-A',
      location: 'Brampton',
      presentMids: ['m1', 'm2'],
      now: NOW,
    });
    expect(res).toEqual({ marked: 0, skipped: 2 });
    expect(created).toHaveLength(0);
    expect(mocks.fetchEnabledLevelsForPid).not.toHaveBeenCalled();
  });

  it('no present children → no offering lookup, nothing marked', async () => {
    const res = await markDoorAttendance({
      fid: 'CMT-A',
      location: 'Brampton',
      presentMids: [],
      now: NOW,
    });
    expect(res).toEqual({ marked: 0, skipped: 0 });
    expect(mocks.getOpenOfferingsForFamily).not.toHaveBeenCalled();
  });
});
