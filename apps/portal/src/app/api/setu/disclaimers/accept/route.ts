import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSchoolYearConfig } from '@/features/setu/rollover/school-year-config';
import { getDisclaimersConfig } from '@/features/setu/disclaimers/config';
import { recordDisclaimerAcceptance } from '@/features/setu/disclaimers/acceptance';

/** POST /api/setu/disclaimers/accept — record the family's acceptance of the
 *  CURRENT content version + school year (server-authoritative; any client-sent
 *  version is ignored). Manager-only (enforced by canAccessRoute). */
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!session.fid || !session.mid) {
    return NextResponse.json({ error: 'no-family' }, { status: 401 });
  }

  const db = portalFirestore();
  const [config, schoolYearConfig] = await Promise.all([
    getDisclaimersConfig(db),
    getSchoolYearConfig(db),
  ]);

  await recordDisclaimerAcceptance(db, session.fid, {
    version: config.version,
    schoolYear: schoolYearConfig.currentYear,
    byMid: session.mid,
  });
  // Invalidate the family cache so the gate re-reads the fresh acceptance on the
  // subsequent HARD navigation to /family.
  revalidateTag(`family-${session.fid}`, 'max');

  return NextResponse.json({ ok: true, version: config.version }, { status: 200 });
}
