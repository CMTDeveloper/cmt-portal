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
