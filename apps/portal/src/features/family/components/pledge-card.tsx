import { SetuIcon } from '@cmt/ui';
import { isPledgeGiving } from '@cmt/shared-domain/setu';
import type { FamilyPledgeView } from '@/features/setu/pledges/select-family-pledge';
import { StartPledgeButton } from './start-pledge-button';

export interface PledgeCardProps {
  /** The family's most relevant pledge, or null if they have never started one. */
  pledge: FamilyPledgeView | null;
  /**
   * What a NEW pledge would cost today. Used ONLY for the ask. An existing
   * pledge always speaks its own snapshotted amount - see below.
   */
  askAmountCAD: number;
  /** Managers only. A second parent sees the state, never a way to commit the family. */
  canStart: boolean;
  /**
   * Does THIS surface solicit a new plan at all? Distinct from `canStart`, which
   * asks whether the VIEWER may commit the family - a non-manager still sees the
   * ask, just without the button.
   *
   * 🔴 Defaults to `false`: a money ask should have to be asked for. Reported
   * 2026-07-28, `/family` showed "Support the mission with $51 a month. You can
   * set one up again below." to a family reading "Not enrolled", with nothing
   * below - the dashboard passes `canStart={false}`, which suppressed the button
   * and left the sales copy behind. Both real surfaces report rather than
   * solicit; the ask lives in the Bala Vihar donate flow, where the family is
   * actually choosing how to pay.
   */
  canAsk?: boolean;
  /** Tighter padding for the mobile column. */
  mobile?: boolean;
}

/**
 * The monthly-gift card.
 *
 * ── The one rule this card exists to keep ───────────────────────────────────
 * It must never claim a family is giving unless the money is actually moving.
 * `started` means "we redirected them to the bank-mandate page and do not yet
 * know what happened" - a materially weaker claim than `active`, and a family
 * wrongly told their gift is set up will never look at it again. Every state
 * here is keyed off `isPledgeGiving()`, which is true for `active` alone.
 *
 * ── Why the ask amount and the pledge amount are separate props ─────────────
 * `monthlyAmountCAD` is snapshotted onto the pledge when it starts, so a later
 * price change never rewrites what an existing pledge says it is. Rendering
 * today's price for an existing pledge would throw that guarantee away at the
 * only place a family would ever notice it. The ask, conversely, MUST quote
 * today's price - they are about to authorise it.
 */
export function PledgeCard({
  pledge,
  askAmountCAD,
  canStart,
  canAsk = false,
  mobile = false,
}: PledgeCardProps) {
  const padding = mobile ? 18 : 24;
  const giving = isPledgeGiving(pledge);
  const inFlight = pledge?.status === 'started';

  // Nothing to report and nothing permitted to ask - an empty "Monthly giving"
  // heading is worse than no card.
  if (!pledge && !canAsk) return null;

  return (
    <div className="card" style={{ padding, marginBottom: mobile ? 12 : 18 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <span
          aria-hidden
          style={{
            width: 36,
            height: 36,
            flex: '0 0 auto',
            borderRadius: 999,
            background: giving ? 'var(--accent)' : 'var(--accentSoft)',
            color: giving ? '#fff' : 'var(--accent)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {giving ? <SetuIcon.check width={17} height={17} /> : <SetuIcon.heart width={17} height={17} />}
        </span>
        <h2 style={{ fontSize: mobile ? 16 : 18, fontWeight: 600 }}>Monthly giving</h2>
      </div>

      {giving && pledge ? (
        <GivingBody pledge={pledge} />
      ) : inFlight ? (
        <InFlightBody />
      ) : canAsk ? (
        <AskBody
          askAmountCAD={askAmountCAD}
          canStart={canStart}
          priorStatus={pledge?.status ?? null}
        />
      ) : (
        <InactiveBody />
      )}
    </div>
  );
}

/** `active`. The only state allowed to thank anyone. */
function GivingBody({ pledge }: { pledge: FamilyPledgeView }) {
  const since = formatToronto(pledge.activatedAt);
  return (
    <>
      <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6 }}>
        {/* The pledge's OWN amount, never the ask's. */}
        You&apos;re giving <strong>${pledge.monthlyAmountCAD} monthly</strong>
        {since ? ` since ${since}` : ''}. Thank you.
      </p>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
        To change or stop your monthly gift, contact the temple office.
      </p>
    </>
  );
}

/**
 * `started`. Carefully worded to promise nothing: no amount, no date, no thanks.
 * A pre-authorized debit mandate can still fail days after the family leaves the
 * hosted page.
 */
function InFlightBody() {
  return (
    <>
      <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6 }}>
        We&apos;re setting up your monthly gift. This can take a few days to confirm.
      </p>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
        We&apos;ll email you once it&apos;s confirmed. Nothing has been taken from your account yet.
      </p>
    </>
  );
}

/**
 * A terminal pledge on a surface that does not solicit.
 *
 * Reports the fact and points at the one place the plan can be restarted -
 * WITHOUT an amount, because quoting the price is the ask, and without "below",
 * because on these surfaces there is nothing below. Neutral about the cause: we
 * genuinely cannot tell a bank decline from an abandoned page from a temple
 * cancellation, and naming one would be worse than naming none.
 */
function InactiveBody() {
  return (
    <>
      <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6 }}>
        Your monthly gift isn&apos;t active.
      </p>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
        Monthly giving is one of the two ways to pay your Bala Vihar contribution - you can choose it
        there, or contact the temple office.
      </p>
    </>
  );
}

/** No pledge, or a terminal one. Both land on the same ask. */
function AskBody({
  askAmountCAD,
  canStart,
  priorStatus,
}: {
  askAmountCAD: number;
  canStart: boolean;
  priorStatus: FamilyPledgeView['status'] | null;
}) {
  return (
    <>
      {priorStatus !== null && (
        // Neutral on purpose: we genuinely do not know whether the family
        // abandoned the page, the bank declined, or the temple cancelled it.
        // Naming a cause we cannot see would be worse than naming none.
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
          Your previous monthly gift isn&apos;t active. You can set one up again below.
        </p>
      )}
      <p style={{ fontSize: 14, color: 'var(--body-text)', lineHeight: 1.6 }}>
        Support the mission with <strong>${askAmountCAD} a month</strong>. It comes straight from your
        bank account, and you can stop it any time by contacting the temple office.
      </p>
      {canStart && (
        <div style={{ marginTop: 14 }}>
          <StartPledgeButton label={`Give $${askAmountCAD} monthly`} />
        </div>
      )}
    </>
  );
}

/**
 * `null` in, `null` out - the caller renders nothing rather than a date. An
 * `active` pledge always has an `activatedAt`, but `Intl` throws a RangeError on
 * an Invalid Date, and a receipt page that 500s over a missing timestamp would
 * be a far worse bug than an unnamed date.
 */
function formatToronto(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Toronto',
  });
}
