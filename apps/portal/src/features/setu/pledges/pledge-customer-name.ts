import type { MemberDoc } from '@cmt/shared-domain/setu';

/**
 * The name the Stripe Customer carries for a monthly pledge.
 *
 * ── Why the PERSON, not the family ─────────────────────────────────────────
 * Until 2026-07-31 this sent `family.name` - the auto-derived "<lastName>
 * family" - so the first real mandate landed at Stripe as "Rana family" beside
 * the manager's personal email. Vaibhav caught it on the live Customer record.
 * Two reasons the person is the right value:
 *   - a pre-authorized debit is a legal agreement with an ACCOUNT HOLDER, and a
 *     CRA donation receipt must name the individual donor;
 *   - the one-time donation path already records the person (`donorName:
 *     "Vaibhav Rana"`), so the two payment paths were labelling the same donor
 *     differently for no reason anybody had decided.
 *
 * ── Why the Family ID is appended ──────────────────────────────────────────
 * Requested by Vaibhav, who reconciles on the Stripe side: `Vaibhav Rana (5001)`
 * makes a Customer traceable to a family without leaving Stripe. It is the
 * PUBLIC id (5001+), never the internal fid, because that is the number staff
 * and families actually quote to each other.
 *
 * ── Fallbacks, and why they are never empty ────────────────────────────────
 * The payment service rejects a blank name, and this runs at the moment a
 * family is trying to pay - so every branch yields something non-empty. A
 * missing member or a nameless one falls back to the family name; a null
 * `publicFid` simply omits the suffix rather than emitting "(null)". `publicFid`
 * is minted at first enrollment and a pledge already requires an active Bala
 * Vihar enrollment, so in practice it is present - the guard is for the order
 * ever changing.
 */
export function buildPledgeCustomerName(args: {
  /**
   * `readonly MemberDoc[]` per `getFamilyByFid`'s contract - but accepted
   * defensively, because this sits in the payment path: a malformed roster must
   * degrade to the family name, never throw. A throw here surfaces as a 503 and
   * a family who cannot pay, which is a far worse outcome than a less precise
   * label on a Stripe Customer.
   */
  members: readonly MemberDoc[] | null | undefined;
  mid: string | null | undefined;
  publicFid: number | string | null | undefined;
  familyName: string | null | undefined;
}): string {
  const { members, mid, publicFid } = args;
  const familyName = args.familyName ?? '';

  const roster = Array.isArray(members) ? members : [];
  const member = mid ? roster.find((m) => m?.mid === mid) : undefined;
  const person = [member?.firstName, member?.lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');

  const base = person || familyName.trim();
  if (!base) return 'Chinmaya Mission family';

  const id = typeof publicFid === 'number' ? String(publicFid) : (publicFid ?? '').toString().trim();
  return id ? `${base} (${id})` : base;
}
