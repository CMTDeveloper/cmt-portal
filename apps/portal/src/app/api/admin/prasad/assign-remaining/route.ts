import { NextResponse } from 'next/server';
import { isAdmin, PrasadAssignRemainingBodySchema } from '@cmt/shared-domain';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { CURRENT_PRASAD_PIDS } from '@/features/setu/prasad/constants';

/** POST /api/admin/prasad/assign-remaining — flip every still-PROPOSED row for
 *  the pid to assigned (confirmedBy:'admin'). The "assign the stragglers"
 *  bulk action before the season starts. Admin-only. */
export async function POST(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = PrasadAssignRemainingBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error?.issues }, { status: 400 });
  if (!CURRENT_PRASAD_PIDS.some((p) => p.pid === parsed.data.pid)) {
    return NextResponse.json({ error: 'unknown-pid' }, { status: 400 });
  }

  const db = portalFirestore();
  const snap = await db.collection('prasadAssignments')
    .where('pid', '==', parsed.data.pid).where('status', '==', 'proposed').get();

  const limit = 400;
  for (let i = 0; i < snap.docs.length; i += limit) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(i, i + limit)) {
      batch.update(doc.ref, {
        status: 'assigned',
        confirmedAt: FieldValue.serverTimestamp(),
        confirmedBy: 'admin',
      });
    }
    await batch.commit();
  }
  return NextResponse.json({ ok: true, assigned: snap.size }, { status: 200 });
}
