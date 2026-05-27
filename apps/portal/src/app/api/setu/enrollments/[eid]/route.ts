import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ eid: string }> },
) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  const fid = req.headers.get('x-portal-fid');

  if (!role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (role !== 'family-manager') {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

  const { eid } = await params;

  if (!eid.startsWith(`${fid}-`)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = portalFirestore();
  const enrollmentRef = db
    .collection('families')
    .doc(fid)
    .collection('enrollments')
    .doc(eid);

  try {
    await db.runTransaction(async (txn) => {
      const snap = await txn.get(enrollmentRef);
      if (!snap.exists) throw new Error('enrollment-not-found');
      const data = snap.data() as { status: string };
      if (data.status === 'cancelled') throw new Error('already-cancelled');

      txn.update(enrollmentRef, {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledReason: 'family-initiated',
      });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'enrollment-not-found') {
      return NextResponse.json({ error: 'enrollment-not-found' }, { status: 404 });
    }
    if (msg === 'already-cancelled') {
      return NextResponse.json({ error: 'already-cancelled' }, { status: 409 });
    }
    throw err;
  }

  revalidateTag(`family-${fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
