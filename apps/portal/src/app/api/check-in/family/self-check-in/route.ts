import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { FamilySelfCheckInResponse } from '@cmt/shared-domain/check-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  students: z.record(z.string(), z.boolean()),
});

export async function POST(req: Request) {
  const familyId = req.headers.get('x-portal-family-id');
  const uid = req.headers.get('x-portal-uid');
  if (!familyId || !uid) {
    return NextResponse.json({ error: 'no-family-id' }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const checkInIds: string[] = [];
  const collection = portalFirestore().collection('check_in_events');
  const checkedInAt = new Date().toISOString();

  for (const [sid, isPresent] of Object.entries(parsed.data.students)) {
    const docRef = await collection.add({
      fid: familyId,
      sid,
      status: isPresent ? 'present' : 'absent',
      checkedInBy: 'family' as const,
      checkedInAt,
      recordedByUid: uid,
    });
    checkInIds.push(docRef.id);
  }

  const body: FamilySelfCheckInResponse = { success: true, checkInIds };
  return NextResponse.json(body, { status: 200 });
}
