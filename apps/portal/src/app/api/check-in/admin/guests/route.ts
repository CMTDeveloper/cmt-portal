import { NextResponse } from 'next/server';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';


export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 100);
  const cursor = url.searchParams.get('cursor') ?? undefined;

  const coll = portalFirestore().collection('guest_check_ins');
  let query = coll.orderBy('checkedInAt', 'desc');

  if (cursor) {
    const cursorSnap = await coll.doc(cursor).get();
    if (cursorSnap.exists) {
      query = query.startAfter(cursorSnap);
    }
  }
  query = query.limit(limit);

  const snap = await query.get();
  const guests = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
  const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1]?.id : null;
  return NextResponse.json({ guests, nextCursor }, { status: 200 });
}
