import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSchoolYearConfig } from '@/features/setu/rollover/school-year-config';
import { deriveNextSchoolYear } from '@/features/setu/rollover/school-year';
import { copySevaOpportunities } from '@/features/setu/rollover/copy-seva-opportunities';

const BodySchema = z.object({
  oppIds: z.array(z.string()).min(1),
  decideLater: z.boolean().default(false),
});

/**
 * POST /api/admin/school-year/copy-seva — selectively copy chosen seva
 * opportunities from this year into next year. Body: `{ oppIds, decideLater? }`.
 * Each copy shifts `date` +364 days (same weekday); `decideLater:false` opens it
 * (`status:'open'`), `decideLater:true` lands it as a `status:'draft'` placeholder
 * families never see. Idempotent in the engine — re-runs report already-present
 * targets rather than overwriting. Admin-only; gated at the middleware via the
 * canAccessRoute `/api/admin/` rule and re-checked here for defense in depth.
 */
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad-request', issues: [] }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  const db = portalFirestore();
  const { currentYear } = await getSchoolYearConfig(db);
  const toYear = deriveNextSchoolYear(currentYear);
  const result = await copySevaOpportunities(db, {
    fromYear: currentYear,
    toYear,
    oppIds: parsed.data.oppIds,
    decideLater: parsed.data.decideLater,
    actorMid: session.mid ?? session.uid ?? 'unknown',
  });
  return NextResponse.json(result, { status: 200 });
}
