import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { findFamilyById } from '@/features/check-in/shared';
import { markSelfCheckInAttendance } from '@/features/setu/check-in/self-check-in-attendance';
import { flags } from '@/lib/flags';
import type { FamilySelfCheckInResponse } from '@cmt/shared-domain/check-in';


const bodySchema = z.object({
  students: z
    .record(z.string(), z.boolean())
    .refine((r) => Object.keys(r).length > 0, { message: 'at-least-one-student-required' }),
});

export async function POST(req: Request) {
  if (!flags.checkInFamily) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

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

  const family = await findFamilyById(familyId);
  if (!family) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  const validSids = new Set(family.students.map((s) => s.sid));
  const foreignSids = Object.keys(parsed.data.students).filter((sid) => !validSids.has(sid));
  if (foreignSids.length > 0) {
    return NextResponse.json({ error: 'invalid-students', foreignSids }, { status: 400 });
  }

  const collection = portalFirestore().collection('check_in_events');
  const checkedInAt = new Date().toISOString();

  const entries = Object.entries(parsed.data.students);
  const docRefs = await Promise.all(
    entries.map(([sid, isPresent]) =>
      collection.add({
        fid: familyId,
        sid,
        status: isPresent ? 'present' : 'absent',
        checkedInBy: 'family' as const,
        checkedInAt,
        recordedByUid: uid,
      }),
    ),
  );
  const checkInIds = docRefs.map((ref) => ref.id);

  // Best-effort: mirror the door kiosk — mark each present child present in their
  // Bala Vihar class attendance so the teacher sees self-checked-in kids too.
  // Legacy ids in, Setu attendance out; never fails the recorded check-in.
  const presentLegacySids = entries.filter(([, isPresent]) => isPresent).map(([sid]) => sid);
  await markSelfCheckInAttendance({ legacyFamilyId: familyId, presentLegacySids });

  const body: FamilySelfCheckInResponse = { success: true, checkInIds };
  return NextResponse.json(body, { status: 200 });
}
