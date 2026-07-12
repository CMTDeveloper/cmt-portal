import { NextResponse } from 'next/server';
import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { SetWeeklyScheduleSchema, isAdmin, isWelcomeTeam, type Location } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getWeeklySchedule } from '@/features/setu/calendar/calendar';
import { getLocationOptions } from '@/lib/locations';

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
  const locations = await getLocationOptions();
  if (!location || !locations.includes(location)) {
    return NextResponse.json({ error: 'location-required' }, { status: 400 });
  }
  const rows = await getWeeklySchedule(location as Location);
  return NextResponse.json({ location, rows });
}

export async function PUT(req: Request) {
  const gate = sevak(req);
  if (gate.error) return gate.error;
  const { session } = gate;

  const raw = await req.json().catch(() => null);
  const parsed = SetWeeklyScheduleSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }
  const { location, rows } = parsed.data;
  await portalFirestore().collection('weeklySchedules').doc(location).set({
    location,
    rows,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: session!.uid,
  });
  return NextResponse.json({ location, rows });
}
