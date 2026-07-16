import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * deriveRoster FETCH tests (the plumbing around the pure buildRoster). Locks in
 * the bulk-read shape: family + member docs are fetched via ONE batched getAll
 * each — never a per-family `.collection('members').get()` fan-out (the ~2N
 * round-trips that made the teacher screens slow). The fake DB below counts
 * per-family member subcollection reads so a regression to fan-out fails loudly.
 */

type Row = Record<string, unknown> & { id: string; __fid?: string };
const { fs } = vi.hoisted(() => ({
  fs: { data: {} as Record<string, Row[]>, perFamilyMemberSubGets: 0, getAllCalls: 0, collectionGroupMembers: 0 },
}));

function snap(id: string, data: Row | undefined, parentFid?: string) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
    ref: { parent: { parent: { id: parentFid ?? id } } },
  };
}

function chainWhere(rows: () => Row[]) {
  const filters: Array<{ f: string; op: string; v: unknown }> = [];
  const q = {
    where(f: string, op: string, v: unknown) { filters.push({ f, op, v }); return q; },
    get: async () => {
      let out = rows();
      for (const flt of filters) {
        out = out.filter((r) => (flt.op === 'in' ? Array.isArray(flt.v) && flt.v.includes(r[flt.f]) : r[flt.f] === flt.v));
      }
      return { docs: out.map((r) => snap(r.id, r, r.__fid)) };
    },
  };
  return q;
}

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection(name: string) {
      return {
        doc(id: string) {
          return {
            id,
            get: async () => snap(id, (fs.data[name] ?? []).find((r) => r.id === id)),
            collection(sub: string) {
              return {
                get: async () => {
                  if (sub === 'members') fs.perFamilyMemberSubGets++; // the fan-out we killed
                  return { docs: (fs.data[sub] ?? []).filter((r) => r.__fid === id).map((r) => snap(r.id, r, id)) };
                },
                doc(subId: string) {
                  return { get: async () => snap(subId, (fs.data[sub] ?? []).find((r) => r.__fid === id && r.id === subId), id) };
                },
              };
            },
          };
        },
        where(f: string, op: string, v: unknown) { return chainWhere(() => fs.data[name] ?? []).where(f, op, v); },
      };
    },
    collectionGroup(name: string) {
      if (name === 'members') fs.collectionGroupMembers++;
      return {
        get: async () => ({ docs: (fs.data[name] ?? []).map((r) => snap(r.id, r, r.__fid)) }),
        where(f: string, op: string, v: unknown) { return chainWhere(() => fs.data[name] ?? []).where(f, op, v); },
      };
    },
    async getAll(...refs: Array<{ get: () => Promise<unknown> }>) {
      fs.getAllCalls++;
      return Promise.all(refs.map((r) => r.get()));
    },
  }),
}));

import { deriveRoster } from '../roster';

beforeEach(() => {
  fs.perFamilyMemberSubGets = 0;
  fs.getAllCalls = 0;
  fs.collectionGroupMembers = 0;
  fs.data = {
    levels: [
      { id: 'brampton-level-2-bv-brampton-2026-27', levelId: 'brampton-level-2-bv-brampton-2026-27', levelName: 'Level 2', location: 'Brampton', pid: 'bv-brampton-2026-27', levelKind: 'level', gradeBand: ['2', '3'] },
    ],
    // Two enrolled families at this pid+location, one at a different location (must be excluded).
    enrollments: [
      { id: 'e1', __fid: 'CMT-A', fid: 'CMT-A', pid: 'bv-brampton-2026-27', status: 'active', location: 'Brampton', enrolledMids: ['CMT-A-02'], eid: 'CMT-A-off', oid: 'off', enrolledVia: 'promotion' },
      { id: 'e2', __fid: 'CMT-B', fid: 'CMT-B', pid: 'bv-brampton-2026-27', status: 'active', location: 'Brampton', enrolledMids: ['CMT-B-03'], eid: 'CMT-B-off', oid: 'off', enrolledVia: 'promotion' },
      { id: 'e3', __fid: 'CMT-C', fid: 'CMT-C', pid: 'bv-brampton-2026-27', status: 'active', location: 'Scarborough', enrolledMids: ['CMT-C-02'], eid: 'CMT-C-off', oid: 'off', enrolledVia: 'promotion' },
    ],
    families: [
      { id: 'CMT-A', legacyFid: 'legacy-A' },
      { id: 'CMT-B', legacyFid: null },
      { id: 'CMT-C', legacyFid: 'legacy-C' },
    ],
    // member doc id === mid (universal convention). Include a non-enrolled sibling
    // to prove only enrolledMids members are pulled.
    members: [
      { id: 'CMT-A-02', __fid: 'CMT-A', mid: 'CMT-A-02', firstName: 'Anil', lastName: 'Apple', type: 'Child', schoolGrade: '2' },
      { id: 'CMT-A-09', __fid: 'CMT-A', mid: 'CMT-A-09', firstName: 'Old', lastName: 'Apple', type: 'Child', schoolGrade: '8' },
      { id: 'CMT-B-03', __fid: 'CMT-B', mid: 'CMT-B-03', firstName: 'Bala', lastName: 'Berry', type: 'Child', schoolGrade: '3' },
      { id: 'CMT-C-02', __fid: 'CMT-C', mid: 'CMT-C-02', firstName: 'Cara', lastName: 'Cherry', type: 'Child', schoolGrade: '2' },
    ],
    attendanceEvents: [
      { id: 'a1', __fid: 'CMT-A', levelId: 'brampton-level-2-bv-brampton-2026-27', date: '2026-07-12', mid: 'CMT-A-02', status: 'present', isGuest: false },
    ],
  };
});

describe('deriveRoster (bulk fetch, no per-family fan-out)', () => {
  it('builds the roster from bulk reads and excludes other-location families', async () => {
    const r = await deriveRoster('brampton-level-2-bv-brampton-2026-27', '2026-07-12', new Date('2026-07-12T17:00:00Z'), { withConfirmation: false });
    expect(r).not.toBeNull();
    // Only Brampton families A + B; Scarborough C excluded. Non-enrolled sibling A-09 excluded.
    expect(r!.members.map((m) => m.mid).sort()).toEqual(['CMT-A-02', 'CMT-B-03']);
    expect(r!.total).toBe(2);
    // legacyFid threads through from the bulk family read.
    expect(r!.members.find((m) => m.mid === 'CMT-A-02')!.legacyFid).toBe('legacy-A');
    // The date's attendance event merged in.
    expect(r!.members.find((m) => m.mid === 'CMT-A-02')!.status).toBe('present');
  });

  it('does ZERO per-family member subcollection reads (uses batched getAll instead)', async () => {
    await deriveRoster('brampton-level-2-bv-brampton-2026-27', '2026-07-12', new Date('2026-07-12T17:00:00Z'), { withConfirmation: false });
    expect(fs.perFamilyMemberSubGets).toBe(0); // was N (one per family) under the old fan-out
    expect(fs.getAllCalls).toBeGreaterThan(0); // family + member docs come via getAll
  });
});
