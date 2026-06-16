import { createHash, randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import {
  checkAndRecordOtpRateLimit,
  normalizeContact,
  storeVerificationCode,
  REGISTER_RATE_LIMIT_MAX,
} from '@/features/check-in/shared';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { findSetuFamilyByContact } from '@/features/setu/auth/find-family-by-contact';
import { createMagicLink } from '@/features/setu/auth/magic-links';
import { portalBaseUrl } from '@/lib/portal-base-url';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import { normalizeContactForKey } from '@cmt/shared-domain/setu';


const bodySchema = z.object({
  type: z.enum(['email', 'phone']),
  value: z.string().min(3),
  // 'signin' (default): anti-enumeration — unknown contacts get a silent 200
  // with NO code. 'register': the user is explicitly signing up, so we DO send
  // a code to a brand-new email (otherwise the OTP-gated registration flow can
  // never deliver a code to a net-new family). Sending a signup code to an
  // email leaks nothing to a third party — only the mailbox owner sees it, and
  // the per-contact rate limit bounds abuse.
  purpose: z.enum(['signin', 'register']).optional(),
});

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export async function POST(req: Request) {
  if (!flags.setuAuth) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const { type, value, purpose } = parsed.data;
  const normalized = normalizeContact(type, value);
  const hashPrefix = createHash('sha256').update(normalized).digest('hex').slice(0, 8);

  const rate = await checkAndRecordOtpRateLimit(normalized);
  if (!rate.allowed) {
    console.log(`[send-code] hash=${hashPrefix} type=${type} → rate-limited`);
    return NextResponse.json({ error: 'rate-limited', resetAt: rate.resetAt }, { status: 429 });
  }

  // purpose=register sends a code to UNKNOWN addresses (so net-new families get
  // their OTP). The per-contact limit above caps one target, but not a spray of
  // many distinct victim addresses from one host — add a per-IP bucket for the
  // register-send path so the new "email any address a signup code" capability
  // can't be abused as an unsolicited-mail amplifier.
  if (purpose === 'register') {
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
    const ipRate = await checkAndRecordOtpRateLimit(`register-send:${ip}`, REGISTER_RATE_LIMIT_MAX);
    if (!ipRate.allowed) {
      return NextResponse.json({ error: 'rate-limited', resetAt: ipRate.resetAt }, { status: 429 });
    }
  }

  // Look up Setu family first; fall back to legacy roster.
  // Always return 200 regardless — no contact enumeration.
  const result = await findSetuFamilyByContact(type, value);
  console.log(
    `[send-code] hash=${hashPrefix} type=${type} source=${result.source ?? 'null'} fid=${result.fid ?? result.legacyFid ?? '-'}`,
  );

  // Invitee path: no existing family, but there might be a pending invite
  // for this email. Without this branch, invitees stare at "Enter your code"
  // with no OTP ever arriving.
  let hasPendingInvite = false;
  if (result.source === null && type === 'email') {
    try {
      const db = portalFirestore();
      const snap = await db
        .collectionGroup('invites')
        .where('email', '==', normalized)
        .where('acceptedAt', '==', null)
        .limit(1)
        .get();
      if (!snap.empty) {
        const inviteDoc = snap.docs[0];
        const data = inviteDoc?.data() as { expiresAt?: { toDate?: () => Date } | string } | undefined;
        const expiresAt = data?.expiresAt && typeof data.expiresAt === 'object' && data.expiresAt.toDate
          ? data.expiresAt.toDate()
          : data?.expiresAt
            ? new Date(data.expiresAt as string)
            : null;
        if (expiresAt && expiresAt > new Date()) {
          hasPendingInvite = true;
          console.log(`[send-code] hash=${hashPrefix} → pending invite found`);
        }
      }
    } catch (err) {
      console.error(`[send-code] hash=${hashPrefix} invite lookup failed:`, err);
    }
  }

  // Admin / welcome-team path: a Firebase auth user with the admin or
  // welcome-team claim (granted by admin tooling — no family attached).
  // Without this branch they'd get the anti-enum silent-200 just like an
  // unknown contact.
  let hasAdminRoleUser = false;
  if (result.source === null && type === 'email') {
    try {
      const user = await portalAuth().getUserByEmail(value).catch(() => null);
      const role = (user?.customClaims as Record<string, unknown> | undefined)?.role;
      if (role === 'welcome-team' || role === 'admin') hasAdminRoleUser = true;
    } catch (err) {
      console.error(`[send-code] hash=${hashPrefix} role lookup failed:`, err);
    }
  }

  // Anti-enumeration silent-200 for SIGN-IN: an unknown contact (no family, no
  // pending invite, no admin role) gets a 200 with no code, so probing can't
  // tell registered from unregistered. REGISTRATION explicitly opts out
  // (purpose='register') — a net-new family must receive its code, and the
  // uniform 200 + per-contact rate limit keep it enumeration-safe.
  if (
    purpose !== 'register' &&
    result.source === null &&
    !hasPendingInvite &&
    !hasAdminRoleUser
  ) {
    return NextResponse.json({ success: true }, { status: 200 });
  }

  const code = generateCode();
  await storeVerificationCode(normalized, code, type);

  if (type === 'email') {
    const canonicalEmail = normalizeContactForKey('email', value);
    const magicLink = await createMagicLink(canonicalEmail);
    // SECURITY: the magic link carries a one-time sign-in token, so its origin
    // must be a TRUSTED canonical base — never an attacker-controllable Host /
    // x-forwarded-host (host-header poisoning would email the victim a real
    // token pointing at the attacker's domain). portalBaseUrl prefers the
    // configured NEXT_PUBLIC_PORTAL_BASE_URL and only accepts an allowlisted
    // request host.
    const magicUrl = `${portalBaseUrl(req)}/api/setu/auth/magic/${magicLink.token}`;
    await resolveSender().sendEmail({
      to: canonicalEmail,
      subject: 'Your CMT portal sign-in link',
      text: [
        `Sign in with this link (expires in 10 minutes):`,
        magicUrl,
        ``,
        `Or enter your verification code: ${code}`,
      ].join('\n'),
    });
  } else {
    // Canonicalize to E.164 (+1XXXXXXXXXX). Without this, users who enter
    // "4379712609" (no +1) get the raw value passed to SNS where sns.ts
    // naively prepends "+" → "+4379712609" → AWS misinterprets the country
    // code or rejects. Now any of "4379712609" / "+14379712609" /
    // "(437) 971-2609" all publish to the same E.164 number.
    await resolveSender().sendSMS({
      phone: normalizeContactForKey('phone', value),
      message: `CMT portal code: ${code} (10 min)`,
    });
  }

  console.log(`[send-code] hash=${hashPrefix} → sent (source=${result.source})`);
  return NextResponse.json({ success: true }, { status: 200 });
}
