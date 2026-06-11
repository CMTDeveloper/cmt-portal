import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
  FieldValue: { serverTimestamp: () => '__ts__' },
}));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getFamilyAssignment, getMoveOptions, moveAssignment, confirmAssignment } from '../family-assignment';
import { FALLBACK_CAP } from '../constants';

const mockFirestore = vi.mocked(portalFirestore);

type Json = Record<string, unknown>;

/** Real-today-relative YYYY-MM-DD. Prod code stays Toronto-aware; tests just
 *  need dates that fall on the correct side of the lock window regardless of
 *  when they run. */
function ymdPlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

interface CalendarSeed {
  entryId: string;
  location: string;
  programKey: string;
  date: string;
  kind: string;
  enabled?: boolean;
  prasadNeeded?: boolean;
}

interface AssignmentSeed {
  paid: string;
  fid: string;
  pid: string;
  date: string;
  status: string;
  youngestName?: string | null;
  birthMonth?: number | null;
  reason?: string;
}

interface ConfigSeed {
  pid: string;
  capPerSunday: number;
}

interface Seeds {
  calendar: CalendarSeed[];
  assignments: AssignmentSeed[];
  config: ConfigSeed[];
}

interface QuerySnap {
  docs: Array<{ id: string; data: () => Json }>;
}

interface DocSnap {
  exists: boolean;
  id: string;
  data: () => Json | undefined;
}

interface UpdateOp {
  collection: string;
  id: string;
  data: Json;
}

function assignmentDoc(seeds: Seeds, paid: string): Json | undefined {
  const a = seeds.assignments.find((x) => x.paid === paid);
  if (!a) return undefined;
  return {
    pid: a.pid,
    fid: a.fid,
    date: a.date,
    youngestName: a.youngestName ?? null,
    birthMonth: a.birthMonth ?? null,
    reason: a.reason ?? 'no-birth-month',
    status: a.status,
  };
}

function makeDb(seeds: Seeds, updateOps: UpdateOp[], opts: { capInTxn?: number; txnDateOverride?: string } = {}) {
  // Captures the where filters on a prasadAssignments query so the same query
  // object resolves correctly whether read via .get() or tx.get().
  function assignmentsQuery() {
    let pid: string | undefined;
    let date: string | undefined;
    const q = {
      where: vi.fn((field: string, _op: string, value: unknown) => {
        if (field === 'pid') pid = String(value);
        if (field === 'date') date = String(value);
        return q;
      }),
      get: vi.fn(async (): Promise<QuerySnap> => resolveAssignments(seeds, pid, date)),
      __resolve: (): QuerySnap => resolveAssignments(seeds, pid, date),
    };
    return q;
  }

  function resolveAssignments(s: Seeds, pid: string | undefined, date: string | undefined): QuerySnap {
    const rows = s.assignments
      .filter((a) => (pid ? a.pid === pid : true) && (date ? a.date === date : true))
      .map((a) => ({ id: a.paid, data: (): Json => ({ fid: a.fid, date: a.date, status: a.status }) }));
    return { docs: rows };
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
            data: (): Json => ({ date: c.date, kind: c.kind, enabled: c.enabled, prasadNeeded: c.prasadNeeded }),
          }));
        return { docs: rows };
      }),
    };
    return q;
  }

  function assignmentDocRef(id: string) {
    return {
      __collection: 'prasadAssignments',
      __id: id,
      get: vi.fn(async (): Promise<DocSnap> => {
        const data = assignmentDoc(seeds, id);
        return { exists: data !== undefined, id, data: () => data };
      }),
    };
  }

  function configDocRef(id: string) {
    return {
      get: vi.fn(async (): Promise<DocSnap> => {
        const c = seeds.config.find((x) => x.pid === id);
        return { exists: c !== undefined, id, data: () => (c ? { capPerSunday: c.capPerSunday } : undefined) };
      }),
    };
  }

  const db = {
    collection: vi.fn((col: string) => {
      if (col === 'classCalendarEntries') return calendarQuery();
      if (col === 'prasadAssignments') {
        const api = assignmentsQuery() as ReturnType<typeof assignmentsQuery> & {
          doc: (id: string) => ReturnType<typeof assignmentDocRef>;
        };
        api.doc = vi.fn((id: string) => assignmentDocRef(id));
        return api;
      }
      if (col === 'prasadConfig') {
        return { doc: vi.fn((id: string) => configDocRef(id)) };
      }
      throw new Error(`unexpected collection ${col}`);
    }),
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: vi.fn(async (
          arg: { __resolve?: () => QuerySnap; __collection?: string; __id?: string },
        ): Promise<QuerySnap | DocSnap> => {
          // Doc-ref branch: resolve the same way assignmentDocRef(...).get() does.
          // txnDateOverride simulates a concurrent admin move: the doc read INSIDE
          // the txn carries a different date than the outside read.
          if (arg.__collection === 'prasadAssignments' && typeof arg.__id === 'string') {
            const data = assignmentDoc(seeds, arg.__id);
            const txnData = data !== undefined && opts.txnDateOverride !== undefined
              ? { ...data, date: opts.txnDateOverride }
              : data;
            return { exists: txnData !== undefined, id: arg.__id, data: () => txnData };
          }
          if (typeof arg.__resolve !== 'function') throw new Error('tx.get on a non-query');
          const snap = arg.__resolve();
          if (opts.capInTxn !== undefined) {
            // Simulate the target Sunday filling up between read and txn: fabricate
            // `capInTxn` assigned docs on the target date.
            const filler = Array.from({ length: opts.capInTxn }, (_, i) => ({
              id: `filler-${i}`,
              data: (): Json => ({ status: 'assigned' }),
            }));
            return { docs: filler };
          }
          return snap;
        }),
        update: vi.fn((ref: { __collection: string; __id: string }, data: Json) => {
          updateOps.push({ collection: ref.__collection, id: ref.__id, data });
        }),
      };
      return fn(tx);
    }),
  };

  return db;
}

const PID = 'bv-brampton-2025-26';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getFamilyAssignment', () => {
  it('returns the view for an assigned family in the first pid, movable when far out', async () => {
    const seeds: Seeds = {
      calendar: [],
      config: [],
      assignments: [
        {
          paid: `${PID}-F-1`, fid: 'F-1', pid: PID, date: ymdPlus(30), status: 'assigned',
          youngestName: 'Asha', birthMonth: 11, reason: 'birthday-month',
        },
      ],
    };
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);

    const view = await getFamilyAssignment('F-1');
    expect(view).not.toBeNull();
    expect(view).toMatchObject({
      paid: `${PID}-F-1`,
      pid: PID,
      date: ymdPlus(30),
      youngestName: 'Asha',
      birthMonth: 11,
      reason: 'birthday-month',
      status: 'assigned',
      movable: true,
    });
  });

  it('is not movable inside the lock window (today+3)', async () => {
    const seeds: Seeds = {
      calendar: [],
      config: [],
      assignments: [
        { paid: `${PID}-F-1`, fid: 'F-1', pid: PID, date: ymdPlus(3), status: 'assigned' },
      ],
    };
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);

    const view = await getFamilyAssignment('F-1');
    expect(view?.movable).toBe(false);
  });

  it('returns null for a cancelled (non-assigned) assignment', async () => {
    const seeds: Seeds = {
      calendar: [],
      config: [],
      assignments: [
        { paid: `${PID}-F-1`, fid: 'F-1', pid: PID, date: ymdPlus(30), status: 'cancelled' },
      ],
    };
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);

    expect(await getFamilyAssignment('F-1')).toBeNull();
  });

  it('returns null when the family has no assignment in either pid', async () => {
    const seeds: Seeds = { calendar: [], config: [], assignments: [] };
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);

    expect(await getFamilyAssignment('F-NONE')).toBeNull();
  });
});

describe('getMoveOptions', () => {
  function moveSeeds(): Seeds {
    return {
      config: [{ pid: PID, capPerSunday: 2 }],
      assignments: [
        // current assignment, far enough out to be movable
        { paid: `${PID}-F-1`, fid: 'F-1', pid: PID, date: ymdPlus(60), status: 'assigned' },
        // fills the "full" candidate date to its cap of 2
        { paid: `${PID}-F-x1`, fid: 'F-x1', pid: PID, date: ymdPlus(40), status: 'assigned' },
        { paid: `${PID}-F-x2`, fid: 'F-x2', pid: PID, date: ymdPlus(40), status: 'assigned' },
        // one assigned on the open candidate (seatsLeft should be cap - 1 = 1)
        { paid: `${PID}-F-x3`, fid: 'F-x3', pid: PID, date: ymdPlus(20), status: 'assigned' },
        // a cancelled doc on the open date must NOT count against capacity
        { paid: `${PID}-F-x4`, fid: 'F-x4', pid: PID, date: ymdPlus(20), status: 'cancelled' },
      ],
      calendar: [
        // current date → excluded
        { entryId: 'cur', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(60), kind: 'class', enabled: true, prasadNeeded: true },
        // open future date → included, seatsLeft 1
        { entryId: 'open', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(20), kind: 'class', enabled: true, prasadNeeded: true },
        // a second open date, further out → included, sorts after the first
        { entryId: 'open2', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(30), kind: 'class', enabled: true, prasadNeeded: true },
        // full date (count >= cap) → excluded
        { entryId: 'full', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(40), kind: 'class', enabled: true, prasadNeeded: true },
        // inside lock window (today+5) → excluded
        { entryId: 'locked', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(5), kind: 'class', enabled: true, prasadNeeded: true },
        // prasadNeeded:false → excluded
        { entryId: 'noprasad', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(25), kind: 'class', enabled: true, prasadNeeded: false },
        // no-class → excluded
        { entryId: 'noclass', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(35), kind: 'no-class', enabled: true, prasadNeeded: true },
      ],
    };
  }

  it('returns sorted open options excluding current/locked/full/no-prasad/no-class dates', async () => {
    mockFirestore.mockReturnValue(makeDb(moveSeeds(), []) as never);

    const result = await getMoveOptions('F-1');
    expect(result).not.toBeNull();
    expect(result!.paid).toBe(`${PID}-F-1`);
    expect(result!.options).toEqual([
      { date: ymdPlus(20), seatsLeft: 1 },
      { date: ymdPlus(30), seatsLeft: 2 },
    ]);
  });

  it('returns null when the family has no current assignment', async () => {
    const seeds: Seeds = { calendar: [], config: [], assignments: [] };
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);

    expect(await getMoveOptions('F-NONE')).toBeNull();
  });

  it('uses FALLBACK_CAP when prasadConfig doc is missing', async () => {
    // Same shape as the happy-path fixtures but config is empty (doc.exists === false).
    // With FALLBACK_CAP (10) as the cap, a date carrying 9 assigned families has
    // seatsLeft 1; a date with 0 assigned has seatsLeft FALLBACK_CAP.
    const seeds: Seeds = {
      config: [], // no prasadConfig doc → FALLBACK_CAP kicks in
      assignments: [
        // current assignment
        { paid: `${PID}-F-1`, fid: 'F-1', pid: PID, date: ymdPlus(60), status: 'assigned' },
        // open date with 9 assigned → seatsLeft = FALLBACK_CAP - 9 = 1
        ...Array.from({ length: 9 }, (_, i) => ({
          paid: `${PID}-F-fill-${i}`, fid: `F-fill-${i}`, pid: PID,
          date: ymdPlus(20), status: 'assigned',
        })),
      ],
      calendar: [
        { entryId: 'cur', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(60), kind: 'class', enabled: true, prasadNeeded: true },
        // open date with 9 taken → 1 seat left
        { entryId: 'open', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(20), kind: 'class', enabled: true, prasadNeeded: true },
        // open date with 0 taken → FALLBACK_CAP seats left
        { entryId: 'open2', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(30), kind: 'class', enabled: true, prasadNeeded: true },
      ],
    };
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);

    const result = await getMoveOptions('F-1');
    expect(result).not.toBeNull();
    expect(result!.options).toEqual([
      { date: ymdPlus(20), seatsLeft: 1 },
      { date: ymdPlus(30), seatsLeft: FALLBACK_CAP },
    ]);
  });
});

describe('moveAssignment', () => {
  function happySeeds(): Seeds {
    return {
      config: [{ pid: PID, capPerSunday: 2 }],
      assignments: [
        { paid: `${PID}-F-1`, fid: 'F-1', pid: PID, date: ymdPlus(60), status: 'assigned' },
      ],
      calendar: [
        { entryId: 'cur', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(60), kind: 'class', enabled: true, prasadNeeded: true },
        { entryId: 'tgt', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(20), kind: 'class', enabled: true, prasadNeeded: true },
      ],
    };
  }

  it('happy path: updates the doc and returns "moved"', async () => {
    const ops: UpdateOp[] = [];
    mockFirestore.mockReturnValue(makeDb(happySeeds(), ops) as never);

    const result = await moveAssignment('F-1', ymdPlus(20), 'actor-mid');
    expect(result).toBe('moved');
    expect(ops).toHaveLength(1);
    expect(ops[0]!.collection).toBe('prasadAssignments');
    expect(ops[0]!.id).toBe(`${PID}-F-1`);
    expect(ops[0]!.data).toMatchObject({
      date: ymdPlus(20),
      movedFrom: ymdPlus(60),
      movedBy: 'actor-mid',
      source: 'family-move',
    });
  });

  it('returns "not-found" when there is no assignment', async () => {
    const ops: UpdateOp[] = [];
    mockFirestore.mockReturnValue(makeDb({ calendar: [], config: [], assignments: [] }, ops) as never);

    expect(await moveAssignment('F-NONE', ymdPlus(20), 'actor-mid')).toBe('not-found');
    expect(ops).toHaveLength(0);
  });

  it('returns "locked" for an assignment inside the lock window without touching the txn', async () => {
    const ops: UpdateOp[] = [];
    const seeds = happySeeds();
    seeds.assignments[0]!.date = ymdPlus(3);
    seeds.calendar[0]!.date = ymdPlus(3);
    const db = makeDb(seeds, ops);
    mockFirestore.mockReturnValue(db as never);

    expect(await moveAssignment('F-1', ymdPlus(20), 'actor-mid')).toBe('locked');
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it('returns "invalid-target" when the target is not an open option', async () => {
    const ops: UpdateOp[] = [];
    const db = makeDb(happySeeds(), ops);
    mockFirestore.mockReturnValue(db as never);

    // ymdPlus(99) is not in the calendar / not an option
    expect(await moveAssignment('F-1', ymdPlus(99), 'actor-mid')).toBe('invalid-target');
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it('returns "target-full" with NO update when the txn sees the cap reached', async () => {
    const ops: UpdateOp[] = [];
    // capInTxn:2 makes tx.get see exactly cap (2) assigned docs on the target.
    mockFirestore.mockReturnValue(makeDb(happySeeds(), ops, { capInTxn: 2 }) as never);

    const result = await moveAssignment('F-1', ymdPlus(20), 'actor-mid');
    expect(result).toBe('target-full');
    expect(ops).toHaveLength(0);
  });
});

describe('proposed-status handling', () => {
  it('getFamilyAssignment returns a proposed doc (status surfaced)', async () => {
    const seeds: Seeds = {
      calendar: [],
      config: [{ pid: 'bv-brampton-2025-26', capPerSunday: 10 }],
      assignments: [{
        paid: 'bv-brampton-2025-26-F1', fid: 'F1', pid: 'bv-brampton-2025-26',
        date: ymdPlus(30), status: 'proposed', reason: 'birthday-month', youngestName: 'Anu', birthMonth: 6,
      }],
    };
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);
    const view = await getFamilyAssignment('F1');
    expect(view?.status).toBe('proposed');
  });

  it('getMoveOptions counts proposed rows against the cap', async () => {
    const target = ymdPlus(30);
    const seeds: Seeds = {
      calendar: [
        { entryId: 'c1', location: 'Brampton', programKey: 'bala-vihar', date: target, kind: 'class' },
        { entryId: 'c2', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(37), kind: 'class' },
      ],
      config: [{ pid: 'bv-brampton-2025-26', capPerSunday: 1 }],
      assignments: [
        { paid: 'bv-brampton-2025-26-F1', fid: 'F1', pid: 'bv-brampton-2025-26', date: ymdPlus(37), status: 'assigned' },
        { paid: 'bv-brampton-2025-26-F2', fid: 'F2', pid: 'bv-brampton-2025-26', date: target, status: 'proposed' },
      ],
    };
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);
    const opts = await getMoveOptions('F1');
    expect(opts!.options.find((o) => o.date === target)).toBeUndefined(); // full
  });

  it('a PROPOSED family sees near-term Sundays (no 7-day lock) but never past ones', async () => {
    const near = ymdPlus(3);
    const seeds: Seeds = {
      calendar: [
        { entryId: 'c1', location: 'Brampton', programKey: 'bala-vihar', date: near, kind: 'class' },
        { entryId: 'c2', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(-7), kind: 'class' },
      ],
      config: [{ pid: 'bv-brampton-2025-26', capPerSunday: 10 }],
      assignments: [{
        paid: 'bv-brampton-2025-26-F1', fid: 'F1', pid: 'bv-brampton-2025-26',
        date: ymdPlus(30), status: 'proposed',
      }],
    };
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);
    const opts = await getMoveOptions('F1');
    expect(opts!.options.map((o) => o.date)).toEqual([near]);
  });

  it('moveAssignment counts proposed rows in the txn cap check', async () => {
    const target = ymdPlus(30);
    const updateOps: UpdateOp[] = [];
    const seeds: Seeds = {
      calendar: [
        { entryId: 'c1', location: 'Brampton', programKey: 'bala-vihar', date: target, kind: 'class' },
        { entryId: 'c2', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(44), kind: 'class' },
      ],
      config: [{ pid: 'bv-brampton-2025-26', capPerSunday: 1 }],
      assignments: [
        { paid: 'bv-brampton-2025-26-F1', fid: 'F1', pid: 'bv-brampton-2025-26', date: ymdPlus(44), status: 'assigned' },
        { paid: 'bv-brampton-2025-26-F2', fid: 'F2', pid: 'bv-brampton-2025-26', date: target, status: 'proposed' },
      ],
    };
    mockFirestore.mockReturnValue(makeDb(seeds, updateOps, { capInTxn: 1 }) as never);
    expect(await moveAssignment('F1', target, 'M1')).toBe('invalid-target');
    expect(updateOps).toHaveLength(0);
  });
});

describe('confirmAssignment', () => {
  function proposedSeeds(extra: AssignmentSeed[] = []): Seeds {
    return {
      calendar: [
        { entryId: 'c1', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(30), kind: 'class' },
        { entryId: 'c2', location: 'Brampton', programKey: 'bala-vihar', date: ymdPlus(37), kind: 'class' },
      ],
      config: [{ pid: PID, capPerSunday: 2 }],
      assignments: [
        { paid: `${PID}-F1`, fid: 'F1', pid: PID, date: ymdPlus(30), status: 'proposed' },
        ...extra,
      ],
    };
  }

  it('confirms in place (no date): status flip, confirmedBy family', async () => {
    const updateOps: UpdateOp[] = [];
    mockFirestore.mockReturnValue(makeDb(proposedSeeds(), updateOps) as never);
    expect(await confirmAssignment('F1', undefined, 'M1')).toBe('confirmed');
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0]!.data).toMatchObject({ status: 'assigned', confirmedBy: 'family' });
    expect(updateOps[0]!.data.date).toBeUndefined();
  });

  it('confirms at another open Sunday: date moves + flip in one update', async () => {
    const updateOps: UpdateOp[] = [];
    mockFirestore.mockReturnValue(makeDb(proposedSeeds(), updateOps) as never);
    expect(await confirmAssignment('F1', ymdPlus(37), 'M1')).toBe('confirmed');
    expect(updateOps[0]!.data).toMatchObject({
      status: 'assigned', confirmedBy: 'family', date: ymdPlus(37), source: 'family-move',
    });
  });

  it('rejects a full target Sunday', async () => {
    const updateOps: UpdateOp[] = [];
    const seeds = proposedSeeds([
      { paid: `${PID}-F2`, fid: 'F2', pid: PID, date: ymdPlus(37), status: 'assigned' },
      { paid: `${PID}-F3`, fid: 'F3', pid: PID, date: ymdPlus(37), status: 'proposed' },
    ]);
    mockFirestore.mockReturnValue(makeDb(seeds, updateOps) as never);
    expect(await confirmAssignment('F1', ymdPlus(37), 'M1')).toBe('invalid-target');
    expect(updateOps).toHaveLength(0);
  });

  it('already-confirmed when the doc is assigned', async () => {
    const seeds: Seeds = { ...proposedSeeds() };
    seeds.assignments[0]!.status = 'assigned';
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);
    expect(await confirmAssignment('F1', undefined, 'M1')).toBe('already-confirmed');
  });

  it('not-found without any doc', async () => {
    mockFirestore.mockReturnValue(makeDb({ calendar: [], config: [], assignments: [] }, []) as never);
    expect(await confirmAssignment('F9', undefined, 'M1')).toBe('not-found');
  });

  it('rejects in-place confirm when the doc date changed underneath (admin moved it)', async () => {
    const updateOps: UpdateOp[] = [];
    // The in-txn read returns a DIFFERENT date than the outside read — the admin
    // reassign route changed `date` without changing `status` in between.
    mockFirestore.mockReturnValue(
      makeDb(proposedSeeds(), updateOps, { txnDateOverride: ymdPlus(37) }) as never,
    );
    expect(await confirmAssignment('F1', undefined, 'M1')).toBe('invalid-target');
    expect(updateOps).toHaveLength(0);
  });

  it('rejects in-place confirm of a past proposed date', async () => {
    const seeds = proposedSeeds();
    seeds.assignments[0]!.date = ymdPlus(-3);
    mockFirestore.mockReturnValue(makeDb(seeds, []) as never);
    expect(await confirmAssignment('F1', undefined, 'M1')).toBe('invalid-target');
  });
});
