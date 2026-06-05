import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from './hash-contact-key';

export interface FamilySummary {
  fid: string;
  name: string;
  location: string;
  memberCount: number;
  managerInitials: string;
  // Which of the submitted contacts actually produced the hit. A user can match
  // via a SECONDARY contact while their primary email isn't on file — sign-in
  // must OTP the on-file (matched) contact, not the primary.
  matchedType: 'email' | 'phone';
  matchedValue: string;
}

export interface ContactInput {
  type: 'email' | 'phone';
  value: string;
}

type FamilyCore = Omit<FamilySummary, 'matchedType' | 'matchedValue'>;

async function buildFamilySummary(fid: string): Promise<FamilyCore | null> {
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

  // Dedupe valid contacts by their hash (keep first occurrence) so the same
  // contact entered twice — e.g. the primary email also listed as an extra —
  // is read from Firestore only once. Bounds the fan-out.
  const seenHashes = new Set<string>();
  const valid: Array<{ contact: ContactInput; hash: string }> = [];
  for (const contact of contacts) {
    if (contact.value.trim() === '') continue;
    const hash = hashContactKey(contact.type, contact.value);
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);
    valid.push({ contact, hash });
  }
  if (valid.length === 0) return null;

  const snaps = await Promise.all(
    valid.map(async (v) => ({
      contact: v.contact,
      snap: await db.collection('contactKeys').doc(v.hash).get(),
    })),
  );

  // snaps stays parallel to the deduped `valid` list, so the first existing
  // snap also tells us WHICH contact matched.
  const hit = snaps.find((s) => s.snap.exists);
  if (!hit) return null;

  const { fid } = hit.snap.data() as { fid: string };
  const core = await buildFamilySummary(fid);
  if (!core) return null;

  return { ...core, matchedType: hit.contact.type, matchedValue: hit.contact.value };
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
