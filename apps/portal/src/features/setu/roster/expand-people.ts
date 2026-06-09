import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { RosterFamilyRow, RosterPersonCsvRow } from '@cmt/shared-domain/setu';

const EXPORT_FAMILY_CAP = 2000;

/** Expand roster families into one CSV row per member. Reads each family's members + the family's active programs already on the row. */
export async function expandPeople(families: RosterFamilyRow[]): Promise<RosterPersonCsvRow[]> {
  const db = portalFirestore();
  const capped = families.slice(0, EXPORT_FAMILY_CAP);
  if (families.length > EXPORT_FAMILY_CAP) {
    console.warn(`roster CSV: capped at ${EXPORT_FAMILY_CAP} families; dropped ${families.length - EXPORT_FAMILY_CAP}`);
  }
  const rows: RosterPersonCsvRow[] = [];
  for (const fam of capped) {
    const memberSnap = await db.collection('families').doc(fam.fid).collection('members').limit(100).get();
    const programs = fam.programs.join('; ');
    for (const m of memberSnap.docs) {
      const d = m.data() as { firstName?: unknown; lastName?: unknown; type?: unknown; schoolGrade?: unknown };
      rows.push({
        familyName: fam.name,
        fid: fam.fid,
        legacyFid: fam.legacyFid ?? '',
        memberName: `${String(d.firstName ?? '')} ${String(d.lastName ?? '')}`.trim(),
        type: String(d.type ?? ''),
        grade: typeof d.schoolGrade === 'string' ? d.schoolGrade : '',
        location: fam.location,
        programs,
        payment: fam.payment,
      });
    }
  }
  return rows;
}
