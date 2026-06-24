import { describe, it, expect, vi, beforeEach } from 'vitest';

const flagsMock = vi.hoisted(() => ({ setuAuth: true }));
vi.mock('@/lib/flags', () => ({ flags: flagsMock }));

// ── prasad engine mocks ───────────────────────────────────────────────────────
const { previewAssignments, publishAssignments } = vi.hoisted(() => ({
  previewAssignments: vi.fn(),
  publishAssignments: vi.fn(),
}));
vi.mock('@/features/setu/prasad/publish-assignments', () => ({ previewAssignments, publishAssignments }));

const { notifyUnnotifiedProposals } = vi.hoisted(() => ({ notifyUnnotifiedProposals: vi.fn() }));
vi.mock('@/features/setu/prasad/proposal-notify', () => ({ notifyUnnotifiedProposals }));

// Routes resolve the request pid against the pid's OWN year via
// findPrasadPeriodForPid (not the live-year-only findCurrentPrasadPeriod), so
// preparing-year pids resolve. Mock returns a period for any well-formed
// bv-* pid; the live/past distinction is enforced by assertWritableYear on the
// WRITE routes (which reads the mocked getSchoolYearConfig below).
const { findPrasadPeriodForPid } = vi.hoisted(() => ({
  findPrasadPeriodForPid: vi.fn(async (_db: unknown, pid: string) =>
    /^bv-brampton-\d{4}-\d{2}$/.test(pid) ? { pid, location: 'Brampton' } : null,
  ),
}));
vi.mock('@/features/setu/prasad/current-periods', () => ({ findPrasadPeriodForPid }));

// The publish past-year guard resolves the live year via getSchoolYearConfig.
const { getSchoolYearConfig } = vi.hoisted(() => ({ getSchoolYearConfig: vi.fn() }));
vi.mock('@/features/setu/rollover/school-year-config', () => ({ getSchoolYearConfig }));

// ── fake Firestore ────────────────────────────────────────────────────────────
// Supports collection().where().where().get() (list), collection().doc().get()/
// .update() (patch), runTransaction with tx.get(docRef)/tx.update(docRef, patch),
// and per-doc preconditioned ref.update(patch, { lastUpdateTime }) on list docs.
const SERVER_TS = { __serverTimestamp: true };
class FakeTimestamp {
  constructor(private iso: string) {}
  toDate(): Date {
    return new Date(this.iso);
  }
}
const { dbState } = vi.hoisted(() => ({
  dbState: {
    listDocs: [] as Array<{
      data: () => Record<string, unknown>;
      updateTime?: string;
      ref?: { id: string; update?: (patch: Record<string, unknown>, precondition?: unknown) => Promise<void> };
    }>,
    docStore: new Map<string, Record<string, unknown> | undefined>(),
    lastWhere: [] as Array<[string, string, unknown]>,
    lastUpdate: undefined as Record<string, unknown> | undefined,
    updatedDocId: undefined as string | undefined,
    batchUpdates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    batchCommits: 0,
    // ref.update(patch, precondition) calls recorded by list-doc refs (assign-remaining).
    refUpdates: [] as Array<{ id: string; patch: Record<string, unknown>; precondition: unknown }>,
    // List-doc ids whose preconditioned ref.update should reject (concurrent change).
    failUpdateIds: new Set<string>(),
    // Doc ids that "vanish" between an outer get and a tx.get (assign TOCTOU).
    txVanishIds: new Set<string>(),
  },
}));

function makeCollection() {
  function makeQuery() {
    return {
      where(field: string, op: string, value: unknown) {
        dbState.lastWhere.push([field, op, value]);
        return makeQuery();
      },
      async get() {
        return { docs: dbState.listDocs, size: dbState.listDocs.length };
      },
    };
  }
  return {
    where: (field: string, op: string, value: unknown) => makeQuery().where(field, op, value),
    doc(id: string) {
      return {
        id,
        async get() {
          const data = dbState.docStore.get(id);
          return {
            exists: dbState.docStore.has(id) && data !== undefined,
            data: () => data,
          };
        },
        async update(patch: Record<string, unknown>) {
          dbState.updatedDocId = id;
          dbState.lastUpdate = patch;
        },
      };
    },
  };
}

function makeBatch() {
  return {
    update(ref: { id: string }, patch: Record<string, unknown>) {
      dbState.batchUpdates.push({ id: ref.id, patch });
    },
    async commit() {
      dbState.batchCommits++;
    },
  };
}

function makeTx() {
  return {
    async get(ref: { id: string }) {
      const gone = dbState.txVanishIds.has(ref.id);
      const data = gone ? undefined : dbState.docStore.get(ref.id);
      return {
        exists: !gone && dbState.docStore.has(ref.id) && data !== undefined,
        data: () => data,
      };
    },
    update(ref: { id: string }, patch: Record<string, unknown>) {
      dbState.updatedDocId = ref.id;
      dbState.lastUpdate = patch;
    },
  };
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: () => makeCollection(),
    batch: makeBatch,
    runTransaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> => fn(makeTx()),
  }),
  FieldValue: { serverTimestamp: () => SERVER_TS },
}));

const PID = 'bv-brampton-2025-26';
const PREVIEW_RESULT = {
  rows: [{ fid: 'CMT-0001', familyName: 'Iyer', location: 'Brampton', date: '2026-03-15' }],
  defaultCap: 3,
  eligibleSundayCount: 20,
};

function req(path: string, init: { method: string; body?: unknown; headers?: Record<string, string> }): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers ?? {}) };
  return new Request(`https://x${path}`, {
    method: init.method,
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}
const ADMIN = { 'x-portal-role': 'admin', 'x-portal-extra-roles': '', 'x-portal-mid': 'CMT-9999-01' };
const FAMILY = { 'x-portal-role': 'family', 'x-portal-extra-roles': '' };

const NOTIFY_RESULT = { checked: 0, sent: 0, skipped: 0, failed: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  flagsMock.setuAuth = true;
  previewAssignments.mockResolvedValue(PREVIEW_RESULT);
  publishAssignments.mockResolvedValue(PREVIEW_RESULT);
  notifyUnnotifiedProposals.mockResolvedValue(NOTIFY_RESULT);
  getSchoolYearConfig.mockResolvedValue({ currentYear: '2025-26' });
  findPrasadPeriodForPid.mockImplementation(async (_db: unknown, pid: string) =>
    /^bv-brampton-\d{4}-\d{2}$/.test(pid) ? { pid, location: 'Brampton' } : null,
  );
  dbState.listDocs = [];
  dbState.docStore = new Map();
  dbState.lastWhere = [];
  dbState.lastUpdate = undefined;
  dbState.updatedDocId = undefined;
  dbState.batchUpdates = [];
  dbState.batchCommits = 0;
  dbState.refUpdates = [];
  dbState.failUpdateIds = new Set();
  dbState.txVanishIds = new Set();
});

// ── POST /api/admin/prasad/preview ─────────────────────────────────────────────
describe('POST /api/admin/prasad/preview', () => {
  it('401 with no session header', async () => {
    const { POST } = await import('../preview/route');
    const res = await POST(req('/api/admin/prasad/preview', { method: 'POST', body: { pid: PID } }));
    expect(res.status).toBe(401);
    expect(previewAssignments).not.toHaveBeenCalled();
  });

  it('403 for a non-admin (family) role', async () => {
    const { POST } = await import('../preview/route');
    const res = await POST(req('/api/admin/prasad/preview', { method: 'POST', body: { pid: PID }, headers: FAMILY }));
    expect(res.status).toBe(403);
    expect(previewAssignments).not.toHaveBeenCalled();
  });

  it('400 on a bad body', async () => {
    const { POST } = await import('../preview/route');
    const res = await POST(req('/api/admin/prasad/preview', { method: 'POST', body: { pid: 42 }, headers: ADMIN }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'bad-request' });
    expect(previewAssignments).not.toHaveBeenCalled();
  });

  it('400 on an unknown pid', async () => {
    const { POST } = await import('../preview/route');
    const res = await POST(req('/api/admin/prasad/preview', { method: 'POST', body: { pid: 'nope' }, headers: ADMIN }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown-pid' });
    expect(previewAssignments).not.toHaveBeenCalled();
  });

  it('200 returns the previewAssignments result (forwards pid/location/cap)', async () => {
    const { POST } = await import('../preview/route');
    const res = await POST(req('/api/admin/prasad/preview', { method: 'POST', body: { pid: PID, cap: 5 }, headers: ADMIN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PREVIEW_RESULT);
    expect(previewAssignments).toHaveBeenCalledWith(PID, 'Brampton', 5);
  });

  it('200 resolves a PREPARING-year pid (live=2025-26) — no past-year guard on the dry-run', async () => {
    const { POST } = await import('../preview/route');
    const res = await POST(
      req('/api/admin/prasad/preview', { method: 'POST', body: { pid: 'bv-brampton-2026-27', cap: 3 }, headers: ADMIN }),
    );
    expect(res.status).toBe(200);
    expect(previewAssignments).toHaveBeenCalledWith('bv-brampton-2026-27', 'Brampton', 3);
  });
});

// ── POST /api/admin/prasad/publish ─────────────────────────────────────────────
describe('POST /api/admin/prasad/publish', () => {
  it('403 for a non-admin (family) role', async () => {
    const { POST } = await import('../publish/route');
    const res = await POST(req('/api/admin/prasad/publish', { method: 'POST', body: { pid: PID, cap: 3 }, headers: FAMILY }));
    expect(res.status).toBe(403);
    expect(publishAssignments).not.toHaveBeenCalled();
    expect(notifyUnnotifiedProposals).not.toHaveBeenCalled();
  });

  it('400 when cap is missing (required)', async () => {
    const { POST } = await import('../publish/route');
    const res = await POST(req('/api/admin/prasad/publish', { method: 'POST', body: { pid: PID }, headers: ADMIN }));
    expect(res.status).toBe(400);
    expect(publishAssignments).not.toHaveBeenCalled();
    expect(notifyUnnotifiedProposals).not.toHaveBeenCalled();
  });

  it('200 calls publishAssignments with (pid, location, cap, actor=mid) and carries the notify report', async () => {
    notifyUnnotifiedProposals.mockResolvedValue({ checked: 5, sent: 4, skipped: 1, failed: 0 });
    const { POST } = await import('../publish/route');
    const res = await POST(req('/api/admin/prasad/publish', { method: 'POST', body: { pid: PID, cap: 4 }, headers: ADMIN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...PREVIEW_RESULT, notify: { checked: 5, sent: 4, skipped: 1, failed: 0 } });
    expect(publishAssignments).toHaveBeenCalledWith(PID, 'Brampton', 4, 'CMT-9999-01');
    expect(notifyUnnotifiedProposals).toHaveBeenCalledWith(PID);
  });

  it('409 past-year when the period is in a past school year', async () => {
    const { POST } = await import('../publish/route');
    const res = await POST(
      req('/api/admin/prasad/publish', { method: 'POST', body: { pid: 'bv-brampton-2024-25', cap: 3 }, headers: ADMIN }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'past-year', year: '2024-25', liveYear: '2025-26' });
    expect(publishAssignments).not.toHaveBeenCalled();
    expect(notifyUnnotifiedProposals).not.toHaveBeenCalled();
  });

  it('does NOT reject a live-year period (publishes)', async () => {
    const { POST } = await import('../publish/route');
    const res = await POST(req('/api/admin/prasad/publish', { method: 'POST', body: { pid: PID, cap: 3 }, headers: ADMIN }));
    expect(res.status).toBe(200);
    expect(publishAssignments).toHaveBeenCalled();
  });

  it('publishes a PREPARING-year period (live=2025-26 → 2026-27 is writable)', async () => {
    const { POST } = await import('../publish/route');
    const res = await POST(
      req('/api/admin/prasad/publish', { method: 'POST', body: { pid: 'bv-brampton-2026-27', cap: 3 }, headers: ADMIN }),
    );
    expect(res.status).toBe(200);
    expect(publishAssignments).toHaveBeenCalledWith('bv-brampton-2026-27', 'Brampton', 3, 'CMT-9999-01');
  });

  it('200 with notify.error when the notify fan-out throws after a landed publish', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      notifyUnnotifiedProposals.mockRejectedValue(new Error('SES exploded'));
      const { POST } = await import('../publish/route');
      const res = await POST(req('/api/admin/prasad/publish', { method: 'POST', body: { pid: PID, cap: 4 }, headers: ADMIN }));
      // The publish itself landed — a notify failure must NOT surface as a 500.
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ...PREVIEW_RESULT,
        notify: { error: true, checked: 0, sent: 0, skipped: 0, failed: 0 },
      });
      expect(publishAssignments).toHaveBeenCalledWith(PID, 'Brampton', 4, 'CMT-9999-01');
    } finally {
      errSpy.mockRestore();
    }
  });
});

// ── GET /api/admin/prasad ──────────────────────────────────────────────────────
describe('GET /api/admin/prasad', () => {
  it('400 without pid', async () => {
    const { GET } = await import('../route');
    const res = await GET(req('/api/admin/prasad', { method: 'GET', headers: ADMIN }));
    expect(res.status).toBe(400);
  });

  it('200 maps + serializes Timestamps, sorts by date then familyName', async () => {
    dbState.listDocs = [
      {
        data: () => ({
          paid: `${PID}-CMT-0002`, pid: PID, fid: 'CMT-0002', familyName: 'Zephyr',
          date: '2026-03-15', status: 'assigned',
          assignedAt: new FakeTimestamp('2026-01-01T00:00:00.000Z'),
          movedAt: null,
          remindedAt: { weekBefore: new FakeTimestamp('2026-03-08T00:00:00.000Z'), twoDayBefore: null },
        }),
      },
      {
        data: () => ({
          paid: `${PID}-CMT-0001`, pid: PID, fid: 'CMT-0001', familyName: 'Adams',
          date: '2026-03-15', status: 'assigned',
          assignedAt: new FakeTimestamp('2026-01-02T00:00:00.000Z'),
          movedAt: new FakeTimestamp('2026-02-01T00:00:00.000Z'),
          confirmedAt: new FakeTimestamp('2026-02-15T00:00:00.000Z'),
          proposalNotifiedAt: new FakeTimestamp('2026-01-10T00:00:00.000Z'),
          remindedAt: { weekBefore: null, twoDayBefore: null },
        }),
      },
      {
        data: () => ({
          paid: `${PID}-CMT-0003`, pid: PID, fid: 'CMT-0003', familyName: 'Adams',
          date: '2026-03-08', status: 'assigned',
          assignedAt: new FakeTimestamp('2026-01-03T00:00:00.000Z'),
          movedAt: null,
          remindedAt: { weekBefore: null, twoDayBefore: null },
        }),
      },
    ];
    const { GET } = await import('../route');
    const res = await GET(req(`/api/admin/prasad?pid=${PID}&date=2026-03-15`, { method: 'GET', headers: ADMIN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assignments: Array<Record<string, unknown>> };

    // pid + date both forwarded to the query.
    expect(dbState.lastWhere).toContainEqual(['pid', '==', PID]);
    expect(dbState.lastWhere).toContainEqual(['date', '==', '2026-03-15']);

    // Sorted: 2026-03-08 first, then 2026-03-15 by familyName (Adams < Zephyr).
    expect(body.assignments.map((a) => a.fid)).toEqual(['CMT-0003', 'CMT-0001', 'CMT-0002']);

    // Timestamps serialized to ISO strings; nulls preserved.
    const adams = body.assignments[1]!;
    expect(adams.assignedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(adams.movedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(adams.confirmedAt).toBe('2026-02-15T00:00:00.000Z');
    expect(adams.proposalNotifiedAt).toBe('2026-01-10T00:00:00.000Z');
    const zephyr = body.assignments[2]!;
    expect((zephyr.remindedAt as Record<string, unknown>).weekBefore).toBe('2026-03-08T00:00:00.000Z');
    expect((zephyr.remindedAt as Record<string, unknown>).twoDayBefore).toBeNull();
    expect(zephyr.movedAt).toBeNull();
    expect(zephyr.confirmedAt).toBeNull();
    expect(zephyr.proposalNotifiedAt).toBeNull();
  });
});

// ── PATCH /api/admin/prasad/assignment ──────────────────────────────────────────
describe('PATCH /api/admin/prasad/assignment', () => {
  it('404 when the assignment is missing', async () => {
    const { PATCH } = await import('../assignment/route');
    const res = await PATCH(
      req('/api/admin/prasad/assignment', { method: 'PATCH', body: { paid: 'missing', cancel: true }, headers: ADMIN }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
  });

  it('200 cancel sets status:cancelled', async () => {
    dbState.docStore.set('p-1', { paid: 'p-1', date: '2026-03-15', status: 'assigned' });
    const { PATCH } = await import('../assignment/route');
    const res = await PATCH(
      req('/api/admin/prasad/assignment', { method: 'PATCH', body: { paid: 'p-1', cancel: true }, headers: ADMIN }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(dbState.updatedDocId).toBe('p-1');
    expect(dbState.lastUpdate).toEqual({ status: 'cancelled' });
  });

  it('200 reassign writes date + movedFrom + movedAt + movedBy + source:admin', async () => {
    dbState.docStore.set('p-2', { paid: 'p-2', date: '2026-03-15', status: 'assigned' });
    const { PATCH } = await import('../assignment/route');
    const res = await PATCH(
      req('/api/admin/prasad/assignment', { method: 'PATCH', body: { paid: 'p-2', date: '2026-03-22' }, headers: ADMIN }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(dbState.updatedDocId).toBe('p-2');
    expect(dbState.lastUpdate).toMatchObject({
      date: '2026-03-22',
      movedFrom: '2026-03-15',
      movedBy: 'CMT-9999-01',
      source: 'admin',
    });
    expect(dbState.lastUpdate!.movedAt).toBe(SERVER_TS);
  });

  it('400 when neither cancel nor date is provided', async () => {
    dbState.docStore.set('p-3', { paid: 'p-3', date: '2026-03-15', status: 'assigned' });
    const { PATCH } = await import('../assignment/route');
    const res = await PATCH(
      req('/api/admin/prasad/assignment', { method: 'PATCH', body: { paid: 'p-3' }, headers: ADMIN }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad-request' });
    expect(dbState.lastUpdate).toBeUndefined();
  });

  it('200 assign:true flips a proposed row to assigned (confirmedBy:admin)', async () => {
    dbState.docStore.set('p-4', { paid: 'p-4', date: '2026-03-15', status: 'proposed' });
    const { PATCH } = await import('../assignment/route');
    const res = await PATCH(
      req('/api/admin/prasad/assignment', { method: 'PATCH', body: { paid: 'p-4', assign: true }, headers: ADMIN }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(dbState.updatedDocId).toBe('p-4');
    expect(dbState.lastUpdate).toEqual({ status: 'assigned', confirmedAt: SERVER_TS, confirmedBy: 'admin' });
  });

  it('409 not-proposed when assign:true targets an already-assigned row', async () => {
    dbState.docStore.set('p-5', { paid: 'p-5', date: '2026-03-15', status: 'assigned' });
    const { PATCH } = await import('../assignment/route');
    const res = await PATCH(
      req('/api/admin/prasad/assignment', { method: 'PATCH', body: { paid: 'p-5', assign: true }, headers: ADMIN }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not-proposed' });
    expect(dbState.lastUpdate).toBeUndefined();
  });

  it('404 when assign:true and the row vanishes between the outer read and the txn read', async () => {
    dbState.docStore.set('p-7', { paid: 'p-7', date: '2026-03-15', status: 'proposed' });
    dbState.txVanishIds.add('p-7'); // deleted by someone else mid-flight
    const { PATCH } = await import('../assignment/route');
    const res = await PATCH(
      req('/api/admin/prasad/assignment', { method: 'PATCH', body: { paid: 'p-7', assign: true }, headers: ADMIN }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
    expect(dbState.lastUpdate).toBeUndefined();
  });

  it('200 assign:true with a date also writes the move fields', async () => {
    dbState.docStore.set('p-6', { paid: 'p-6', date: '2026-03-15', status: 'proposed' });
    const { PATCH } = await import('../assignment/route');
    const res = await PATCH(
      req('/api/admin/prasad/assignment', {
        method: 'PATCH', body: { paid: 'p-6', assign: true, date: '2026-03-22' }, headers: ADMIN,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(dbState.updatedDocId).toBe('p-6');
    expect(dbState.lastUpdate).toMatchObject({
      status: 'assigned',
      confirmedBy: 'admin',
      date: '2026-03-22',
      movedFrom: '2026-03-15',
      movedBy: 'CMT-9999-01',
      source: 'admin',
    });
    expect(dbState.lastUpdate!.confirmedAt).toBe(SERVER_TS);
    expect(dbState.lastUpdate!.movedAt).toBe(SERVER_TS);
  });
});

// ── POST /api/admin/prasad/assign-remaining ────────────────────────────────────
describe('POST /api/admin/prasad/assign-remaining', () => {
  /** A queried still-proposed doc whose ref supports preconditioned update().
   *  A precondition mismatch (the row changed since the query) is simulated via
   *  dbState.failUpdateIds. */
  function proposedDoc(id: string) {
    return {
      data: () => ({ paid: id, pid: PID, status: 'proposed' }),
      updateTime: `ut-${id}`,
      ref: {
        id,
        update: async (patch: Record<string, unknown>, precondition?: unknown) => {
          if (dbState.failUpdateIds.has(id)) throw new Error('FAILED_PRECONDITION: row changed');
          dbState.refUpdates.push({ id, patch, precondition });
        },
      },
    };
  }

  it('404 when the setuAuth flag is off', async () => {
    flagsMock.setuAuth = false;
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: PID }, headers: ADMIN }));
    expect(res.status).toBe(404);
    expect(dbState.refUpdates).toEqual([]);
  });

  it('401 with no session header', async () => {
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: PID } }));
    expect(res.status).toBe(401);
    expect(dbState.refUpdates).toEqual([]);
  });

  it('403 for a non-admin (family) role', async () => {
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: PID }, headers: FAMILY }));
    expect(res.status).toBe(403);
    expect(dbState.refUpdates).toEqual([]);
  });

  it('400 on a malformed body', async () => {
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: 42 }, headers: ADMIN }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'bad-request' });
    expect(dbState.refUpdates).toEqual([]);
  });

  it('400 on an unknown pid', async () => {
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: 'nope' }, headers: ADMIN }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown-pid' });
    expect(dbState.refUpdates).toEqual([]);
  });

  it('200 flips every still-proposed row via a preconditioned per-doc update and returns the counts', async () => {
    dbState.listDocs = [proposedDoc('a'), proposedDoc('b'), proposedDoc('c')];
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: PID }, headers: ADMIN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, assigned: 3, skipped: 0 });

    // Query scoped to the pid's still-proposed rows.
    expect(dbState.lastWhere).toContainEqual(['pid', '==', PID]);
    expect(dbState.lastWhere).toContainEqual(['status', '==', 'proposed']);

    // Every doc updated with the assigned/confirmed payload, preconditioned on
    // the row being unchanged since the query (lastUpdateTime).
    expect(dbState.refUpdates.map((u) => u.id)).toEqual(['a', 'b', 'c']);
    for (const u of dbState.refUpdates) {
      expect(u.patch).toEqual({ status: 'assigned', confirmedAt: SERVER_TS, confirmedBy: 'admin' });
      expect(u.precondition).toEqual({ lastUpdateTime: `ut-${u.id}` });
    }
  });

  it('200 counts a rejected precondition as skipped and still assigns the rest', async () => {
    dbState.listDocs = [proposedDoc('a'), proposedDoc('b'), proposedDoc('c')];
    dbState.failUpdateIds.add('b'); // b was confirmed/cancelled between query and update
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: PID }, headers: ADMIN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, assigned: 2, skipped: 1 });
    expect(dbState.refUpdates.map((u) => u.id)).toEqual(['a', 'c']);
  });

  it('200 { assigned: 0, skipped: 0 } when nothing is still proposed', async () => {
    dbState.listDocs = [];
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: PID }, headers: ADMIN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, assigned: 0, skipped: 0 });
    expect(dbState.refUpdates).toEqual([]);
  });

  it('409 past-year when the period is in a past school year (write blocked)', async () => {
    dbState.listDocs = [proposedDoc('a')];
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(
      req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: 'bv-brampton-2024-25' }, headers: ADMIN }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'past-year', year: '2024-25', liveYear: '2025-26' });
    expect(dbState.refUpdates).toEqual([]);
  });

  it('200 assigns a PREPARING-year period (live=2025-26 → 2026-27 is writable)', async () => {
    dbState.listDocs = [proposedDoc('a'), proposedDoc('b')];
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(
      req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: 'bv-brampton-2026-27' }, headers: ADMIN }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, assigned: 2, skipped: 0 });
  });
});
