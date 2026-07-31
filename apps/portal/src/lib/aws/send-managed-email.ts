import 'server-only';
import { TemplateDoesNotExistException } from '@aws-sdk/client-ses';
import { resolveSender } from './resolve-sender';
import { sesTemplateNameFor, senderIdentityFor, type ManagedEmailName } from './email-templates-config';

/**
 * Send one logical email, preferring its SES-managed template and rendering in
 * code when there isn't one.
 *
 * The fallback is deliberately NARROW. Exactly two conditions reach the in-code
 * renderer:
 *
 *   1. no `SES_TEMPLATE_*` is configured for this name (info - a design state
 *      during the migration, and the steady state for anything Vaibhav has not
 *      authored yet)
 *   2. SES reports the named template does not exist (error - the var points at
 *      nothing, which is a misconfiguration; that log IS the migration
 *      checklist)
 *
 * Everything else propagates. Falling back on a throttle, an auth error or a
 * network failure would mask a real delivery problem, and could double-send a
 * message SES had already accepted.
 *
 * What this CANNOT catch: a template that exists but fails to render. SES
 * accepts the message, returns a MessageId, and delivers nothing. That gap is
 * covered out of band by SES_CONFIGURATION_SET's RENDERING_FAILURE destination
 * (see ses.ts) and by the per-template UAT send in the runbook - not here.
 */

/**
 * The emails whose delivery matters more than the diagnosis of a failure.
 *
 * ── This REPLACES the old blanket refusal ───────────────────────────────────
 * Until 2026-07-31 this module threw for anything matching /otp|code|verif/,
 * backed by a compile-time assertion, so sign-in codes could not go through a
 * managed template at all. CMT then authored `setu_otp` and asked for it live.
 *
 * The reason for the refusal was never "templates are bad" - it was that a bad
 * SES template would break EVERY SIGN-IN AT ONCE, with no deploy and no review,
 * and a family who cannot get a code has no other way in. That reason is
 * answered here instead of by prohibition: for these names ONLY, any failure -
 * and any stall past ATTEMPT_BUDGET_MS - drops to the portal's own renderer.
 *
 * ── 🔴 What this does NOT buy, stated plainly ───────────────────────────────
 * It is NOT delivery failover. The fallback goes through the SAME SES account,
 * credentials, region, network and quota, so an account-wide throttle, expired
 * credentials or an outage will usually fail it too, and the route then 500s
 * with the code already stored. An earlier draft of this comment claimed "the
 * family still gets a code" for exactly those cases; that was wrong, and a Codex
 * review (2026-07-31) called it out. What the fallback genuinely recovers is a
 * TEMPLATE-specific fault - missing, renamed, malformed, unparseable - plus
 * transient blips. Those are the failures a template ADDS, which is the risk
 * this change introduces, so it is the right cover for it.
 *
 * It also cannot cover a template that is ACCEPTED and renders wrong: SES
 * returns a MessageId and delivers a blank, so nothing here ever learns. For
 * this email that is a code nobody can read. Only two things address it, both
 * outside this module - SES_CONFIGURATION_SET's RENDERING_FAILURE destination
 * (an after-the-fact alarm), and a human reading one real send before the var is
 * ever set.
 *
 * Every other email keeps the strict rule (propagate anything but a missing
 * template) because there a fallback could mask a real delivery problem or
 * double-send a message SES already accepted. For OTP that trade inverts: a
 * duplicate is two copies of ONE credential - same PIN, same link,
 * `storeVerificationCode` ran once - which is confusing but harmless, while a
 * missed one is a family who cannot get in.
 */
const FALLBACK_ON_ANY_ERROR: ReadonlySet<ManagedEmailName> = new Set(['otp-code']);

/**
 * How long a delivery-first email waits on the managed path before giving up.
 *
 * The SES client sets no connection or request timeout (Smithy's default is
 * zero), so a socket that stops progressing without rejecting never rejects -
 * and a `catch` cannot run for a promise that stays pending. Unbounded, the
 * sign-in request hangs on "Sending…" while the code it already stored expires.
 * A deadline is the only thing that reaches that state.
 *
 * On timeout the attempt is ABANDONED, not cancelled, so it may still deliver
 * and the family may get two copies. Deliberate: same PIN, same link, harmless,
 * and strictly better than a hang on the one email with no other way in.
 */
const ATTEMPT_BUDGET_MS = 4000;

/** The managed path, bounded, dropping to `fallback` on any failure or stall. */
async function sendDeliveryFirst(
  name: ManagedEmailName,
  attempt: () => Promise<void>,
  fallback: () => Promise<void>,
): Promise<void> {
  const TIMED_OUT = Symbol('timed-out');
  let outcome: unknown;
  try {
    outcome = await Promise.race([
      attempt(),
      new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), ATTEMPT_BUDGET_MS)),
    ]);
  } catch (err) {
    // ERROR even though the send still happens: silently rendering in code for
    // weeks would hide that CMT's template is not being used at all.
    console.error(
      `[send-managed-email] "${name}" failed on the managed path - rendering in code so the send still happens. The SES template is NOT being used; investigate.`,
      err,
    );
    await fallback();
    return;
  }
  if (outcome === TIMED_OUT) {
    console.error(
      `[send-managed-email] "${name}" did not complete within ${ATTEMPT_BUDGET_MS}ms - rendering in code. The abandoned attempt may still deliver, so the recipient may get two copies of the same code.`,
    );
    await fallback();
  }
}

export interface SendManagedEmailArgs {
  name: ManagedEmailName;
  to: string;
  data: Record<string, unknown>;
  /** Renders and sends the same email in code. Its failures are the caller's. */
  fallback: () => Promise<void>;
}

export async function sendManagedEmail(args: SendManagedEmailArgs): Promise<void> {
  const { name, to, data, fallback } = args;

  const templateName = sesTemplateNameFor(name);
  if (!templateName) {
    console.info(`[send-managed-email] no SES template configured for "${name}" - rendering in code`);
    await fallback();
    return;
  }

  // Through resolveSender(), NEVER `./ses` directly. This module sits beside
  // ses.ts, so the direct import is the natural one and the wrong one: it
  // bypasses SETU_EMAIL_ALLOWLIST, SETU_EMAIL_REDIRECT_TO and the
  // NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY route to mockSender, which together are
  // the only thing stopping a test run from mailing real families - and the
  // payment-reminder cron from blasting the whole roster.
  const from = senderIdentityFor(name);
  const attempt = () =>
    resolveSender().sendSesTemplatedEmail({
      to,
      templateName,
      data,
      ...(from ? { from } : {}),
    });

  // Bounded, and lenient about WHY it failed. Only the sign-in code takes this
  // path; see FALLBACK_ON_ANY_ERROR for what it does and does not buy.
  if (FALLBACK_ON_ANY_ERROR.has(name)) {
    await sendDeliveryFirst(name, attempt, fallback);
    return;
  }

  try {
    await attempt();
  } catch (err) {
    // `instanceof`, never a `.name` compare or `.includes()`: two nearby names
    // (CustomVerificationEmailTemplateDoesNotExistException, and a bounce-reason
    // literal `TemplateDoesNotExist` with no Exception suffix) make loose
    // matching genuinely dangerous here.
    if (!(err instanceof TemplateDoesNotExistException)) throw err;
    console.error(
      `[send-managed-email] SES template "${templateName}" (${name}) does not exist in this region - rendering in code. Create the template or unset its SES_TEMPLATE_* var.`,
    );
    await fallback();
  }
}
