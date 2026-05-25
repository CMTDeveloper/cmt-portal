import { NextResponse } from 'next/server';
import { z } from 'zod';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { getOrCreateAdminUser } from '@cmt/firebase-shared/admin/claims';
import { hasCapability, type ClaimsShape } from '@/lib/auth/role-claims';


export async function GET() {
  const result = await portalAuth().listUsers(1000);
  // hasCapability honors extraRoles so a family-manager with admin extra
  // shows up in the admin list, not just primary-role admins.
  const users = result.users
    .filter((u) => hasCapability((u.customClaims as ClaimsShape | undefined) ?? null, 'admin'))
    .map((u) => ({ uid: u.uid, email: u.email ?? '' }));
  return NextResponse.json({ users }, { status: 200 });
}

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const user = await getOrCreateAdminUser(parsed.data.email, parsed.data.password);
  return NextResponse.json(
    { uid: user.uid, email: user.email ?? parsed.data.email },
    { status: 201 },
  );
}
