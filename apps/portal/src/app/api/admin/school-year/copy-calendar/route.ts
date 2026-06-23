import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSchoolYearConfig } from '@/features/setu/rollover/school-year-config';
import { deriveNextSchoolYear } from '@/features/setu/rollover/school-year';
import { cloneCalendarYear } from '@/features/setu/rollover/clone-calendar';

/**
 * Clone this year's Bala Vihar class calendar into next year (+364 days so each
 * class Sunday stays a Sunday). Idempotent in the engine — re-runs report
 * already-existing entries rather than overwriting. The /admin/calendar page
 * reads classCalendarEntries fresh/dynamic (no `use cache` tag), so no
 * revalidation is needed here.
 */
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = portalFirestore();
  const { currentYear } = await getSchoolYearConfig(db);
  const toYear = deriveNextSchoolYear(currentYear);
  const result = await cloneCalendarYear(db, { fromYear: currentYear, toYear, dryRun: false });
  return NextResponse.json(result, { status: 200 });
}
