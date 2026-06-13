import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { readSessionFromHeaders } from '@/lib/auth/headers';

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

  // Header-based session (cookie AND Bearer/mobile callers) — middleware
  // forwards the verified uid + contact claims as x-portal-* headers.
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const uid = session.uid;
  const email = session.email;

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
