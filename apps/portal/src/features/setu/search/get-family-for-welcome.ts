import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { SetuSessionClaimsSchema } from '@cmt/shared-domain/setu';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { FamilyDoc, MemberDoc } from '@cmt/shared-domain/setu';

export type FamilyForWelcome = {
  family: FamilyDoc;
  members: MemberDoc[];
};

export async function getFamilyForWelcome(fid: string): Promise<FamilyForWelcome | null> {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  if (!sessionCookie) return null;

  const raw = await verifyPortalSessionCookie(sessionCookie);
  if (!raw) return null;

  const parsed = SetuSessionClaimsSchema.safeParse(raw);
  if (!parsed.success) return null;

  const claims = parsed.data;
  if (claims.role !== 'welcome-team') return null;

  const db = portalFirestore();

  const [familySnap, membersSnap] = await Promise.all([
    db.collection('families').doc(fid).get(),
    db.collection('families').doc(fid).collection('members').get(),
  ]);

  if (!familySnap.exists) return null;

  const familyData = familySnap.data();
  if (!familyData) return null;

  const family: FamilyDoc = {
    fid: familyData.fid,
    legacyFid: familyData.legacyFid ?? null,
    name: familyData.name,
    location: familyData.location,
    createdAt: familyData.createdAt?.toDate() ?? new Date(),
    managers: familyData.managers ?? [],
    searchKeys: familyData.searchKeys ?? [],
  };

  const members: MemberDoc[] = membersSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      mid: d.mid,
      uid: d.uid ?? null,
      firstName: d.firstName,
      lastName: d.lastName,
      type: d.type,
      gender: d.gender,
      manager: d.manager ?? false,
      joinedAt: d.joinedAt?.toDate() ?? new Date(),
      email: d.email ?? null,
      phone: d.phone ?? null,
      schoolGrade: d.schoolGrade ?? null,
      birthMonthYear: d.birthMonthYear ?? null,
      volunteeringSkills: d.volunteeringSkills ?? [],
      foodAllergies: d.foodAllergies ?? null,
      emergencyContacts: d.emergencyContacts ?? [null, null],
    } as MemberDoc;
  });

  return { family, members };
}
