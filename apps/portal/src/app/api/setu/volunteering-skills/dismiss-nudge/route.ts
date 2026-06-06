import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';

/**
 * POST /api/setu/volunteering-skills/dismiss-nudge
 *
 * Marks the one-time "set your volunteering skills" dashboard nudge as
 * dismissed for the SIGNED-IN member only (identity from the session via
 * getCurrentFamily — never from the body). Covered by the isSetuFamily
 * canAccessRoute rule for /api/setu/volunteering-skills/*.
 */
export async function POST(_req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const current = await getCurrentFamily();
  if (!current) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const db = portalFirestore();
  await db
    .collection('families')
    .doc(current.family.fid)
    .collection('members')
    .doc(current.currentMid)
    .update({ volunteeringSkillsNudgeDismissedAt: FieldValue.serverTimestamp() });

  revalidateTag(`family-${current.family.fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
