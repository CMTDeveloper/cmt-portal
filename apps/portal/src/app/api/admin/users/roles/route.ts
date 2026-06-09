import { NextResponse } from 'next/server';
import { RevokeRoleBodySchema, isAdmin } from '@cmt/shared-domain';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import {
  revokeRole,
  listStaff,
  resolveContactIdentity,
} from '@/features/setu/auth/manage-roles';

// DELETE revokes admin/welcome-team. Admin-only (gated by the /api/admin/*
// catch-all; re-checked defensively). Body is JSON: { contact, role }.
//
// Two guards on revoking 'admin' protect against bricking the org:
//   - self-lockout: an admin cannot strip their OWN admin role (409).
//   - last-admin:   the final remaining admin cannot be removed (409).
export async function DELETE(req: Request) {
  const session = readSessionFromHeaders(req);
  if (!session) {
    return NextResponse.json({ error: 'no-session' }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = RevokeRoleBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { contact, role } = parsed.data;

  if (role === 'admin') {
    // Self-lockout: does this contact resolve to the caller themselves?
    const identity = await resolveContactIdentity(contact);
    const isSelf =
      (identity.mid !== null && identity.mid === session.mid) ||
      (session.uid !== null && identity.uid === session.uid);
    if (isSelf) {
      return NextResponse.json({ error: 'self-lockout' }, { status: 409 });
    }

    // Last-admin: never remove the only remaining admin.
    const staff = await listStaff();
    const admins = staff.filter((s) => s.roles.includes('admin'));
    if (admins.length <= 1) {
      return NextResponse.json({ error: 'last-admin' }, { status: 409 });
    }
  }

  const result = await revokeRole(parsed.data);
  return NextResponse.json({ ok: true, role, contact, ...result });
}
