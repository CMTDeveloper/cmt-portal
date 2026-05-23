import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { registerFamily, type AdditionalMember } from '@/features/setu/registration/register-family';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';
import { sha256Hex } from '@/features/check-in/shared';
import { normalizeContact } from '@/features/check-in/shared';


const additionalMemberSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  type: z.enum(['Adult', 'Child']),
  gender: z.enum(['Male', 'Female', 'PreferNotToSay']),
  schoolGrade: z.string().optional(),
  birthMonthYear: z.string().optional(),
  foodAllergies: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

const bodySchema = z.object({
  email: z.string().email(),
  phone: z.string().min(7),
  familyName: z.string().min(1),
  location: z.enum(['Brampton', 'Mississauga', 'Scarborough', 'Markham']),
  manager: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    gender: z.enum(['Male', 'Female', 'PreferNotToSay']),
  }),
  additionalMembers: z.array(additionalMemberSchema).default([]),
});

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad-request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Strip undefined optional fields to satisfy exactOptionalPropertyTypes in RegisterFamilyInput
  const additionalMembers: AdditionalMember[] = parsed.data.additionalMembers.map((m) => {
    const member: AdditionalMember = {
      firstName: m.firstName,
      lastName: m.lastName,
      type: m.type,
      gender: m.gender,
    };
    if (m.schoolGrade !== undefined) member.schoolGrade = m.schoolGrade;
    if (m.birthMonthYear !== undefined) member.birthMonthYear = m.birthMonthYear;
    if (m.foodAllergies !== undefined) member.foodAllergies = m.foodAllergies;
    if (m.email !== undefined) member.email = m.email;
    if (m.phone !== undefined) member.phone = m.phone;
    return member;
  });
  const input = { ...parsed.data, additionalMembers };

  let result: { fid: string; mid: string };
  try {
    result = await registerFamily(input);
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    const message = (err as Error).message ?? '';
    if (code === 'duplicate-contact' || message.includes('Contact already registered')) {
      return NextResponse.json({ error: 'duplicate-contact' }, { status: 409 });
    }
    throw err;
  }

  const { fid, mid } = result;
  const { email } = parsed.data;

  // Create / ensure Firebase Auth user for the registering manager
  const normalized = normalizeContact('email', email);
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

  const claims: Record<string, unknown> = {
    role: 'family-manager',
    fid,
    mid,
    email,
  };
  await auth.setCustomUserClaims(uid, claims);
  const customToken = await auth.createCustomToken(uid, claims);
  const idToken = await exchangeCustomTokenForIdToken(customToken);

  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '5');
  const session = await createPortalSessionCookie(idToken, expiresInDays);

  const res = NextResponse.json({ fid, mid }, { status: 200 });
  res.cookies.set('__session', session, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60,
  });
  return res;
}
