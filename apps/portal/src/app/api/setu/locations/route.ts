import { NextResponse } from 'next/server';
import { getLocationOptions } from '@/lib/locations';

/**
 * GET /api/setu/locations
 *
 * PUBLIC, read-only list of the admin-managed centre locations. Consumed by the
 * PRE-AUTH registration wizard's centre picker (the registering user has no
 * session yet) AND any signed-in member's forms. The options are org-wide,
 * non-sensitive config, so no session is required - the route is listed in
 * PUBLIC_ROUTES. Writes go through /api/admin/locations (admin-only).
 */
export async function GET() {
  const options = await getLocationOptions();
  return NextResponse.json({ options });
}
