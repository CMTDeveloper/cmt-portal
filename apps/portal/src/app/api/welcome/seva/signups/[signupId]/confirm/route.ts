import { NextResponse } from 'next/server';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { isWelcomeTeam, ConfirmSevaSignupSchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSignup } from '@/features/setu/seva/get-signups';
import { getOpportunity } from '@/features/setu/seva/get-opportunities';

type RouteContext = { params: Promise<{ signupId: string }> };

export async function POST(req: Request, ctx: RouteContext) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isWelcomeTeam(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { signupId } = await ctx.params;
  const raw = await req.json().catch(() => null);
  const parsed = ConfirmSevaSignupSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });

  const existing = await getSignup(signupId);
  if (!existing) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  // A family-cancelled sign-up cannot be confirmed (they withdrew). Any other
  // state — signed-up, or a prior completed/no-show being re-adjusted — is fine.
  if (existing.status === 'cancelled') return NextResponse.json({ error: 'not-confirmable' }, { status: 409 });

  const { status } = parsed.data;
  let hoursAwarded = 0;
  if (status === 'completed') {
    if (parsed.data.hoursAwarded != null) {
      hoursAwarded = parsed.data.hoursAwarded;
    } else {
      const opp = await getOpportunity(existing.oppId);
      hoursAwarded = opp?.defaultHours ?? 0;
    }
  }

  await portalFirestore().collection('seva_signups').doc(signupId).set(
    { status, hoursAwarded, confirmedAt: FieldValue.serverTimestamp(), confirmedBy: session.uid },
    { merge: true },
  );
  return NextResponse.json({ ok: true, status, hoursAwarded });
}
