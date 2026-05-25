import { NextResponse } from 'next/server';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { removeCapability, hasCapability, type ClaimsShape } from '@/lib/auth/role-claims';

// Admin-only — canAccessRoute routes /api/check-in/admin/* to isAdmin(claims).

export async function DELETE(_req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  if (!uid) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const auth = portalAuth();
  try {
    const u = await auth.getUser(uid);
    const existingClaims = (u.customClaims as ClaimsShape | undefined) ?? null;
    if (!hasCapability(existingClaims, 'welcome-team')) {
      return NextResponse.json({ error: 'not-welcome-team' }, { status: 409 });
    }
    // Drop just the welcome-team capability; preserves family-manager etc.
    // Existing session cookies remain valid until expiry; revokeRefreshTokens
    // is the way to force immediate sign-out.
    const newClaims = removeCapability(existingClaims, 'welcome-team');
    await auth.setCustomUserClaims(uid, newClaims);
    return NextResponse.json({ ok: true, claims: newClaims }, { status: 200 });
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    throw err;
  }
}
