import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(),
}));

vi.mock('@/features/setu/registration/lazy-migrate', () => ({
  lazyMigrateLegacyFamily: vi.fn(),
}));

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { lazyMigrateLegacyFamily } from '@/features/setu/registration/lazy-migrate';
import { resolveKioskFamily, resolveKioskFamilyOrMigrate } from '../resolve-kiosk-family';

const mockFirestore = vi.mocked(portalFirestore);
const mockLazyMigrate = vi.mocked(lazyMigrateLegacyFamily);

type MockDocData = Record<string, unknown>;

// Family docs keyed by their CMT- doc id. The where() mock filters this map by
// the queried field/value so that "legacyFid tried first" is genuinely exercised.
const families = new Map<string, MockDocData>();

function makeDb() {
  return {
    collection: vi.fn((col: string) => {
      // col === 'families'
      if (col !== 'families') {
        throw new Error(`unexpected collection: ${col}`);
      }
      return {
        where: vi.fn((field: string, _op: string, val: string) => ({
          limit: vi.fn((n: number) => ({
            get: vi.fn(async () => {
              const docs = [...families.entries()]
                .filter(([, d]) => d[field] === val)
                .slice(0, n)
                .map(([id, d]) => ({ id, data: () => d }));
              return { docs };
            }),
          })),
        })),
      };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  families.clear();
  mockFirestore.mockReturnValue(makeDb() as never);
});

describe('resolveKioskFamily', () => {
  it('resolves by legacyFid first (the primary door lookup)', async () => {
    families.set('CMT-A', {
      publicFid: '1075',
      legacyFid: '477',
      location: 'Brampton',
      name: 'Rana family',
    });
    const r = await resolveKioskFamily('477');
    expect(r).toMatchObject({
      fid: 'CMT-A',
      matchedOn: 'legacyFid',
      publicFid: '1075',
      legacyFid: '477',
      location: 'Brampton',
      name: 'Rana family',
    });
  });

  it('resolves the LEGACY owner when a number is one family legacyFid AND another family publicFid (the collision)', async () => {
    // The exact door bug: 1257 is Matta's legacy check-in id AND Vadhavkar's new
    // publicFid. A publicFid-first lookup returned Vadhavkar; legacy-first must
    // return Matta (the person entering their legacy id).
    families.set('CMT-MATTA', { publicFid: '1514', legacyFid: '1257', name: 'Matta family' });
    families.set('CMT-VADHAVKAR', { publicFid: '1257', legacyFid: '931', name: 'Vadhavkar family' });
    const r = await resolveKioskFamily('1257');
    expect(r).toMatchObject({ fid: 'CMT-MATTA', matchedOn: 'legacyFid', name: 'Matta family' });
  });

  it('falls back to publicFid when the id is not any family legacyFid', async () => {
    // A Setu-only family (or a family whose new id nobody uses as a legacy id):
    // publicFid resolves via the fallback.
    families.set('CMT-A', {
      publicFid: '1075',
      legacyFid: '477',
      location: 'Brampton',
      name: 'Rana family',
    });
    const r = await resolveKioskFamily('1075');
    expect(r).toMatchObject({ fid: 'CMT-A', matchedOn: 'publicFid' });
  });

  it('returns null for an unknown id', async () => {
    families.set('CMT-A', {
      publicFid: '1075',
      legacyFid: '477',
      location: 'Brampton',
      name: 'Rana family',
    });
    expect(await resolveKioskFamily('999999')).toBeNull();
  });

  it('returns null for blank / whitespace input', async () => {
    expect(await resolveKioskFamily('   ')).toBeNull();
    expect(await resolveKioskFamily('')).toBeNull();
  });

  it('trims surrounding whitespace before matching', async () => {
    families.set('CMT-A', {
      publicFid: '1075',
      legacyFid: '477',
      location: 'Brampton',
      name: 'Rana family',
    });
    const r = await resolveKioskFamily('  1075  ');
    expect(r).toMatchObject({ fid: 'CMT-A', matchedOn: 'publicFid' });
  });

  it('falls back to doc id for name and null for missing optional fields', async () => {
    families.set('CMT-B', { publicFid: '2000' });
    const r = await resolveKioskFamily('2000');
    expect(r).toMatchObject({
      fid: 'CMT-B',
      matchedOn: 'publicFid',
      publicFid: '2000',
      legacyFid: null,
      location: null,
      name: 'CMT-B',
    });
  });
});

describe('resolveKioskFamilyOrMigrate', () => {
  it('returns a Setu hit without migrating', async () => {
    families.set('CMT-A', { publicFid: '5075', legacyFid: '477', name: 'Rana family' });
    const r = await resolveKioskFamilyOrMigrate('477');
    expect(r).toMatchObject({ fid: 'CMT-A', matchedOn: 'legacyFid' });
    expect(mockLazyMigrate).not.toHaveBeenCalled();
  });

  it('on a Setu miss, migrates the legacy family then re-resolves', async () => {
    // The entered number is not in Setu yet (first touch at the door). The
    // migrate "creates" the record - simulated by adding it to the map keyed by
    // the legacyFid = the entered id - so the re-resolve finds it. The migrated
    // record has NO publicFid (minted later by the check-in auto-enroll).
    mockLazyMigrate.mockImplementation(async (legacyFid: string) => {
      families.set('CMT-NEW', { legacyFid, name: 'Door family', location: 'Brampton' });
      return { migrated: true, fid: 'CMT-NEW', legacyFid };
    });
    const r = await resolveKioskFamilyOrMigrate('888');
    expect(mockLazyMigrate).toHaveBeenCalledWith('888');
    expect(r).toMatchObject({ fid: 'CMT-NEW', matchedOn: 'legacyFid', legacyFid: '888', publicFid: null });
  });

  it('returns null when the number is in neither Setu nor the legacy roster', async () => {
    mockLazyMigrate.mockRejectedValue(new Error('Legacy family not found: fid=999'));
    expect(await resolveKioskFamilyOrMigrate('999')).toBeNull();
  });

  it('returns null for blank input without migrating', async () => {
    expect(await resolveKioskFamilyOrMigrate('   ')).toBeNull();
    expect(mockLazyMigrate).not.toHaveBeenCalled();
  });
});
