import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: () => '__ts__' },
}));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { previewAssignments, publishAssignments } from '../publish-assignments';

const mockFirestore = vi.mocked(portalFirestore);

type Json = Record<string, unknown>;

interface CalendarSeed {
  entryId: string;
  location: string;
  programKey: string;
  date: string;
  kind: string;
  enabled?: boolean;
  prasadNeeded?: boolean;
}

interface MemberSeed {
  mid: string;
  firstName: string;
  lastName: string;
  type: 'Child' | 'Adult';
  schoolGrade?: string | null;
  birthMonth?: number | null;
  birthMonthYear?: string | null;
}

interface FamilySeed {
  fid: string;
  name: string;
  location: string;
  /** active enrollment for this pid: enrolledMids */
  enrolledMids: string[];
  members: MemberSeed[];
}

interface EnrollmentSeed {
  fid: string;
  pid: string;
  location: string;
  status: string;
  enrolledMids: string[];
}

interface AssignmentSeed {
  paid: string;
  fid: string;
  pid: string;
  date: string;
  status: string;
}

interface QuerySnap {
  docs: Array<{ id: string; data: () => Json }>;
}

interface DocSnap {
  exists: boolean;
  data: () => Json | undefined;
}

interface BatchOp {
  ref: { __collection: string; __id: string };
  data: Json;
}

interface Seeds {
  calendar: CalendarSeed[];
  families: FamilySeed[];
  enrollments: EnrollmentSeed[];
  assignments: AssignmentSeed[];
}

function makeDb(seeds: Seeds, batchOps: BatchOp[]) {
  const byFid = new Map(seeds.families.map((f) => [f.fid, f]));

  // collectionGroup('enrollments') with where filters resolved at .get()
  function enrollmentGroup() {
    let pid: string | undefined;
    let status: string | undefined;
    const cg = {
      where: vi.fn((field: string, _op: string, value: unknown) => {
        if (field === 'pid') pid = String(value);
        if (field === 'status') status = String(value);
        return cg;
      }),
      get: vi.fn(async (): Promise<QuerySnap> => {
        const rows = seeds.enrollments
          .filter((e) => (pid ? e.pid === pid : true) && (status ? e.status === status : true))
          .map((e, i) => ({
            id: `${e.fid}-e-${i}`,
            data: (): Json => ({ fid: e.fid, location: e.location, enrolledMids: e.enrolledMids }),
          }));
        return { docs: rows };
      }),
    };
    return cg;
  }

  function calendarQuery() {
    let location: string | undefined;
    let programKey: string | undefined;
    const q = {
      where: vi.fn((field: string, _op: string, value: unknown) => {
        if (field === 'location') location = String(value);
        if (field === 'programKey') programKey = String(value);
        return q;
      }),
      get: vi.fn(async (): Promise<QuerySnap> => {
        const rows = seeds.calendar
          .filter((c) => (location ? c.location === location : true) && (programKey ? c.programKey === programKey : true))
          .map((c) => ({
            id: c.entryId,
            data: (): Json => ({
              date: c.date,
              kind: c.kind,
              enabled: c.enabled,
              prasadNeeded: c.prasadNeeded,
            }),
          }));
        return { docs: rows };
      }),
    };
    return q;
  }

  function assignmentsQuery() {
    let pid: string | undefined;
    const q = {
      where: vi.fn((field: string, _op: string, value: unknown) => {
        if (field === 'pid') pid = String(value);
        return q;
      }),
      get: vi.fn(async (): Promise<QuerySnap> => {
        const rows = seeds.assignments
          .filter((a) => (pid ? a.pid === pid : true))
          .map((a) => ({
            id: a.paid,
            data: (): Json => ({ fid: a.fid, date: a.date, status: a.status }),
          }));
        return { docs: rows };
      }),
    };
    return q;
  }

  function familyDoc(fid: string) {
    return {
      get: vi.fn(async (): Promise<DocSnap> => {
        const f = byFid.get(fid);
        return { exists: f !== undefined, data: () => (f ? { name: f.name } : undefined) };
      }),
      collection: vi.fn((sub: string) => {
        if (sub !== 'members') throw new Error(`unexpected subcollection ${sub}`);
        const f = byFid.get(fid);
        return {
          get: vi.fn(async (): Promise<QuerySnap> => ({
            docs: (f?.members ?? []).map((m) => ({ id: m.mid, data: (): Json => ({ ...m }) })),
          })),
        };
      }),
    };
  }

  function docRef(collection: string, id: string) {
    return { __collection: collection, __id: id };
  }

  const db = {
    collection: vi.fn((col: string) => {
      if (col === 'classCalendarEntries') return calendarQuery();
      if (col === 'prasadAssignments') {
        const api = assignmentsQuery() as ReturnType<typeof assignmentsQuery> & {
          doc: (id: string) => ReturnType<typeof docRef>;
        };
        api.doc = vi.fn((id: string) => docRef('prasadAssignments', id));
        return api;
      }
      if (col === 'prasadConfig') {
        return {
          doc: vi.fn((id: string) => {
            const ref = docRef('prasadConfig', id) as ReturnType<typeof docRef> & {
              set: (data: Json, opts?: unknown) => Promise<void>;
            };
            ref.set = vi.fn(async (data: Json) => {
              batchOps.push({ ref: docRef('prasadConfig', id), data });
            });
            return ref;
          }),
        };
      }
      if (col === 'families') {
        return { doc: vi.fn((fid: string) => familyDoc(fid)) };
      }
      throw new Error(`unexpected collection ${col}`);
    }),
    collectionGroup: vi.fn((group: string) => {
      if (group !== 'enrollments') throw new Error(`unexpected group ${group}`);
      return enrollmentGroup();
    }),
    batch: vi.fn(() => ({
      set: vi.fn((ref: { __collection: string; __id: string }, data: Json) => {
        batchOps.push({ ref, data });
      }),
      commit: vi.fn(async () => undefined),
    })),
  };

  return db;
}

// Future relative to a frozen-ish "today". The torontoToday() call inside the
// loader uses the real wall clock, so seed dates far in the future to stay
// future-only regardless of when this runs.
const FUTURE_A = '2099-11-08'; // November → birthMonth 11 matches
const FUTURE_B = '2099-11-22';
const PAST = '2000-09-07';

const seeds = (): Seeds => ({
  calendar: [
    { entryId: 'e1', location: 'Brampton', programKey: 'bala-vihar', date: FUTURE_A, kind: 'class', enabled: true, prasadNeeded: true },
    { entryId: 'e2', location: 'Brampton', programKey: 'bala-vihar', date: FUTURE_B, kind: 'class', enabled: true, prasadNeeded: true },
    // prasadNeeded:false → excluded
    { entryId: 'e3', location: 'Brampton', programKey: 'bala-vihar', date: '2099-12-06', kind: 'class', enabled: true, prasadNeeded: false },
    // past-dated → excluded
    { entryId: 'e4', location: 'Brampton', programKey: 'bala-vihar', date: PAST, kind: 'class', enabled: true, prasadNeeded: true },
    // no-class → excluded
    { entryId: 'e5', location: 'Brampton', programKey: 'bala-vihar', date: '2099-12-13', kind: 'no-class', enabled: true, prasadNeeded: true },
  ],
  families: [
    {
      fid: 'F-BDAY',
      name: 'Birthday Family',
      location: 'Brampton',
      enrolledMids: ['m1'],
      members: [
        { mid: 'm1', firstName: 'Asha', lastName: 'B', type: 'Child', schoolGrade: '3', birthMonth: 11, birthMonthYear: null },
      ],
    },
    {
      fid: 'F-NOMONTH',
      name: 'No Month Family',
      location: 'Brampton',
      enrolledMids: ['m2'],
      members: [
        { mid: 'm2', firstName: 'Ravi', lastName: 'N', type: 'Child', schoolGrade: '2', birthMonth: null, birthMonthYear: null },
      ],
    },
  ],
  enrollments: [
    { fid: 'F-BDAY', pid: 'bv-brampton-2025-26', location: 'Brampton', status: 'active', enrolledMids: ['m1'] },
    { fid: 'F-NOMONTH', pid: 'bv-brampton-2025-26', location: 'Brampton', status: 'active', enrolledMids: ['m2'] },
  ],
  assignments: [],
});

const PID = 'bv-brampton-2025-26';
const LOC = 'Brampton';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('previewAssignments — calendar eligibility filtering', () => {
  it('counts only class + enabled + prasadNeeded + future Sundays', async () => {
    const ops: BatchOp[] = [];
    mockFirestore.mockReturnValue(makeDb(seeds(), ops) as never);

    const res = await previewAssignments(PID, LOC);
    // Only e1 and e2 survive (e3 prasadNeeded:false, e4 past, e5 no-class).
    expect(res.eligibleSundayCount).toBe(2);
    // defaultCap = ceil(2 families / 2 sundays) = 1.
    expect(res.defaultCap).toBe(1);
    expect(res.cap).toBe(1);
  });

  it('assigns both families with correct reasons (birthday-month + no-birth-month)', async () => {
    const ops: BatchOp[] = [];
    mockFirestore.mockReturnValue(makeDb(seeds(), ops) as never);

    const res = await previewAssignments(PID, LOC);
    expect(res.rows).toHaveLength(2);
    expect(res.stats.families).toBe(2);

    const bday = res.rows.find((r) => r.fid === 'F-BDAY');
    expect(bday?.reason).toBe('birthday-month');
    expect(bday?.birthMonth).toBe(11);
    // Placed on a November Sunday.
    expect(bday?.date.slice(5, 7)).toBe('11');

    const noMonth = res.rows.find((r) => r.fid === 'F-NOMONTH');
    expect(noMonth?.reason).toBe('no-birth-month');
    expect(noMonth?.birthMonth).toBeNull();
  });
});

describe('publishAssignments', () => {
  it('writes deterministic paid ids + the full doc shape + a prasadConfig doc', async () => {
    const ops: BatchOp[] = [];
    mockFirestore.mockReturnValue(makeDb(seeds(), ops) as never);

    await publishAssignments(PID, LOC, 1, 'actor-mid');

    const assignWrites = ops.filter((o) => o.ref.__collection === 'prasadAssignments');
    expect(assignWrites).toHaveLength(2);
    expect(assignWrites.map((o) => o.ref.__id).sort()).toEqual(
      [`${PID}-F-BDAY`, `${PID}-F-NOMONTH`].sort(),
    );

    const bdayWrite = assignWrites.find((o) => o.ref.__id === `${PID}-F-BDAY`)!;
    expect(bdayWrite.data).toMatchObject({
      paid: `${PID}-F-BDAY`,
      pid: PID,
      fid: 'F-BDAY',
      familyName: 'Birthday Family',
      location: LOC,
      youngestMid: 'm1',
      birthMonth: 11,
      reason: 'birthday-month',
      source: 'auto',
      status: 'assigned',
      movedFrom: null,
      movedAt: null,
      movedBy: null,
      remindedAt: { weekBefore: null, twoDayBefore: null },
    });

    const configWrites = ops.filter((o) => o.ref.__collection === 'prasadConfig');
    expect(configWrites).toHaveLength(1);
    expect(configWrites[0]!.ref.__id).toBe(PID);
    expect(configWrites[0]!.data).toMatchObject({ pid: PID, capPerSunday: 1, publishedBy: 'actor-mid' });
  });

  it('keeps an existing assigned family and emits no new row for it', async () => {
    const ops: BatchOp[] = [];
    const withExisting = seeds();
    withExisting.assignments = [
      { paid: `${PID}-F-BDAY`, fid: 'F-BDAY', pid: PID, date: FUTURE_A, status: 'assigned' },
    ];
    mockFirestore.mockReturnValue(makeDb(withExisting, ops) as never);

    const res = await previewAssignments(PID, LOC);
    expect(res.stats.keptExisting).toBe(1);
    // Only the no-month family gets a NEW row; the existing one is excluded.
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.fid).toBe('F-NOMONTH');
  });
});
