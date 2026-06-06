import { NextResponse } from 'next/server';
import { isAdmin, SevaRequirementConfigSchema } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { getSevaRequirement, setSevaRequirement } from '@/lib/seva-requirement';

/** GET /api/admin/seva/requirement — current seva-hours requirement (admin only). */
export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });

  return NextResponse.json({ requirement: await getSevaRequirement() });
}

/** PUT /api/admin/seva/requirement — persist the seva-hours requirement (admin only). */
export async function PUT(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'admin-required' }, { status: 403 });

  const raw = await req.json().catch(() => null);
  const parsed = SevaRequirementConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  await setSevaRequirement(parsed.data);
  return NextResponse.json({ requirement: parsed.data });
}
