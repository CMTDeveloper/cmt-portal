import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { sha256Hex, normalizeContact } from '@/features/check-in/shared';
import { addCapability, hasCapability, type ClaimsShape } from '@/lib/auth/role-claims';

// Admin-only — canAccessRoute routes /api/check-in/admin/* to isAdmin(claims).
// Middleware enforces this BEFORE we get here.

const grantSchema = z.object({
  email: z.string().email(),
});

export async function GET() {
  const auth = portalAuth();
  const users: Array<{ uid: string; email: string }> = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      const claims = (u.customClaims as ClaimsShape | undefined) ?? null;
      if (hasCapability(claims, 'welcome-team')) {
        const email = typeof claims?.email === 'string' ? claims.email : (u.email ?? '');
        users.push({ uid: u.uid, email });
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);
  users.sort((a, b) => a.email.localeCompare(b.email));
  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = grantSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const { email } = parsed.data;

  // uid must match what verify-code computes for this email, otherwise their
  // welcome-team claim won't survive sign-in.
  const normalized = normalizeContact('email', email);
  const uid = sha256Hex(normalized);

  const auth = portalAuth();
  let existingClaims: ClaimsShape | null = null;
  try {
    const u = await auth.getUser(uid);
    existingClaims = (u.customClaims as ClaimsShape | undefined) ?? null;
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser({ uid, email, disabled: false });
    } else {
      throw err;
    }
  }
  const newClaims = addCapability(existingClaims, 'welcome-team', email);
  await auth.setCustomUserClaims(uid, newClaims);
  return NextResponse.json({ uid, email, claims: newClaims }, { status: 201 });
}
