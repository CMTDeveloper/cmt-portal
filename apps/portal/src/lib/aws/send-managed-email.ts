import 'server-only';
import { TemplateDoesNotExistException } from '@aws-sdk/client-ses';
import { resolveSender } from './resolve-sender';
import { sesTemplateNameFor, type ManagedEmailName } from './email-templates-config';

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

// If 'otp-code' is ever added to ManagedEmailName this stops compiling. A test
// asserting `names).not.toContain('otp-code')` over a literal the test itself
// wrote cannot fail; this can.
type _OtpNotManaged = 'otp-code' extends ManagedEmailName ? never : true;
const _assertOtpNotManaged: _OtpNotManaged = true;
void _assertOtpNotManaged;

// Backstop for a cast or an `as never` slipping past the type above.
const OTP_LIKE = /otp|code|verif/i;

export interface SendManagedEmailArgs {
  name: ManagedEmailName;
  to: string;
  data: Record<string, unknown>;
  /** Renders and sends the same email in code. Its failures are the caller's. */
  fallback: () => Promise<void>;
}

export async function sendManagedEmail(args: SendManagedEmailArgs): Promise<void> {
  const { name, to, data, fallback } = args;

  if (OTP_LIKE.test(name)) {
    throw new Error(
      `[send-managed-email] refusing to send "${name}" through the managed path: sign-in codes must stay on the portal's own renderer, where an SES template edit cannot break every sign-in at once`,
    );
  }

  const templateName = sesTemplateNameFor(name);
  if (!templateName) {
    console.info(`[send-managed-email] no SES template configured for "${name}" - rendering in code`);
    await fallback();
    return;
  }

  try {
    // Through resolveSender(), NEVER `./ses` directly. This module sits beside
    // ses.ts, so the direct import is the natural one and the wrong one: it
    // bypasses SETU_EMAIL_ALLOWLIST, SETU_EMAIL_REDIRECT_TO and the
    // NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY route to mockSender, which together
    // are the only thing stopping a test run from mailing real families - and
    // the payment-reminder cron from blasting the whole roster.
    await resolveSender().sendSesTemplatedEmail({ to, templateName, data });
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
