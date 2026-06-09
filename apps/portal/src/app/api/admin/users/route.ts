import { NextResponse } from 'next/server';
import { GrantRoleBodySchema, isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { grantRole, listStaff } from '@/features/setu/auth/manage-roles';

// Admin-only Users & Roles surface. The /api/admin/* catch-all in
// canAccessRoute already gates this at the middleware layer; the handler
// re-checks isAdmin defensively (helper-based, honors extraRoles).

export async function GET(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const staff = await listStaff();
  return NextResponse.json({ staff });
}

export async function POST(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = GrantRoleBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await grantRole(parsed.data);
  // The granted capability applies at the target's next sign-in (claims are
  // baked into the session cookie). The UI surfaces that note.
  return NextResponse.json(
    { ok: true, role: parsed.data.role, contact: parsed.data.contact, ...result },
    { status: 201 },
  );
}
