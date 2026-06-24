import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * N=2 dedup fixture for listSevaks(). Exercises two of every source plus the
 * critical merge case — a legacy auth-claim whose contact resolves to an
 * EXISTING family mid must NOT create a duplicate row.
 *
 * People in the fixture:
 *  - Asha  (mid CMT-FAM1-01, fid CMT-FAM1): family admin + welcome-team (dual role)
 *  - Bala  (mid CMT-FAM2-01, fid CMT-FAM2): family admin only; ALSO a parent-teacher
 *  - Chitra (no family): non-family auth-claim admin  → uid-chitra
 *  - Asha again via a legacy auth-claim (uid-asha) carrying admin → MUST MERGE into Asha's row
 *  - Standalone teacher Devi (tid TCH-DEVI): teacher-only, own row
 */

const {
  mockListMembersWithRole,
  mockFind,
  mockListUsers,
  mockCollection,
  mockCollectionGroup,
  mockGetAll,
} = vi.hoisted(() => ({
  mockListMembersWithRole: vi.fn(),
  mockFind: vi.fn(),
  mockListUsers: vi.fn(),
  mockCollection: vi.fn(),
  mockCollectionGroup: vi.fn(),
  mockGetAll: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/check-in/shared', () => ({ sha256Hex: (s: string) => `uid-${s}` }));
vi.mock('@cmt/shared-domain/setu', () => ({
  normalizeContactForKey: (_t: string, v: string) => v,
}));
vi.mock('@cmt/firebase-shared/admin/auth', () => ({
  portalAuth: () => ({ listUsers: mockListUsers }),
}));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    collection: mockCollection,
    collectionGroup: mockCollectionGroup,
    getAll: mockGetAll,
  }),
}));
vi.mock('../find-family-by-contact', () => ({ findSetuFamilyByContact: mockFind }));
vi.mock('../member-roles', () => ({
  addMemberRole: vi.fn(),
  removeMemberRole: vi.fn(),
  listMembersWithRole: mockListMembersWithRole,
}));

import { listSevaks } from '../manage-roles';

// --- member docs keyed by `${fid}/${mid}` ---
const MEMBERS: Record<string, FirebaseFirestore.DocumentData> = {
  'CMT-FAM1/CMT-FAM1-01': {
    mid: 'CMT-FAM1-01',
    firstName: 'Asha',
    lastName: 'Iyer',
    email: 'asha@example.com',
    phone: null,
  },
  'CMT-FAM2/CMT-FAM2-01': {
    mid: 'CMT-FAM2-01',
    firstName: 'Bala',
    lastName: 'Rao',
    email: null,
    phone: '+15551112222',
  },
};

// --- teacherAssignments docs ---
const TEACHER_ASSIGNMENTS = [
  { ref: 'CMT-FAM2-01', levelIds: ['lvl-west-2'] }, // parent-teacher (Bala)
  { ref: 'TCH-DEVI', levelIds: ['lvl-east-1'] }, // standalone teacher (Devi)
];

// --- levels docs ---
const LEVELS: Record<string, FirebaseFirestore.DocumentData> = {
  'lvl-west-2': { levelId: 'lvl-west-2', levelName: 'Level 2 (West)' },
  'lvl-east-1': { levelId: 'lvl-east-1', levelName: 'Level 1 (East)' },
};

// --- standalone teachers/{tid} docs ---
const TEACHERS: Record<string, FirebaseFirestore.DocumentData> = {
  'TCH-DEVI': { tid: 'TCH-DEVI', firstName: 'Devi', lastName: 'Nair', email: 'devi@example.com', phone: null },
};

function snap(data: FirebaseFirestore.DocumentData | undefined, id: string) {
  return data
    ? { exists: true, id, data: () => data }
    : { exists: false, id, data: () => undefined };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockListMembersWithRole.mockImplementation(async (role: string) => {
    if (role === 'admin') {
      return [
        { mid: 'CMT-FAM1-01', fid: 'CMT-FAM1', grantedVia: 'asha@example.com' },
        { mid: 'CMT-FAM2-01', fid: 'CMT-FAM2', grantedVia: null },
      ];
    }
    if (role === 'welcome-team') {
      return [{ mid: 'CMT-FAM1-01', fid: 'CMT-FAM1', grantedVia: 'asha@example.com' }];
    }
    return [];
  });

  // collection() routes by name.
  mockCollection.mockImplementation((name: string) => {
    if (name === 'families') {
      return {
        doc: (fid: string) => ({
          collection: (sub: string) => {
            if (sub !== 'members') throw new Error(`unexpected subcollection ${sub}`);
            return { doc: (mid: string) => ({ get: async () => snap(MEMBERS[`${fid}/${mid}`], mid) }) };
          },
        }),
      };
    }
    if (name === 'teacherAssignments') {
      return {
        get: async () => ({ docs: TEACHER_ASSIGNMENTS.map((d) => ({ id: d.ref, data: () => d })) }),
      };
    }
    if (name === 'levels') {
      return { doc: (id: string) => ({ __levelRef: id }) };
    }
    if (name === 'teachers') {
      return { doc: (id: string) => ({ get: async () => snap(TEACHERS[id], id) }) };
    }
    throw new Error(`unexpected collection ${name}`);
  });

  // collectionGroup('members').where('mid','==',ref).limit(1).get()
  mockCollectionGroup.mockImplementation((name: string) => {
    if (name !== 'members') throw new Error(`unexpected collectionGroup ${name}`);
    return {
      where: (_f: string, _op: string, mid: string) => ({
        limit: () => ({
          get: async () => {
            const fid = mid === 'CMT-FAM2-01' ? 'CMT-FAM2' : mid === 'CMT-FAM1-01' ? 'CMT-FAM1' : null;
            if (!fid || !MEMBERS[`${fid}/${mid}`]) return { docs: [] };
            return {
              docs: [
                {
                  data: () => MEMBERS[`${fid}/${mid}`],
                  ref: { parent: { parent: { id: fid } } },
                },
              ],
            };
          },
        }),
      }),
    };
  });

  // getAll(...levelRefs) for level-name resolution.
  mockGetAll.mockImplementation(async (...refs: Array<{ __levelRef: string }>) =>
    refs.map((r) => snap(LEVELS[r.__levelRef], r.__levelRef)),
  );

  // listUsers → one non-family admin (Chitra) + one legacy claim on Asha's contact.
  mockListUsers.mockResolvedValue({
    users: [
      { uid: 'uid-chitra@example.com', email: 'chitra@example.com', customClaims: { role: 'admin', email: 'chitra@example.com' }, metadata: { lastSignInTime: '2026-06-21T09:00:00.000Z' } },
      // Asha's canonical family uid IS uid-asha@example.com here (mocked sha256
      // is `uid-${contact}`), so her family row resolves last-sign-in from this
      // auth user's metadata — covering the family-contact-derived path.
      { uid: 'uid-asha@example.com', email: 'asha@example.com', customClaims: { role: 'admin', email: 'asha@example.com' }, metadata: { lastSignInTime: '2026-06-20T10:00:00.000Z' } },
    ],
    pageToken: undefined,
  });

  // findSetuFamilyByContact: Asha's contact maps to her existing mid; Chitra's does not.
  mockFind.mockImplementation(async (_type: string, value: string) => {
    if (value === 'asha@example.com') {
      return { source: 'setu', fid: 'CMT-FAM1', mid: 'CMT-FAM1-01', legacyFid: null, family: null };
    }
    return { source: null, fid: null, mid: null, legacyFid: null, family: null };
  });
});

describe('listSevaks — merged + deduped', () => {
  it('produces one row per distinct person (no dup for the legacy-claim-on-existing-mid)', async () => {
    const sevaks = await listSevaks();

    // Asha, Bala, Chitra, Devi = 4 distinct people.
    expect(sevaks).toHaveLength(4);

    const byKey = new Map(sevaks.map((s) => [s.key, s]));
    // no duplicate keys
    expect(byKey.size).toBe(sevaks.length);

    const asha = byKey.get('CMT-FAM1-01');
    expect(asha).toBeDefined();
    expect(asha!.roles.slice().sort()).toEqual(['admin', 'welcome-team']);
    expect(asha!.source).toBe('family');
    expect(asha!.isTeacher).toBe(false);

    const bala = byKey.get('CMT-FAM2-01');
    expect(bala).toBeDefined();
    expect(bala!.roles).toEqual(['admin']);
    expect(bala!.isTeacher).toBe(true);
    expect(bala!.teacherLevels).toEqual(['Level 2 (West)']);

    const chitra = byKey.get('uid-chitra@example.com');
    expect(chitra).toBeDefined();
    expect(chitra!.roles).toEqual(['admin']);
    expect(chitra!.source).toBe('staff');

    const devi = byKey.get('TCH-DEVI');
    expect(devi).toBeDefined();
    expect(devi!.isTeacher).toBe(true);
    expect(devi!.teacherLevels).toEqual(['Level 1 (East)']);
    expect(devi!.roles).toEqual([]);
    expect(devi!.source).toBe('staff');
    expect(devi!.name).toBe('Devi Nair');

    // the legacy claim on asha@example.com did NOT add a separate uid-asha row
    expect(byKey.has('uid-asha@example.com')).toBe(false);
  });

  it('resolves last sign-in from the auth metadata (family-contact + auth-claim paths), null when never', async () => {
    const byKey = new Map((await listSevaks()).map((s) => [s.key, s]));
    // Asha is a FAMILY member — her last sign-in resolves from the auth user at
    // her canonical contact uid (the new uidOf-based lookup).
    expect(byKey.get('CMT-FAM1-01')!.lastSignIn).toBe('2026-06-20T10:00:00.000Z');
    // Chitra is a standalone auth-claim sevak — resolved directly by her uid.
    expect(byKey.get('uid-chitra@example.com')!.lastSignIn).toBe('2026-06-21T09:00:00.000Z');
    // Devi is a standalone teacher with no auth user → never signed in.
    expect(byKey.get('TCH-DEVI')!.lastSignIn).toBeNull();
  });

  it('sorts rows by name', async () => {
    const sevaks = await listSevaks();
    const names = sevaks.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
