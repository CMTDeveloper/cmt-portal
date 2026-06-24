import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSchoolYearConfig } from '@/features/setu/rollover/school-year-config';
import { deriveNextSchoolYear } from '@/features/setu/rollover/school-year';
import { prefillTeachers } from '@/features/setu/rollover/prefill-teachers';

/**
 * POST /api/admin/school-year/copy-teachers — optional, opt-in teacher pre-fill:
 * carry each current-year Bala Vihar level's `teacherRefs` into its matching
 * next-year level, but ONLY when that target's `teacherRefs` is empty (never
 * clobber an admin assignment). Idempotent — a re-run reports already-filled
 * targets as skipped. Admin-only; gated at the middleware via the canAccessRoute
 * `/api/admin/` rule and re-checked here for defense in depth.
 */
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = portalFirestore();
  const { currentYear } = await getSchoolYearConfig(db);
  const toYear = deriveNextSchoolYear(currentYear);
  const result = await prefillTeachers(db, {
    fromYear: currentYear,
    toYear,
    dryRun: false,
    actorMid: session.mid ?? session.uid ?? 'unknown',
  });
  return NextResponse.json(result, { status: 200 });
}
