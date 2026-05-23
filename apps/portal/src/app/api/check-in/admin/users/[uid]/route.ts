import { NextResponse } from 'next/server';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';

export const runtime = 'nodejs';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const callerUid = req.headers.get('x-portal-uid');
  if (!callerUid) {
    return NextResponse.json({ error: 'no-uid' }, { status: 401 });
  }
  const { uid } = await params;
  if (uid === callerUid) {
    return NextResponse.json({ error: 'cannot-self-delete' }, { status: 400 });
  }
  await portalAuth().setCustomUserClaims(uid, null);
  await portalAuth().updateUser(uid, { disabled: true });
  return NextResponse.json({ success: true }, { status: 200 });
}
