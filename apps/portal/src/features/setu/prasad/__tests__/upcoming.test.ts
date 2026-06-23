import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
}));

// Pin "today" so the date>= filter is deterministic. The current periods mock
// keeps the test keyed to the Brampton + Scarborough pid pair.
vi.mock('../constants', async () => {
  const actual = await vi.importActual<typeof import('../constants')>('../constants');
  return { ...actual, torontoToday: () => '2026-03-01' };
});

vi.mock('../current-periods', () => ({
  getCurrentPrasadPeriods: vi.fn(async () => [
    { pid: 'bv-brampton-2025-26', location: 'Brampton' },
    { pid: 'bv-scarborough-2025-26', location: 'Scarborough' },
  ]),
}));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getUpcomingPrasad } from '../upcoming';

const mockFirestore = vi.mocked(portalFirestore);

type Json = Record<string, unknown>;

interface AssignmentSeed {
  pid: string;
  fid: string;
  familyName: string;
  date: string;
  status: string;
}

interface MemberSeed {
  mid: string;
  manager?: boolean;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
}

interface Seeds {
  assignments: AssignmentSeed[];
  membersByFid: Record<string, MemberSeed[]>;
}

// Capture every where()/orderBy()/limit() against prasadAssignments so the
// test can assert the query is backed by the (pid,date) index.
interface Captured {
  where: Array<{ field: string; op: string; value: unknown }>;
  orderBy: Array<{ field: string; dir: string }>;
  limit: number | null;
  lastPid: string | null;
}

function makeDb(seeds: Seeds, captured: Captured) {
  function assignmentsQuery(state: { pid: string | null }) {
    const q = {
      where: vi.fn((field: string, op: string, value: unknown) => {
        captured.where.push({ field, op, value });
        if (field === 'pid') { state.pid = value as string; captured.lastPid = value as string; }
        return q;
      }),
      orderBy: vi.fn((field: string, dir: string) => {
        captured.orderBy.push({ field, dir });
        return q;
      }),
      limit: vi.fn((n: number) => {
        captured.limit = n;
        return q;
      }),
      get: vi.fn(async () => {
        const today = captured.where.find((w) => w.field === 'date')?.value as string | undefined;
        const rows = seeds.assignments
          .filter((a) => a.pid === state.pid)
          .filter((a) => (today ? a.date >= today : true))
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, captured.limit ?? undefined)
          .map((a) => ({ data: (): Json => ({ ...a }) }));
        return { docs: rows };
      }),
    };
    return q;
  }

  function familyDoc(fid: string) {
    return {
      collection: vi.fn((sub: string) => {
        if (sub !== 'members') throw new Error(`unexpected subcollection ${sub}`);
        const membersQ = {
          where: vi.fn((field: string, _op: string, value: unknown) => {
            if (field !== 'manager' || value !== true) {
              throw new Error(`unexpected members filter ${field}=${String(value)}`);
            }
            return membersQ;
          }),
          get: vi.fn(async () => {
            const managers = (seeds.membersByFid[fid] ?? []).filter((m) => m.manager === true);
            return { docs: managers.map((m) => ({ id: m.mid, data: (): Json => ({ ...m }) })) };
          }),
        };
        return membersQ;
      }),
    };
  }

  return {
    collection: vi.fn((col: string) => {
      if (col === 'prasadAssignments') return assignmentsQuery({ pid: null });
      if (col === 'families') return { doc: vi.fn((fid: string) => familyDoc(fid)) };
      throw new Error(`unexpected collection ${col}`);
    }),
  };
}

function freshCaptured(): Captured {
  return { where: [], orderBy: [], limit: null, lastPid: null };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getUpcomingPrasad', () => {
  it('groups assignments by date, takes the first 4 Sundays per location, joins manager contacts', async () => {
    const captured = freshCaptured();
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            // Brampton — 5 distinct future Sundays; only the first 4 should survive.
            { pid: 'bv-brampton-2025-26', fid: 'F1', familyName: 'Sharma', date: '2026-03-08', status: 'assigned' },
            { pid: 'bv-brampton-2025-26', fid: 'F2', familyName: 'Patel', date: '2026-03-08', status: 'assigned' },
            { pid: 'bv-brampton-2025-26', fid: 'F3', familyName: 'Iyer', date: '2026-03-15', status: 'assigned' },
            { pid: 'bv-brampton-2025-26', fid: 'F4', familyName: 'Rao', date: '2026-03-22', status: 'assigned' },
            { pid: 'bv-brampton-2025-26', fid: 'F5', familyName: 'Nair', date: '2026-03-29', status: 'assigned' },
            { pid: 'bv-brampton-2025-26', fid: 'F6', familyName: 'Bose', date: '2026-04-05', status: 'assigned' },
            // Scarborough — one Sunday.
            { pid: 'bv-scarborough-2025-26', fid: 'S1', familyName: 'Kumar', date: '2026-03-15', status: 'assigned' },
          ],
          membersByFid: {
            F1: [{ mid: 'F1-01', manager: true, firstName: 'Asha', lastName: 'Sharma', email: 'asha@x.com', phone: '(416) 555-1212' }],
            F2: [{ mid: 'F2-01', manager: true, firstName: 'Ravi', lastName: 'Patel', email: null, phone: '(905) 555-0000' }],
            F3: [{ mid: 'F3-01', manager: true, firstName: 'Meena', lastName: 'Iyer', email: 'meena@x.com', phone: null }],
            F4: [{ mid: 'F4-01', manager: true, firstName: 'Sita', lastName: 'Rao', email: 'sita@x.com', phone: '111' }],
            F5: [{ mid: 'F5-01', manager: true, firstName: 'Gita', lastName: 'Nair', email: 'gita@x.com', phone: '222' }],
            F6: [{ mid: 'F6-01', manager: true, firstName: 'Hari', lastName: 'Bose', email: 'hari@x.com', phone: '333' }],
            S1: [{ mid: 'S1-01', manager: true, firstName: 'Anil', lastName: 'Kumar', email: 'anil@x.com', phone: '444' }],
          },
        },
        captured,
      ) as never,
    );

    const result = await getUpcomingPrasad();

    // (pid,date) index shape: pid== then date>= then orderBy date asc.
    expect(captured.where).toContainEqual({ field: 'pid', op: '==', value: expect.any(String) });
    expect(captured.where).toContainEqual({ field: 'date', op: '>=', value: '2026-03-01' });
    expect(captured.orderBy).toContainEqual({ field: 'date', dir: 'asc' });
    expect(captured.limit).toBe(60);

    expect(result.locations.map((l) => l.location)).toEqual(['Brampton', 'Scarborough']);

    const brampton = result.locations[0]!;
    // First 4 distinct Sundays only — 04-05 dropped.
    expect(brampton.sundays.map((s) => s.date)).toEqual(['2026-03-08', '2026-03-15', '2026-03-22', '2026-03-29']);
    // 03-08 has two families.
    expect(brampton.sundays[0]!.families.map((f) => f.fid)).toEqual(['F1', 'F2']);

    // Contact join — null parts preserved for the page to omit.
    const sharma = brampton.sundays[0]!.families[0]!;
    expect(sharma.contacts).toEqual([
      { name: 'Asha Sharma', email: 'asha@x.com', phone: '(416) 555-1212' },
    ]);
    const patel = brampton.sundays[0]!.families[1]!;
    expect(patel.contacts).toEqual([
      { name: 'Ravi Patel', email: null, phone: '(905) 555-0000' },
    ]);

    const scarborough = result.locations[1]!;
    expect(scarborough.sundays.map((s) => s.date)).toEqual(['2026-03-15']);
    expect(scarborough.sundays[0]!.families[0]!.contacts[0]!.name).toBe('Anil Kumar');
  });

  it('keeps proposed rows sorted after assigned within a Sunday; cancelled still excluded', async () => {
    const captured = freshCaptured();
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            // Proposed seeded FIRST so the confirmed-first sort must reorder it.
            { pid: 'bv-brampton-2025-26', fid: 'F2', familyName: 'Patel', date: '2026-03-08', status: 'proposed' },
            { pid: 'bv-brampton-2025-26', fid: 'F1', familyName: 'Sharma', date: '2026-03-08', status: 'assigned' },
            { pid: 'bv-brampton-2025-26', fid: 'F3', familyName: 'Iyer', date: '2026-03-08', status: 'cancelled' },
          ],
          membersByFid: {
            F1: [{ mid: 'F1-01', manager: true, firstName: 'Asha', lastName: 'Sharma', email: 'asha@x.com', phone: null }],
            F2: [{ mid: 'F2-01', manager: true, firstName: 'Ravi', lastName: 'Patel', email: 'ravi@x.com', phone: null }],
          },
        },
        captured,
      ) as never,
    );

    const result = await getUpcomingPrasad();
    const families = result.locations[0]!.sundays[0]!.families;
    expect(families.map((f) => f.status)).toEqual(['assigned', 'proposed']);
    // Cancelled F3 never makes it into the Sunday.
    expect(families.map((f) => f.fid)).toEqual(['F1', 'F2']);
  });

  it('filters out cancelled/moved rows before grouping', async () => {
    const captured = freshCaptured();
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            { pid: 'bv-brampton-2025-26', fid: 'F1', familyName: 'Sharma', date: '2026-03-08', status: 'cancelled' },
            { pid: 'bv-brampton-2025-26', fid: 'F2', familyName: 'Patel', date: '2026-03-08', status: 'assigned' },
          ],
          membersByFid: {
            F2: [{ mid: 'F2-01', manager: true, firstName: 'Ravi', lastName: 'Patel', email: 'ravi@x.com', phone: null }],
          },
        },
        captured,
      ) as never,
    );

    const result = await getUpcomingPrasad();
    const brampton = result.locations[0]!;
    expect(brampton.sundays).toHaveLength(1);
    expect(brampton.sundays[0]!.families.map((f) => f.fid)).toEqual(['F2']);
  });

  it('returns an empty sundays array for a location with no upcoming assigned rows', async () => {
    const captured = freshCaptured();
    mockFirestore.mockReturnValue(
      makeDb({ assignments: [], membersByFid: {} }, captured) as never,
    );

    const result = await getUpcomingPrasad();
    expect(result.locations).toHaveLength(2);
    for (const loc of result.locations) {
      expect(loc.sundays).toEqual([]);
    }
  });

  it('builds a contact name even when lastName is missing (null-safe), and tolerates a family with no managers', async () => {
    const captured = freshCaptured();
    mockFirestore.mockReturnValue(
      makeDb(
        {
          assignments: [
            { pid: 'bv-brampton-2025-26', fid: 'F1', familyName: 'Sharma', date: '2026-03-08', status: 'assigned' },
            { pid: 'bv-brampton-2025-26', fid: 'F2', familyName: 'Nomanager', date: '2026-03-08', status: 'assigned' },
          ],
          membersByFid: {
            F1: [{ mid: 'F1-01', manager: true, firstName: 'Asha', email: 'asha@x.com', phone: null }],
            // F2 has only a non-manager member → no contacts.
            F2: [{ mid: 'F2-01', manager: false, firstName: 'Kid', lastName: 'Sharma' }],
          },
        },
        captured,
      ) as never,
    );

    const result = await getUpcomingPrasad();
    const families = result.locations[0]!.sundays[0]!.families;
    const f1 = families.find((f) => f.fid === 'F1')!;
    expect(f1.contacts).toEqual([{ name: 'Asha', email: 'asha@x.com', phone: null }]);
    const f2 = families.find((f) => f.fid === 'F2')!;
    expect(f2.contacts).toEqual([]);
  });
});
