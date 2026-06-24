import { NextResponse } from 'next/server';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import {
  UpdateCalendarEntrySchema,
  isAdmin,
  isWelcomeTeam,
  type ClassCalendarEntryDoc,
} from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import {
  assertWritableYear,
  PastYearWriteError,
} from '@/features/setu/rollover/assert-writable-year';
import { schoolYearOfDate } from '@/features/setu/rollover/school-year';

function sevak(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) return { error: NextResponse.json({ error: 'no-session' }, { status: 401 }) };
  if (!isAdmin(session) && !isWelcomeTeam(session)) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { session };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const gate = sevak(req);
  if (gate.error) return gate.error;
  const { session } = gate;

  const { entryId } = await params;
  const ref = portalFirestore().collection('classCalendarEntries').doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const raw = await req.json().catch(() => null);
  const parsed = UpdateCalendarEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;
  const existing = snap.data() as ClassCalendarEntryDoc;

  // Past school years are read-only history; live + preparing stay editable.
  try {
    await assertWritableYear(portalFirestore(), schoolYearOfDate(existing.date));
  } catch (e) {
    if (e instanceof PastYearWriteError) {
      return NextResponse.json({ error: 'past-year', year: e.year, liveYear: e.liveYear }, { status: 409 });
    }
    throw e;
  }

  // Reconcile kind/classType against the merged result so a partial PATCH can't
  // leave a class day with no classType or a no-class day with one.
  const kind = data.kind ?? existing.kind;
  const classType = data.classType !== undefined ? data.classType : existing.classType;
  if (kind === 'class' && classType == null) {
    return NextResponse.json(
      { error: 'bad-request', issues: [{ path: ['classType'], message: 'class entries need a classType' }] },
      { status: 400 },
    );
  }
  if (kind === 'no-class' && classType != null) {
    return NextResponse.json(
      { error: 'bad-request', issues: [{ path: ['classType'], message: 'no-class entries must omit classType' }] },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), updatedBy: session!.uid };
  if (data.kind !== undefined) update.kind = data.kind;
  if (data.classType !== undefined) update.classType = data.classType;
  if (data.noClassReason !== undefined) update.noClassReason = data.noClassReason;
  if (data.specialEvents !== undefined) update.specialEvents = data.specialEvents;
  if (data.enabled !== undefined) update.enabled = data.enabled;
  if (data.prasadNeeded !== undefined) update.prasadNeeded = data.prasadNeeded;

  await ref.update(update);
  return NextResponse.json({ entryId });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const gate = sevak(req);
  if (gate.error) return gate.error;

  const { entryId } = await params;
  const ref = portalFirestore().collection('classCalendarEntries').doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  // Past school years are read-only history; live + preparing stay editable.
  const existing = snap.data() as ClassCalendarEntryDoc;
  try {
    await assertWritableYear(portalFirestore(), schoolYearOfDate(existing.date));
  } catch (e) {
    if (e instanceof PastYearWriteError) {
      return NextResponse.json({ error: 'past-year', year: e.year, liveYear: e.liveYear }, { status: 409 });
    }
    throw e;
  }

  await ref.delete();
  return NextResponse.json({ entryId, deleted: true });
}
