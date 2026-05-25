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
import { getCurrentSessionContact } from '@/features/setu/auth/get-current-session-email';
import { hashContactKey } from '@/features/setu/registration/hash-contact-key';


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

  const session = await getCurrentSessionContact();
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

      // 3. Read family doc
      const familyRef = db.collection('families').doc(fid);
      const familySnap = await txn.get(familyRef);
      if (!familySnap.exists) throw new Error('invite-not-found');

      // 4. Read members subcollection for sequence
      const membersSnap = await txn.get(
        db.collection('families').doc(fid).collection('members'),
      );

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

      const memberCount = (membersSnap as { size: number }).size ?? 0;
      const newMid = `${fid}-${zeroPad(memberCount + 1)}`;
      const nowTs = FieldValue.serverTimestamp();

      // Write new member doc
      const memberRef = db
        .collection('families')
        .doc(fid)
        .collection('members')
        .doc(newMid);
      txn.set(memberRef, {
        mid: newMid,
        uid: session.uid,
        // Placeholder by absence — empty firstName/lastName triggers the
        // "Complete your profile" CTA on the dashboard (family/page.tsx
        // needsProfile = !trimmedFirst). The co-manager fills in their
        // real name in /family/members/[mid]/edit.
        firstName: '',
        lastName: '',
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

      // Update family.managers
      txn.update(familyRef, {
        managers: FieldValue.arrayUnion(newMid),
      });

      // Write contactKey
      txn.set(contactKeyRef, {
        contactKey: contactHash,
        type: session.type,
        fid,
        mid: newMid,
      });

      // Mark invite accepted
      txn.update(inviteDoc.ref, {
        acceptedAt: nowTs,
        acceptedByMid: newMid,
      });

      return { mid: newMid, fid };
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
  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '5');
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
