import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { memberMatchesLevel, type LevelDoc, type Location } from '@cmt/shared-domain';

export interface UnassignedStudent {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  schoolGrade: string | null;
}

/**
 * Children with an active enrollment at `location` whose grade/age matches NO
 * enabled level there — the §6 data-gap a welcome-team member chases down
 * (grade typo, missing grade, or a level not yet created). Computed, not stored.
 */
export async function findUnassignedStudents(
  location: Location,
  now: Date = new Date(),
): Promise<UnassignedStudent[]> {
  const db = portalFirestore();

  const levelsSnap = await db
    .collection('levels')
    .where('location', '==', location)
    .where('enabled', '==', true)
    .get();
  const levels = levelsSnap.docs.map((d) => d.data() as LevelDoc);

  const enrollSnap = await db.collectionGroup('enrollments').where('status', '==', 'active').get();
  const fids = [
    ...new Set(
      enrollSnap.docs
        .map((d) => d.data() as { fid?: string; location?: string })
        .filter((e) => e.location === location && typeof e.fid === 'string')
        .map((e) => e.fid as string),
    ),
  ];

  const out: UnassignedStudent[] = [];
  for (const fid of fids) {
    const memSnap = await db.collection('families').doc(fid).collection('members').get();
    for (const doc of memSnap.docs) {
      const m = doc.data();
      if (m.type !== 'Child') continue;
      const member = { type: 'Child' as const, schoolGrade: m.schoolGrade ?? null, birthMonthYear: m.birthMonthYear ?? null };
      const matchesAny = levels.some((lvl) => memberMatchesLevel(member, lvl, now));
      if (!matchesAny) {
        out.push({ mid: m.mid, fid, firstName: m.firstName, lastName: m.lastName, schoolGrade: m.schoolGrade ?? null });
      }
    }
  }
  out.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  return out;
}
