import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { isWelcomeTeam, UpdateSevaOpportunitySchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getOpportunity } from '@/features/setu/seva/get-opportunities';

type RouteContext = { params: Promise<{ oppId: string }> };

export async function PATCH(req: Request, ctx: RouteContext) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { oppId } = await ctx.params;
  const raw = await req.json().catch(() => null);
  const parsed = UpdateSevaOpportunitySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });

  const existing = await getOpportunity(oppId);
  if (!existing) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const { date, ...rest } = parsed.data;
  const updates: Record<string, unknown> = {
    ...rest,
    ...(date !== undefined ? { date: new Date(date) } : {}),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: session.uid,
  };
  await portalFirestore().collection('seva_opportunities').doc(oppId).set(updates, { merge: true });
  revalidateTag('seva-opportunities', 'max');
  return NextResponse.json({ ok: true });
}
