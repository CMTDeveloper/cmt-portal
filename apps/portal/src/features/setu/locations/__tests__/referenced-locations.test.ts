import { it, expect, vi, beforeEach } from 'vitest';

// Per-collection count fixtures keyed by `${collection}:${value}`. The mock
// ignores the field + op, so it serves both `where('location','==')` and
// `where('locations','array-contains')` from the same map.
const counts: Record<string, number> = {};
// weeklySchedules is doc-id keyed, so its existence is tracked separately by
// `${collection}:${docId}`.
const docExists: Record<string, boolean> = {};
function coll(name: string) {
  return {
    where: (_f: string, _op: string, val: string) => ({
      count: () => ({ get: async () => ({ data: () => ({ count: counts[`${name}:${val}`] ?? 0 }) }) }),
    }),
    doc: (id: string) => ({
      get: async () => ({ exists: docExists[`${name}:${id}`] ?? false }),
    }),
  };
}
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: vi.fn(() => ({
    collection: (n: string) => coll(n),
    collectionGroup: (n: string) => coll(n),
  })),
}));

import { countLocationReferences } from '../referenced-locations';

beforeEach(() => {
  for (const k of Object.keys(counts)) delete counts[k];
  for (const k of Object.keys(docExists)) delete docExists[k];
});

it('returns 0 when nothing references the location', async () => {
  expect(await countLocationReferences('Oakville')).toBe(0);
});
it('sums references across families, offerings, levels, enrollments', async () => {
  counts['families:Brampton'] = 714;
  counts['offerings:Brampton'] = 1;
  counts['levels:Brampton'] = 8;
  counts['enrollments:Brampton'] = 500;
  expect(await countLocationReferences('Brampton')).toBe(714 + 1 + 8 + 500);
});
it('sums references across all seven denormalized sources', async () => {
  counts['families:Brampton'] = 714;
  counts['offerings:Brampton'] = 1;
  counts['levels:Brampton'] = 8;
  counts['enrollments:Brampton'] = 500;
  counts['programs:Brampton'] = 3;
  counts['classCalendarEntries:Brampton'] = 12;
  docExists['weeklySchedules:Brampton'] = true;
  expect(await countLocationReferences('Brampton')).toBe(714 + 1 + 8 + 500 + 3 + 12 + 1);
});
it('counts a location referenced only by a program (array-contains path)', async () => {
  counts['programs:Milton'] = 2;
  expect(await countLocationReferences('Milton')).toBe(2);
});
it('counts a location referenced only by its weeklySchedules doc (doc-existence path)', async () => {
  docExists['weeklySchedules:Ajax'] = true;
  expect(await countLocationReferences('Ajax')).toBe(1);
});
