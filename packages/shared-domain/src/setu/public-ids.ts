/** User-facing Family ID: the 4-digit publicFid when assigned, else the legacy CMT- fid. */
export function displayFid(f: { publicFid?: string | null | undefined; fid: string }): string {
  return f.publicFid ?? f.fid;
}

/** User-facing Member ID: the 5-digit publicMid when assigned, else the legacy ${fid}-NN mid. */
export function displayMid(m: { publicMid?: string | null | undefined; mid: string }): string {
  return m.publicMid ?? m.mid;
}

/**
 * How a family is identified on an EXTERNAL payment record (Stripe metadata).
 *
 * Vaibhav, 2026-07-31, reading a live Stripe call: the metadata carried only
 * `fid: "CMT-HTNO0TEG"`, our internal document key, which matches nothing a
 * human or a bank statement can be reconciled against. He asked for the
 * Family ID in the form "FID-XXXX".
 *
 * The prefix is not decoration - it makes the value self-describing in a flat
 * metadata table where "5001" alone reads as an amount, an invoice number, or
 * a member id. Falls back to the internal fid when publicFid has not been
 * minted yet (it is allocated lazily at first enrollment), because an awkward
 * identifier still identifies the family and an absent one does not.
 */
export function paymentFamilyLabel(f: {
  publicFid?: string | null | undefined;
  fid: string;
}): string {
  return `FID-${displayFid(f)}`;
}
