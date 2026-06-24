import { describe, expect, it, vi } from 'vitest';
import {
  fallbackPrasadPeriodsForYear,
  findCurrentPrasadPeriod,
  findPrasadPeriodForPid,
  getCurrentPrasadPeriods,
} from '../current-periods';

vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

function dbWithConfigAndOfferings(
  currentYear: string | null,
  offerings: Array<Record<string, unknown>>,
): FirebaseFirestore.Firestore {
  const filters: Array<{ field: string; value: unknown }> = [];
  const getOfferings = vi.fn(async () => ({
    docs: offerings
      .filter((data) => filters.every((filter) => data[filter.field] === filter.value))
      .map((data) => ({ data: () => data })),
  }));
  const query = {
    where: vi.fn((field: string, _op: string, value: unknown) => {
      filters.push({ field, value });
      return query;
    }),
    get: getOfferings,
  };

  return {
    collection: vi.fn((collection: string) => {
      if (collection === 'app_config') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn(async () => ({
              exists: currentYear !== null,
              data: () => currentYear === null ? undefined : { currentYear },
            })),
          })),
        };
      }
      if (collection === 'offerings') return query;
      throw new Error(`unexpected collection ${collection}`);
    }),
  } as unknown as FirebaseFirestore.Firestore;
}

describe('current prasad periods', () => {
  it('derives fallback pids for a school year', () => {
    expect(fallbackPrasadPeriodsForYear('2026-27')).toEqual([
      { pid: 'bv-brampton-2026-27', location: 'Brampton' },
      { pid: 'bv-scarborough-2026-27', location: 'Scarborough' },
    ]);
  });

  it('uses the default school year when config is missing', async () => {
    await expect(getCurrentPrasadPeriods(dbWithConfigAndOfferings(null, []))).resolves.toEqual([
      { pid: 'bv-brampton-2025-26', location: 'Brampton' },
      { pid: 'bv-scarborough-2025-26', location: 'Scarborough' },
    ]);
  });

  it('uses Bala Vihar offerings from the app-managed current year', async () => {
    const db = dbWithConfigAndOfferings('2026-27', [
      { oid: 'tabla-brampton-2026-27', programKey: 'tabla', termLabel: '2026-27', location: 'Brampton' },
      { oid: 'bv-scarborough-2026-27', programKey: 'bala-vihar', termLabel: '2026-27', location: 'Scarborough' },
      { oid: 'bv-brampton-2026-27', programKey: 'bala-vihar', termLabel: '2026-27', location: 'Brampton' },
      { oid: 'bv-missing-location-2026-27', programKey: 'bala-vihar', termLabel: '2026-27', location: null },
    ]);

    await expect(getCurrentPrasadPeriods(db)).resolves.toEqual([
      { pid: 'bv-brampton-2026-27', location: 'Brampton' },
      { pid: 'bv-scarborough-2026-27', location: 'Scarborough' },
    ]);
  });

  it('falls back to the configured year when no matching offerings exist yet', async () => {
    await expect(getCurrentPrasadPeriods(dbWithConfigAndOfferings('2027-28', []))).resolves.toEqual([
      { pid: 'bv-brampton-2027-28', location: 'Brampton' },
      { pid: 'bv-scarborough-2027-28', location: 'Scarborough' },
    ]);
  });

  it('finds a current pid by id', async () => {
    const db = dbWithConfigAndOfferings('2026-27', [
      { oid: 'bv-brampton-2026-27', programKey: 'bala-vihar', termLabel: '2026-27', location: 'Brampton' },
    ]);

    await expect(findCurrentPrasadPeriod(db, 'bv-brampton-2026-27')).resolves.toEqual({
      pid: 'bv-brampton-2026-27',
      location: 'Brampton',
    });
    await expect(findCurrentPrasadPeriod(db, 'bv-scarborough-2025-26')).resolves.toBeNull();
  });

  it('findPrasadPeriodForPid resolves against the pid OWN year, not the live year', async () => {
    // Live year is 2025-26, but a PREPARING 2026-27 offering exists. The
    // live-year-only resolver misses it; the pid-year resolver finds it.
    const db = dbWithConfigAndOfferings('2025-26', [
      { oid: 'bv-brampton-2025-26', programKey: 'bala-vihar', termLabel: '2025-26', location: 'Brampton' },
      { oid: 'bv-brampton-2026-27', programKey: 'bala-vihar', termLabel: '2026-27', location: 'Brampton' },
    ]);

    await expect(findCurrentPrasadPeriod(db, 'bv-brampton-2026-27')).resolves.toBeNull();
    await expect(findPrasadPeriodForPid(db, 'bv-brampton-2026-27')).resolves.toEqual({
      pid: 'bv-brampton-2026-27',
      location: 'Brampton',
    });
  });
});
