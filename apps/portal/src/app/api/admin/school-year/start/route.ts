import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { StartYearBodySchema, isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { startNewYear } from '@/features/setu/rollover/start-new-year';

/**
 * POST /api/admin/school-year/start — clone a school year's Bala Vihar levels
 * + offerings from `fromYear` to `toYear` (engine defaults when omitted).
 * Admin-only; gated at the middleware via canAccessRoute `/api/admin/` rule and
 * re-checked here for defense in depth. Returns the StartYearResult JSON.
 */
export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const parsed = StartYearBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const result = await startNewYear(portalFirestore(), {
    ...(parsed.data.fromYear !== undefined ? { fromYear: parsed.data.fromYear } : {}),
    ...(parsed.data.toYear !== undefined ? { toYear: parsed.data.toYear } : {}),
    actorMid: session.mid ?? session.uid ?? 'unknown',
    dryRun: false,
  });

  // start clones offerings + levels; invalidate both read surfaces.
  revalidateTag('offerings', 'max');
  revalidateTag('levels', 'max');

  return NextResponse.json(result);
}
