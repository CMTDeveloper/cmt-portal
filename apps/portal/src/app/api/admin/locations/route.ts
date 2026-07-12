import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getLocationOptions, setLocationOptions } from '@/lib/locations';
import { countLocationReferences } from '@/features/setu/locations/referenced-locations';

const PutSchema = z.object({
  options: z.array(z.string().trim().min(1).max(60)).max(30),
});

/** GET /api/admin/locations - current centre list for the admin editor. */
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });
  return NextResponse.json({ options: await getLocationOptions() });
}

/** PUT /api/admin/locations - replace the centre list (admin only). */
export async function PUT(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });

  const parsed = PutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  // Dedupe case-insensitively, keeping the first spelling of each centre.
  const seen = new Set<string>();
  const options: string[] = [];
  for (const opt of parsed.data.options) {
    const key = opt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(opt);
  }
  if (options.length === 0) {
    return NextResponse.json({ error: 'empty-list' }, { status: 400 });
  }

  // Referential-safety guard: any centre present now but absent from the new
  // list must be unreferenced (the name is the denormalized key).
  const current = await getLocationOptions();
  const nextLower = new Set(options.map((o) => o.toLowerCase()));
  const removed = current.filter((c) => !nextLower.has(c.toLowerCase()));
  for (const location of removed) {
    const count = await countLocationReferences(location);
    if (count > 0) {
      return NextResponse.json({ error: 'location-in-use', location, count }, { status: 409 });
    }
  }

  await setLocationOptions(options);
  return NextResponse.json({ options });
}
