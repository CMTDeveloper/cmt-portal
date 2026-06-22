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
  // How the client should route this contact:
  //  - 'sign-in'         → the matched member already has portal access (a
  //                        manager, or an active/legacy member). Send them to
  //                        OTP sign-in as before.
  //  - 'request-to-join' → the matched member is GATED (portalAccess:'pending'),
  //                        i.e. a non-manager adult pre-populated by legacy
  //                        migration who has not yet been approved. They cannot
  //                        sign in themselves; route them to "request to join".
  // Still PII-free: this discloses only a routing decision about the caller's
  // OWN contact, never any family detail.
  matchAction: 'sign-in' | 'request-to-join';
}

export interface ContactInput {
  type: 'email' | 'phone';
  value: string;
}

// The body of a contactKeys/{hash} doc. Only the {fid, mid} pointer is needed
// here to load the matched member and classify the routing action.
interface ContactKeyPointer {
  fid?: string;
  mid?: string;
}

// Search across many contacts. Hash each non-blank contact, read the
// contactKeys, and return whether any matched plus how to route it. Pure read —
// no auth, no writes (you're searching, not associating). Blank contacts
// skipped. A contact that is NOT in `contactKeys` never matches — emergency
// contacts are stored only on the member doc and are never indexed into
// contactKeys, so they can never produce a hit here.
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
    valid.map(async (v) => {
      const snap = await db.collection('contactKeys').doc(v.hash).get();
      return {
        contact: v.contact,
        exists: snap.exists,
        // contactKeys body is {contactKey,type,fid,mid,...}; only {fid,mid} is
        // needed to load + classify the member.
        data: snap.exists ? (snap.data() as ContactKeyPointer | undefined) : undefined,
      };
    }),
  );

  // snaps stays parallel to the deduped `valid` list, so the first existing
  // snap also tells us WHICH contact matched.
  const hit = snaps.find((s) => s.exists);
  if (!hit) return null;

  // Classify how the client should route this contact by reading the matched
  // member doc (NOT the family doc — no family PII is read or returned).
  // Default to 'sign-in' (the conservative, existing behaviour) whenever the
  // pointer or member is missing/malformed, so a data anomaly never strands a
  // real owner in the "request to join" flow.
  const matchAction = await classifyMatchAction(db, hit.data);

  return {
    found: true,
    matchedType: hit.contact.type,
    matchedValue: hit.contact.value,
    matchAction,
  };
}

// A member is GATED iff member.portalAccess === 'pending' AND it is NOT a
// manager — exactly the sign-in gate's rule (a manager is never gated, even if
// some data anomaly left them portalAccess:'pending'). Managers and
// active/absent members route to sign-in. Returns the routing action only —
// never the member doc, fid, or any other family detail.
async function classifyMatchAction(
  db: ReturnType<typeof portalFirestore>,
  pointer: ContactKeyPointer | undefined,
): Promise<'sign-in' | 'request-to-join'> {
  const fid = pointer?.fid;
  const mid = pointer?.mid;
  if (typeof fid !== 'string' || fid === '' || typeof mid !== 'string' || mid === '') {
    return 'sign-in';
  }

  const memberSnap = await db
    .collection('families')
    .doc(fid)
    .collection('members')
    .doc(mid)
    .get();
  if (!memberSnap.exists) return 'sign-in';

  const member = memberSnap.data() as { portalAccess?: unknown; manager?: unknown } | undefined;
  // A manager is never gated.
  if (member?.manager === true) return 'sign-in';
  // Optional field; absent ⇒ active. Only an explicit 'pending' gates a
  // non-manager member.
  return member?.portalAccess === 'pending' ? 'request-to-join' : 'sign-in';
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
