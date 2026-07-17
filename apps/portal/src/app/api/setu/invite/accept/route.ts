import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';
import { getSessionContactFromHeaders } from '@/features/setu/auth/get-current-session-email';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';
import { allocateMemberPublicIds } from '@/features/setu/ids/public-id-allocator';


const bodySchema = z.object({
  token: z.string().min(1),
  // Mobile: see apps/portal/docs/mobile-api-integration.md
  mode: z.enum(['web', 'mobile']).optional(),
});

function zeroPad(n: number): string {
  return n.toString().padStart(2, '0');
}

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  // Header-based session contact (cookie AND Bearer/mobile callers) — the
  // cookie-only variant made the mode:'mobile' branch unreachable for
  // Bearer-authenticated invitees.
  const session = getSessionContactFromHeaders(req);
  if (!session) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { token } = parsed.data;
  const db = portalFirestore();

  // Accepting an invite CREATES a new co-manager member doc below, so allocate its
  // user-facing 5-digit publicMid BEFORE the txn opens — the allocator runs its own
  // Firestore transaction and Firestore forbids nested transactions. Exactly one
  // member is created per accept.
  const newPublicMid = (await allocateMemberPublicIds(1))[0]!;

  let result: { mid: string; fid: string };
  try {
    result = await db.runTransaction(async (txn) => {
      // --- ALL READS FIRST ---

      // 1. Look up invite via collectionGroup
      const inviteQuery = await db
        .collectionGroup('invites')
        .where('token', '==', token)
        .limit(1)
        .get();

      if (inviteQuery.empty) throw new Error('invite-not-found');

      const inviteDoc = inviteQuery.docs[0];
      if (!inviteDoc) throw new Error('invite-not-found');

      // 2. Read the invite doc inside the transaction for consistency
      const inviteSnap = await txn.get(inviteDoc.ref);
      if (!inviteSnap.exists) throw new Error('invite-not-found');

      const d = inviteSnap.data() as Record<string, unknown>;
      const now = new Date();
      const expiresAt: Date = (d['expiresAt'] as { toDate?: () => Date })?.toDate
        ? (d['expiresAt'] as { toDate: () => Date }).toDate()
        : new Date(d['expiresAt'] as string);
      const acceptedAt: Date | null = d['acceptedAt']
        ? ((d['acceptedAt'] as { toDate?: () => Date })?.toDate
            ? (d['acceptedAt'] as { toDate: () => Date }).toDate()
            : new Date(d['acceptedAt'] as string))
        : null;

      if (expiresAt <= now) throw new Error('invite-expired');
      if (acceptedAt !== null) throw new Error('invite-already-accepted');

      const inviteEmail = (d['email'] as string).toLowerCase().trim();
      const sessionEmail = session.value.toLowerCase().trim();

      if (inviteEmail !== sessionEmail) throw new Error('email-mismatch');

      const fid = inviteDoc.ref.parent.parent?.id;
      if (!fid) throw new Error('invite-not-found');

      // The invite created a pending member at send time (Feature B); accept LINKS
      // that existing doc rather than creating a duplicate. Legacy invites (created
      // before this change) have no memberMid — those fall back to the create path.
      const memberMid = typeof d['memberMid'] === 'string' ? d['memberMid'] : null;

      // 3. Read family doc
      const familyRef = db.collection('families').doc(fid);
      const familySnap = await txn.get(familyRef);
      if (!familySnap.exists) throw new Error('invite-not-found');

      // 4. Read either the existing pending member (link path) OR the members
      //    subcollection for the next sequence id (legacy create path).
      const existingMemberRef = memberMid
        ? db.collection('families').doc(fid).collection('members').doc(memberMid)
        : null;
      const existingMemberSnap = existingMemberRef ? await txn.get(existingMemberRef) : null;
      const membersSnap = existingMemberRef
        ? null
        : await txn.get(db.collection('families').doc(fid).collection('members'));

      // The invite named a pending member but it's gone (an inconsistent state —
      // cancel deletes the member AND the invite together, so this shouldn't
      // happen). Fail closed rather than mint a colliding sequence id.
      if (existingMemberRef && !existingMemberSnap?.exists) throw new Error('invite-not-found');

      // 5. Read contactKey to check for theft
      const contactHash = hashContactKey(session.type, session.value);
      const contactKeyRef = db.collection('contactKeys').doc(contactHash);
      const contactKeySnap = await txn.get(contactKeyRef);

      if (contactKeySnap.exists) {
        const existing = contactKeySnap.data() as { fid?: string } | undefined;
        if (existing?.fid && existing.fid !== fid) {
          throw new Error('contact-conflict');
        }
      }

      // --- ALL WRITES ---

      const nowTs = FieldValue.serverTimestamp();

      // Resolve the member id being bound. Link path reuses the pending member's
      // mid; create path mints the next sequence id.
      const boundMid =
        existingMemberRef && existingMemberSnap?.exists
          ? memberMid!
          : `${fid}-${zeroPad(((membersSnap as { size: number } | null)?.size ?? 0) + 1)}`;
      const memberRef = db.collection('families').doc(fid).collection('members').doc(boundMid);

      if (existingMemberRef && existingMemberSnap?.exists) {
        // LINK: bind the invitee's auth to the pending member and activate it.
        // Keep its existing publicMid, name, and email (set at invite-send); the
        // allocated newPublicMid is unused here (a tiny id gap is harmless).
        txn.update(memberRef, {
          uid: session.uid,
          inviteStatus: null,
          ...(session.type === 'email' ? { email: session.value } : { phone: session.value }),
        });
      } else {
        // CREATE (legacy invite with no pending member): mint the co-manager now.
        txn.set(memberRef, {
          mid: boundMid,
          publicMid: newPublicMid,
          uid: session.uid,
          firstName: typeof d['firstName'] === 'string' ? d['firstName'] : '',
          lastName: typeof d['lastName'] === 'string' ? d['lastName'] : '',
          type: 'Adult',
          gender: 'PreferNotToSay',
          manager: true,
          joinedAt: nowTs,
          email: session.type === 'email' ? session.value : null,
          phone: session.type === 'phone' ? session.value : null,
          schoolGrade: null,
          birthMonthYear: null,
          volunteeringSkills: [],
          foodAllergies: null,
          emergencyContacts: [null, null],
        });
      }

      // Update family.managers (arrayUnion is idempotent if already present)
      txn.update(familyRef, {
        managers: FieldValue.arrayUnion(boundMid),
      });

      // Write contactKey
      txn.set(contactKeyRef, {
        contactKey: contactHash,
        type: session.type,
        fid,
        mid: boundMid,
      });

      // Mark invite accepted
      txn.update(inviteDoc.ref, {
        acceptedAt: nowTs,
        acceptedByMid: boundMid,
      });

      return { mid: boundMid, fid };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'invite-not-found') {
      return NextResponse.json({ error: 'invite-not-found' }, { status: 404 });
    }
    if (msg === 'invite-expired') {
      return NextResponse.json({ error: 'expired' }, { status: 410 });
    }
    if (msg === 'invite-already-accepted') {
      return NextResponse.json({ error: 'already-accepted' }, { status: 409 });
    }
    if (msg === 'email-mismatch') {
      return NextResponse.json({ error: 'email-mismatch' }, { status: 403 });
    }
    if (msg === 'contact-conflict') {
      return NextResponse.json({ error: 'contact-already-registered' }, { status: 409 });
    }
    throw err;
  }

  const { mid, fid } = result;
  revalidateTag(`family-${fid}`, 'max');
  const auth = portalAuth();

  const claims: Record<string, unknown> = {
    role: 'family-manager',
    fid,
    mid,
    ...(session.type === 'email' ? { email: session.value } : { phone: session.value }),
  };
  await auth.setCustomUserClaims(session.uid, claims);
  const customToken = await auth.createCustomToken(session.uid, claims);

  const urlMode = new URL(req.url).searchParams.get('mode');
  const mode = parsed.data.mode === 'mobile' || urlMode === 'mobile' ? 'mobile' : 'web';

  if (mode === 'mobile') {
    return NextResponse.json(
      { mid, fid, redirectTo: '/family', customToken },
      { status: 200 },
    );
  }

  const idToken = await exchangeCustomTokenForIdToken(customToken);
  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '14');
  const sessionCookie = await createPortalSessionCookie(idToken, expiresInDays);

  const res = NextResponse.json({ mid, fid, redirectTo: '/family' }, { status: 200 });
  res.cookies.set('__session', sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60,
  });
  return res;
}
