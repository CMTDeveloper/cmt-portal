import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSchoolYearConfig } = vi.hoisted(() => ({ getSchoolYearConfig: vi.fn() }));
vi.mock('../school-year-config', () => ({ getSchoolYearConfig }));

import { assertWritableYear, PastYearWriteError } from '../assert-writable-year';

// getSchoolYearConfig is mocked, so the db arg is never read.
const db = {} as FirebaseFirestore.Firestore;

beforeEach(() => {
  vi.clearAllMocks();
  getSchoolYearConfig.mockResolvedValue({ currentYear: '2025-26' });
});

describe('assertWritableYear', () => {
  it('rejects a PAST year (year < live)', async () => {
    await expect(assertWritableYear(db, '2024-25')).rejects.toBeInstanceOf(PastYearWriteError);
    await expect(assertWritableYear(db, '2024-25')).rejects.toMatchObject({
      year: '2024-25',
      liveYear: '2025-26',
    });
  });

  it('resolves for the LIVE year (year == live)', async () => {
    await expect(assertWritableYear(db, '2025-26')).resolves.toBeUndefined();
  });

  it('resolves for a PREPARING / future year (year > live) — prep writes MUST NOT throw', async () => {
    await expect(assertWritableYear(db, '2026-27')).resolves.toBeUndefined();
  });

  it('reads the live year from getSchoolYearConfig', async () => {
    await assertWritableYear(db, '2025-26');
    expect(getSchoolYearConfig).toHaveBeenCalledWith(db);
  });
});
