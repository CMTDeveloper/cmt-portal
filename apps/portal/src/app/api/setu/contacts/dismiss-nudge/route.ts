import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';

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
    .update({ contactsNudgeDismissedAt: FieldValue.serverTimestamp() });

  revalidateTag(`family-${current.family.fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
