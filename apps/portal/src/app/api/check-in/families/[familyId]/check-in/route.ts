import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { findFamilyById } from '@/features/check-in/shared';
import { resolveSender } from '@/lib/aws/resolve-sender';

export const runtime = 'nodejs';

const bodySchema = z.object({
  students: z.record(z.string(), z.boolean()),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ familyId: string }> },
) {
  const { familyId } = await params;
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const family = await findFamilyById(familyId);
  if (!family) {
    return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  }

  const coll = portalFirestore().collection('check_in_events');
  const checkedInAt = new Date().toISOString();
  const checkInIds: string[] = [];

  for (const [sid, isPresent] of Object.entries(parsed.data.students)) {
    const ref = await coll.add({
      fid: familyId,
      sid,
      status: isPresent ? 'present' : 'absent',
      checkedInBy: 'sevak' as const,
      checkedInAt,
    });
    checkInIds.push(ref.id);
  }

  if (family.paymentStatus !== 'paid') {
    const email = family.contacts.find((c) => c.type === 'email')?.value;
    if (email) {
      await resolveSender().sendEmail({
        to: email,
        subject: 'Payment reminder — Chinmaya Mission Toronto',
        text: `Hari OM ${family.name}, your family check-in was recorded. Please see a sevak to settle your outstanding payment.`,
      });
    }
  }

  return NextResponse.json({ success: true, checkInIds }, { status: 200 });
}
