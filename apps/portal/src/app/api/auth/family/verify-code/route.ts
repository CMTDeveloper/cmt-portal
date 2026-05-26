import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import {
  findFamilyByContact,
  normalizeContact,
  sha256Hex,
  verifyCode,
} from '@/features/check-in/shared';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalCustomToken,
  setPortalUserClaims,
} from '@cmt/firebase-shared/admin/claims';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';


const bodySchema = z.object({
  type: z.enum(['email', 'phone']),
  value: z.string().min(3),
  code: z.string().regex(/^\d{6}$/),
  mode: z.enum(['web', 'mobile']).optional(),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  if (!flags.checkInFamily) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const normalized = normalizeContact(parsed.data.type, parsed.data.value);
  const ok = await verifyCode(normalized, parsed.data.code, parsed.data.type);
  if (!ok) {
    return NextResponse.json({ error: 'invalid-or-expired' }, { status: 401 });
  }

  const family = await findFamilyByContact(parsed.data.type, parsed.data.value);
  if (!family) {
    return NextResponse.json({ error: 'invalid-or-expired' }, { status: 401 });
  }

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

  const contactClaim =
    parsed.data.type === 'email'
      ? { email: parsed.data.value }
      : { phone: parsed.data.value };
  await setPortalUserClaims(uid, {
    role: 'family',
    familyId: family.fid,
    ...contactClaim,
  });

  const customToken = await createPortalCustomToken(uid, {
    role: 'family',
    familyId: family.fid,
  });
  const urlMode = new URL(req.url).searchParams.get('mode');
  const mode = urlMode === 'mobile' || parsed.data.mode === 'mobile' ? 'mobile' : 'web';

  if (mode === 'mobile') {
    return NextResponse.json({ customToken }, { status: 200 });
  }

  const idToken = await exchangeCustomTokenForIdToken(customToken);
  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '14');
  const session = await createPortalSessionCookie(idToken, expiresInDays);

  const res = NextResponse.json({ redirectTo: '/check-in/family' }, { status: 200 });
  res.cookies.set('__session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60,
  });
  return res;
}
