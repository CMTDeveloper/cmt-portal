import { NextResponse } from 'next/server';
import { LOCATIONS, type Location } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getPublishedCalendar, getWeeklySchedule } from '@/features/setu/calendar/calendar';

// Published class calendar for a location — readable by any signed-in user.
// Returns only enabled entries plus the weekly time schedule.
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const location = new URL(req.url).searchParams.get('location');
  if (!location || !(LOCATIONS as readonly string[]).includes(location)) {
    return NextResponse.json({ error: 'location-required' }, { status: 400 });
  }

  const [entries, weekly] = await Promise.all([
    getPublishedCalendar(location as Location),
    getWeeklySchedule(location as Location),
  ]);
  return NextResponse.json({ location, entries, weekly });
}
