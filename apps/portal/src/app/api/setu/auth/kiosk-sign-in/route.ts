import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isKiosk, isSafeInternalPath, type WithRole } from '@cmt/shared-domain';
import { flags } from '@/lib/flags';
import { mintPasswordSession } from '@/features/setu/auth/mint-password-session';

const bodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Shared-credential staff login for the door kiosk. A friendly `sevak` username
 * maps to the dedicated kiosk account's email; the password is checked through
 * the same Firebase pipeline as the family password sign-in (via
 * mintPasswordSession, which also runs the OTP rate-limiter keyed on the kiosk
 * email - throttling brute force against the shared credential).
 *
 * Security posture: never leak WHICH field was wrong (username, password,
 * disabled account, misconfig), so every credential-ish failure collapses to a
 * single 401 invalid-credentials. Only the rate-limit 429 is surfaced distinctly
 * so the UI can show "too many attempts".
 */
export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { username, password } = parsed.data;

  if (username !== (process.env.KIOSK_USERNAME ?? 'sevak')) {
    return NextResponse.json({ error: 'invalid-credentials' }, { status: 401 });
  }

  const email = process.env.KIOSK_ACCOUNT_EMAIL;
  if (!email) {
    return NextResponse.json({ error: 'server-misconfigured' }, { status: 500 });
  }

  const reqUrl = new URL(req.url);
  const from = reqUrl.searchParams.get('from');

  const result = await mintPasswordSession({ email, password, from, mode: 'web' });

  // Surface the rate-limit distinctly (protects the shared credential); collapse
  // every other credential-ish failure to 401 invalid-credentials so the login
  // never reveals whether the password was wrong vs the account disabled vs
  // misconfigured.
  if (result.status === 'error') {
    if (result.httpStatus === 429) {
      return NextResponse.json(
        result.resetAt !== undefined
          ? { error: 'too-many-requests', resetAt: result.resetAt }
          : { error: 'too-many-requests' },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: 'invalid-credentials' }, { status: 401 });
  }

  // pending-approval / no-session / mobile should never occur for the kiosk
  // account (it has no family, and we always request web mode). Treat them
  // defensively as a failed credential rather than minting anything.
  if (result.status !== 'session') {
    return NextResponse.json({ error: 'invalid-credentials' }, { status: 401 });
  }

  // Defensive: never mint a non-kiosk session here even if the resolved account
  // somehow carries a different role.
  if (!isKiosk(result.claims as WithRole)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const redirectTo = isSafeInternalPath(from) ? from : '/check-in';

  const res = NextResponse.json({ redirectTo }, { status: 200 });
  res.cookies.set('__session', result.cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: result.maxAgeSeconds,
  });
  return res;
}
