import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SCHOOL_YEAR_CONFIG,
  getSchoolYearConfig,
  listBalaViharSourceOids,
  resolveBalaViharSourceOids,
  resolveRolloverYearContext,
  setSchoolYearConfig,
} from '../school-year-config';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockGet, set: mockSet }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));

function configDb(): FirebaseFirestore.Firestore {
  return { collection: mockCollection } as unknown as FirebaseFirestore.Firestore;
}

function offeringsDb(docs: Array<Record<string, unknown>>): FirebaseFirestore.Firestore {
  const get = vi.fn(async () => ({
    docs: docs.map((data) => ({ data: () => data })),
  }));
  const secondWhere = vi.fn(() => ({ get }));
  const firstWhere = vi.fn(() => ({ where: secondWhere }));
  const collection = vi.fn(() => ({ where: firstWhere }));
  return { collection } as unknown as FirebaseFirestore.Firestore;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getSchoolYearConfig', () => {
  it('returns the default when the doc is missing', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await getSchoolYearConfig(configDb())).toEqual(DEFAULT_SCHOOL_YEAR_CONFIG);
  });

  it('returns stored config', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ currentYear: '2026-27' }) });
    expect(await getSchoolYearConfig(configDb())).toEqual({ currentYear: '2026-27' });
  });

  it('falls back for malformed stored config', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ currentYear: '2026' }) });
    expect(await getSchoolYearConfig(configDb())).toEqual(DEFAULT_SCHOOL_YEAR_CONFIG);
  });
});

describe('setSchoolYearConfig', () => {
  it('writes config with audit fields', async () => {
    mockSet.mockResolvedValue(undefined);
    await setSchoolYearConfig(configDb(), { currentYear: '2026-27' }, 'admin-mid');
    expect(mockSet).toHaveBeenCalledWith(
      { currentYear: '2026-27', updatedAt: 'SERVER_TS', updatedBy: 'admin-mid' },
      { merge: true },
    );
  });
});

describe('resolveRolloverYearContext', () => {
  it('uses stored current year and derives next year when omitted', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ currentYear: '2026-27' }) });
    expect(await resolveRolloverYearContext(configDb(), {})).toEqual({
      fromYear: '2026-27',
      toYear: '2027-28',
    });
  });

  it('preserves explicit overrides', async () => {
    expect(await resolveRolloverYearContext(configDb(), { fromYear: '2024-25', toYear: '2025-26' })).toEqual({
      fromYear: '2024-25',
      toYear: '2025-26',
    });
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('Bala Vihar source oids', () => {
  it('returns offering ids for the configured year', async () => {
    const db = offeringsDb([{ oid: 'custom-bv-2026-27' }, { oid: 'bv-brampton-2026-27' }]);
    expect(await listBalaViharSourceOids(db, '2026-27')).toEqual(['custom-bv-2026-27', 'bv-brampton-2026-27']);
  });

  it('falls back to known Bala Vihar ids when no offerings exist yet', async () => {
    expect(await resolveBalaViharSourceOids(offeringsDb([]), '2026-27')).toEqual([
      'bv-brampton-2026-27',
      'bv-scarborough-2026-27',
    ]);
  });
});
