import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { UpdateProgramSchema, isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getProgram } from '@/features/setu/programs/get-programs';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'admin-required' }, { status: 403 });
  }

  const { key } = await params;

  const existing = await getProgram(key);
  if (!existing) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = UpdateProgramSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const db = portalFirestore();
  const programRef = db.collection('programs').doc(key);

  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: session.uid,
  };

  if (data.label !== undefined) update['label'] = data.label;
  if (data.shortDescription !== undefined) update['shortDescription'] = data.shortDescription;
  if (data.status !== undefined) update['status'] = data.status;
  if (data.locations !== undefined) update['locations'] = data.locations;
  if (data.termType !== undefined) update['termType'] = data.termType;
  if (data.eligibility !== undefined) update['eligibility'] = data.eligibility;
  if (data.capabilities !== undefined) update['capabilities'] = data.capabilities;
  if (data.displayOrder !== undefined) update['displayOrder'] = data.displayOrder;

  await programRef.update(update);

  revalidateTag('programs', 'max');
  revalidateTag(`program-${key}`, 'max');

  return NextResponse.json({ programKey: key });
}
