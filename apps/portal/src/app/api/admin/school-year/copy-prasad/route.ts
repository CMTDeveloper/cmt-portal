import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSchoolYearConfig } from '@/features/setu/rollover/school-year-config';
import { deriveNextSchoolYear } from '@/features/setu/rollover/school-year';
import { clonePrasadConfig } from '@/features/setu/rollover/clone-prasad-config';

/**
 * POST /api/admin/school-year/copy-prasad — clone this year's Bala Vihar prasad
 * cap-per-Sunday config (`prasadConfig/{oid}`) into next year's oids. Optional
 * rollover convenience; idempotent in the engine — re-runs report already-present
 * targets rather than overwriting. Admin-only; gated at the middleware via the
 * canAccessRoute `/api/admin/` rule and re-checked here for defense in depth.
 */
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = portalFirestore();
  const { currentYear } = await getSchoolYearConfig(db);
  const toYear = deriveNextSchoolYear(currentYear);
  const result = await clonePrasadConfig(db, {
    fromYear: currentYear,
    toYear,
    dryRun: false,
    actorMid: session.mid ?? session.uid ?? 'unknown',
  });
  return NextResponse.json(result, { status: 200 });
}
