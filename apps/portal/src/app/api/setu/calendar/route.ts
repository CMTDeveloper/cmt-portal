import { NextResponse } from 'next/server';
import { LOCATIONS, type Location } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getPublishedCalendar, getWeeklySchedule } from '@/features/setu/calendar/calendar';
import { getLiveSchoolYearCached } from '@/features/setu/rollover/live-school-year';

// Published class calendar for a location — readable by any signed-in user.
// Returns only enabled entries plus the weekly time schedule.
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session || !session.role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const location = params.get('location');
  if (!location || !(LOCATIONS as readonly string[]).includes(location)) {
    return NextResponse.json({ error: 'location-required' }, { status: 400 });
  }
  // Calendar is per-program. Default to Bala Vihar (the only calendar program
  // today); a mobile client can request another via ?programKey=.
  const programKey = params.get('programKey') || 'bala-vihar';

  const liveYear = await getLiveSchoolYearCached();
  const [entries, weekly] = await Promise.all([
    getPublishedCalendar(location as Location, programKey, liveYear),
    getWeeklySchedule(location as Location),
  ]);
  return NextResponse.json({ location, programKey, entries, weekly });
}
