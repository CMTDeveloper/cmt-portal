/**
 * Centralized site / brand strings (issue #11). Keep ALL brand wording here
 * rather than hardcoding it across pages, components, and metadata.
 *
 * Per-deployment overrides come from NEXT_PUBLIC_* env vars, read with a LITERAL
 * `process.env.NEXT_PUBLIC_x` access so Next.js statically inlines them into the
 * client bundle — do NOT refactor these into a `readEnv(name)` helper, that
 * defeats the static replacement and the values silently become undefined.
 */
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? 'Chinmaya Setu';
export const ORG_NAME = process.env.NEXT_PUBLIC_ORG_NAME ?? 'Chinmaya Mission Toronto';

/** Default document title — used on the home page and any page without its own
 *  title: "Chinmaya Setu | Chinmaya Mission Toronto". */
export const SITE_TITLE_DEFAULT = `${SITE_NAME} | ${ORG_NAME}`;

/** Title template applied to every child-page title → "Page title | Chinmaya Setu". */
export const SITE_TITLE_TEMPLATE = `%s | ${SITE_NAME}`;

/** Default meta description. */
export const SITE_DESCRIPTION = `Bridging knowledge, community, and spiritual practice — ${ORG_NAME} portal.`;

/**
 * Where a family writes when they need a human.
 *
 * Vaibhav, 2026-07-31, looking at the live home page: the Contact link pointed
 * at the general `info@` inbox, which nobody on the Bala Vihar registration
 * team reads. It is the same address the portal already sends FROM
 * (`AWS_SES_FROM_EMAIL`), so a reply lands with the people who can act.
 *
 * Defined here, not inline, because it was previously typed out at three call
 * sites and only the one on the home page was noticed.
 *
 * A plain constant, deliberately not a NEXT_PUBLIC_ override: an unlisted var
 * is stripped from the Turborepo build sandbox, so an override would appear to
 * work locally and silently fall back to this default on Vercel.
 */
export const CONTACT_EMAIL = 'bvregistration@chinmayatoronto.org';

/** `mailto:` for a Setu account problem, pre-subjected so replies triage easily. */
export const CONTACT_ACCOUNT_ISSUE_MAILTO = `mailto:${CONTACT_EMAIL}?subject=Chinmaya%20Setu%20account%20issue`;

/**
 * SMS consent, shown wherever a family types a phone number we might text.
 *
 * Not decoration and not legal boilerplate for its own sake: mobile carriers
 * require a visible opt-in disclosure at the point of collection, and a
 * toll-free number cannot be verified without a screenshot showing it. A bare
 * phone field is one of the most common rejection reasons, and a rejected
 * submission costs weeks.
 *
 * Deliberately present tense and specific about WHO sends, WHAT for, and HOW to
 * stop - the three things a reviewer looks for. STOP/HELP are handled by AWS
 * End User Messaging at the platform level; the application never overrides them.
 *
 * Defined once because the sign-in page renders its form twice (a mobile layout
 * and a desktop one) and the register page a third time.
 */
export const SMS_CONSENT_NOTICE =
  `By choosing to receive a code by text, you agree that ${ORG_NAME} may send text messages ` +
  'to this number for sign-in codes and account notices. Message and data rates may apply. ' +
  'Reply STOP to opt out or HELP for help.';

/** Where the SMS consent notice sends people for the detail. */
export const PRIVACY_PATH = '/privacy';

/**
 * Opt-out line appended to RECURRING messages (not one-time codes).
 *
 * Carriers generally exempt a code the user just asked for; a notification that
 * arrives unprompted is a different category and wants an explicit way out.
 */
export const SMS_OPT_OUT_SUFFIX = ' Reply STOP to opt out.';
