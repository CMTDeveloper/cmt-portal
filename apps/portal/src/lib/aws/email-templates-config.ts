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
 * ── 🔴 `'otp-code'` was deliberately EXCLUDED until 2026-07-31 ──────────────
 * The original rule: *"OTP is the one email whose content and delivery the
 * portal must fully control: a template edit on the SES side could break every
 * sign-in at once, with no deploy and no review."* That reasoning has not
 * become wrong - it is the highest-stakes email in the system, because a family
 * who cannot receive a code cannot sign in at all, and there is no second route
 * in.
 *
 * CMT authored `setu_otp` and asked for it live, which is their call to make.
 * What could NOT be carried over unchanged is the failure mode, so the risk is
 * answered a different way: `sendManagedEmail` gives this one email
 * `fallbackOnAnyError`, so a template that is missing, malformed, throttled or
 * unreachable falls back to the portal's own renderer instead of failing the
 * sign-in. The general rule (propagate everything but a missing template, so a
 * real delivery problem is never masked) still holds for every OTHER email,
 * where a missed send costs a notice rather than the whole account.
 *
 * What no fallback can cover is a template that EXISTS and renders WRONG - SES
 * returns a MessageId and delivers a blank. For this email that means a code
 * nobody can read, so `SES_CONFIGURATION_SET` with a RENDERING_FAILURE
 * destination matters more here than anywhere else.
 */
export type ManagedEmailName =
  | 'payment-reminder'
  | 'donation-thank-you'
  | 'setu-invite'
  | 'setu-join-request'
  | 'pledge-activated'
  // ── The Bala Vihar enrollment trio (CMT, 2026-07-29) ──────────────────────
  // Authored and owned by CMT in SES (`bv_enrolled_*`, ca-central-1), sent from
  // the verified `bvregistration@chinmayatoronto.org`. The COPY is theirs; this
  // repo only decides when each one fires and what data it carries.
  //
  // ⚠️ The placeholder names below are SES's, not ours - `registrant_name`,
  // `donation_amount`, `registration_link`. SES does not fail a send when a
  // placeholder goes unfilled: it renders the message with a blank where the
  // value should be and still reports a MessageId. So a typo here is invisible
  // to this process and shows up only as a family receiving "Dear ," - which is
  // why `SES_CONFIGURATION_SET` with a RENDERING_FAILURE destination matters,
  // and why the data keys are asserted in __tests__/bv-enrollment-emails.test.ts.
  | 'bv-enrolled-donation-complete'
  | 'bv-enrolled-pledge-complete'
  | 'bv-enrolled-donation-pending'
  // CMT's sign-in template (2026-07-31), `setu_otp`, placeholders `otp_link` and
  // `otp_pin`, sent as "Chinmaya Setu" <noreply@chinmayatoronto.org>. See the
  // block above for why this one alone falls back on ANY error.
  | 'otp-code';

const ENV_VAR: Record<ManagedEmailName, string> = {
  'payment-reminder': 'SES_TEMPLATE_PAYMENT_REMINDER',
  'donation-thank-you': 'SES_TEMPLATE_DONATION_THANK_YOU',
  'setu-invite': 'SES_TEMPLATE_SETU_INVITE',
  'setu-join-request': 'SES_TEMPLATE_SETU_JOIN_REQUEST',
  'pledge-activated': 'SES_TEMPLATE_PLEDGE_ACTIVATED',
  'bv-enrolled-donation-complete': 'SES_TEMPLATE_BV_ENROLLED_DONATION_COMPLETE',
  'bv-enrolled-pledge-complete': 'SES_TEMPLATE_BV_ENROLLED_PLEDGE_COMPLETE',
  'bv-enrolled-donation-pending': 'SES_TEMPLATE_BV_ENROLLED_DONATION_PENDING',
  'otp-code': 'SES_TEMPLATE_SETU_OTP',
};

/**
 * The `From` for one logical email, when it differs from the portal default.
 *
 * CMT specified a distinct sender for `setu_otp` - *Name: Chinmaya Setu, From:
 * noreply@chinmayatoronto.org* - because a sign-in code is not a Bala Vihar
 * registration matter and should not be signed as one.
 *
 * Both halves are CODE defaults, like DEFAULT_FROM_NAME, so preview and
 * production cannot drift into signing the same letter differently.
 * `AWS_SES_OTP_FROM_EMAIL` remains as an override for an environment that needs
 * a different address.
 *
 * The address is safe to hardcode because SES verifies the DOMAIN
 * `chinmayatoronto.org` (confirmed 2026-07-31, ca-central-1, status Success),
 * which covers every address under it - `noreply@` needs no separate
 * verification. ⚠️ `ListVerifiedEmailAddresses` lists only ADDRESS identities and
 * does NOT show it; check domain identities before concluding otherwise.
 */
export function senderIdentityFor(name: ManagedEmailName): { email?: string; name?: string } | undefined {
  if (name !== 'otp-code') return undefined;
  const email = (process.env.AWS_SES_OTP_FROM_EMAIL ?? '').trim() || 'noreply@chinmayatoronto.org';
  return { email, name: 'Chinmaya Setu' };
}

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
