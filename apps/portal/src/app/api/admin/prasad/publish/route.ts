import { NextResponse } from 'next/server';
import { isAdmin, PrasadPublishBodySchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { CURRENT_PRASAD_PIDS } from '@/features/setu/prasad/constants';
import { publishAssignments } from '@/features/setu/prasad/publish-assignments';

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
  return NextResponse.json(result, { status: 200 });
}
