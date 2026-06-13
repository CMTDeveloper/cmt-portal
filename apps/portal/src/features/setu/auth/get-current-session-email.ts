import 'server-only';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';

export type SessionContact = {
  type: 'email' | 'phone';
  value: string;
  uid: string;
};

/**
 * Returns the verified contact (email or phone) from the session cookie.
 * The verify-code route embeds the raw contact value in the custom claims
 * alongside the role/fid/mid, so we read it from the decoded token directly.
 */
/**
 * Header-based sibling of getCurrentSessionContact for API ROUTE HANDLERS:
 * middleware forwards the verified contact claims as x-portal-email/-phone
 * for BOTH cookie and Bearer (mobile) sessions. Same role gate as the
 * cookie variant — family roles only, including the pre-family 'family'
 * role a fresh invitee holds.
 */
export function getSessionContactFromHeaders(req: Request): SessionContact | null {
  const role = req.headers.get('x-portal-role');
  if (role !== 'family-manager' && role !== 'family-member' && role !== 'family') {
    return null;
  }

  const uid = req.headers.get('x-portal-uid');
  if (!uid) return null;

  const email = req.headers.get('x-portal-email');
  if (email) return { type: 'email', value: email, uid };
  const phone = req.headers.get('x-portal-phone');
  if (phone) return { type: 'phone', value: phone, uid };
  return null;
}

export async function getCurrentSessionContact(): Promise<SessionContact | null> {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value;
  if (!sessionCookie) return null;

  const raw = await verifyPortalSessionCookie(sessionCookie);
  if (!raw) return null;

  const uid = raw.uid as string | undefined;
  if (!uid) return null;

  const role = raw.role as string | undefined;
  if (
    role !== 'family-manager' &&
    role !== 'family-member' &&
    role !== 'family'
  ) {
    return null;
  }

  const email = raw.email as string | undefined;
  const phone = raw.phone as string | undefined;

  if (email) return { type: 'email', value: email, uid };
  if (phone) return { type: 'phone', value: phone, uid };

  return null;
}
