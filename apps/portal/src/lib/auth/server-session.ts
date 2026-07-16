import { headers } from 'next/headers';
import { readSessionFromHeaderBag, type PortalSessionHeaders } from './headers';

/**
 * The verified session for a Server Component / layout, read from the x-portal-*
 * request headers middleware already set (its single checkRevoked cookie verify
 * per request). Use this instead of verifyPortalSessionCookie() in render code:
 * re-verifying the cookie there is a redundant Firebase Auth network round-trip
 * on every navigation (middleware is the one revocation gate, and it covers
 * every non-static route via the matcher). Returns null if the headers are
 * absent (fail-closed — the caller renders the signed-out / denied state).
 */
export async function getServerSession(): Promise<PortalSessionHeaders | null> {
  return readSessionFromHeaderBag(await headers());
}
