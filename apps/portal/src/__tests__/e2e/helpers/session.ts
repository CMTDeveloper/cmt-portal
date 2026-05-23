import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';

export interface TestSessionClaims {
  role: 'family-manager' | 'family-member' | 'welcome-team';
  fid?: string;
  mid?: string;
  email?: string;
  phone?: string;
  [key: string]: unknown;
}

/**
 * Mints a real Firebase session cookie for the given uid + claims.
 * Bypasses OTP send/verify — the resulting cookie is valid for the UAT project.
 */
export async function mintTestSession(uid: string, claims: TestSessionClaims): Promise<string> {
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

  await auth.setCustomUserClaims(uid, claims);
  const customToken = await auth.createCustomToken(uid, claims);
  const idToken = await exchangeCustomTokenForIdToken(customToken);
  const expiresInDays = 1;
  return createPortalSessionCookie(idToken, expiresInDays);
}
