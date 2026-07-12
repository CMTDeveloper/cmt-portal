import { it, expect, vi, beforeEach } from 'vitest';

const counts: Record<string, number> = {};
function coll(name: string) {
  return {
    where: (_f: string, _op: string, val: string) => ({
      count: () => ({ get: async () => ({ data: () => ({ count: counts[`${name}:${val}`] ?? 0 }) }) }),
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

beforeEach(() => { for (const k of Object.keys(counts)) delete counts[k]; });

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
