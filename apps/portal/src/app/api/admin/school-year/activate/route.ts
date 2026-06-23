import { NextResponse } from 'next/server';
import { revalidateTag, revalidatePath } from 'next/cache';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import {
  getSchoolYearConfig,
  setSchoolYearConfig,
} from '@/features/setu/rollover/school-year-config';
import { deriveNextSchoolYear } from '@/features/setu/rollover/school-year';
import { computeYearReadiness } from '@/features/setu/rollover/year-readiness';
import { getSevaRequirement, setSevaRequirement } from '@/lib/seva-requirement';

/**
 * Flip the live school year forward AND align seva's active year — but only once
 * this year's families have actually been promoted into the next year. The
 * promotion gate (`readiness.promotionRan`) guards against activating an empty
 * next year and stranding every BV family's attendance/dashboard window.
 */
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = portalFirestore();
  const { currentYear } = await getSchoolYearConfig(db);
  const toYear = deriveNextSchoolYear(currentYear);

  const readiness = await computeYearReadiness(db, { fromYear: currentYear, toYear });
  if (!readiness.promotionRan) {
    return NextResponse.json({ error: 'promotion-not-run', toYear }, { status: 409 });
  }

  const actorMid = session.mid ?? session.uid ?? 'unknown';
  const config = await setSchoolYearConfig(db, { currentYear: toYear }, actorMid);
  const seva = await getSevaRequirement();
  await setSevaRequirement({ ...seva, currentSevaYear: toYear });

  revalidateTag('school-year', 'max'); // live-year badges everywhere
  revalidatePath('/admin/school-year'); // the Year center
  return NextResponse.json({ config, sevaYear: toYear }, { status: 200 });
}
