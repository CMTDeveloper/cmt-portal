import { NextResponse } from 'next/server';
import { isAdmin, PrasadPreviewBodySchema } from '@cmt/shared-domain';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { findCurrentPrasadPeriod } from '@/features/setu/prasad/current-periods';
import { previewAssignments } from '@/features/setu/prasad/publish-assignments';

/** POST /api/admin/prasad/preview — dry-run the prasad assigner for one period. Admin-only. */
export async function POST(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = PrasadPreviewBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error?.issues }, { status: 400 });
  const period = await findCurrentPrasadPeriod(portalFirestore(), parsed.data.pid);
  if (!period) return NextResponse.json({ error: 'unknown-pid' }, { status: 400 });
  const result = await previewAssignments(period.pid, period.location, parsed.data.cap);
  return NextResponse.json(result, { status: 200 });
}
