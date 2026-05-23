import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from './hash-contact-key';

export interface FamilySummary {
  fid: string;
  name: string;
  location: string;
  memberCount: number;
  managerInitials: string;
}

export async function lookupFamilyByContacts(
  email: string,
  phone: string,
): Promise<FamilySummary | null> {
  const db = portalFirestore();
  const emailHash = hashContactKey('email', email);
  const phoneHash = hashContactKey('phone', phone);

  const [emailSnap, phoneSnap] = await Promise.all([
    db.collection('contactKeys').doc(emailHash).get(),
    db.collection('contactKeys').doc(phoneHash).get(),
  ]);

  const hit = emailSnap.exists ? emailSnap : phoneSnap.exists ? phoneSnap : null;
  if (!hit) return null;

  const { fid } = hit.data() as { fid: string };
  const familySnap = await db.collection('families').doc(fid).get();
  if (!familySnap.exists) return null;

  const family = familySnap.data() as {
    name: string;
    location: string;
    managers: string[];
  };

  const membersSnap = await db.collection('families').doc(fid).collection('members').get();
  const memberCount = membersSnap.size;

  // Build manager initials from the first manager member doc
  let managerInitials = '';
  const firstManagerId = family.managers[0];
  if (firstManagerId) {
    const managerSnap = await db
      .collection('families')
      .doc(fid)
      .collection('members')
      .doc(firstManagerId)
      .get();
    if (managerSnap.exists) {
      const m = managerSnap.data() as { firstName: string; lastName: string };
      managerInitials = `${m.firstName[0] ?? ''}.${m.lastName[0] ?? ''}.`;
    }
  }

  return {
    fid,
    name: family.name,
    location: family.location,
    memberCount,
    managerInitials,
  };
}
