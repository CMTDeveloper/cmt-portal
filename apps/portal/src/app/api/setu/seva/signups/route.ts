import { NextResponse } from 'next/server';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { CreateSevaSignupSchema, isParticipating } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getFamilyByFid } from '@/features/setu/members/get-family-by-fid';
import { getOpportunity } from '@/features/setu/seva/get-opportunities';
import { getSignup, listSignupsForOpp, signupDocId, isActiveSignup } from '@/features/setu/seva/get-signups';

export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!session.fid) return NextResponse.json({ error: 'missing-fid' }, { status: 400 });

  const raw = await req.json().catch(() => null);
  const parsed = CreateSevaSignupSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  const { oppId, mid } = parsed.data;

  const opp = await getOpportunity(oppId);
  if (!opp) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (opp.status !== 'open') return NextResponse.json({ error: 'not-open' }, { status: 409 });
  if (mid && !mid.startsWith(`${session.fid}-`)) return NextResponse.json({ error: 'invalid-member' }, { status: 400 });
  // The prefix check above proves the mid BELONGS to this family; it does not
  // prove the member exists or still takes part. Without this, seva credit can
  // be recorded against a member the family retired - or against a mid that was
  // never real, since a prefix is trivially constructed. Load the member and
  // ask the one shared question.
  if (mid) {
    const fam = await getFamilyByFid(session.fid);
    const member = fam?.members.find((m) => m.mid === mid);
    if (!member) return NextResponse.json({ error: 'invalid-member' }, { status: 400 });
    if (!isParticipating(member)) {
      return NextResponse.json({ error: 'member-inactive' }, { status: 409 });
    }
  }

  const id = signupDocId(oppId, session.fid);
  const existing = await getSignup(id);
  if (existing && existing.status === 'signed-up') {
    return NextResponse.json({ signupId: id, status: 'signed-up' });
  }
  // A completed / no-show signup must NOT be silently overwritten — that would
  // reset awarded hours once Slice C confirmation exists. Only a cancelled
  // signup is reactivated below; any other resolved state is rejected.
  if (existing && existing.status !== 'cancelled') {
    return NextResponse.json({ error: 'already-resolved' }, { status: 409 });
  }

  if (opp.capacity != null) {
    const signups = await listSignupsForOpp(oppId);
    const active = signups.filter((s) => isActiveSignup(s) && s.signupId !== id).length;
    if (active >= opp.capacity) return NextResponse.json({ error: 'opportunity-full' }, { status: 409 });
  }

  await portalFirestore().collection('seva_signups').doc(id).set({
    signupId: id, oppId, fid: session.fid, mid: mid ?? null,
    sevaYear: opp.sevaYear, status: 'signed-up', hoursAwarded: 0,
    signedUpAt: FieldValue.serverTimestamp(), signedUpByMid: session.mid ?? null,
    confirmedAt: null, confirmedBy: null,
  });
  return NextResponse.json({ signupId: id, status: 'signed-up' }, { status: 201 });
}
