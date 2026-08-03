import { BALA_VIHAR } from './schemas/offering';

/**
 * The metadata block both Stripe paths send, in ONE place.
 *
 * CMT's payment service is shared across their properties and the accounting
 * side reports on `campaign` + `source`. The contract is CMT's "Stripe
 * Integration Doc": every call carries
 *
 *     "metadata": { "campaign": "BalaViharDonation", "source": "setu" }
 *
 * with `BalaViharPledge` on the monthly PAD flow.
 *
 * The portal was sending NEITHER correctly. The one-time donation put the
 * literal `'setu'` in `campaign` (i.e. the SOURCE, in the CAMPAIGN field, so the
 * campaign was never populated at all and the source never sent), and the pledge
 * path sent no campaign and no source whatsoever. Reported 2026-08-02: "Stripe
 * campaign info is inaccurate and needs to match integration doc."
 *
 * Two fields, two neighbouring keys, both strings - the exact shape where a
 * mix-up is invisible on both sides. Hence one helper, tested against the
 * literals from the doc, rather than an object literal at each call site.
 */

/** Every payment the portal starts comes from this system. Never varies. */
export const PAYMENT_SOURCE = 'setu';

/**
 * Campaign per flow, per the integration doc. Deliberately a lookup rather than
 * a hardcode at the call sites: the doc names two, they differ by one word, and
 * the difference decides which report a real gift lands in.
 */
export const CAMPAIGN_BY_PROGRAM: Readonly<Record<string, string>> = {
  [BALA_VIHAR]: 'BalaViharDonation',
};

/** The monthly pre-authorized-debit flow. Bala Vihar only, by design. */
export const CAMPAIGN_PLEDGE = 'BalaViharPledge';

/**
 * Campaign for a donation toward `programKey`.
 *
 * Owner decision 2026-08-02: *"for now only payment from portal will be for
 * balavihar... for Tabla I will update you later how they want to collect
 * payments."* So Bala Vihar is the only campaign CMT has named.
 *
 * A program CMT has not named yet gets `SetuDonation`, NOT `BalaViharDonation`.
 * That choice is the whole point of this function:
 *
 *  - Labelling it `BalaViharDonation` would misfile a real Tabla gift into the
 *    Bala Vihar report, silently and unrecoverably - nobody reconciling either
 *    report would see a discrepancy.
 *  - REFUSING the payment would be worse: `paymentSourceOf()` defaults an
 *    offering with no explicit `paymentSource` to `'portal'`, so any non-Bala
 *    Vihar offering is payable through the portal TODAY. A refusal would stop a
 *    family giving money CMT wants, with no way for them to fix it.
 *
 * `SetuDonation` is honest, visible in Stripe, and reconcilable - and
 * `programKey` rides in the metadata beside it, so the true program is never
 * lost even before CMT names the campaign.
 */
export const CAMPAIGN_FALLBACK = 'SetuDonation';

export function campaignForProgram(programKey: string | null | undefined): string {
  if (!programKey) return CAMPAIGN_FALLBACK;
  return CAMPAIGN_BY_PROGRAM[programKey] ?? CAMPAIGN_FALLBACK;
}

/** Whether `programKey` has a campaign CMT has actually named. */
export function hasNamedCampaign(programKey: string | null | undefined): boolean {
  return typeof programKey === 'string' && programKey in CAMPAIGN_BY_PROGRAM;
}

export type PaymentMetadataInput =
  | {
      kind: 'donation';
      /** Internal family doc key. The join key for support + reconciliation. */
      fid: string;
      /** Human-readable "FID-5001" - see paymentFamilyLabel. */
      familyId: string;
      /** The enrollment's ACTUAL program, never assumed. */
      programKey: string | null;
    }
  | {
      kind: 'pledge';
      fid: string;
      familyId: string;
      /** Our pledge doc id, so a Stripe row maps back to a portal record. */
      pid: string;
    };

/**
 * Stripe metadata values must be strings. Returned as a plain record so each
 * call site can pass it straight through to the payment service.
 *
 * `fid` + `familyId` are kept from the 2026-07-31 change (Vaibhav found a live
 * record identified only by "CMT-HTNO0TEG"). The doc does not list them; extra
 * keys are allowed, and removing data someone may already be reporting on is
 * the riskier move.
 */
export function buildPaymentMetadata(input: PaymentMetadataInput): Record<string, string> {
  const base = { source: PAYMENT_SOURCE, fid: input.fid, familyId: input.familyId };
  if (input.kind === 'pledge') {
    return { ...base, campaign: CAMPAIGN_PLEDGE, pid: input.pid };
  }
  return {
    ...base,
    campaign: campaignForProgram(input.programKey),
    // The truth, beside the label. Even for a program whose campaign CMT has
    // not named yet, the Stripe row says exactly what was paid for.
    programKey: input.programKey ?? '',
  };
}
