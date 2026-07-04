import { describe, it, expect } from 'vitest';
import { findNameConflict, normalizeLevelName } from '../level-name-conflict';

/**
 * Minimal fake Firestore matching the single access pattern the helper uses:
 * `db.collection('levels').where('pid', '==', pid).get()`. Only `levels` docs
 * with a matching `pid` field are returned — mirroring the real single-field
 * index query (phantom docs with no `pid` field are never returned).
 */
interface FakeLevel {
  id: string;
  pid?: string;
  location?: string;
  levelName?: string;
}

function fakeDb(levels: FakeLevel[]) {
  return {
    collection(name: string) {
      if (name !== 'levels') throw new Error(`unexpected collection ${name}`);
      return {
        where(field: string, op: string, value: unknown) {
          if (field !== 'pid' || op !== '==') {
            throw new Error(`unexpected query ${field} ${op}`);
          }
          const matched = levels.filter((l) => l.pid === value);
          return {
            async get() {
              return {
                docs: matched.map((l) => ({
                  id: l.id,
                  data: () => ({ location: l.location, levelName: l.levelName }),
                })),
              };
            },
          };
        },
      };
    },
  } as unknown as FirebaseFirestore.Firestore;
}

// Two Brampton levels in pid 'bv-brampton-2025-26': "Level 2" and "Level 3",
// plus a Scarborough "Level 2" (same pid, different location) and a phantom
// partial doc (no pid/location/levelName — a denormalized teacherRefs write).
const db = fakeDb([
  { id: 'brampton-level-2-bv-brampton-2025-26', pid: 'bv-brampton-2025-26', location: 'Brampton', levelName: 'Level 2' },
  { id: 'brampton-level-3-bv-brampton-2025-26', pid: 'bv-brampton-2025-26', location: 'Brampton', levelName: 'Level 3' },
  { id: 'scarborough-level-2-bv-brampton-2025-26', pid: 'bv-brampton-2025-26', location: 'Scarborough', levelName: 'Level 2' },
  { id: 'phantom-partial-doc' }, // teacherRefs-only write: no pid → never queried
]);

describe('normalizeLevelName', () => {
  it('trims, collapses whitespace, and lowercases', () => {
    expect(normalizeLevelName('  Level   2 ')).toBe('level 2');
    expect(normalizeLevelName('LEVEL 2')).toBe('level 2');
  });
});

describe('findNameConflict', () => {
  it('returns the conflicting levelId when a name normalizes-equal within (location, pid)', async () => {
    expect(
      await findNameConflict(db, { location: 'Brampton', pid: 'bv-brampton-2025-26', normalizedName: 'level 2' }),
    ).toBe('brampton-level-2-bv-brampton-2025-26');
  });

  it('matches case- and spacing-insensitively (the caller normalizes the incoming name)', async () => {
    expect(
      await findNameConflict(db, {
        location: 'Brampton',
        pid: 'bv-brampton-2025-26',
        normalizedName: normalizeLevelName('  level    2 '),
      }),
    ).toBe('brampton-level-2-bv-brampton-2025-26');
  });

  it('ignores the level being edited via exceptLevelId', async () => {
    expect(
      await findNameConflict(db, {
        location: 'Brampton',
        pid: 'bv-brampton-2025-26',
        normalizedName: 'level 2',
        exceptLevelId: 'brampton-level-2-bv-brampton-2025-26',
      }),
    ).toBeNull();
  });

  it('allows the same name at a DIFFERENT location', async () => {
    // "Level 2" exists at Scarborough in this pid; querying Scarborough for a
    // name that only exists at Brampton must not conflict.
    expect(
      await findNameConflict(db, { location: 'Scarborough', pid: 'bv-brampton-2025-26', normalizedName: 'level 3' }),
    ).toBeNull();
  });

  it('returns null when there is no matching name', async () => {
    expect(
      await findNameConflict(db, { location: 'Brampton', pid: 'bv-brampton-2025-26', normalizedName: 'level 9' }),
    ).toBeNull();
  });
});
