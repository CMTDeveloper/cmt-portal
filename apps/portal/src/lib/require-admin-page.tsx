import { cookies } from 'next/headers';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { isAdmin, type WithRole } from '@cmt/shared-domain';

/**
 * The SECOND authorization layer for a page that renders admin-only data.
 *
 * Setu route access takes three gates, not one: canAccessRoute in the
 * middleware, a positive check in the page, and (where there is one) a check in
 * the API handler. The /welcome section made that a real requirement on
 * 2026-08-03, when levels / seva / prasad / reports became admin-only: the
 * welcome LAYOUT still admits welcome-team and coordinator — correctly, since
 * they own the roster and the visitors board inside the same layout — so the
 * layout cannot be the gate for the pages they no longer reach.
 *
 * Returns the denial element to render, or null when the caller may proceed:
 *
 *   const denied = await denyUnlessAdmin();
 *   if (denied) return denied;
 *
 * Positive confirmation, never inference: any failure to verify the cookie
 * denies rather than falls through.
 */
export async function denyUnlessAdmin(): Promise<React.ReactElement | null> {
  const cookieStore = await cookies();
  const raw = await verifyPortalSessionCookie(cookieStore.get('__session')?.value ?? '').catch(() => null);
  if (raw && isAdmin(raw as unknown as WithRole)) return null;
  return (
    <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
      <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Admin role required.</p>
    </div>
  );
}
