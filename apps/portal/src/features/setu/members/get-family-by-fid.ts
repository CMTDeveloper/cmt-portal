import { cacheLife, cacheTag } from 'next/cache';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { FamilyDoc, MemberDoc } from '@cmt/shared-domain/setu';

export type FamilyAndMembers = { family: FamilyDoc; members: MemberDoc[] };

// Cached per-fid via Next.js 16 Cache Components. revalidateTag(`family-${fid}`)
// in mutation routes (POST/PATCH/DELETE /api/setu/members, /api/setu/invite/accept)
// invalidates this. cacheLife 'family' profile is defined in next.config.ts.
export async function getFamilyByFid(fid: string): Promise<FamilyAndMembers | null> {
  'use cache';
  cacheTag(`family-${fid}`);
  cacheLife('family');
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
    publicFid: familyData.publicFid ?? null,
    legacyFid: familyData.legacyFid ?? null,
    name: familyData.name,
    location: familyData.location,
    createdAt: familyData.createdAt?.toDate() ?? new Date(),
    managers: familyData.managers ?? [],
    searchKeys: familyData.searchKeys ?? [],
    familyEmergencyContact: familyData.familyEmergencyContact ?? null,
    disclaimersAccepted: familyData.disclaimersAccepted
      ? {
          schoolYear: familyData.disclaimersAccepted.schoolYear,
          version: familyData.disclaimersAccepted.version,
          acceptedByMid: familyData.disclaimersAccepted.acceptedByMid,
        }
      : null,
  };

  const members: MemberDoc[] = membersSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      mid: d.mid,
      publicMid: d.publicMid ?? null,
      uid: d.uid ?? null,
      firstName: d.firstName,
      lastName: d.lastName,
      type: d.type,
      gender: d.gender,
      manager: d.manager ?? false,
      joinedAt: d.joinedAt?.toDate() ?? new Date(),
      email: d.email ?? null,
      phone: d.phone ?? null,
      altEmails: d.altEmails ?? [],
      altPhones: d.altPhones ?? [],
      contactsNudgeDismissedAt: d.contactsNudgeDismissedAt?.toDate?.() ?? null,
      volunteeringSkillsNudgeDismissedAt: d.volunteeringSkillsNudgeDismissedAt?.toDate?.() ?? null,
      schoolGrade: d.schoolGrade ?? null,
      legacySid: d.legacySid ?? null,
      birthMonthYear: d.birthMonthYear ?? null,
      volunteeringSkills: d.volunteeringSkills ?? [],
      foodAllergies: d.foodAllergies ?? null,
      emergencyContacts: d.emergencyContacts ?? [null, null],
    } as MemberDoc;
  });

  return { family, members };
}
