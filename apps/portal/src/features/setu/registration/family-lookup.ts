import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from './hash-contact-key';

// PUBLIC, unauthenticated lookup. It MUST NOT leak family PII (name, location,
// member count, manager initials) to anyone who can guess a contact — that's
// an enumeration / disclosure vector. It returns only whether one of the
// CALLER'S OWN submitted contacts is already on file, and which one matched, so
// the client can route the user to OTP sign-in with that contact. The family
// details are revealed only AFTER the user proves ownership via OTP sign-in.
export interface LookupResult {
  found: true;
  // Which of the submitted contacts produced the hit — echoes the caller's own
  // input, so it discloses nothing new, and tells the client which contact to
  // sign in with (a user can match via a secondary contact).
  matchedType: 'email' | 'phone';
  matchedValue: string;
}

export interface ContactInput {
  type: 'email' | 'phone';
  value: string;
}

// Search across many contacts. Hash each non-blank contact, read the
// contactKeys, and return whether any matched (no family data). Pure read — no
// auth, no writes (you're searching, not associating). Blank contacts skipped.
export async function lookupFamilyByContactList(
  contacts: ContactInput[],
): Promise<LookupResult | null> {
  const db = portalFirestore();

  // Dedupe valid contacts by their hash (keep first occurrence) so the same
  // contact entered twice is read from Firestore only once. Bounds the fan-out.
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
      exists: (await db.collection('contactKeys').doc(v.hash).get()).exists,
    })),
  );

  // snaps stays parallel to the deduped `valid` list, so the first existing
  // snap also tells us WHICH contact matched. No family doc is read.
  const hit = snaps.find((s) => s.exists);
  if (!hit) return null;

  return { found: true, matchedType: hit.contact.type, matchedValue: hit.contact.value };
}

// Back-compat: the original single email+phone signature still works.
export async function lookupFamilyByContacts(
  email: string,
  phone: string,
): Promise<LookupResult | null> {
  return lookupFamilyByContactList([
    { type: 'email', value: email },
    { type: 'phone', value: phone },
  ]);
}
