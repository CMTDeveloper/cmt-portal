import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { PromoteBodySchema, isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { promoteFamilies } from '@/features/setu/rollover/promote-families';

/**
 * POST /api/admin/school-year/promote — run the family-promotion engine for the
 * Bala Vihar rollover. `dryRun:true` previews the report with no writes;
 * `dryRun:false` commits the promotion. Admin-only (re-checked here on top of the
 * middleware `/api/admin/` gate). Returns the RolloverReport JSON.
 *
 * On a commit run, per-family enrollment + member docs change, so we invalidate
 * the `family-${fid}` read tag for every affected family in the report. A dry-run
 * performs no writes and therefore does NOT revalidate.
 */
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const parsed = PromoteBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const result = await promoteFamilies(portalFirestore(), {
    ...(parsed.data.fromYear !== undefined ? { fromYear: parsed.data.fromYear } : {}),
    ...(parsed.data.toYear !== undefined ? { toYear: parsed.data.toYear } : {}),
    actorMid: session.mid ?? session.uid ?? 'unknown',
    dryRun: parsed.data.dryRun,
  });

  if (!parsed.data.dryRun) {
    const affectedFids = new Set(result.rows.map((row) => row.fid));
    for (const fid of affectedFids) {
      revalidateTag(`family-${fid}`, 'max');
    }
  }

  return NextResponse.json(result);
}
