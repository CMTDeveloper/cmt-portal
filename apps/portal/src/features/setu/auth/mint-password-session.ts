import { checkAndRecordOtpRateLimit, normalizeContact } from '@/features/check-in/shared';
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
import { firebaseSignInWithPassword } from '@/features/setu/auth/firebase-rest';
import { isSafeInternalPath } from '@cmt/shared-domain';

export type MintPasswordSessionResult =
  | { status: 'error'; httpStatus: 401 | 403 | 429 | 500; error: string; resetAt?: string }
  | { status: 'pending-approval'; pendingFid: string; pendingMatchedMid: string }
  | { status: 'no-session'; redirectTo: string }
  | { status: 'mobile'; customToken: string }
  | {
      status: 'session';
      redirectTo: string;
      cookieValue: string;
      maxAgeSeconds: number;
      uid: string;
      claims: Record<string, unknown>;
    };

/**
 * Shared cookie-minting core for every password-based sign-in path (family
 * `password-sign-in` + the shared-credential `kiosk-sign-in`). It runs the OTP
 * rate-limiter, the Firebase password sign-in, and the session-claims build,
 * then returns a discriminated-union RESULT that each route maps to its own
 * NextResponse. Keeping the pending-approval / no-session branches as returned
 * variants (rather than baking a response in here) lets each caller decide the
 * exact shape/status it surfaces while the credential-checking core stays in one
 * place.
 */
export async function mintPasswordSession(args: {
  email: string;
  password: string;
  from?: string | null;
  mode?: 'web' | 'mobile';
}): Promise<MintPasswordSessionResult> {
  const { email, password, from, mode = 'web' } = args;

  const normalized = normalizeContact('email', email);

  const rate = await checkAndRecordOtpRateLimit(normalized);
  if (!rate.allowed) {
    return rate.resetAt !== undefined
      ? { status: 'error', httpStatus: 429, error: 'too-many-requests', resetAt: rate.resetAt }
      : { status: 'error', httpStatus: 429, error: 'too-many-requests' };
  }

  const signInResult = await firebaseSignInWithPassword({ email, password });
  if (!signInResult.ok) {
    switch (signInResult.error) {
      case 'invalid-credentials':
        return { status: 'error', httpStatus: 401, error: 'invalid-credentials' };
      case 'user-disabled':
        return { status: 'error', httpStatus: 403, error: 'user-disabled' };
      case 'too-many-requests':
        return { status: 'error', httpStatus: 429, error: 'too-many-requests' };
      default:
        return { status: 'error', httpStatus: 500, error: 'network' };
    }
  }

  const sessionResult = await buildSessionClaimsForContact({
    type: 'email',
    value: email,
    contactProvenance: 'password',
  });

  if (isPendingApproval(sessionResult)) {
    return {
      status: 'pending-approval',
      pendingFid: sessionResult.pendingFid,
      pendingMatchedMid: sessionResult.pendingMatchedMid,
    };
  }

  if (!hasSession(sessionResult)) {
    return { status: 'no-session', redirectTo: sessionResult.redirectTo };
  }

  const { uid, claims, redirectTo: baseRedirectTo } = sessionResult;
  const redirectTo = isSafeInternalPath(from) ? from : baseRedirectTo;

  const auth = portalAuth();
  await auth.setCustomUserClaims(uid, claims);
  const customToken = await auth.createCustomToken(uid, claims);

  if (mode === 'mobile') {
    return { status: 'mobile', customToken };
  }

  const idToken = await exchangeCustomTokenForIdToken(customToken);
  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '14');
  const cookieValue = await createPortalSessionCookie(idToken, expiresInDays);

  return {
    status: 'session',
    redirectTo,
    cookieValue,
    maxAgeSeconds: expiresInDays * 24 * 60 * 60,
    uid,
    claims,
  };
}
