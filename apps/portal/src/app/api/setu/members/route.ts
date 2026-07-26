import { NextResponse } from 'next/server';
import { flags } from '@/lib/flags';
import { addMember } from '@/features/setu/members/write-member';

/**
 * Family self-serve: a manager adds a member to their OWN family.
 *
 * Everything about what a valid member write does - the schema, the per-type
 * required-field matrix, the contactKey theft guards, mid allocation - lives in
 * `features/setu/members/write-member.ts`, so the staff cross-family routes
 * cannot drift from this one. What stays here is the only thing that differs:
 * who is allowed in. `actor: null` marks this as a family write, which
 * deliberately produces no audit row.
 */
export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const role = req.headers.get('x-portal-role');
  const fid = req.headers.get('x-portal-fid');

  if (!role) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (role !== 'family-manager') {
    return NextResponse.json({ error: 'manager-required' }, { status: 403 });
  }
  if (!fid) {
    return NextResponse.json({ error: 'missing-fid' }, { status: 400 });
  }

  const raw = await req.json().catch(() => null);
  const result = await addMember({ fid, body: raw, actor: null });
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json({ mid: result.mid }, { status: 201 });
}
