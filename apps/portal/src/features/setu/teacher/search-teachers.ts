import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { searchFamilies } from '@/features/setu/search/search-families';

export interface TeacherSearchHit {
  mid: string;
  name: string;
  email: string | null;
  fid: string;
  location: string;
}

/**
 * Search assignable teachers by name/email/phone. Reuses the family search
 * (searchKeys array-contains — existing index), then surfaces each matched
 * family's ADULT members (a teacher is an adult) as {mid,name,email}. Bounded:
 * searchFamilies caps at 20 families; we read their members subcollections and
 * cap the result at 15 hits. Read-only. No new index.
 */
export async function searchTeachers(q: string): Promise<TeacherSearchHit[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const db = portalFirestore();
  const families = await searchFamilies(trimmed);
  if (families.length === 0) return [];

  const hits: TeacherSearchHit[] = [];
  const seen = new Set<string>();
  for (const fam of families) {
    const memSnap = await db.collection('families').doc(fam.fid).collection('members').get();
    for (const doc of memSnap.docs) {
      const m = doc.data() as {
        mid?: string;
        type?: string;
        firstName?: string;
        lastName?: string;
        email?: string | null;
      };
      if (m.type !== 'Adult' || typeof m.mid !== 'string' || seen.has(m.mid)) continue;
      seen.add(m.mid);
      hits.push({
        mid: m.mid,
        name: `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.mid,
        email: typeof m.email === 'string' && m.email ? m.email : null,
        fid: fam.fid,
        location: fam.location,
      });
      if (hits.length >= 15) return hits;
    }
  }
  return hits;
}
