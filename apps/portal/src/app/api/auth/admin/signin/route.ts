import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  signInWithEmailPassword,
  createPortalSessionCookie,
} from '@cmt/firebase-shared/admin/session';
import { getPortalUserWithClaims } from '@cmt/firebase-shared/admin/claims';


const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  try {
    const { idToken, localId } = await signInWithEmailPassword(
      parsed.data.email,
      parsed.data.password,
    );
    const user = await getPortalUserWithClaims(localId);
    if (user.claims.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '5');
    const session = await createPortalSessionCookie(idToken, expiresInDays);

    const res = NextResponse.json({ redirectTo: '/check-in/admin' }, { status: 200 });
    res.cookies.set('__session', session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: expiresInDays * 24 * 60 * 60,
    });
    return res;
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
}
