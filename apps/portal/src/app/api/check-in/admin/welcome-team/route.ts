import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { sha256Hex, normalizeContact } from '@/features/check-in/shared';

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
      const claims = (u.customClaims as Record<string, unknown> | undefined) ?? {};
      if (claims.role === 'welcome-team') {
        const email = typeof claims.email === 'string' ? claims.email : (u.email ?? '');
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
  try {
    await auth.getUser(uid);
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser({ uid, email, disabled: false });
    } else {
      throw err;
    }
  }
  await auth.setCustomUserClaims(uid, { role: 'welcome-team', email });
  return NextResponse.json({ uid, email }, { status: 201 });
}
