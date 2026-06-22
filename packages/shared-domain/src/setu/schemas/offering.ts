import { z } from 'zod';

// Dynamic program key: a lowercase slug (e.g. 'bala-vihar', 'tabla').
// Replaces the frozen PROGRAM_KEYS enum so new programs need no schema change.
export const programKeySchema = z.string().regex(/^[a-z0-9-]+$/, 'programKey must be a lowercase slug');

export const BALA_VIHAR = 'bala-vihar';

export const PROGRAM_TERM_TYPES = ['term', 'one-time', 'rolling'] as const;
export type ProgramTermType = (typeof PROGRAM_TERM_TYPES)[number];

export const LOCATIONS = ['Brampton', 'Mississauga', 'Scarborough', 'Markham'] as const;
export type Location = (typeof LOCATIONS)[number];

// Where a family's payment status for a period comes from:
//  - 'portal' → the Setu donations collection (Stripe checkouts through the portal).
//  - 'legacy' → the prod RTDB roster `payment` field (the pre-portal system).
//  - 'teacher-managed' → teachers collect/track payment outside the portal.
// The 2025-26 cutover year is 'legacy' (most families already paid offline);
// most new offerings are 'portal', with exceptions set per offering.
export const PAYMENT_SOURCES = ['portal', 'legacy', 'teacher-managed'] as const;
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

// Tiers must be strictly ascending by effectiveFrom (only enforced when non-empty).
function tiersAscending(tiers: PricingTier[]): boolean {
  for (let i = 1; i < tiers.length; i++) {
    const prev = tiers[i - 1];
    const cur = tiers[i];
    if (!prev || !cur) return false;
    if (cur.effectiveFrom <= prev.effectiveFrom) return false;
  }
  return true;
}

export const OfferingDocSchema = z.object({
  oid: z.string().min(1),
  programKey: programKeySchema,
  programLabel: z.string().min(1),
  location: z.enum(LOCATIONS).nullable(),
  termLabel: z.string().min(1),
  termType: z.enum(PROGRAM_TERM_TYPES),
  startDate: z.date(),
  endDate: z.date().nullable(),
  // May be empty for free programs; ascending constraint applies when non-empty.
  pricingTiers: z.array(PricingTierSchema),
  // Optional give-more quick-pick chips on the donate form. When absent the
  // form derives chips from the resolved suggested amount.
  amountTiers: z.array(z.number().int().min(1)).min(1).optional(),
  // Where payment status is read from. Optional for back-compat with offerings
  // written before this field existed — absent is treated as 'portal'.
  paymentSource: z.enum(PAYMENT_SOURCES).optional(),
  enabled: z.boolean(),
  createdAt: z.date(),
  createdBy: z.string().min(1),
  updatedAt: z.date(),
  updatedBy: z.string().min(1),
});

export type OfferingDoc = z.infer<typeof OfferingDocSchema>;

/** An offering's effective payment source — defaults to 'portal' when unset. */
export function paymentSourceOf(offering: { paymentSource?: PaymentSource }): PaymentSource {
  return offering.paymentSource ?? 'portal';
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
 * Before the first tier's window → the first (full-year) tier. Returns 0 when
 * pricingTiers is empty (free program).
 */
export function resolveSuggestedAmount(
  offering: Pick<OfferingDoc, 'pricingTiers'>,
  enrollDate: Date,
): number {
  const tiers = offering.pricingTiers ?? [];
  const first = tiers[0];
  if (!first) return 0; // free program or defensive against legacy docs
  const ymd = torontoYmd(enrollDate);
  let chosen: PricingTier = first;
  for (const t of tiers) {
    if (t.effectiveFrom <= ymd) chosen = t;
    else break;
  }
  return chosen.amountCAD;
}

// Schema for POST (create) requests — oid + audit fields are server-generated.
// location and endDate are nullable (location-less programs; rolling offerings).
export const CreateOfferingSchema = z
  .object({
    programKey: programKeySchema,
    location: z.enum(LOCATIONS).nullable(),
    termLabel: z.string().min(1),
    termType: z.enum(PROGRAM_TERM_TYPES),
    startDate: z.string().datetime({ offset: true }),
    endDate: z.string().datetime({ offset: true }).nullable(),
    pricingTiers: z.array(PricingTierSchema),
    amountTiers: z.array(z.number().int().min(1)).min(1).optional(),
    paymentSource: z.enum(PAYMENT_SOURCES).default('portal'),
    enabled: z.boolean().default(true),
  })
  .refine(
    (d) => {
      if (d.endDate) return new Date(d.endDate) >= new Date(d.startDate);
      return true;
    },
    { message: 'endDate must be on or after startDate', path: ['endDate'] },
  )
  .refine((d) => tiersAscending(d.pricingTiers), {
    message: 'pricingTiers must be ascending by effectiveFrom',
    path: ['pricingTiers'],
  });

export type CreateOfferingInput = z.infer<typeof CreateOfferingSchema>;

// Schema for PATCH (update) requests — all fields optional except structural invariants.
// programKey and location are immutable after creation (omitted from update).
export const UpdateOfferingSchema = z
  .object({
    termLabel: z.string().min(1).optional(),
    termType: z.enum(PROGRAM_TERM_TYPES).optional(),
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).nullable().optional(),
    pricingTiers: z.array(PricingTierSchema).optional(),
    amountTiers: z.array(z.number().int().min(1)).min(1).optional(),
    paymentSource: z.enum(PAYMENT_SOURCES).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (d) => {
      // Mirror Create: only enforce when both bounds are present and endDate is
      // non-null; endDate == startDate is valid (one-time offering).
      if (d.startDate && d.endDate) {
        return new Date(d.endDate) >= new Date(d.startDate);
      }
      return true;
    },
    { message: 'endDate must be on or after startDate', path: ['endDate'] },
  )
  .refine((d) => (d.pricingTiers ? tiersAscending(d.pricingTiers) : true), {
    message: 'pricingTiers must be ascending by effectiveFrom',
    path: ['pricingTiers'],
  });

export type UpdateOfferingInput = z.infer<typeof UpdateOfferingSchema>;
