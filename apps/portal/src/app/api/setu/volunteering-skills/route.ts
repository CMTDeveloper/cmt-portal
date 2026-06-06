import { NextResponse } from 'next/server';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getVolunteeringSkillOptions } from '@/lib/volunteering-skills';

/**
 * GET /api/setu/volunteering-skills
 *
 * Read-only list of the admin-managed volunteering-skill options, consumed by
 * the member add/edit forms. Middleware (canAccessRoute) already restricts this
 * to a signed-in Setu family — including a family-member editing their own
 * profile — so the session check here is defensive.
 */
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  const options = await getVolunteeringSkillOptions();
  return NextResponse.json({ options });
}
