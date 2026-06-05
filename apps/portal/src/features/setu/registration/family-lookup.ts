import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from './hash-contact-key';

export interface FamilySummary {
  fid: string;
  name: string;
  location: string;
  memberCount: number;
  managerInitials: string;
}

export interface ContactInput {
  type: 'email' | 'phone';
  value: string;
}

async function buildFamilySummary(fid: string): Promise<FamilySummary | null> {
  const db = portalFirestore();
  const familySnap = await db.collection('families').doc(fid).get();
  if (!familySnap.exists) return null;

  const family = familySnap.data() as {
    name: string;
    location: string;
    managers: string[];
  };

  const membersSnap = await db.collection('families').doc(fid).collection('members').get();
  const memberCount = membersSnap.size;

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

// Search across many contacts. Hash each non-blank contact, read the
// contactKeys, and return the first family hit. Pure read — no auth, no writes
// (you're searching, not associating). Blank/whitespace contacts are skipped.
export async function lookupFamilyByContactList(
  contacts: ContactInput[],
): Promise<FamilySummary | null> {
  const db = portalFirestore();
  const valid = contacts.filter((c) => c.value.trim() !== '');
  if (valid.length === 0) return null;

  const snaps = await Promise.all(
    valid.map((c) => db.collection('contactKeys').doc(hashContactKey(c.type, c.value)).get()),
  );

  const hit = snaps.find((s) => s.exists);
  if (!hit) return null;

  const { fid } = hit.data() as { fid: string };
  return buildFamilySummary(fid);
}

// Back-compat: the original single email+phone signature still works.
export async function lookupFamilyByContacts(
  email: string,
  phone: string,
): Promise<FamilySummary | null> {
  return lookupFamilyByContactList([
    { type: 'email', value: email },
    { type: 'phone', value: phone },
  ]);
}
