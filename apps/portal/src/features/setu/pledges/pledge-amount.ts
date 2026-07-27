/** The $/month a NEW pledge would commit to. */
export const FALLBACK_MONTHLY_CAD = 51;

/**
 * The configured monthly amount.
 *
 * Read at call time, never captured at module load, so a redeploy or a test that
 * changes the env is not defeated by a stale binding.
 *
 * Guarded rather than a bare `Number(...)`: a mistyped env var would otherwise
 * yield NaN, and NaN reaches two bad places - Firestore rejects it outright
 * (so starting a pledge would fail with an opaque write error), and any screen
 * that got past that would read "Give $NaN monthly".
 *
 * Note this is only ever the DISPLAYED amount. What is actually debited lives on
 * the Stripe Price, which is why the plan requires opening the dashboard and
 * confirming the live Price before the flag is ever flipped on.
 */
export function configuredMonthlyAmountCAD(): number {
  const n = Number(process.env.PLEDGE_MONTHLY_AMOUNT_CAD ?? FALLBACK_MONTHLY_CAD);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : FALLBACK_MONTHLY_CAD;
}
