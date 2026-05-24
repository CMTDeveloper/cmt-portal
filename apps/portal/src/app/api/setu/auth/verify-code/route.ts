import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import {
  normalizeContact,
  sha256Hex,
  verifyCode,
} from '@/features/check-in/shared';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';
import { lazyMigrateLegacyFamily } from '@/features/setu/registration/lazy-migrate';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';


const bodySchema = z.object({
  type: z.enum(['email', 'phone']),
  value: z.string().min(3),
  code: z.string().regex(/^\d{6}$/),
  mode: z.enum(['web', 'mobile']).optional(),
});

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { type, value, code } = parsed.data;
  const normalized = normalizeContact(type, value);
  const ok = await verifyCode(normalized, code, type);
  if (!ok) {
    return NextResponse.json({ error: 'invalid-or-expired' }, { status: 400 });
  }

  const result = await findSetuFamilyByContact(type, value);

  // No family found in Setu OR legacy. Check for a pending invite — if one
  // exists, the OTP-verified user is a legitimate invitee and needs a session
  // (with role='family') to call POST /api/setu/invite/accept. Without a
  // session, accept would 401 in a loop. If no invite either, fall through
  // to the original /register flow (no session — they're a brand-new family).
  let hasPendingInvite = false;
  if (result.source === null && type === 'email') {
    try {
      const db = portalFirestore();
      const snap = await db
        .collectionGroup('invites')
        .where('email', '==', normalized)
        .where('acceptedAt', '==', null)
        .limit(1)
        .get();
      if (!snap.empty) {
        const data = snap.docs[0]?.data() as { expiresAt?: { toDate?: () => Date } | string } | undefined;
        const expiresAt = data?.expiresAt && typeof data.expiresAt === 'object' && data.expiresAt.toDate
          ? data.expiresAt.toDate()
          : data?.expiresAt
            ? new Date(data.expiresAt as string)
            : null;
        if (expiresAt && expiresAt > new Date()) hasPendingInvite = true;
      }
    } catch (err) {
      console.error('[verify-code] invite lookup failed:', err);
    }
  }

  if (result.source === null && !hasPendingInvite) {
    // Brand-new family path (no invite) — keep the old behavior of redirecting
    // to /register without a session. Registration flow creates the session.
    return NextResponse.json({ redirectTo: '/register?contact=verified' }, { status: 200 });
  }

  const uid = sha256Hex(normalized);
  const auth = portalAuth();

  try {
    await auth.getUser(uid);
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser({ uid, disabled: false });
    } else {
      throw err;
    }
  }

  // Build claims — Setu roles extend beyond the legacy PortalClaims type so we
  // set custom claims directly via the Firebase Admin SDK.
  const contactClaim = type === 'email' ? { email: value } : { phone: value };
  let claims: Record<string, unknown> = { role: 'family', familyId: '', ...contactClaim };
  let redirectTo: string = '/register?contact=verified';

  if (result.source === 'setu' && result.fid && result.mid) {
    const isManager = result.member?.manager === true;
    claims = {
      role: isManager ? 'family-manager' : 'family-member',
      fid: result.fid,
      mid: result.mid,
      ...contactClaim,
    };
    redirectTo = '/family';
  } else {
    // Legacy hit — attempt lazy single-family migration to Setu on first sign-in.
    const legacyFid = result.legacyFid ?? '';
    let migratedToSetu = false;

    if (legacyFid) {
      try {
        await lazyMigrateLegacyFamily(legacyFid);
        // Re-lookup to get the new Setu fid/mid after migration
        const setuResult = await findSetuFamilyByContact(type, value);
        if (setuResult.source === 'setu' && setuResult.fid && setuResult.mid) {
          claims = {
            role: setuResult.member?.manager === true ? 'family-manager' : 'family-member',
            fid: setuResult.fid,
            mid: setuResult.mid,
            ...contactClaim,
          };
          redirectTo = '/family';
          migratedToSetu = true;
        }
      } catch (err) {
        console.error('[verify-code] lazyMigrateLegacyFamily failed', err);
      }
    }

    if (!migratedToSetu) {
      // Migration failed or re-lookup missed — use legacy claims, send to register
      claims = { role: 'family', familyId: legacyFid, ...contactClaim };
      redirectTo = '/register?contact=verified';
    }
  }

  await auth.setCustomUserClaims(uid, claims);
  const customToken = await auth.createCustomToken(uid, claims);

  const reqUrl = new URL(req.url);
  const urlMode = reqUrl.searchParams.get('mode');
  const mode = urlMode === 'mobile' || parsed.data.mode === 'mobile' ? 'mobile' : 'web';

  // Honor same-origin `from=` param (e.g. set by invite-accept redirect).
  const fromParam = reqUrl.searchParams.get('from');
  if (fromParam && fromParam.startsWith('/') && !fromParam.startsWith('//')) {
    redirectTo = fromParam;
  }

  if (mode === 'mobile') {
    return NextResponse.json({ customToken }, { status: 200 });
  }

  const idToken = await exchangeCustomTokenForIdToken(customToken);
  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '5');
  const session = await createPortalSessionCookie(idToken, expiresInDays);

  const res = NextResponse.json({ redirectTo }, { status: 200 });
  res.cookies.set('__session', session, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60,
  });
  return res;
}
