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
import { normalizeContactForKey } from '@cmt/shared-domain/setu';
import { getMemberRoles } from '@/features/setu/auth/member-roles';


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

  // Look up Firebase auth user BEFORE the early-return so we can detect
  // admin / welcome-team grants. Roles can live on `role` OR `extraRoles`
  // (multi-role: e.g. a family-manager who is also an admin has
  // role='family-manager', extraRoles=['admin']).
  //
  // uid derives from the *canonical* contact form (E.164 for phone, lowercase
  // for email) so a user who signs in with "4379712609", "+14379712609", or
  // "(437) 971-2609" all map to the same auth user — and grant-admin can
  // pre-create that uid by looking at member.phone (any format) and getting
  // the same canonical hash.
  const uid = sha256Hex(normalizeContactForKey(type, value));
  const auth = portalAuth();
  let existingPrimaryRole: string | undefined;
  let existingExtraRoles: string[] = [];
  try {
    const existing = await auth.getUser(uid);
    const c = (existing.customClaims as Record<string, unknown> | undefined) ?? {};
    if (typeof c.role === 'string') existingPrimaryRole = c.role;
    if (Array.isArray(c.extraRoles)) {
      existingExtraRoles = c.extraRoles.filter((r): r is string => typeof r === 'string');
    }
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser({ uid, disabled: false });
    } else {
      throw err;
    }
  }
  const allExistingRoles = new Set<string>([
    ...(existingPrimaryRole ? [existingPrimaryRole] : []),
    ...existingExtraRoles,
  ]);

  // Member-id-keyed role assignments (canonical source for family-member
  // admins). Decouples "is this person admin" from "which auth uid signed
  // in" — same mid for email + phone sign-in means one grant covers both.
  // Legacy auth-claim grants on the auth user still count as a fallback.
  const memberRoles = result.mid ? await getMemberRoles(result.mid) : [];

  const isAdminUser = allExistingRoles.has('admin') || memberRoles.includes('admin');
  const isWelcomeTeamUser =
    allExistingRoles.has('welcome-team') || memberRoles.includes('welcome-team');

  // extraRoles to attach to the new claims. Family takes the primary slot
  // (it's their main UI surface), and we preserve admin/welcome-team as
  // extras so capability checks (isAdmin etc) still pass.
  function preservedExtras(): string[] {
    const extras: string[] = [];
    if (isAdminUser) extras.push('admin');
    if (isWelcomeTeamUser && !isAdminUser) extras.push('welcome-team');
    return extras;
  }

  if (result.source === null && !hasPendingInvite && !isWelcomeTeamUser && !isAdminUser) {
    // Brand-new family path (no invite, not admin/welcome-team) — keep the
    // old behavior of redirecting to /register without a session.
    return NextResponse.json({ redirectTo: '/register?contact=verified' }, { status: 200 });
  }

  // Build claims — Setu roles extend beyond the legacy PortalClaims type so we
  // set custom claims directly via the Firebase Admin SDK.
  // Canonicalize the contact for the session claim so it doesn't matter
  // whether the user entered "4379712609" or "+14379712609" — the claim
  // always carries the E.164 form for downstream use (display, mobile API).
  const canonicalContact = normalizeContactForKey(type, value);
  const contactClaim = type === 'email' ? { email: canonicalContact } : { phone: canonicalContact };
  let claims: Record<string, unknown> = { role: 'family', familyId: '', ...contactClaim };
  let redirectTo: string = '/register?contact=verified';

  if (result.source === 'setu' && result.fid && result.mid) {
    const isManager = result.member?.manager === true;
    const extras = preservedExtras();
    claims = {
      role: isManager ? 'family-manager' : 'family-member',
      fid: result.fid,
      mid: result.mid,
      ...contactClaim,
      ...(extras.length > 0 ? { extraRoles: extras } : {}),
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
          const extras = preservedExtras();
          claims = {
            role: setuResult.member?.manager === true ? 'family-manager' : 'family-member',
            fid: setuResult.fid,
            mid: setuResult.mid,
            ...contactClaim,
            ...(extras.length > 0 ? { extraRoles: extras } : {}),
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

  // Admin / welcome-team are the LAST priority — only apply when the user
  // has NO family attached. A family-manager who also happens to have
  // admin/welcome-team claim continues to sign in as their family role
  // (these admin roles are for non-family CMT staff). Admin beats
  // welcome-team because admin can do everything welcome-team can.
  // If a multi-role need emerges later, introduce a claims.roles[] array.
  if (result.source === null && !hasPendingInvite) {
    if (isAdminUser) {
      claims = { role: 'admin', ...contactClaim };
      redirectTo = '/admin';
    } else if (isWelcomeTeamUser) {
      claims = { role: 'welcome-team', ...contactClaim };
      redirectTo = '/welcome';
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
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60,
  });
  return res;
}
