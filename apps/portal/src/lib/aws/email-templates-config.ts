import 'server-only';

/**
 * The registry mapping each logical email to its `SES_TEMPLATE_*` env var.
 *
 * `import 'server-only'` is load-bearing, not decorative: from a client bundle
 * every `process.env.SES_TEMPLATE_*` reads `undefined`, so every email would
 * silently and permanently take the in-code fallback with nothing to show for
 * it in a log anyone reads.
 */

/**
 * The emails that MAY be rendered by an SES-managed template.
 *
 * `'otp-code'` is deliberately absent, and its absence is enforced at compile
 * time in `send-managed-email.ts`. OTP is the one email whose content and
 * delivery the portal must fully control: a template edit on the SES side
 * could break every sign-in at once, with no deploy and no review.
 */
export type ManagedEmailName =
  | 'payment-reminder'
  | 'donation-thank-you'
  | 'setu-invite'
  | 'setu-join-request'
  | 'pledge-activated';

const ENV_VAR: Record<ManagedEmailName, string> = {
  'payment-reminder': 'SES_TEMPLATE_PAYMENT_REMINDER',
  'donation-thank-you': 'SES_TEMPLATE_DONATION_THANK_YOU',
  'setu-invite': 'SES_TEMPLATE_SETU_INVITE',
  'setu-join-request': 'SES_TEMPLATE_SETU_JOIN_REQUEST',
  'pledge-activated': 'SES_TEMPLATE_PLEDGE_ACTIVATED',
};

/** Every `SES_TEMPLATE_*` var, for the env inventory and for test cleanup. */
export const SES_TEMPLATE_ENV_VARS: readonly string[] = Object.values(ENV_VAR);

/**
 * The SES-side template name for one logical email, or null when it is not
 * configured.
 *
 * A whitespace-only value counts as unconfigured: that is the shape an operator
 * produces when clearing the var in Vercel, and treating it as a name would ask
 * SES for a template called "".
 */
export function sesTemplateNameFor(name: ManagedEmailName): string | null {
  const configured = (process.env[ENV_VAR[name]] ?? '').trim();
  return configured === '' ? null : configured;
}
