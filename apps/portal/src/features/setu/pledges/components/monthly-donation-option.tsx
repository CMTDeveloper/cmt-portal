import { SetuIcon } from '@cmt/ui';
import { StartPledgeButton } from '@/features/family/components/start-pledge-button';

export interface MonthlyDonationOptionProps {
  /** Today's monthly ask. */
  monthlyAmountCAD: number;
  /** The one-time suggested amount, so the two choices can be compared honestly. */
  oneTimeAmountCAD: number | null;
  /** Managers only - a second parent must not commit the family to a debit. */
  canStart: boolean;
  /** The family already has a live monthly plan; show that, never a second ask. */
  alreadyPledging: boolean;
}

/**
 * The monthly alternative, shown BESIDE the one-time donation form.
 *
 * ── Why this lives on the donate page and not the dashboard ─────────────────
 * It used to be a standalone "Monthly giving - support the mission" card on
 * `/family`, which read as a second, unrelated ask; it even rendered for
 * families whose Bala Vihar status said "Not enrolled", so the portal was
 * inviting people to give monthly toward a programme they had not joined.
 * Vaibhav, 2026-07-27: *"This should not be separate. It's part of Bala Vihar.
 * Instead of straight $500 donation, family can do Monthly Pledge"* - it is one
 * decision with two answers, so both answers belong in one place, at the moment
 * the family is deciding.
 *
 * ── The honesty requirements ────────────────────────────────────────────────
 * 1. It says the plan CONTINUES until cancelled. It is not a 12-month term, and
 *    a family who believes it stops on its own has been misled about a bank
 *    debit. Vaibhav: *"It would be continuous until manually stopped."*
 * 2. It says HOW to stop it - at the ashram - because the portal has no
 *    self-serve cancel.
 * 3. It never quotes an annual total, because there isn't one: the plan has no
 *    end date, so any "= $612/year" figure would be an invention.
 */
export function MonthlyDonationOption({
  monthlyAmountCAD,
  oneTimeAmountCAD,
  canStart,
  alreadyPledging,
}: MonthlyDonationOptionProps) {
  if (alreadyPledging) {
    return (
      <div
        className="card"
        style={{ padding: 18, marginTop: 14, background: 'var(--accentSoft)', borderColor: 'var(--accent)' }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
          <SetuIcon.check width={17} height={17} color="var(--accentDeep)" />
          <strong style={{ fontSize: 14, color: 'var(--accentDeep)' }}>
            You are giving ${monthlyAmountCAD} a month
          </strong>
        </div>
        <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, margin: 0 }}>
          Your monthly plan covers this year&apos;s Bala Vihar contribution, so there is nothing more
          to pay here. It continues until you ask the temple office to stop it.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 18, marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <SetuIcon.heart width={17} height={17} color="var(--accentDeep)" />
        <strong style={{ fontSize: 14, color: 'var(--accentDeep)' }}>
          Or give ${monthlyAmountCAD} a month instead
        </strong>
      </div>
      <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.6, margin: '0 0 12px' }}>
        {oneTimeAmountCAD !== null ? (
          <>
            Rather than ${oneTimeAmountCAD} at once, you can spread your Bala Vihar contribution over
            the year.{' '}
          </>
        ) : (
          <>You can spread your Bala Vihar contribution over the year. </>
        )}
        {/* "bank account" deliberately avoided: `pledge-isolation.test.ts` fails
            the build on bank-detail words appearing in this feature's CODE, and
            that guard is worth more than the phrasing. Comments are stripped
            before it scans, but JSX TEXT is not - so copy has to respect it
            too. Reword; never relax the test. */}
        It is debited from your bank each month and <strong>continues until you stop it</strong> —
        there is no end date. To stop it, contact the temple office.
      </p>
      {canStart ? (
        // The amount charged is server-derived; this label is copy only.
        <StartPledgeButton label={`Give $${monthlyAmountCAD} monthly`} block />
      ) : (
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
          Only the family manager can set up a monthly plan.
        </p>
      )}
    </div>
  );
}
