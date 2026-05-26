import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { cookies } from 'next/headers';

const bodySchema = z.object({
  password: z
    .string()
    .min(8, 'password must be at least 8 characters')
    .max(128, 'password too long'),
});

function isStrongEnough(password: string): boolean {
  return /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('__session')?.value ?? '';
  const claims = sessionCookie ? await verifyPortalSessionCookie(sessionCookie) : null;

  if (!claims) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const uid = claims.uid;
  const email = (claims as Record<string, unknown>).email as string | undefined;

  if (!email) {
    return NextResponse.json({ error: 'no-email-on-session' }, { status: 400 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'bad-request' }, { status: 400 });
  }

  const { password } = parsed.data;

  if (!isStrongEnough(password)) {
    return NextResponse.json({ error: 'password must contain at least one letter and one digit' }, { status: 400 });
  }

  await portalAuth().updateUser(uid, { email, password });

  console.log(`[set-password] uid=${uid} ok`);

  return NextResponse.json({ success: true }, { status: 200 });
}
