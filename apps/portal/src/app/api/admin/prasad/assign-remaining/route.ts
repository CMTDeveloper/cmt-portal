import { NextResponse } from 'next/server';
import { isAdmin, PrasadAssignRemainingBodySchema } from '@cmt/shared-domain';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { findCurrentPrasadPeriod } from '@/features/setu/prasad/current-periods';

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
  const db = portalFirestore();
  if (!(await findCurrentPrasadPeriod(db, parsed.data.pid))) {
    return NextResponse.json({ error: 'unknown-pid' }, { status: 400 });
  }

  const snap = await db.collection('prasadAssignments')
    .where('pid', '==', parsed.data.pid).where('status', '==', 'proposed').get();

  // Per-doc preconditioned updates, NOT a blind batch: a row cancelled or
  // family-confirmed between the query and the write must not be flipped back
  // to admin-assigned. A precondition conflict means someone else changed the
  // row — skipping is the correct semantics; the admin can re-click.
  let assigned = 0;
  let skipped = 0;
  const CHUNK = 25;
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const results = await Promise.allSettled(
      snap.docs.slice(i, i + CHUNK).map((doc) =>
        doc.ref.update(
          {
            status: 'assigned',
            confirmedAt: FieldValue.serverTimestamp(),
            confirmedBy: 'admin',
          },
          { lastUpdateTime: doc.updateTime }, // precondition: row unchanged since the query
        ),
      ),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') assigned++;
      else skipped++;
    }
  }
  return NextResponse.json({ ok: true, assigned, skipped }, { status: 200 });
}
