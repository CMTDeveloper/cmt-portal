import 'server-only';
import { sendManagedEmail } from '@/lib/aws/send-managed-email';
import { ORG_NAME } from '@/lib/branding';

/**
 * The three Bala Vihar enrollment emails CMT authored in SES (2026-07-29).
 *
 * ── Why they live together ──────────────────────────────────────────────────
 * They are one conversation with the family, branched on how the money ended
 * up: donation paid, monthly pledge active, or neither yet. Their SES bodies
 * share the same opening paragraph and differ only in the confirmation block.
 * Spreading three `sendManagedEmail` calls across the donate-success page, the
 * pledge activator and the kiosk route would put that shared shape in three
 * places, and the placeholder names - which are SES's, not ours - in three
 * places with it.
 *
 * ── NEVER THROWS ────────────────────────────────────────────────────────────
 * Every function here swallows its own failures. Each is called immediately
 * after something irreversible has already happened: Stripe has taken the
 * money, the mandate is live, or the child is already marked present at the
 * door. A mail failure must never undo any of that, and must never turn a
 * successful payment into an error page. Same rule the pledge activator already
 * follows for exactly this reason.
 *
 * ── The `$` belongs to the template ─────────────────────────────────────────
 * The SES copy reads `CAD ${{donation_amount}}`, so the value passed here is a
 * BARE number ("500", "51"). Passing "$500" renders "CAD $$500".
 */

/** How SES formats a dollar figure in these templates: no symbol, no decimals
 *  on a whole number ("500"), two decimals otherwise ("51.50"). */
export function formatAmountForTemplate(amountCAD: number): string {
  // Guarded, because this string goes straight into a letter about money.
  // `String(1e21)` is "1e+21" and `String(NaN)` is "NaN"; both would print
  // verbatim after "CAD $". Anything not a sane positive amount becomes '0',
  // which reads as obviously wrong rather than as a plausible figure - and
  // callers refuse to send at all when the amount is unreadable.
  if (!Number.isFinite(amountCAD) || amountCAD < 0 || amountCAD >= 1e15) return '0';
  // toFixed avoids exponent notation entirely; whole amounts stay bare so the
  // common case reads "CAD $500", not "CAD $500.00".
  return Number.isInteger(amountCAD) ? amountCAD.toFixed(0) : amountCAD.toFixed(2);
}

export interface BvEnrollmentEmailRecipient {
  /** The manager's email. Nothing sends when this is absent. */
  to: string | null | undefined;
  /** Fills `{{registrant_name}}` - the person, not the family. */
  registrantName: string;
}

/**
 * Enrolled, and the one-time donation is paid → `bv_enrolled_donation_complete`.
 * Subject: "Your Bala Vihar Enrollment is Confirmed".
 */
export async function sendBvDonationCompleteEmail(
  recipient: BvEnrollmentEmailRecipient,
  amountCAD: number,
): Promise<void> {
  await send('bv-enrolled-donation-complete', recipient, {
    registrant_name: recipient.registrantName,
    donation_amount: formatAmountForTemplate(amountCAD),
  });
}

/**
 * Enrolled, and the monthly pledge is ACTIVE → `bv_enrolled_pledge_complete`.
 *
 * `amountCAD` is the MONTHLY figure, not a yearly total: the copy reads "your
 * monthly continued pledge of CAD $…".
 */
export async function sendBvPledgeCompleteEmail(
  recipient: BvEnrollmentEmailRecipient,
  monthlyAmountCAD: number,
): Promise<void> {
  await send('bv-enrolled-pledge-complete', recipient, {
    registrant_name: recipient.registrantName,
    donation_amount: formatAmountForTemplate(monthlyAmountCAD),
  });
}

/**
 * Enrolled, but NEITHER the donation nor the pledge completed →
 * `bv_enrolled_donation_pending`. Subject: "Your Bala Vihar enrollment is not
 * yet confirmed".
 *
 * `registrationLink` must be ABSOLUTE - it is a link in an email, so a relative
 * path is simply broken. Callers pass `portalBaseUrl(req)`-derived urls.
 */
export async function sendBvDonationPendingEmail(
  recipient: BvEnrollmentEmailRecipient,
  registrationLink: string,
): Promise<void> {
  await send('bv-enrolled-donation-pending', recipient, {
    registrant_name: recipient.registrantName,
    registration_link: registrationLink,
  });
}

/**
 * Who the confirmation is addressed to: the member who is actually doing this,
 * falling back to the family's first manager.
 *
 * `{{registrant_name}}` names the PERSON, so the signed-in member is the honest
 * answer - a co-manager who pays should not be greeted by the other manager's
 * name. The fallback matters for the paths with no session at all (the kiosk,
 * the reconciler), where the first manager is the best available answer.
 */
export function bvEmailRecipient(
  members: readonly { mid: string; email?: string | null; firstName?: string | null; lastName?: string | null }[],
  preferredMid: string | null | undefined,
  managerMids: readonly string[] = [],
): BvEnrollmentEmailRecipient {
  const byMid = (mid: string | null | undefined) =>
    mid ? members.find((m) => m.mid === mid) : undefined;
  // An address is required, so a preferred member WITHOUT one must not win and
  // silently send nothing - fall through to whoever can actually be reached.
  const preferred = byMid(preferredMid);
  const chosen =
    (preferred?.email ? preferred : undefined) ??
    managerMids.map(byMid).find((m) => m?.email) ??
    members.find((m) => m?.email) ??
    preferred;
  const name = `${chosen?.firstName ?? ''} ${chosen?.lastName ?? ''}`.trim();
  return { to: chosen?.email ?? null, registrantName: name };
}

/**
 * The shared send. Fails soft, and says which email it was in the log so an
 * operator does not have to guess from a stack trace.
 *
 * The in-code `fallback` is deliberately a LOG, not a hand-rolled copy of CMT's
 * email. These three are the charity's own words, reviewed by them, and a
 * paraphrase written here would drift from the SES version the moment they edit
 * it - the family would then get a different letter depending on whether an env
 * var happened to be set. Better to send nothing and record it loudly: the
 * money side of every one of these paths has already succeeded and is visible
 * in the portal regardless.
 */
async function send(
  name:
    | 'bv-enrolled-donation-complete'
    | 'bv-enrolled-pledge-complete'
    | 'bv-enrolled-donation-pending',
  recipient: BvEnrollmentEmailRecipient,
  data: Record<string, string>,
): Promise<void> {
  const to = (recipient.to ?? '').trim();
  if (!to) {
    console.info(`[bv-email] no recipient address for "${name}" - nothing sent`);
    return;
  }
  try {
    await sendManagedEmail({
      name,
      to,
      data,
      fallback: async () => {
        console.warn(
          `[bv-email] "${name}" is not configured (its SES_TEMPLATE_* var is unset) - ${ORG_NAME} sent nothing to ${to}`,
        );
      },
    });
  } catch (err) {
    console.error(`[bv-email] "${name}" failed for ${to}`, err);
  }
}
