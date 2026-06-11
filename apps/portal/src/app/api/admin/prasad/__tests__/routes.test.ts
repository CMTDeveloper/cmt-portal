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

// ── fake Firestore ────────────────────────────────────────────────────────────
// Supports collection().where().where().get() (list) and collection().doc().get()/.update() (patch).
const SERVER_TS = { __serverTimestamp: true };
class FakeTimestamp {
  constructor(private iso: string) {}
  toDate(): Date {
    return new Date(this.iso);
  }
}
const { dbState } = vi.hoisted(() => ({
  dbState: {
    listDocs: [] as Array<{ data: () => Record<string, unknown>; ref?: { id: string } }>,
    docStore: new Map<string, Record<string, unknown> | undefined>(),
    lastWhere: [] as Array<[string, string, unknown]>,
    lastUpdate: undefined as Record<string, unknown> | undefined,
    updatedDocId: undefined as string | undefined,
    batchUpdates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    batchCommits: 0,
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

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({ collection: () => makeCollection(), batch: makeBatch }),
  FieldValue: { serverTimestamp: () => SERVER_TS },
}));

const PID = 'bv-brampton-2025-26'; // a real CURRENT_PRASAD_PIDS entry
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
  dbState.listDocs = [];
  dbState.docStore = new Map();
  dbState.lastWhere = [];
  dbState.lastUpdate = undefined;
  dbState.updatedDocId = undefined;
  dbState.batchUpdates = [];
  dbState.batchCommits = 0;
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
    const zephyr = body.assignments[2]!;
    expect((zephyr.remindedAt as Record<string, unknown>).weekBefore).toBe('2026-03-08T00:00:00.000Z');
    expect((zephyr.remindedAt as Record<string, unknown>).twoDayBefore).toBeNull();
    expect(zephyr.movedAt).toBeNull();
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
  function proposedDoc(id: string) {
    return { data: () => ({ paid: id, pid: PID, status: 'proposed' }), ref: { id } };
  }

  it('404 when the setuAuth flag is off', async () => {
    flagsMock.setuAuth = false;
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: PID }, headers: ADMIN }));
    expect(res.status).toBe(404);
    expect(dbState.batchUpdates).toEqual([]);
  });

  it('401 with no session header', async () => {
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: PID } }));
    expect(res.status).toBe(401);
    expect(dbState.batchUpdates).toEqual([]);
  });

  it('403 for a non-admin (family) role', async () => {
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: PID }, headers: FAMILY }));
    expect(res.status).toBe(403);
    expect(dbState.batchUpdates).toEqual([]);
  });

  it('400 on a malformed body', async () => {
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: 42 }, headers: ADMIN }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'bad-request' });
    expect(dbState.batchUpdates).toEqual([]);
  });

  it('400 on an unknown pid', async () => {
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: 'nope' }, headers: ADMIN }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown-pid' });
    expect(dbState.batchUpdates).toEqual([]);
  });

  it('200 flips every still-proposed row to assigned and returns the count', async () => {
    dbState.listDocs = [proposedDoc('a'), proposedDoc('b'), proposedDoc('c')];
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: PID }, headers: ADMIN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, assigned: 3 });

    // Query scoped to the pid's still-proposed rows.
    expect(dbState.lastWhere).toContainEqual(['pid', '==', PID]);
    expect(dbState.lastWhere).toContainEqual(['status', '==', 'proposed']);

    // Every doc batched with the same assigned/confirmed payload, one commit.
    expect(dbState.batchUpdates.map((u) => u.id)).toEqual(['a', 'b', 'c']);
    for (const u of dbState.batchUpdates) {
      expect(u.patch).toEqual({ status: 'assigned', confirmedAt: SERVER_TS, confirmedBy: 'admin' });
    }
    expect(dbState.batchCommits).toBe(1);
  });

  it('200 { assigned: 0 } when nothing is still proposed (no batch commit)', async () => {
    dbState.listDocs = [];
    const { POST } = await import('../assign-remaining/route');
    const res = await POST(req('/api/admin/prasad/assign-remaining', { method: 'POST', body: { pid: PID }, headers: ADMIN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, assigned: 0 });
    expect(dbState.batchCommits).toBe(0);
  });
});
