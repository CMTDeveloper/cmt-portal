import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import {
  normalizeContact,
  verifyCode,
} from '@/features/check-in/shared';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';
import {
  buildSessionClaimsForContact,
  hasSession,
  isPendingApproval,
} from '@/features/setu/auth/build-session-claims';
import { issueRegistrationGrant } from '@/features/setu/registration/registration-grant';
import { requestFamilyAccess } from '@/features/setu/join-request/request-family-access';
import { portalBaseUrl } from '@/lib/portal-base-url';
import { portalEnv } from '@/lib/env';
import { isSafeInternalPath } from '@cmt/shared-domain';


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

  // Mirrors send-code. Without it a family that somehow reaches the code screen
  // burns verify attempts against a code that was never sent, and the error
  // they see blames them ("invalid or expired") rather than the channel.
  if (type === 'phone' && !flags.smsOtp) {
    return NextResponse.json({ error: 'sms-signin-unsupported' }, { status: 400 });
  }

  const normalized = normalizeContact(type, value);
  const ok = await verifyCode(normalized, code, type);
  if (!ok) {
    return NextResponse.json({ error: 'invalid-or-expired' }, { status: 400 });
  }

  const sessionResult = await buildSessionClaimsForContact({
    type,
    value,
    contactProvenance: 'otp',
  });

  // Gated member: the contact resolves to an existing family member whose
  // portalAccess === 'pending' (a non-primary adult awaiting a manager's
  // approval). We verified OTP ownership, but we do NOT mint a family session
  // or set claims. Surface the pending signal so the sign-in UI can show
  // "access pending your manager's approval" and offer to (re)send the request.
  if (isPendingApproval(sessionResult)) {
    // ── Tell the manager. The screen this produces SAYS we did ────────────────
    //
    // 🔴 Vaibhav, from production 2026-07-31: his wife reached
    // "We've let them know" and he received nothing. Returning the pending
    // signal used to be the whole of this branch, and the only code that ever
    // notified a manager sat behind a button on the next screen labelled
    // "Re-send request" - so the first request was never sent, by construction.
    //
    // Notifying HERE rather than from the client is deliberate: this is the
    // point where the pending state is created, and it is the strongest
    // evidence we will ever have that the requester owns the contact (they
    // just proved it with an OTP). A client-side trigger would also have to be
    // re-added by hand at every future entry point into this state.
    //
    // Deduped by an open request, so re-signing-in next week does not re-ping
    // the manager; failures are swallowed inside the helper.
    try {
      await requestFamilyAccess({
        type,
        value,
        ttlDays: portalEnv().SETU_INVITE_TTL_DAYS,
        baseUrl: portalBaseUrl(req),
      });
    } catch {
      // The member is still correctly pending and the screen still offers an
      // explicit re-send. Never fail a verified sign-in over a notification.
    }
    return NextResponse.json(
      {
        pendingApproval: true,
        pendingFid: sessionResult.pendingFid,
        pendingMatchedMid: sessionResult.pendingMatchedMid,
      },
      { status: 200 },
    );
  }

  if (!hasSession(sessionResult)) {
    // No family for this contact → the user is headed to registration. For an
    // email, mint a one-time registration grant proving this email was just
    // OTP-verified; /api/setu/register requires it before creating the family
    // (closes the unauthenticated-registration / contact-squatting hole). Phone
    // registration is not supported in v1, so no grant is issued for phone.
    const body: { redirectTo: string; registrationGrant?: string } = {
      redirectTo: sessionResult.redirectTo,
    };
    if (type === 'email') {
      body.registrationGrant = await issueRegistrationGrant(value);
    }
    return NextResponse.json(body, { status: 200 });
  }

  const { uid, claims, redirectTo: baseRedirectTo } = sessionResult;

  const reqUrl = new URL(req.url);
  const urlMode = reqUrl.searchParams.get('mode');
  const mode = urlMode === 'mobile' || parsed.data.mode === 'mobile' ? 'mobile' : 'web';

  // Honor same-origin `from=` param (e.g. set by invite-accept redirect).
  let redirectTo = baseRedirectTo;
  const fromParam = reqUrl.searchParams.get('from');
  if (isSafeInternalPath(fromParam)) {
    redirectTo = fromParam;
  }

  const auth = portalAuth();
  await auth.setCustomUserClaims(uid, claims);
  const customToken = await auth.createCustomToken(uid, claims);

  if (mode === 'mobile') {
    return NextResponse.json({ customToken }, { status: 200 });
  }

  const idToken = await exchangeCustomTokenForIdToken(customToken);
  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '14');
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
