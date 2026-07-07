import { NextResponse } from 'next/server';
import { getVolunteeringSkillOptions } from '@/lib/volunteering-skills';

/**
 * GET /api/setu/volunteering-skills
 *
 * PUBLIC, read-only list of the admin-managed volunteering-skill options.
 * Consumed by the PRE-AUTH registration wizard's "How can you help?" picker (the
 * registering user has no session yet) AND the authed member add/edit forms. The
 * options are org-wide, non-sensitive config, so no session is required — the
 * route is listed in PUBLIC_ROUTES. Without that, the register form 401s and
 * shows "No volunteering options have been set up yet."
 */
export async function GET() {
  const options = await getVolunteeringSkillOptions();
  return NextResponse.json({ options });
}
