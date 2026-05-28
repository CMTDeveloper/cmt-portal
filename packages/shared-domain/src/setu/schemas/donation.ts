import { z } from 'zod';

export const DONATION_TYPES = ['bala-vihar', 'general'] as const;
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
  pid: z.string().min(1).nullable(), // bala-vihar → period id; general → null
  eid: z.string().min(1).nullable(), // bala-vihar → enrollment id; general → null
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
 * Checkout request body. Discriminated on `type`:
 * - bala-vihar: requires `eid`; server enforces amount >= effectiveSuggestedAmount.
 * - general: no enrollment; any positive amount.
 * `amountCAD` is integer dollars (Stripe service receives dollars, not cents).
 */
export const CheckoutInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bala-vihar'),
    eid: z.string().min(1),
    amountCAD: z.number().int().min(1).max(100000),
    coverFee: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('general'),
    amountCAD: z.number().int().min(1).max(100000),
    coverFee: z.boolean().default(false),
  }),
]);

export type CheckoutInput = z.infer<typeof CheckoutInputSchema>;

// Stripe processing-fee constants — identical to the events-registration app so
// the donor-facing "cover the fee" math matches across CMT properties.
export const STRIPE_PERCENT_FEE = 0.022;
export const STRIPE_FIXED_FEE = 0.3;

/** Processing fee for a given gift, rounded to cents. */
export function processingFeeCAD(amountCAD: number): number {
  return Math.round((amountCAD * STRIPE_PERCENT_FEE + STRIPE_FIXED_FEE) * 100) / 100;
}

/** Server-derived Stripe line-item name. Never trust a client-supplied label. */
export function checkoutLineItemName(type: DonationType, periodLabel?: string): string {
  if (type === 'bala-vihar') {
    return periodLabel
      ? `Bala Vihar Donation — ${periodLabel}`
      : 'Bala Vihar Donation';
  }
  return 'General Donation — Chinmaya Mission Toronto';
}
