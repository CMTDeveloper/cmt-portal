import { NextResponse } from 'next/server';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import {
  CreateCalendarEntrySchema,
  calendarEntryId,
  isAdmin,
  isWelcomeTeam,
  LOCATIONS,
  type Location,
} from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getCalendarSerialized } from '@/features/setu/calendar/calendar';

function sevak(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.uid) return { error: NextResponse.json({ error: 'no-session' }, { status: 401 }) };
  if (!isAdmin(session) && !isWelcomeTeam(session)) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { session };
}

export async function GET(req: Request) {
  const gate = sevak(req);
  if (gate.error) return gate.error;

  const location = new URL(req.url).searchParams.get('location');
  if (!location || !(LOCATIONS as readonly string[]).includes(location)) {
    return NextResponse.json({ error: 'location-required' }, { status: 400 });
  }
  const entries = await getCalendarSerialized(location as Location);
  return NextResponse.json({ entries });
}

export async function POST(req: Request) {
  const gate = sevak(req);
  if (gate.error) return gate.error;
  const { session } = gate;

  const raw = await req.json().catch(() => null);
  const parsed = CreateCalendarEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;
  const entryId = calendarEntryId(data.programKey, data.location, data.date);
  const now = FieldValue.serverTimestamp();

  try {
    await portalFirestore().collection('classCalendarEntries').doc(entryId).create({
      entryId,
      programKey: data.programKey,
      location: data.location,
      date: data.date,
      kind: data.kind,
      classType: data.classType,
      noClassReason: data.noClassReason,
      specialEvents: data.specialEvents,
      enabled: data.enabled,
      createdAt: now,
      createdBy: session!.uid,
      updatedAt: now,
      updatedBy: session!.uid,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 6) {
      return NextResponse.json({ error: 'entry-conflict', entryId }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ entryId }, { status: 201 });
}
