import { BALA_VIHAR } from '@cmt/shared-domain';

type Db = FirebaseFirestore.Firestore;

export type SchoolYearStatus = 'past' | 'live' | 'preparing';
export interface ViewYear {
  year: string;
  status: SchoolYearStatus;
}

/** Years that actually have BV data (offering termLabels), ascending + deduped. */
export async function listKnownSchoolYears(db: Db, liveYear: string): Promise<string[]> {
  const snap = await db.collection('offerings').where('programKey', '==', BALA_VIHAR).get();
  const set = new Set<string>([liveYear]); // live year always selectable
  for (const d of snap.docs) {
    const t = d.data()['termLabel'];
    if (typeof t === 'string' && /^\d{4}-\d{2}$/.test(t)) set.add(t);
  }
  return [...set].sort();
}

/** Resolve the ?year= selection against the known set; fall back to live. */
export function resolveViewYear(years: string[], liveYear: string, raw: string | null): ViewYear {
  const year = raw && years.includes(raw) ? raw : liveYear;
  const status: SchoolYearStatus =
    year === liveYear ? 'live' : year < liveYear ? 'past' : 'preparing';
  return { year, status };
}
