import { NextResponse } from 'next/server';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { isAdmin, UpdateLevelSchema, type LevelDoc } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import {
  assertWritableYear,
  PastYearWriteError,
} from '@/features/setu/rollover/assert-writable-year';

export async function PATCH(req: Request, { params }: { params: Promise<{ levelId: string }> }) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { levelId } = await params;
  const db = portalFirestore();
  const ref = db.collection('levels').doc(levelId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = UpdateLevelSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  // gradeBand consistency against the resulting (merged) levelKind: a partial
  // PATCH may change only one of the pair, so validate against the existing doc.
  const existing = snap.data() as LevelDoc;

  // Past school years are read-only history; live + preparing stay editable.
  // periodLabel is the level's school-year string (e.g. "2025-26").
  try {
    await assertWritableYear(db, existing.periodLabel);
  } catch (e) {
    if (e instanceof PastYearWriteError) {
      return NextResponse.json({ error: 'past-year', year: e.year, liveYear: e.liveYear }, { status: 409 });
    }
    throw e;
  }

  const effectiveKind = data.levelKind ?? existing.levelKind;
  const effectiveBand = data.gradeBand ?? existing.gradeBand;
  if ((effectiveKind === 'level' || effectiveKind === 'pre-level') && effectiveBand.length === 0) {
    return NextResponse.json(
      {
        error: 'bad-request',
        issues: [{ path: ['gradeBand'], message: 'level and pre-level require a non-empty gradeBand' }],
      },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: session.uid,
  };
  if (data.levelName !== undefined) update.levelName = data.levelName;
  if (data.levelKind !== undefined) update.levelKind = data.levelKind;
  if (data.order !== undefined) update.order = data.order;
  if (data.gradeBand !== undefined) update.gradeBand = data.gradeBand;
  if (data.ageLabel !== undefined) update.ageLabel = data.ageLabel;
  if (data.curriculum !== undefined) update.curriculum = data.curriculum;
  if (data.enabled !== undefined) update.enabled = data.enabled;

  await ref.update(update);
  return NextResponse.json({ levelId });
}
