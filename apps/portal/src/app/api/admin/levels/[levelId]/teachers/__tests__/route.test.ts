import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory fake Firestore ────────────────────────────────────────────────
// The route, assignTeacher, getTeacherLevelIds and findMissingLevelIds all read
// AND write real Firestore through portalFirestore(). To prove the sync property
// (teacherAssignments.levelIds and levels.teacherRefs move together) we run the
// REAL helpers against one shared in-memory store — NOT a mocked assignTeacher.
const { store, seedLevel, seedAssignment, getLevel, getAssignment, FieldValue, portalFirestore } =
  vi.hoisted(() => {
    type Doc = Record<string, unknown>;
    const store = new Map<string, Map<string, Doc>>();

    function col(name: string): Map<string, Doc> {
      let c = store.get(name);
      if (!c) {
        c = new Map();
        store.set(name, c);
      }
      return c;
    }

    const SERVER_TS = { __serverTimestamp: true } as const;
    const FieldValue = {
      serverTimestamp: () => SERVER_TS,
      arrayUnion: (v: unknown) => ({ __arrayUnion: v }),
      arrayRemove: (v: unknown) => ({ __arrayRemove: v }),
    };

    function applyValue(existing: unknown, incoming: unknown): unknown {
      if (incoming === SERVER_TS) return 'SERVER_TS';
      if (incoming && typeof incoming === 'object') {
        const obj = incoming as Record<string, unknown>;
        if ('__arrayUnion' in obj) {
          const arr = Array.isArray(existing) ? [...(existing as unknown[])] : [];
          if (!arr.includes(obj.__arrayUnion)) arr.push(obj.__arrayUnion);
          return arr;
        }
        if ('__arrayRemove' in obj) {
          const arr = Array.isArray(existing) ? [...(existing as unknown[])] : [];
          return arr.filter((x) => x !== obj.__arrayRemove);
        }
      }
      return incoming;
    }

    function applySet(collection: string, id: string, data: Doc, opts?: { merge?: boolean }): void {
      const c = col(collection);
      const prev = opts?.merge ? (c.get(id) ?? {}) : {};
      const next: Doc = { ...prev };
      for (const [k, v] of Object.entries(data)) next[k] = applyValue(next[k], v);
      c.set(id, next);
    }

    function docRef(collection: string, id: string) {
      return {
        __collection: collection,
        __id: id,
        async get() {
          const c = col(collection);
          const exists = c.has(id);
          const data = c.get(id);
          return { exists, id, data: () => (exists ? { ...data } : undefined) };
        },
        async set(data: Doc, opts?: { merge?: boolean }) {
          applySet(collection, id, data, opts);
        },
      };
    }

    const db = {
      collection: (name: string) => ({ doc: (id: string) => docRef(name, id) }),
      async getAll(...refs: Array<{ __collection: string; __id: string }>) {
        return Promise.all(refs.map((r) => docRef(r.__collection, r.__id).get()));
      },
      batch() {
        const ops: Array<() => void> = [];
        return {
          set(
            ref: { __collection: string; __id: string },
            data: Doc,
            opts?: { merge?: boolean },
          ) {
            ops.push(() => applySet(ref.__collection, ref.__id, data, opts));
          },
          async commit() {
            for (const op of ops) op();
          },
        };
      },
    };

    const seedLevel = (id: string, pid: string) => col('levels').set(id, { pid });
    const seedAssignment = (ref: string, levelIds: string[]) =>
      col('teacherAssignments').set(ref, { ref, levelIds });
    const getLevel = (id: string) => col('levels').get(id);
    const getAssignment = (ref: string) => col('teacherAssignments').get(ref);

    return {
      store,
      seedLevel,
      seedAssignment,
      getLevel,
      getAssignment,
      FieldValue,
      portalFirestore: () => db,
    };
  });

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({ portalFirestore, FieldValue }));

// assertWritableYear resolves the live year via getSchoolYearConfig.
const { mockGetSchoolYearConfig } = vi.hoisted(() => ({ mockGetSchoolYearConfig: vi.fn() }));
vi.mock('@/features/setu/rollover/school-year-config', () => ({
  getSchoolYearConfig: mockGetSchoolYearConfig,
}));

const LEVEL_1 = 'brampton-level-2-bv-brampton-2025-26';
const LEVEL_2 = 'brampton-level-3-bv-brampton-2025-26';
const MID_1 = 'CMT-FAM1-01';
const MID_2 = 'CMT-FAM2-01';

function makeRequest(method: string, body?: unknown, uid?: string, role = 'admin'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-portal-role': role };
  if (uid) headers['x-portal-uid'] = uid;
  return new Request(`http://localhost/api/admin/levels/${LEVEL_1}/teachers`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const params = (levelId = LEVEL_1) => ({ params: Promise.resolve({ levelId }) });

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  // Two live-year levels available to assign against.
  seedLevel(LEVEL_1, 'bv-brampton-2025-26');
  seedLevel(LEVEL_2, 'bv-brampton-2025-26');
  mockGetSchoolYearConfig.mockResolvedValue({ currentYear: '2025-26' });
});

describe('POST /api/admin/levels/[levelId]/teachers', () => {
  it('adds the teacher to BOTH the level teacherRefs and the assignment levelIds', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { mid: MID_1 }, 'uid-admin'), params());
    expect(res.status).toBe(200);
    // both sources of truth reflect the add
    expect(getLevel(LEVEL_1)?.teacherRefs).toEqual([MID_1]);
    expect(getAssignment(MID_1)?.levelIds).toEqual([LEVEL_1]);
  });

  it('allows welcome-team (front-desk)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { mid: MID_1 }, 'uid-w', 'welcome-team'), params());
    expect(res.status).toBe(200);
    expect(getLevel(LEVEL_1)?.teacherRefs).toEqual([MID_1]);
  });

  it('N=2 — two teachers on one level: both mids on the level, each assignment has the level', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest('POST', { mid: MID_1 }, 'uid-admin'), params());
    const res2 = await POST(makeRequest('POST', { mid: MID_2 }, 'uid-admin'), params());
    expect(res2.status).toBe(200);
    expect(getLevel(LEVEL_1)?.teacherRefs).toEqual([MID_1, MID_2]);
    expect(getAssignment(MID_1)?.levelIds).toEqual([LEVEL_1]);
    expect(getAssignment(MID_2)?.levelIds).toEqual([LEVEL_1]);
  });

  it('N=2 — one teacher on two levels: assignment holds both, each level holds the mid', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest('POST', { mid: MID_1 }, 'uid-admin'), params(LEVEL_1));
    const res2 = await POST(makeRequest('POST', { mid: MID_1 }, 'uid-admin'), params(LEVEL_2));
    expect(res2.status).toBe(200);
    expect(getAssignment(MID_1)?.levelIds).toEqual([LEVEL_1, LEVEL_2]);
    expect(getLevel(LEVEL_1)?.teacherRefs).toEqual([MID_1]);
    expect(getLevel(LEVEL_2)?.teacherRefs).toEqual([MID_1]);
  });

  it('is idempotent — re-adding the same teacher does not duplicate', async () => {
    const { POST } = await import('../route');
    await POST(makeRequest('POST', { mid: MID_1 }, 'uid-admin'), params());
    const res2 = await POST(makeRequest('POST', { mid: MID_1 }, 'uid-admin'), params());
    expect(res2.status).toBe(200);
    expect(getLevel(LEVEL_1)?.teacherRefs).toEqual([MID_1]);
    expect(getAssignment(MID_1)?.levelIds).toEqual([LEVEL_1]);
  });

  it('returns 401 without x-portal-uid', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { mid: MID_1 }), params());
    expect(res.status).toBe(401);
  });

  it('returns 403 for a family-manager (non-admin/non-welcome)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { mid: MID_1 }, 'uid-m', 'family-manager'), params());
    expect(res.status).toBe(403);
    expect(getAssignment(MID_1)).toBeUndefined();
  });

  it('returns 400 for a bad payload (missing mid)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', {}, 'uid-admin'), params());
    expect(res.status).toBe(400);
  });

  it('returns 400 unknown-levels for a level with no doc', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('POST', { mid: MID_1 }, 'uid-admin'), params('ghost-level'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unknown-levels', missing: ['ghost-level'] });
    expect(getAssignment(MID_1)).toBeUndefined();
  });

  it('returns 409 past-year when the level belongs to a past school year', async () => {
    seedLevel('brampton-level-2-bv-brampton-2024-25', 'bv-brampton-2024-25');
    const { POST } = await import('../route');
    const res = await POST(
      makeRequest('POST', { mid: MID_1 }, 'uid-admin'),
      params('brampton-level-2-bv-brampton-2024-25'),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'past-year', year: '2024-25', liveYear: '2025-26' });
    expect(getAssignment(MID_1)).toBeUndefined();
  });
});

describe('DELETE /api/admin/levels/[levelId]/teachers', () => {
  it('removes the teacher from BOTH the level teacherRefs and the assignment levelIds', async () => {
    // Seed a prior assignment: MID_1 on LEVEL_1.
    seedAssignment(MID_1, [LEVEL_1]);
    store.get('levels')!.set(LEVEL_1, { pid: 'bv-brampton-2025-26', teacherRefs: [MID_1] });

    const { DELETE } = await import('../route');
    const res = await DELETE(makeRequest('DELETE', { mid: MID_1 }, 'uid-admin'), params());
    expect(res.status).toBe(200);
    expect(getLevel(LEVEL_1)?.teacherRefs).toEqual([]);
    expect(getAssignment(MID_1)?.levelIds).toEqual([]);
  });

  it('N=2 — removing one of two teachers leaves the other on the level', async () => {
    seedAssignment(MID_1, [LEVEL_1]);
    seedAssignment(MID_2, [LEVEL_1]);
    store.get('levels')!.set(LEVEL_1, { pid: 'bv-brampton-2025-26', teacherRefs: [MID_1, MID_2] });

    const { DELETE } = await import('../route');
    const res = await DELETE(makeRequest('DELETE', { mid: MID_1 }, 'uid-admin'), params());
    expect(res.status).toBe(200);
    expect(getLevel(LEVEL_1)?.teacherRefs).toEqual([MID_2]);
    expect(getAssignment(MID_1)?.levelIds).toEqual([]);
    expect(getAssignment(MID_2)?.levelIds).toEqual([LEVEL_1]);
  });

  it('N=2 — removing one of a teacher’s two levels keeps the other level', async () => {
    seedAssignment(MID_1, [LEVEL_1, LEVEL_2]);
    store.get('levels')!.set(LEVEL_1, { pid: 'bv-brampton-2025-26', teacherRefs: [MID_1] });
    store.get('levels')!.set(LEVEL_2, { pid: 'bv-brampton-2025-26', teacherRefs: [MID_1] });

    const { DELETE } = await import('../route');
    const res = await DELETE(makeRequest('DELETE', { mid: MID_1 }, 'uid-admin'), params(LEVEL_1));
    expect(res.status).toBe(200);
    expect(getAssignment(MID_1)?.levelIds).toEqual([LEVEL_2]);
    expect(getLevel(LEVEL_1)?.teacherRefs).toEqual([]);
    expect(getLevel(LEVEL_2)?.teacherRefs).toEqual([MID_1]);
  });

  it('allows welcome-team', async () => {
    seedAssignment(MID_1, [LEVEL_1]);
    store.get('levels')!.set(LEVEL_1, { pid: 'bv-brampton-2025-26', teacherRefs: [MID_1] });
    const { DELETE } = await import('../route');
    const res = await DELETE(makeRequest('DELETE', { mid: MID_1 }, 'uid-w', 'welcome-team'), params());
    expect(res.status).toBe(200);
    expect(getLevel(LEVEL_1)?.teacherRefs).toEqual([]);
  });

  it('returns 403 for a family-member', async () => {
    const { DELETE } = await import('../route');
    const res = await DELETE(makeRequest('DELETE', { mid: MID_1 }, 'uid-mb', 'family-member'), params());
    expect(res.status).toBe(403);
  });

  it('returns 409 past-year when removing from a past-year level', async () => {
    seedLevel('brampton-level-2-bv-brampton-2024-25', 'bv-brampton-2024-25');
    seedAssignment(MID_1, ['brampton-level-2-bv-brampton-2024-25']);
    const { DELETE } = await import('../route');
    const res = await DELETE(
      makeRequest('DELETE', { mid: MID_1 }, 'uid-admin'),
      params('brampton-level-2-bv-brampton-2024-25'),
    );
    expect(res.status).toBe(409);
    // assignment untouched
    expect(getAssignment(MID_1)?.levelIds).toEqual(['brampton-level-2-bv-brampton-2024-25']);
  });
});
