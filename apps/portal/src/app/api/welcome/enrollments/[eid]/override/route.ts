import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { isWelcomeTeam, OverrideEnrollmentBodySchema } from '@cmt/shared-domain';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eid: string }> },
) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const session = readSessionFromHeaders(req);
  if (!session) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isWelcomeTeam(session)) {
    return NextResponse.json({ error: 'welcome-team-required' }, { status: 403 });
  }

  const { eid } = await params;

  const raw = await req.json().catch(() => null);
  const parsed = OverrideEnrollmentBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = portalFirestore();

  // eid = "{fid}-{pid}" — look up by collectionGroup to avoid needing fid upfront.
  const enrollmentSnaps = await db
    .collectionGroup('enrollments')
    .where('eid', '==', eid)
    .limit(1)
    .get();

  if (enrollmentSnaps.empty) {
    return NextResponse.json({ error: 'enrollment-not-found' }, { status: 404 });
  }

  const enrollmentRef = enrollmentSnaps.docs[0]!.ref;
  const enrollmentData = enrollmentSnaps.docs[0]!.data() as { status: string; fid: string };

  if (enrollmentData.status !== 'active') {
    return NextResponse.json({ error: 'enrollment-not-active' }, { status: 409 });
  }

  await enrollmentRef.update({
    suggestedAmountOverride: parsed.data.suggestedAmountOverride,
    updatedAt: FieldValue.serverTimestamp(),
  });

  revalidateTag(`family-${enrollmentData.fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
