import { NextResponse } from 'next/server';
import { isAdmin, PrasadPublishBodySchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { CURRENT_PRASAD_PIDS } from '@/features/setu/prasad/constants';
import { publishAssignments } from '@/features/setu/prasad/publish-assignments';
import { notifyUnnotifiedProposals, type ProposalNotifyResult } from '@/features/setu/prasad/proposal-notify';

// Publish + the synchronous proposal-notify fan-out (~357 families × members
// read + up to 4 sends each, chunked ×10) can take minutes at p99 send
// latency. Pin the function to the platform max rather than inheriting a
// shorter default — publish is a once-a-year admin action.
export const maxDuration = 300;

/** POST /api/admin/prasad/publish — write the prasad assignments + config for one period. Admin-only. */
export async function POST(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = PrasadPublishBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error?.issues }, { status: 400 });
  const period = CURRENT_PRASAD_PIDS.find((p) => p.pid === parsed.data.pid);
  if (!period) return NextResponse.json({ error: 'unknown-pid' }, { status: 400 });
  const actor = session.mid ?? session.uid ?? 'admin';
  const result = await publishAssignments(period.pid, period.location, parsed.data.cap, actor);
  // Fire the one-time proposal notifications for anything still un-notified
  // (self-healing — includes rows from a previous publish whose notify crashed).
  // A notify throw must NOT 500 a publish that already landed — surface it as
  // notify.error instead; the next publish click retries the un-stamped rows.
  let notify: ProposalNotifyResult;
  try {
    notify = await notifyUnnotifiedProposals(period.pid);
  } catch (err) {
    console.error('[prasad-publish] notify failed after publish:', err);
    notify = { error: true as const, checked: 0, sent: 0, skipped: 0, failed: 0 };
  }
  return NextResponse.json({ ...result, notify }, { status: 200 });
}
