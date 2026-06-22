import 'server-only';
import { randomBytes } from 'node:crypto';
import {
  portalFirestore,
  FieldValue,
  Timestamp,
} from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';

export interface CreateRequestInput {
  type: 'email' | 'phone';
  value: string;
  ttlDays: number;
}

// A manager to notify once a request is created. Email is the primary channel;
// phone is best-effort SMS.
export interface ManagerNotifyTarget {
  email: string | null;
  phone: string | null;
  name: string;
}

export type CreateRequestResult =
  | {
      // A fresh pending request was written (or an existing open one was reused
      // — `created` distinguishes the two so the route can decide whether to
      // re-notify). Either way the route should always answer {ok:true}.
      outcome: 'created' | 'deduped';
      token: string;
      fid: string;
      familyName: string;
      requesterEmail: string;
      requesterContact: string;
      requesterName: string;
      managers: ManagerNotifyTarget[];
    }
  | {
      // No actionable request: the contact didn't match a gated member (no
      // contactKey, member already active/absent, or member is a manager). The
      // route must STILL answer {ok:true} (anti-enumeration) and notify no one.
      outcome: 'noop';
    };

// Coerce a Firestore Timestamp | Date | ISO-string | null into a Date (or null).
function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') return maybe.toDate();
  return new Date(value as string);
}

function memberDisplayName(
  m: { displayName?: string; firstName?: string; lastName?: string } | undefined,
  fallback: string,
): string {
  if (m?.displayName && m.displayName.trim()) return m.displayName.trim();
  const first = (m?.firstName ?? '').trim();
  const last = (m?.lastName ?? '').trim();
  const full = `${first} ${last}`.trim();
  return full || fallback;
}

// Resolve a contact to a gated member, dedupe an existing open request, and
// write a pending joinRequests/{token} doc. Returns the data the caller needs
// to notify the family's managers. Never throws on the "no actionable match"
// paths — it returns outcome:'noop' so the route can keep the anti-enumeration
// {ok:true} contract.
export async function createJoinRequest(
  input: CreateRequestInput,
): Promise<CreateRequestResult> {
  const db = portalFirestore();
  const normalizedValue =
    input.type === 'email' ? input.value.toLowerCase().trim() : input.value.trim();
  const requesterEmail = input.type === 'email' ? normalizedValue : '';

  // 1. Resolve fid+mid from the contactKey body. Emergency contacts were never
  //    indexed, so they produce no contactKey → no match → noop.
  const hash = hashContactKey(input.type, input.value);
  const contactKeySnap = await db.collection('contactKeys').doc(hash).get();
  if (!contactKeySnap.exists) return { outcome: 'noop' };
  const ck = contactKeySnap.data() as { fid?: string; mid?: string } | undefined;
  const fid = ck?.fid;
  const matchedMid = ck?.mid;
  if (!fid || !matchedMid) return { outcome: 'noop' };

  // 2. Load the matched member — only a gated (portalAccess:'pending'),
  //    non-manager member is actionable.
  const memberSnap = await db
    .collection('families')
    .doc(fid)
    .collection('members')
    .doc(matchedMid)
    .get();
  if (!memberSnap.exists) return { outcome: 'noop' };
  const member = memberSnap.data() as
    | {
        portalAccess?: 'active' | 'pending';
        manager?: boolean;
        firstName?: string;
        lastName?: string;
        displayName?: string;
      }
    | undefined;
  // gated iff portalAccess === 'pending' AND not already a manager.
  if (member?.manager === true) return { outcome: 'noop' };
  if (member?.portalAccess !== 'pending') return { outcome: 'noop' };

  // 3. Load the family doc (name + managers list).
  const familySnap = await db.collection('families').doc(fid).get();
  if (!familySnap.exists) return { outcome: 'noop' };
  const familyData = familySnap.data() as
    | { name?: string; managers?: string[] }
    | undefined;
  const familyName = familyData?.name ?? fid;
  const managerMids = Array.isArray(familyData?.managers) ? familyData.managers : [];

  const requesterContact = input.type === 'email' ? normalizedValue : input.value.trim();
  const requesterName = memberDisplayName(member, requesterContact);

  // Resolve manager notify targets (email + phone + name) from member docs.
  const managers = await resolveManagerTargets(db, fid, managerMids);

  // 4. Dedupe by DETERMINISTIC doc id. The request doc lives at
  //    families/{fid}/joinRequests/{matchedMid} (NOT a random token), so two
  //    concurrent sends for the same member resolve to the SAME doc and can
  //    never create two pending rows. The random `token` is kept as a stored
  //    FIELD (used for the email link + the collectionGroup get-by-token).
  const requestRef = db
    .collection('families')
    .doc(fid)
    .collection('joinRequests')
    .doc(matchedMid);

  const existingSnap = await requestRef.get();
  if (existingSnap.exists) {
    const existing = existingSnap.data() as
      | { token?: string; status?: string; expiresAt?: unknown }
      | undefined;
    const expiresAt = toDate(existing?.expiresAt);
    const stillOpen =
      existing?.status === 'pending' && (expiresAt === null || expiresAt > new Date());
    if (stillOpen) {
      // A live open request already exists — dedupe (re-clicks won't re-notify).
      return {
        outcome: 'deduped',
        token: existing?.token ?? matchedMid,
        fid,
        familyName,
        requesterEmail,
        requesterContact,
        requesterName,
        managers,
      };
    }
    // Otherwise (declined/approved/expired) we fall through and OVERWRITE the
    // doc with a fresh pending request, so a re-request after a decline works.
  }

  // 5. Write (or overwrite) the pending request at the deterministic doc id.
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + input.ttlDays * 86400_000);

  await requestRef.set({
    token,
    fid,
    matchedMid,
    requesterEmail,
    ...(input.type === 'phone' ? { requesterPhone: input.value.trim() } : {}),
    requesterName,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
  });

  return {
    outcome: 'created',
    token,
    fid,
    familyName,
    requesterEmail,
    requesterContact,
    requesterName,
    managers,
  };
}

async function resolveManagerTargets(
  db: ReturnType<typeof portalFirestore>,
  fid: string,
  managerMids: string[],
): Promise<ManagerNotifyTarget[]> {
  if (managerMids.length === 0) return [];
  const refs = managerMids.map((mid) =>
    db.collection('families').doc(fid).collection('members').doc(mid),
  );
  const snaps = await db.getAll(...refs);
  const targets: ManagerNotifyTarget[] = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const m = snap.data() as
      | { email?: string | null; phone?: string | null; firstName?: string; lastName?: string; displayName?: string }
      | undefined;
    const email = m?.email ?? null;
    const phone = m?.phone ?? null;
    if (!email && !phone) continue;
    targets.push({ email, phone, name: memberDisplayName(m, 'A family manager') });
  }
  return targets;
}
