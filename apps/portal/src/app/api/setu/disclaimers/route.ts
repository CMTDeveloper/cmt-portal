import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';
import { getDisclaimerStateForFamily } from '@/features/setu/disclaimers/acceptance';

/** GET /api/setu/disclaimers — the signed-in family's disclaimer state
 *  (current content + whether their acceptance is current). Mobile reads this. */
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!session.fid) return NextResponse.json({ error: 'no-family' }, { status: 401 });

  const fam = await getFamilyByFid(session.fid);
  if (!fam) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const state = await getDisclaimerStateForFamily(portalFirestore(), fam.family);
  return NextResponse.json(state, { status: 200 });
}
