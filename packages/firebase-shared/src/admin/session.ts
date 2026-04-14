import type { DecodedIdToken } from 'firebase-admin/auth';
import { portalAuth } from './auth';

export type PortalSessionClaims = DecodedIdToken & {
  role?: 'admin' | 'teacher' | 'family';
  familyId?: string;
};

export async function createPortalSessionCookie(
  idToken: string,
  expiresInDays: number,
): Promise<string> {
  const expiresIn = expiresInDays * 24 * 60 * 60 * 1000;
  return portalAuth().createSessionCookie(idToken, { expiresIn });
}

export async function verifyPortalSessionCookie(
  sessionCookie: string,
): Promise<PortalSessionClaims | null> {
  try {
    const decoded = await portalAuth().verifySessionCookie(sessionCookie, true);
    return decoded as PortalSessionClaims;
  } catch {
    return null;
  }
}

export async function verifyPortalIdToken(
  idToken: string,
): Promise<PortalSessionClaims | null> {
  try {
    const decoded = await portalAuth().verifyIdToken(idToken, true);
    return decoded as PortalSessionClaims;
  } catch {
    return null;
  }
}

export async function exchangeCustomTokenForIdToken(customToken: string): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error(
      '[firebase-shared] NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY is required to exchange custom tokens',
    );
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(`[firebase-shared] exchangeCustomTokenForIdToken failed: ${msg}`);
  }
  const json = (await res.json()) as { idToken: string };
  return json.idToken;
}

export async function signInWithEmailPassword(
  email: string,
  password: string,
): Promise<{ idToken: string; localId: string }> {
  const apiKey = process.env.NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error(
      '[firebase-shared] NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY is required for email/password sign-in',
    );
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(`[firebase-shared] signInWithEmailPassword failed: ${msg}`);
  }
  return (await res.json()) as { idToken: string; localId: string };
}
