'use client';

import { useId, useState } from 'react';
import { SetuIcon, toast } from '@cmt/ui';
import { startEnrollmentCheckout } from '@/features/family/components/start-checkout-client';
import { startPledgeCheckout } from '@/features/family/components/start-pledge-client';
import { enrollFamily } from '@/features/family/components/enroll-client';

/** Where a family's monthly plan currently stands, as far as this screen cares. */
export type PledgeState =
  /** No plan, or a previous attempt that settled `failed`/`cancelled`. */
  | 'none'
  /** Mandate authorised, not yet confirmed by the bank. Days, not minutes. */
  | 'pending'
  /** Live and collecting. */
  | 'giving';

export interface DonationChoiceProps {
  /**
   * Enrollment id, or `null` when the family has NOT enrolled yet. The one-time
   * checkout is pinned to this enrollment; with no eid there is nothing to pin
   * to, so `enrollOid` must carry the offering to join first.
   */
  eid: string | null;
  /**
   * The offering to enrol into when `eid` is null. Supplying both is harmless -
   * `eid` wins, because an existing enrollment is never re-created.
   */
  enrollOid?: string | null;
  /** The enrollment-resolved one-time ask. Re-derived and enforced server-side. */
  oneTimeAmountCAD: number;
  /** The configured monthly ask. What is DEBITED lives on the Stripe Price. */
  monthlyAmountCAD: number;
  /** Managers only - a second parent must not commit the family to a debit. */
  canStartPledge: boolean;
  pledgeState: PledgeState;
}

/**
 * "Choose your donation" - one decision, two answers, one call to action.
 *
 * ── Why this replaced two stacked buttons ───────────────────────────────────
 * The enroll page previously rendered "Continue to donation →" AND a separate
 * "Give $51 monthly" button in the aside. Two primary buttons for a single
 * decision is the same ambiguity that put the pledge on a page nobody visited:
 * the family cannot tell whether these are alternatives or steps. Design by
 * Vaibhav, 2026-07-28 - a radio group makes them visibly exclusive, and the
 * single CTA acts on whichever is selected.
 *
 * ── The three states the design does not draw ───────────────────────────────
 * Two of them are correctness, not styling:
 *
 * 1. **Non-manager.** A second parent must not be able to commit the family to a
 *    recurring bank debit, so the monthly radio is disabled - and the reason is
 *    stated, because a greyed control with no explanation reads as a broken page.
 * 2. **Pending pledge.** 🔴 A mandate settles in DAYS. If the family can still
 *    pay the one-time amount while it confirms, they are charged BOTH, and the
 *    portal cannot undo it - there is no cancel endpoint on the payment service
 *    and `cancelPledgeRecord` is bookkeeping only. So a pending pledge gets NO
 *    payment control at all. Nobody is stranded: a FAILED mandate is written
 *    `failed`, which returns this to `none` and the choice comes back on its own.
 * 3. **Already giving.** Show the live plan; never ask a second time.
 */
export function DonationChoice({
  eid,
  enrollOid = null,
  oneTimeAmountCAD,
  monthlyAmountCAD,
  canStartPledge,
  pledgeState,
}: DonationChoiceProps) {
  const [choice, setChoice] = useState<'full' | 'monthly'>('full');
  const [pending, setPending] = useState(false);
  // ── Why the group name is per-INSTANCE and not a constant ──────────────────
  //
  // The enroll page renders a mobile tree AND a desktop tree, both in the DOM at
  // once (`block md:hidden` / `hidden md:block`). With a shared `name`, the
  // browser treats every radio across BOTH trees as ONE group, so the
  // second-rendered instance silently steals `checked` from the first: on
  // deployed preview the desktop radio showed filled and the phone's showed
  // EMPTY, while the card beside it was still tinted as selected. The duplicated
  // `id` compounded it - `<label htmlFor>` binds to the first match in document
  // order, so tapping the desktop label drove the mobile input.
  //
  // Unit tests render this component once and could never see it; it took a
  // screenshot of the real page. `useId` is SSR-safe and stable across hydration.
  const uid = useId();

  if (pledgeState === 'giving') {
    return (
      <ChoiceShell>
        <div className="card" style={{ padding: 18, background: 'var(--accentSoft)', borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
            <SetuIcon.check width={17} height={17} color="var(--accentDeep)" />
            <strong style={{ fontSize: 14, color: 'var(--accentDeep)' }}>
              You are giving ${monthlyAmountCAD} a month
            </strong>
          </div>
          <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, margin: 0 }}>
            Your monthly plan covers this year&apos;s Bala Vihar contribution, so there is nothing
            more to pay here. It continues until you ask the temple office to stop it.
          </p>
        </div>
      </ChoiceShell>
    );
  }

  if (pledgeState === 'pending') {
    return (
      <ChoiceShell>
        <div className="card" style={{ padding: 18, background: 'var(--surface2, #f3f1ec)', borderColor: 'var(--line, #e5e0d8)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
            <SetuIcon.check width={17} height={17} color="var(--muted)" />
            <strong style={{ fontSize: 14, color: 'var(--body-text)' }}>
              We&apos;re setting up your monthly gift
            </strong>
          </div>
          <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, margin: 0 }}>
            Your bank is confirming it, which can take a few days. Nothing has been taken yet, and
            there is nothing more for you to do. Changed your mind? Contact the temple office.
          </p>
        </div>
      </ChoiceShell>
    );
  }

  async function handleContinue() {
    if (pending) return;
    setPending(true);

    // ── Enrol first when the family has not joined yet ────────────────────────
    //
    // Both answers require an enrollment: the one-time checkout is pinned to an
    // `eid`, and a monthly plan that funds Bala Vihar for a family not IN Bala
    // Vihar is nonsense. Enrolling here rather than behind a separate "Enroll"
    // button is the whole point - the family previously met TWO buttons and had
    // to guess which one also enrolled them.
    //
    // Enrollment is free and reversible by the office; the payment step after it
    // is neither. So a failure here stops before either payment path is touched.
    let checkoutEid = eid;
    let checkoutAmount = oneTimeAmountCAD;
    if (!checkoutEid && enrollOid) {
      let enrolled: Awaited<ReturnType<typeof enrollFamily>>;
      try {
        enrolled = await enrollFamily(enrollOid);
      } catch {
        toast.error('Network error - please try again.');
        setPending(false);
        return;
      }
      if (!enrolled.ok) {
        if (enrolled.reason === 'unauthorized') {
          window.location.href = '/sign-in?from=%2Ffamily';
          return;
        }
        toast.error(enrolled.message);
        setPending(false);
        return;
      }
      checkoutEid = enrolled.eid;
      // The server's resolved amount wins over the rendered one - it re-derives
      // the floor, and the page's figure can be stale by the time this runs.
      if (enrolled.suggestedAmount >= 1) checkoutAmount = enrolled.suggestedAmount;
    }

    if (choice === 'monthly') {
      let result: Awaited<ReturnType<typeof startPledgeCheckout>>;
      try {
        result = await startPledgeCheckout();
      } catch {
        toast.error('Network error - please try again.');
        setPending(false);
        return;
      }
      // Navigation unmounts us, so `pending` is deliberately NOT cleared on the
      // success paths: flashing the idle label invites a second click, and a
      // second click here mints a second hosted session.
      if (result.ok) {
        window.location.href = result.checkoutUrl;
        return;
      }
      if (result.reason === 'unauthorized') {
        window.location.href = '/sign-in?from=%2Ffamily';
        return;
      }
      if (result.reason === 'already-live') {
        // The screen is stale, not broken. A hard reload re-reads the pledge and
        // renders the state that already exists rather than reporting a failure.
        toast.error('You already have a monthly gift in progress.');
        window.location.reload();
        return;
      }
      if (result.reason === 'manager-required') {
        toast.error('Only the family manager can set up monthly giving.');
      } else if (result.reason === 'no-email') {
        toast.error('Add an email address to your profile first - the bank needs somewhere to confirm.');
      } else if (result.reason === 'unavailable') {
        toast.error('Monthly giving is temporarily unavailable - please try again later.');
      } else {
        toast.error('Could not start monthly giving - please try again.');
      }
      setPending(false);
      return;
    }

    // No eid even after the enrol step - a free/$0 offering returns none, and
    // the checkout API requires amountCAD >= 1 anyway. The donate page owns that
    // flow. `/family/donate` with no eid resolves the family's own enrollment.
    if (!checkoutEid || checkoutAmount < 1) {
      window.location.href = checkoutEid
        ? `/family/donate?eid=${encodeURIComponent(checkoutEid)}`
        : '/family/donate';
      return;
    }

    let result: Awaited<ReturnType<typeof startEnrollmentCheckout>>;
    try {
      result = await startEnrollmentCheckout(checkoutEid, checkoutAmount);
    } catch {
      toast.error('Network error - please try again.');
      setPending(false);
      return;
    }
    if (result.ok) {
      window.location.href = result.url;
      return;
    }
    if (result.reason === 'unauthorized') {
      window.location.href = '/sign-in?from=%2Ffamily';
      return;
    }
    if (result.reason === 'pledge-covers-enrollment') {
      // A pledge was started elsewhere after this page rendered - another tab,
      // or a co-manager's device. Retrying can never clear it, so the generic
      // "please try again" would be actively wrong. Reload; the server render
      // then shows the pending/giving state instead of the choice.
      toast.error('Your monthly gift already covers this - refreshing.');
      window.location.reload();
      return;
    }
    if (result.reason === 'below-suggested') {
      toast.error(`The suggested amount is $${result.suggested}. Please contact the welcome team to give less.`);
    } else if (result.reason === 'not-configured') {
      toast.error('Donations are temporarily unavailable - please try again later.');
    } else if (result.reason === 'manager-required') {
      toast.error('Only the family manager can make a donation through the portal.');
    } else {
      toast.error('Could not start checkout - please try again.');
    }
    setPending(false);
  }

  return (
    <ChoiceShell>
      <div style={{ display: 'grid', gap: 12 }}>
        <Option
          id={`${uid}-full`}
          name={`${uid}-donation-choice`}
          selected={choice === 'full'}
          onSelect={() => setChoice('full')}
          title="Full donation"
          amount={`$${oneTimeAmountCAD}`}
          unitTop="one-time donation"
          unitBottom="per family"
          body={`A one-time donation of $${oneTimeAmountCAD} supports the entire academic year.`}
        />
        <Option
          id={`${uid}-monthly`}
          name={`${uid}-donation-choice`}
          selected={choice === 'monthly'}
          onSelect={() => setChoice('monthly')}
          disabled={!canStartPledge}
          title="Monthly pledge"
          amount={`$${monthlyAmountCAD}`}
          unitTop="per month"
          unitBottom="ongoing"
          body={`Make a convenient monthly pledge of $${monthlyAmountCAD} to support Bala Vihar all year long.`}
          note={canStartPledge ? undefined : 'Only the family manager can set up a monthly plan.'}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '16px 0 14px' }}>
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <SetuIcon.shield width={17} height={17} color="var(--muted)" />
        </span>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: 0 }}>
          Donations are tax-deductible.
          <br />
          Chinmaya Mission Toronto
        </p>
      </div>

      <button
        type="button"
        className="btn btn--p btn--block"
        disabled={pending}
        onClick={handleContinue}
        style={{ display: 'block', width: '100%', opacity: pending ? 0.7 : 1 }}
      >
        {/* A family who has not joined yet is enrolled by this same click, and
            the label has to say so - "Continue to donation" would enrol them
            silently, which the old two-button layout at least made explicit. */}
        {pending ? 'Starting…' : eid ? 'Continue to donation →' : 'Enroll and continue →'}
      </button>
    </ChoiceShell>
  );
}

/** The titled card every state shares, so the heading cannot drift between them. */
function ChoiceShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          marginBottom: 14,
        }}
      >
        Choose your donation
      </div>
      {children}
    </div>
  );
}

interface OptionProps {
  id: string;
  name: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  title: string;
  amount: string;
  unitTop: string;
  unitBottom: string;
  body: string;
  /** `| undefined` explicitly: exactOptionalPropertyTypes is on. */
  note?: string | undefined;
}

/**
 * One selectable donation option.
 *
 * The whole card is the label, so the tap target is the card and not just the
 * 16px radio - the difference matters a great deal on a phone. The native input
 * is kept (visually plain, never `display:none`) so the radio group keeps its
 * keyboard behaviour and screen-reader semantics for free.
 */
function Option({
  id,
  name,
  selected,
  onSelect,
  disabled = false,
  title,
  amount,
  unitTop,
  unitBottom,
  body,
  note,
}: OptionProps) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'block',
        padding: 16,
        borderRadius: 'var(--radius)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        background: selected ? 'var(--accentSoft)' : 'var(--surface)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <input
          type="radio"
          id={id}
          name={name}
          checked={selected}
          disabled={disabled}
          onChange={onSelect}
          style={{ accentColor: 'var(--accent)', width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* No "RECOMMENDED" badge: removed 2026-07-28 at Vaibhav's request. It
              steered families toward the one-time option, and $51x12 = $612
              against $500 means the two are not equivalent in the direction the
              badge implied. "Full donation" is still the preselected default. */}
          <div style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: 15, color: 'var(--ink)' }}>{title}</strong>
          </div>
          {/* Amount and unit share a baseline row so the unit reads as a
              qualifier on the number, exactly as drawn. It wraps on narrow
              phones rather than shrinking the amount. */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--display)', fontSize: 34, lineHeight: 1.1, color: 'var(--ink)' }}>
              {amount}
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.35 }}>
              {unitTop}
              <br />
              {unitBottom}
            </span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, margin: '10px 0 0' }}>{body}</p>
          {note && (
            <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '8px 0 0' }}>{note}</p>
          )}
        </div>
      </div>
    </label>
  );
}
