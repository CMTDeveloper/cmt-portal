import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import {
  getVolunteeringSkillOptions,
  setVolunteeringSkillOptions,
} from '@/lib/volunteering-skills';

const PutSchema = z.object({
  options: z.array(z.string().trim().min(1).max(60)).max(50),
});

/** GET /api/admin/volunteering-skills — current options for the admin editor. */
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });

  const options = await getVolunteeringSkillOptions();
  return NextResponse.json({ options });
}

/** PUT /api/admin/volunteering-skills — replace the options list (admin only). */
export async function PUT(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });

  const raw = await req.json().catch(() => null);
  const parsed = PutSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  // Dedupe case-insensitively, keeping the first spelling of each option.
  const seen = new Set<string>();
  const options: string[] = [];
  for (const opt of parsed.data.options) {
    const key = opt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(opt);
  }

  await setVolunteeringSkillOptions(options);
  return NextResponse.json({ options });
}
