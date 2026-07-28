import { NextResponse } from 'next/server';
import { z } from 'zod';
import { flags } from '@/lib/flags';
import { checkAndRecordOtpRateLimit, LOOKUP_RATE_LIMIT_MAX } from '@/features/check-in/shared';
import { portalEnv } from '@/lib/env';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { sendManagedEmail } from '@/lib/aws/send-managed-email';
import { setuJoinRequestEmail } from '@/lib/aws/templates/setu-join-request-email';
import { createJoinRequest } from '@/features/setu/join-request/create-request';
import { portalBaseUrl } from '@/lib/portal-base-url';

// Open (no session required — a requester may not have one yet). Anti-enumeration:
// ALWAYS answers {ok:true} for a well-formed body. The server only creates +
// notifies for a valid GATED match, dedupes an existing open request, and
// otherwise silently no-ops. IP rate-limited.
const bodySchema = z.object({
  email: z.string().optional(),
  phone: z.string().optional(),
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

  const result = await createJoinRequest({ ...contact, ttlDays: env.SETU_INVITE_TTL_DAYS });

  // Notify ONLY when a fresh request was created. A 'deduped' outcome means an
  // open request already exists, so a requester re-clicking "Send request"
  // can't spam the managers with repeat notifications. ('noop' notifies no one.)
  if (result.outcome === 'created') {
    // Notify ALL family managers by email (+ SMS best-effort). Failures are
    // swallowed so a flaky notification never reveals match state to the caller
    // (we always answer {ok:true}).
    // portalBaseUrl(req), not `env.NEXT_PUBLIC_PORTAL_BASE_URL ?? ''`. The helper
    // chains configured -> allowlisted request host -> prod fallback and can never
    // return empty; the old `?? ''` produced a HOST-LESS link ("/join-request/<token>")
    // in a real email whenever the var was unset - which is exactly the state of
    // the Vercel PREVIEW environment (2026-07-27), where the var is deliberately
    // absent because preview URLs are per-deployment.
    const reviewUrl = `${portalBaseUrl(req)}/join-request/${result.token}`;
    const sender = resolveSender();
    await Promise.allSettled(
      result.managers.flatMap((m) => {
        const tasks: Array<Promise<unknown>> = [];
        if (m.email) {
          const managerEmail = m.email;
          const emailData = {
            requesterName: result.requesterName ?? result.requesterContact,
            requesterContact: result.requesterContact,
            familyName: result.familyName,
            reviewUrl,
          };
          tasks.push(
            sendManagedEmail({
              name: 'setu-join-request',
              to: managerEmail,
              data: emailData,
              fallback: () =>
                sender.sendEmail({ to: managerEmail, ...setuJoinRequestEmail(emailData) }),
            }),
          );
        }
        if (m.phone) {
          tasks.push(
            sender.sendSMS({
              phone: m.phone,
              message: `Hari OM! ${result.requesterContact} asked to join your ${result.familyName} family on Chinmaya Setu. Review: ${reviewUrl}`,
            }),
          );
        }
        return tasks;
      }),
    );
  }

  // Anti-enumeration + idempotent: always {ok:true} for a well-formed body.
  return NextResponse.json({ ok: true }, { status: 200 });
}
