import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { registerFamily, type AdditionalMember, type RegisterFamilyManager } from '@/features/setu/registration/register-family';
import { consumeRegistrationGrant } from '@/features/setu/registration/registration-grant';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';
import {
  sha256Hex,
  normalizeContact,
  checkAndRecordOtpRateLimit,
  REGISTER_RATE_LIMIT_MAX,
} from '@/features/check-in/shared';
import { whatsMissingForMember, type MemberRequiredField, FamilyAddressSchema } from '@cmt/shared-domain';


// Capture-form gender is Male|Female ONLY (no PreferNotToSay) — the matrix
// treats PreferNotToSay as missing, so accepting it would let an incomplete
// member through registration straight into the post-sign-in gate.
const additionalMemberSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  type: z.enum(['Adult', 'Child']),
  gender: z.enum(['Male', 'Female']),
  schoolGrade: z.string().optional(),
  birthMonthYear: z.string().optional(),
  foodAllergies: z.string().optional(),
  volunteeringSkills: z.array(z.string()).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

const bodySchema = z.object({
  email: z.string().email(),
  phone: z.string().min(7),
  familyName: z.string().min(1),
  location: z.enum(['Brampton', 'Mississauga', 'Scarborough', 'Markham']),
  // Required family home address collected at registration. Flows through the
  // `input` spread of parsed.data into registerFamily.
  familyAddress: FamilyAddressSchema,
  manager: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    gender: z.enum(['Male', 'Female']),
    foodAllergies: z.string().optional(),
    volunteeringSkills: z.array(z.string()).optional(),
  }),
  additionalMembers: z.array(additionalMemberSchema).default([]),
  // Proof that THIS email was just OTP-verified — issued by verify-code on the
  // no-family path, required here so registration can't mint a family-manager
  // session for an email the caller doesn't own. Consumed below.
  registrationGrant: z.string().min(1),
  // Mobile clients pass mode='mobile' (in body or as ?mode=mobile in URL) to
  // get back a `customToken` instead of an httpOnly session cookie. They
  // exchange that via the Firebase SDK locally and use the resulting ID
  // token as a Bearer header on subsequent requests. See
  // apps/portal/docs/mobile-api-integration.md.
  mode: z.enum(['web', 'mobile']).optional(),
});

// Map the first matrix-missing field to the contract's 400 error code. Same
// codes the canonical /api/setu/members write returns, so the mobile + web
// clients share one vocabulary. `skills-required` is reused as-is.
const MISSING_FIELD_ERROR: Partial<Record<MemberRequiredField, string>> = {
  foodAllergies: 'foodAllergies-required',
  email: 'contact-required',
  phone: 'contact-required',
  volunteeringSkills: 'skills-required',
  schoolGrade: 'grade-required',
  birthMonthYear: 'birthmonth-required',
};

/**
 * Per-type required-field validation for one member, using the shared matrix
 * helper. Returns the contract error code for the first missing field, or null
 * when complete. firstName/lastName/gender/type are already guaranteed non-empty
 * by the zod schema, so only the conditionally-required fields ever surface here.
 */
function requiredFieldError(member: Parameters<typeof whatsMissingForMember>[0]): string | null {
  for (const field of whatsMissingForMember(member)) {
    const code = MISSING_FIELD_ERROR[field];
    if (code) return code;
  }
  return null;
}

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

  // Rate-limit by IP AFTER body validation (a malformed body 400s without
  // consuming quota) and BEFORE any write. Stricter than the read-only lookup
  // bucket because this path creates Firestore docs + a Firebase Auth user —
  // it bounds mass-registration / contact-squatting spam.
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const rate = await checkAndRecordOtpRateLimit(`register:${ip}`, REGISTER_RATE_LIMIT_MAX);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'rate-limited', resetAt: rate.resetAt }, { status: 429 });
  }

  // OWNERSHIP GATE: consume the one-time registration grant proving this email
  // was just OTP-verified (issued by verify-code). Done BEFORE any write so an
  // unverified caller never creates a family or reserves a contact key. The
  // grant is bound to this exact email, so it can't be replayed for another.
  const verified = await consumeRegistrationGrant(parsed.data.registrationGrant, parsed.data.email);
  if (!verified) {
    return NextResponse.json({ error: 'registration-unverified' }, { status: 403 });
  }

  // PER-TYPE REQUIRED MATRIX (shared helper, same codes as /api/setu/members).
  // The manager is always an Adult; its email/phone arrive at the top level
  // (verified above), so they satisfy the adult contact requirement. Adults may
  // reuse the manager's/family contact — the matrix only checks non-empty, so
  // same-as-manager reuse PASSES here; cross-family contact theft is still
  // caught later inside registerFamily's transaction.
  const managerError = requiredFieldError({
    type: 'Adult',
    firstName: parsed.data.manager.firstName,
    lastName: parsed.data.manager.lastName,
    gender: parsed.data.manager.gender,
    foodAllergies: parsed.data.manager.foodAllergies,
    volunteeringSkills: parsed.data.manager.volunteeringSkills,
    email: parsed.data.email,
    phone: parsed.data.phone,
  });
  if (managerError) {
    return NextResponse.json({ error: managerError, member: 'manager' }, { status: 400 });
  }
  for (let i = 0; i < parsed.data.additionalMembers.length; i++) {
    const m = parsed.data.additionalMembers[i];
    if (!m) continue;
    const memberError = requiredFieldError(m);
    if (memberError) {
      return NextResponse.json({ error: memberError, member: i }, { status: 400 });
    }
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
    if (m.volunteeringSkills !== undefined) member.volunteeringSkills = m.volunteeringSkills;
    if (m.email !== undefined) member.email = m.email;
    if (m.phone !== undefined) member.phone = m.phone;
    return member;
  });

  // Same exactOptionalPropertyTypes strip for the manager's new optional fields.
  const manager: RegisterFamilyManager = {
    firstName: parsed.data.manager.firstName,
    lastName: parsed.data.manager.lastName,
    gender: parsed.data.manager.gender,
  };
  if (parsed.data.manager.foodAllergies !== undefined) manager.foodAllergies = parsed.data.manager.foodAllergies;
  if (parsed.data.manager.volunteeringSkills !== undefined) manager.volunteeringSkills = parsed.data.manager.volunteeringSkills;

  const input = { ...parsed.data, manager, additionalMembers };

  let result: { fid: string; mid: string };
  try {
    result = await registerFamily(input);
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    const message = (err as Error).message ?? '';
    if (message === 'duplicate-contact-in-form') {
      // Two members of THIS submission share a normalized email/phone — a distinct
      // client-actionable case. Safe to name explicitly: it leaks nothing about
      // other families (unlike the pre-existing-family case below).
      return NextResponse.json({ error: 'duplicate-contact-in-form' }, { status: 409 });
    }
    if (code === 'duplicate-contact' || message.includes('Contact already registered')) {
      // Keep the message generic — returning the raw text would reveal that a
      // given contact already belongs to SOME family (an enumeration leak).
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

  const urlMode = new URL(req.url).searchParams.get('mode');
  const mode = parsed.data.mode === 'mobile' || urlMode === 'mobile' ? 'mobile' : 'web';

  if (mode === 'mobile') {
    return NextResponse.json({ fid, mid, customToken }, { status: 200 });
  }

  const idToken = await exchangeCustomTokenForIdToken(customToken);
  const expiresInDays = Number(process.env.SESSION_COOKIE_EXPIRES_DAYS ?? '14');
  const session = await createPortalSessionCookie(idToken, expiresInDays);

  const res = NextResponse.json({ fid, mid }, { status: 200 });
  res.cookies.set('__session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInDays * 24 * 60 * 60,
  });
  return res;
}
