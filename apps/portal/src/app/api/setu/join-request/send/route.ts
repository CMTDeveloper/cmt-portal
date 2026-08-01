import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { checkAndRecordOtpRateLimit, LOOKUP_RATE_LIMIT_MAX } from '@/features/check-in/shared';
import { portalEnv } from '@/lib/env';
import { requestFamilyAccess } from '@/features/setu/join-request/request-family-access';
import { portalBaseUrl } from '@/lib/portal-base-url';

// Open (no session required — a requester may not have one yet). Anti-enumeration:
// ALWAYS answers {ok:true} for a well-formed body. The server only creates +
// notifies for a valid GATED match, dedupes an existing open request, and
// otherwise silently no-ops. IP rate-limited.
const bodySchema = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
  // An explicit "Re-send request to my manager" click, as opposed to a
  // first-time send from /register.
  //
  // Every sign-in path now creates the request the moment a gated member proves
  // ownership of their contact, so by the time the pending screen is on screen
  // an open request USUALLY exists (not always - creation can fail, and those
  // paths swallow it deliberately). Without this flag the re-send button would
  // dedupe into silence while the UI answered "Request sent."
  //
  // ⚠️ This route is UNAUTHENTICATED, so the flag cannot be its own permission
  // to send: `requestFamilyAccess` enforces a per-request cooldown that keys on
  // the request document rather than the caller. Do not "simplify" that into an
  // IP limit - rotating IPs would then re-open unbounded manager spam.
  resend: z.boolean().optional(),
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

  const email = parsed.data.email?.trim() ?? '';
  const phone = parsed.data.phone?.trim() ?? '';
  if (!email && !phone) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  // Rate-limit by IP — misses still consume quota (anti-enumeration).
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const rate = await checkAndRecordOtpRateLimit(`join-request-send:${ip}`, LOOKUP_RATE_LIMIT_MAX);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'rate-limited', resetAt: rate.resetAt }, { status: 429 });
  }

  const env = portalEnv();

  // Prefer the email contact (the primary signable channel); fall back to phone.
  const contact = email
    ? { type: 'email' as const, value: email }
    : { type: 'phone' as const, value: phone };

  // Create-and-notify is one operation (see request-family-access.ts). Failures
  // are swallowed in there so a flaky notification never reveals match state.
  //
  // portalBaseUrl(req), not `env.NEXT_PUBLIC_PORTAL_BASE_URL ?? ''`. The helper
  // chains configured -> allowlisted request host -> prod fallback and can never
  // return empty; the old `?? ''` produced a HOST-LESS link ("/join-request/<token>")
  // in a real email whenever the var was unset - which is exactly the state of
  // the Vercel PREVIEW environment (2026-07-27), where the var is deliberately
  // absent because preview URLs are per-deployment.
  await requestFamilyAccess({
    ...contact,
    ttlDays: env.SETU_INVITE_TTL_DAYS,
    baseUrl: portalBaseUrl(req),
    notifyOnExisting: parsed.data.resend === true,
  });

  // Anti-enumeration + idempotent: always {ok:true} for a well-formed body.
  return NextResponse.json({ ok: true }, { status: 200 });
}
