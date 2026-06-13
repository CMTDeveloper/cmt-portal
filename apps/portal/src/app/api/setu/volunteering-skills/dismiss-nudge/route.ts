import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { isSetuFamily } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';

/**
 * POST /api/setu/volunteering-skills/dismiss-nudge
 *
 * Marks the one-time "set your volunteering skills" dashboard nudge as
 * dismissed for the SIGNED-IN member only (identity from the verified
 * session headers — never from the body; works for cookie AND Bearer/mobile
 * callers). Covered by the isSetuFamily canAccessRoute rule for
 * /api/setu/volunteering-skills/*.
 */
export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const session = readSessionFromHeaders(req);
  if (!session || !isSetuFamily(session) || !session.fid || !session.mid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const db = portalFirestore();
  await db
    .collection('families')
    .doc(session.fid)
    .collection('members')
    .doc(session.mid)
    .update({ volunteeringSkillsNudgeDismissedAt: FieldValue.serverTimestamp() });

  revalidateTag(`family-${session.fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
