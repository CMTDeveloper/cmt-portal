import { z } from 'zod';

// The READ vocabulary, and it still contains 'general' ON PURPOSE.
//
// General donations were retired 2026-08-03 (owner: "there are no general
// donations in the app") and `CheckoutInputSchema` below no longer accepts the
// type - but `DonationDocSchema` validates on READ, and donation documents with
// `type: 'general'` are sitting in production from before the UI was withdrawn
// (CMT decision 2026-06-04). Narrowing this enum would make every one of them
// fail to parse, which is the "never tighten a read-validated doc schema" rule
// this repo has been bitten by before.
//
// Removing the type is a WRITE-side change. It stays readable forever.
export const DONATION_TYPES = ['enrollment', 'general'] as const;
export type DonationType = (typeof DONATION_TYPES)[number];

export const DONATION_STATUSES = ['redirected', 'completed', 'abandoned'] as const;
export type DonationStatus = (typeof DONATION_STATUSES)[number];

/**
 * A donation initiated through the portal. The portal does NOT issue tax
 * receipts — accounting@chinmayatoronto.org mails an annual CRA rollup each
 * February. This doc is an audit trail + the family's own "donations I started"
 * record. `status` is best-effort (no Stripe webhook in this slice); accounting's
 * payment notification remains the source of truth for what actually settled.
 */
export const DonationDocSchema = z.object({
  did: z.string().min(1),
  fid: z.string().min(1),
  donorMid: z.string().min(1),
  donorName: z.string().min(1),
  donorEmail: z.string().email(),
  type: z.enum(DONATION_TYPES),
  // Nullable on READ, not because a general donation leaves them empty (that
  // type is gone) but because donation docs written before this are still in
  // production and a doc schema must never gain a required field.
  programKey: z.string().min(1).nullable(),
  programLabel: z.string().min(1).nullable(),
  pid: z.string().min(1).nullable(), // the offering id (legacy field name)
  eid: z.string().min(1).nullable(),
  label: z.string().min(1),
  amountCAD: z.number().int().min(1),
  coverFee: z.boolean(),
  feeCAD: z.number().min(0),
  clientReferenceId: z.string().min(1),
  status: z.enum(DONATION_STATUSES),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type DonationDoc = z.infer<typeof DonationDocSchema>;

/**
 * Checkout request body. Discriminated on `type`, which now has exactly one
 * member - kept as a union so the shape (and the mobile's mirror of it) does not
 * change, and so a future type is additive.
 * - enrollment: requires `eid`; server enforces amount >= effectiveSuggestedAmount
 *   and derives the program label/key from the enrollment's offering.
 * `amountCAD` is integer dollars (Stripe service receives dollars, not cents).
 */
export const CheckoutInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('enrollment'),
    eid: z.string().min(1),
    amountCAD: z.number().int().min(1).max(100000),
    coverFee: z.boolean().default(false),
  }),
]);

export type CheckoutInput = z.infer<typeof CheckoutInputSchema>;

/**
 * Body for POST /api/setu/donations/{did}/status — the mobile equivalent of
 * the web success/cancel pages. A client can only report a TERMINAL outcome
 * it observed at the Stripe return URL; it can never set 'redirected'. The
 * handler reuses markDonationStatus (fid guard + no completed→abandoned
 * downgrade); 'completed' stays client-trusted (no Stripe webhook).
 */
export const DonationStatusUpdateSchema = z.object({
  status: z.enum(['completed', 'abandoned']),
});

export type DonationStatusUpdate = z.infer<typeof DonationStatusUpdateSchema>;

// Stripe processing-fee constants — identical to the events-registration app so
// the donor-facing "cover the fee" math matches across CMT properties.
export const STRIPE_PERCENT_FEE = 0.022;
export const STRIPE_FIXED_FEE = 0.3;

/** Processing fee for a given gift, rounded to cents. */
export function processingFeeCAD(amountCAD: number): number {
  return Math.round((amountCAD * STRIPE_PERCENT_FEE + STRIPE_FIXED_FEE) * 100) / 100;
}

/**
 * Server-derived Stripe line-item name. Never trust a client-supplied label.
 * Enrollment donations are named after their program (and term, when known):
 * "Bala Vihar Donation — 2025-26", "Tabla classes Donation — 2026-27".
 */
export function checkoutLineItemName(
  _type: DonationType,
  opts?: { programLabel?: string; termLabel?: string },
): string {
  const programLabel = opts?.programLabel?.trim() || 'Program';
  const base = `${programLabel} Donation`;
  return opts?.termLabel ? `${base} — ${opts.termLabel}` : base;
}
