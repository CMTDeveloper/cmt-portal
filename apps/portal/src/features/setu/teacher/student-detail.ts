import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { isAdmin, type WithRole } from '@cmt/shared-domain';
import { getMyLevels } from './levels';
import { deriveRoster } from './roster';
import { getAttendanceForMember, summarize, type AttendanceRecord, type AttendanceSummary } from './get-attendance';

export interface ParentContact {
  name: string;
  phone: string | null;
  email: string | null;
}

export interface StudentDetail {
  mid: string;
  fid: string;
  firstName: string;
  lastName: string;
  type: 'Adult' | 'Child';
  schoolGrade: string | null;
  foodAllergies: string | null;
  emergencyContacts: Array<{ relation: string; phone: string; email: string } | null>;
  parents: ParentContact[];
  summary: AttendanceSummary;
  records: AttendanceRecord[];
}

/** Find a member by mid across all families. Returns the member + its fid. */
async function findMember(mid: string): Promise<{ data: FirebaseFirestore.DocumentData; fid: string } | null> {
  const snap = await portalFirestore().collectionGroup('members').where('mid', '==', mid).limit(1).get();
  const doc = snap.docs[0];
  if (!doc) return null;
  const fid = doc.ref.parent.parent?.id ?? '';
  return { data: doc.data(), fid };
}

/**
 * May this teacher view this student? Admin always; otherwise the student must
 * appear on the roster of a level the teacher teaches. Reuses deriveRoster so
 * the membership rule stays in one place.
 */
export async function canTeacherSeeStudent(
  session: WithRole & { mid?: string | null },
  mid: string,
): Promise<boolean> {
  if (isAdmin(session)) return true;
  const myLevels = await getMyLevels(session.mid ?? null);
  for (const level of myLevels) {
    const roster = await deriveRoster(level.levelId, '1970-01-01'); // date irrelevant for membership
    if (roster?.members.some((m) => m.mid === mid)) return true;
  }
  return false;
}

/** Full read model for the teacher student-detail view. */
export async function getStudentDetail(mid: string): Promise<StudentDetail | null> {
  const found = await findMember(mid);
  if (!found) return null;
  const { data: m, fid } = found;

  // Parent contacts = manager members of the family (tap-to-reveal in the UI).
  const db = portalFirestore();
  const memSnap = await db.collection('families').doc(fid).collection('members').get();
  const parents: ParentContact[] = memSnap.docs
    .map((d) => d.data())
    .filter((x) => x.type === 'Adult' && x.manager === true)
    .map((x) => ({ name: `${x.firstName} ${x.lastName}`, phone: x.phone ?? null, email: x.email ?? null }));

  const records = await getAttendanceForMember(mid);

  return {
    mid,
    fid,
    firstName: m.firstName,
    lastName: m.lastName,
    type: m.type,
    schoolGrade: m.schoolGrade ?? null,
    foodAllergies: m.foodAllergies ?? null,
    emergencyContacts: (m.emergencyContacts ?? [null, null]) as StudentDetail['emergencyContacts'],
    parents,
    summary: summarize(records),
    records,
  };
}
