import { NextResponse } from 'next/server';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';

export async function DELETE(_req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  if (!uid) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const auth = portalAuth();
  try {
    const u = await auth.getUser(uid);
    const role = (u.customClaims as Record<string, unknown> | undefined)?.role;
    if (role !== 'welcome-team') {
      return NextResponse.json({ error: 'not-welcome-team' }, { status: 409 });
    }
    await auth.setCustomUserClaims(uid, {});
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    throw err;
  }
}
