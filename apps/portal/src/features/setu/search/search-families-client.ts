import type { FamilySearchHit } from './types';

export type { FamilySearchHit };

export async function searchFamiliesClient(q: string): Promise<FamilySearchHit[]> {
  const res = await fetch(`/api/setu/family/search?q=${encodeURIComponent(q)}`, {
    credentials: 'same-origin',
  });
  if (!res.ok) {
    // Signal real failures (401, 403, 500) up to the UI so the error toast
    // fires instead of falling back to the empty-results state. The UI's
    // catch block converts this to "Search failed".
    throw new Error(`search-failed-${res.status}`);
  }
  const data = (await res.json()) as { hits: FamilySearchHit[] };
  return data.hits;
}
