import { z } from 'zod';

/**
 * A family's monthly pre-authorized debit (PAD), as the PORTAL records it.
 *
 * ── What this record deliberately is NOT ─────────────────────────────────────
 * It holds **status and opaque provider handles, nothing else**. The mandate is
 * authorised on a Stripe-HOSTED page: no bank account number, transit number,
 * institution number, last-4, or mandate document ever reaches this codebase -
 * not in a field, not in a log, not in a Sentry event, not in an email. If a
 * change here tempts you to add one, the change is wrong.
 *
 * Zod objects strip unknown keys by default, so spreading a provider response
 * into a doc cannot smuggle bank details past this schema. That is load-bearing
 * rather than incidental, and there is a test pinning it.
 */

/**
 * `started` rather than `pending`: it means "we redirected the family to the
 * hosted page and do not yet know what happened". `pending` reads as "in
 * progress and on track", which is a stronger claim than anything has verified -
 * the browser may have died on the hosted page and left an orphan mandate.
 */
export const PLEDGE_STATUSES = ['started', 'active', 'cancelled', 'failed'] as const;
export type PledgeStatus = (typeof PLEDGE_STATUSES)[number];

export const PledgeDocSchema = z.object({
  pid: z.string().min(1),
  fid: z.string().min(1),
  /**
   * Snapshotted when the pledge starts, so a later price change never rewrites
   * what an EXISTING pledge says it is. The authoritative charge amount lives at
   * Stripe against the Price id - this field is what the portal may honestly
   * display for this family, and nothing more.
   */
  monthlyAmountCAD: z.number().int().positive(),
  status: z.enum(PLEDGE_STATUSES),
  startedAt: z.date(),
  activatedAt: z.date().nullable(),
  cancelledAt: z.date().nullable(),
  startedByMid: z.string().min(1),

  // ── Opaque Stripe handles ───────────────────────────────────────────────────
  // Reconciliation inputs, not secrets and not for display. Bare `.optional()`
  // and never `.default()`: doc schemas validate on READ, so a default would
  // invent a value for a document that never carried one.
  setupSessionId: z.string().nullable().optional(),
  subscriptionId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  lastCheckedAt: z.date().nullable().optional(),
  /** Last provider error, for the stale-pledge report. Never shown to a family. */
  lastError: z.string().nullable().optional(),
});

export type PledgeDoc = z.infer<typeof PledgeDocSchema>;

/**
 * Is this family actually giving monthly?
 *
 * ONLY `active` counts. `started` is the trap: the family has been sent to the
 * hosted page, but nothing has confirmed a mandate or created a subscription, so
 * any surface claiming they are giving would be telling them money is moving
 * when it is not. Every piece of pledge copy keys off this.
 */
export function isPledgeGiving(pledge: { status: PledgeStatus } | null | undefined): boolean {
  return pledge?.status === 'active';
}
