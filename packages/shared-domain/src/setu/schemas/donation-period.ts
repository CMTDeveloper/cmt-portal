import { z } from 'zod';

export const PROGRAM_KEYS = ['bala-vihar'] as const;
export type ProgramKey = (typeof PROGRAM_KEYS)[number];

export const LOCATIONS = ['Brampton', 'Mississauga', 'Scarborough', 'Markham'] as const;
export type Location = (typeof LOCATIONS)[number];

// Where a family's payment status for a period comes from:
//  - 'portal' → the Setu donations collection (Stripe checkouts through the portal).
//  - 'legacy' → the prod RTDB roster `payment` field (the pre-portal system).
// The 2025-26 cutover year is 'legacy' (most families already paid offline);
// 2026-27 onward is 'portal'. Admin-set per period.
export const PAYMENT_SOURCES = ['portal', 'legacy'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

// A date-windowed pricing tier. The suggested donation is prorated by when a
// family enrolls: full year from September, less if they join mid-year. Tiers
// are ordered ascending by effectiveFrom; the first is the full-year/base.
export const PricingTierSchema = z.object({
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveFrom must be YYYY-MM-DD'),
  amountCAD: z.number().int().min(1),
  label: z.string().min(1),
});

export type PricingTier = z.infer<typeof PricingTierSchema>;

// Tiers must be non-empty and strictly ascending by effectiveFrom.
function tiersAscending(tiers: PricingTier[]): boolean {
  for (let i = 1; i < tiers.length; i++) {
    const prev = tiers[i - 1];
    const cur = tiers[i];
    if (!prev || !cur) return false;
    if (cur.effectiveFrom <= prev.effectiveFrom) return false;
  }
  return true;
}

export const DonationPeriodDocSchema = z.object({
  pid: z.string().min(1),
  programKey: z.enum(PROGRAM_KEYS),
  programLabel: z.string().min(1),
  location: z.enum(LOCATIONS),
  periodLabel: z.string().min(1), // school year, e.g. "2025-26"
  startDate: z.date(),
  endDate: z.date(),
  // Date-windowed suggested-donation schedule (prorated by enrollment date).
  pricingTiers: z.array(PricingTierSchema).min(1),
  // Optional give-more quick-pick chips on the donate form. When absent the
  // form derives chips from the resolved suggested amount.
  amountTiers: z.array(z.number().int().min(1)).min(1).optional(),
  // Where payment status is read from. Optional for back-compat with periods
  // written before this field existed — absent is treated as 'portal'.
  paymentSource: z.enum(PAYMENT_SOURCES).optional(),
  enabled: z.boolean(),
  createdAt: z.date(),
  createdBy: z.string().min(1),
  updatedAt: z.date(),
  updatedBy: z.string().min(1),
});

export type DonationPeriodDoc = z.infer<typeof DonationPeriodDocSchema>;

/** A period's effective payment source — defaults to 'portal' when unset. */
export function paymentSourceOf(period: Pick<DonationPeriodDoc, 'paymentSource'>): PaymentSource {
  return period.paymentSource ?? 'portal';
}

/** YYYY-MM-DD for a Date in America/Toronto (en-CA renders ISO-style). */
function torontoYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * The suggested donation for a family enrolling on `enrollDate`: the last
 * pricing tier whose `effectiveFrom` is on/before the enrollment date (Toronto).
 * Before the first tier's window → the first (full-year) tier. This value is
 * pinned onto the enrollment's suggestedAmountSnapshot.
 */
export function resolveSuggestedAmount(
  period: Pick<DonationPeriodDoc, 'pricingTiers'>,
  enrollDate: Date,
): number {
  const tiers = period.pricingTiers ?? [];
  const first = tiers[0];
  if (!first) return 0; // schema enforces min(1); defensive against legacy docs
  const ymd = torontoYmd(enrollDate);
  let chosen: PricingTier = first;
  for (const t of tiers) {
    if (t.effectiveFrom <= ymd) chosen = t;
    else break;
  }
  return chosen.amountCAD;
}

// Schema for POST (create) requests — pid + audit fields are server-generated
export const CreateDonationPeriodSchema = z
  .object({
    programKey: z.enum(PROGRAM_KEYS),
    location: z.enum(LOCATIONS),
    periodLabel: z.string().min(1),
    startDate: z.string().datetime({ offset: true }),
    endDate: z.string().datetime({ offset: true }),
    pricingTiers: z.array(PricingTierSchema).min(1),
    amountTiers: z.array(z.number().int().min(1)).min(1).optional(),
    paymentSource: z.enum(PAYMENT_SOURCES).default('portal'),
    enabled: z.boolean().default(true),
  })
  .refine((d) => new Date(d.endDate) > new Date(d.startDate), {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  })
  .refine((d) => tiersAscending(d.pricingTiers), {
    message: 'pricingTiers must be ascending by effectiveFrom',
    path: ['pricingTiers'],
  });

export type CreateDonationPeriodInput = z.infer<typeof CreateDonationPeriodSchema>;

// Schema for PATCH (update) requests — all fields optional except structural invariants
export const UpdateDonationPeriodSchema = z
  .object({
    periodLabel: z.string().min(1).optional(),
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).optional(),
    pricingTiers: z.array(PricingTierSchema).min(1).optional(),
    amountTiers: z.array(z.number().int().min(1)).min(1).optional(),
    paymentSource: z.enum(PAYMENT_SOURCES).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (d) => {
      if (d.startDate && d.endDate) {
        return new Date(d.endDate) > new Date(d.startDate);
      }
      return true;
    },
    { message: 'endDate must be after startDate', path: ['endDate'] },
  )
  .refine((d) => (d.pricingTiers ? tiersAscending(d.pricingTiers) : true), {
    message: 'pricingTiers must be ascending by effectiveFrom',
    path: ['pricingTiers'],
  });

export type UpdateDonationPeriodInput = z.infer<typeof UpdateDonationPeriodSchema>;
