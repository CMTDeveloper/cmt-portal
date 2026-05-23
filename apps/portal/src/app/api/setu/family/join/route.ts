import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { joinFamily } from '@/features/setu/registration/family-join';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';
import { normalizeContact, sha256Hex } from '@/features/check-in/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  fid: z.string().min(1),
  contactProof: z.object({
    type: z.enum(['email', 'phone']),
    value: z.string().min(3),
  }),
});

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { fid, contactProof } = parsed.data;
  const { type, value } = contactProof;

  let joinResult: { fid: string; mid: string; isManager: boolean };
  try {
    joinResult = await joinFamily({ fid, contactProof });
  } catch (err) {
    const message = (err as Error).message ?? '';
    if (message.includes('Contact not found') || message.includes('does not belong')) {
      return NextResponse.json({ error: 'contact-mismatch' }, { status: 403 });
    }
    if (message.includes('family-not-found') || message.includes('Family not found')) {
      return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
    }
    throw err;
  }

  // Create / ensure Firebase Auth user
  const normalized = normalizeContact(type, value);
  const uid = sha256Hex(normalized);
  const auth = portalAuth();

  try {
    await auth.getUser(uid);
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      await auth.createUser({ uid, disabled: false });
    } else {
      throw err;
    }
  }

  const contactClaim = type === 'email' ? { email: value } : { phone: value };
  const claims: Record<string, unknown> = {
    role: joinResult.isManager ? 'family-manager' : 'family-member',
    fid: joinResult.fid,
    mid: joinResult.mid,
    ...contactClaim,
  };
  await auth.setCustomUserClaims(uid, claims);
  const customToken = await auth.createCustomToken(uid, claims);
  const idToken = await exchangeCustomTokenForIdToken(customToken);

  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '5');
  const session = await createPortalSessionCookie(idToken, expiresInDays);

  const res = NextResponse.json({ fid: joinResult.fid, mid: joinResult.mid }, { status: 200 });
  res.cookies.set('__session', session, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60,
  });
  return res;
}
