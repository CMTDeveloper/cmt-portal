import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { flags } from '@/lib/flags';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { isSetuFamily } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  // Header-based session (cookie AND Bearer/mobile callers). Identity comes
  // from the verified claims only — never from the body.
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
    .update({ contactsNudgeDismissedAt: FieldValue.serverTimestamp() });

  revalidateTag(`family-${session.fid}`, 'max');
  return NextResponse.json({ ok: true }, { status: 200 });
}
