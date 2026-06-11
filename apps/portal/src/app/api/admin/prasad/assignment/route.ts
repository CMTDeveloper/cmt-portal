import { NextResponse } from 'next/server';
import { isAdmin, PrasadAdminReassignBodySchema } from '@cmt/shared-domain';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';

/**
 * PATCH /api/admin/prasad/assignment — front-desk reassign or cancel one prasad
 * row. Admin-only. Admin deliberately bypasses the cap + 7-day move lock that
 * gate family self-service moves — this is the manual override for front-desk
 * judgment (a family that walked up, a swap the engine can't see).
 */
export async function PATCH(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = PrasadAdminReassignBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error?.issues }, { status: 400 });

  const ref = portalFirestore().collection('prasadAssignments').doc(parsed.data.paid);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  if (parsed.data.cancel === true) {
    await ref.update({ status: 'cancelled' });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (parsed.data.assign === true) {
    const data = snap.data() as { status?: string; date?: string } | undefined;
    if (data?.status !== 'proposed') {
      return NextResponse.json({ error: 'not-proposed' }, { status: 409 });
    }
    const actor = session.mid ?? session.uid ?? 'admin';
    await ref.update({
      status: 'assigned',
      confirmedAt: FieldValue.serverTimestamp(),
      confirmedBy: 'admin',
      ...(parsed.data.date !== undefined
        ? { date: parsed.data.date, movedFrom: data?.date ?? null, movedAt: FieldValue.serverTimestamp(), movedBy: actor, source: 'admin' }
        : {}),
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (parsed.data.date !== undefined) {
    const actor = session.mid ?? session.uid ?? 'admin';
    const previousDate = (snap.data() as { date?: string } | undefined)?.date ?? null;
    await ref.update({
      date: parsed.data.date,
      movedFrom: previousDate,
      movedAt: FieldValue.serverTimestamp(),
      movedBy: actor,
      source: 'admin',
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  return NextResponse.json({ error: 'bad-request' }, { status: 400 });
}
