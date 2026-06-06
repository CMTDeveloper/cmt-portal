import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSignup } from '@/features/setu/seva/get-signups';

type Ctx = { params: Promise<{ signupId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.fid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  const { signupId } = await ctx.params;
  const existing = await getSignup(signupId);
  if (!existing) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (existing.fid !== session.fid) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (existing.status !== 'signed-up') return NextResponse.json({ error: 'not-cancellable' }, { status: 409 });
  await portalFirestore().collection('seva_signups').doc(signupId).set({ status: 'cancelled' }, { merge: true });
  return NextResponse.json({ ok: true });
}
