import type { RosterPayment, DonationDoc } from '@cmt/shared-domain';
import { chargeAmount, paymentSourceOf } from '@cmt/shared-domain/setu';
import type { StaffPledgeView } from '@/features/setu/pledges/get-pledges-for-staff';
import type { FamilyPaymentData, FamilyUnknownReason } from '../payment';

/**
 * The welcome desk's payment answer for one family.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 * "I am currently checking through Stripe logs to see what has happened when
 * someone inquires" (Vaibhav, 2026-08-05). Everything here exists to answer a
 * phone call without leaving the portal. That goal decides the shape: one
 * verdict, then the EVIDENCE behind it, then the provider's own words - never a
 * second competing status.
 *
 * ── Server components, no 'use client' ──────────────────────────────────────
 * Pure presentation over data the page already loaded. Nothing here is
 * interactive; the write controls remain their own client components.
 */

function money(cad: number): string {
  return `$${cad.toLocaleString('en-CA')}`;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Toronto',
  });
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--muted)',
        letterSpacing: '.1em',
        textTransform: 'uppercase',
        marginBottom: 6,
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

function Chip({ tone, children }: { tone: 'good' | 'warn' | 'neutral'; children: React.ReactNode }) {
  const palette =
    tone === 'good'
      ? { background: 'var(--accentSoft)', color: 'var(--accentDeep)' }
      : tone === 'warn'
        ? { background: 'var(--errSoft, #fdecec)', color: 'var(--err)' }
        : { background: 'var(--surface2)', color: 'var(--muted)' };
  return (
    <span
      style={{
        flex: '0 0 auto',
        fontSize: 10,
        padding: '2px 9px',
        borderRadius: 99,
        fontWeight: 600,
        ...palette,
      }}
    >
      {children}
    </span>
  );
}

/** The verdict as a word a volunteer can say out loud. */
const VERDICT_LABEL: Record<RosterPayment, string> = {
  paid: 'Paid',
  outstanding: 'Outstanding',
  'not-applicable': 'No fee',
  unknown: 'Unknown',
};

const VERDICT_TONE: Record<RosterPayment, 'good' | 'warn' | 'neutral'> = {
  paid: 'good',
  outstanding: 'warn',
  'not-applicable': 'neutral',
  unknown: 'neutral',
};

/**
 * Why the portal cannot answer - in words, and WITHOUT money figures, so this
 * is safe for a welcome-team volunteer who is not shown amounts.
 *
 * This is the sentence that ends the Stripe-dashboard trip. NOT ONE of these
 * four is a Stripe question - every one is answered inside CMT's own data (an
 * empty roster, a missing offering price, a program the teacher collects for, a
 * corrupt amount). So a desk that saw only "Unknown" was being sent to look in
 * the one place the answer could never be.
 */
const UNKNOWN_COPY: Record<FamilyUnknownReason, string> = {
  // Not a family fact at all - a fault on our side. It says so, because telling
  // a volunteer "unknown" about a family who may well have paid is how a paid
  // family gets chased for money.
  'donations-unavailable':
    'We could not read this family\u2019s donation history just now, so this is not a verdict on whether they have paid. Please refresh before telling them anything.',
  'no-active-enrollment': 'Nobody in this family is enrolled in a program this year, so there is nothing to pay.',
  'unpriceable-enrollment':
    'One of their programs has no fee recorded against it, so the portal cannot work out what is owed. An admin needs to set the price on that offering.',
  'off-portal-program':
    'One of their programs is paid outside the portal - the teacher collects it directly - so the portal cannot see whether it has been paid.',
  'corrupt-total': 'The recorded amounts for this family do not add up. Please report this one.',
};

export interface FamilyPaymentSectionProps {
  payment: FamilyPaymentData | null;
  /** Amounts, donation history and provider errors are admin-only. */
  canSeeMoney: boolean;
}

/**
 * "Programs & payment" - shown to every staff viewer who can reach this page.
 *
 * The verdict chip is the same value welcome-team already sees per family as the
 * roster's payment column, so this page merely stops being LESS informative than
 * the list that links to it. Amounts stay behind `canSeeMoney`.
 */
export function FamilyPaymentSection({ payment, canSeeMoney }: FamilyPaymentSectionProps) {
  if (payment === null) {
    // The loader threw - almost always the enrollments read. Say so rather than
    // rendering an empty "no programs" state, which would read as a family with
    // nothing enrolled and is the wrong thing to tell someone on the phone.
    return (
      <div style={{ marginBottom: 16 }}>
        <SectionHeading>Programs &amp; payment</SectionHeading>
        <div className="card" style={{ padding: 16 }}>
          <p style={{ fontSize: 13, margin: 0, color: 'var(--muted)', lineHeight: 1.55 }}>
            Couldn&apos;t load this family&apos;s programs or payment information. Please refresh; if it
            keeps happening, report it rather than assuming they are not enrolled.
          </p>
        </div>
      </div>
    );
  }

  const active = payment.enrollments.filter((e) => e.status === 'active');
  const inactive = payment.enrollments.filter((e) => e.status !== 'active');

  return (
    <div style={{ marginBottom: 16 }}>
      <SectionHeading>Programs &amp; payment</SectionHeading>

      <div className="card" style={{ padding: 16, marginBottom: 10 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Payment</span>
          <Chip tone={VERDICT_TONE[payment.verdict]}>{VERDICT_LABEL[payment.verdict]}</Chip>
          {payment.paidByPledge && <Chip tone="neutral">Monthly plan</Chip>}
        </div>

        {/* The arithmetic. This is what turns a chip into an answer, and it is
            the difference between "Outstanding" and "they owe $500, we have
            received $200". Admin-only because it is money. */}
        {canSeeMoney && payment.expectedCAD !== null && (
          <p style={{ fontSize: 13, margin: '0 0 4px', color: 'var(--body-text)' }}>
            Expected {money(payment.expectedCAD)}
            {/* ⚠️ The received figure is SUPPRESSED for a pledge family, and
                that is not cosmetic. A live pre-authorized debit writes no
                completed donation docs (no Stripe webhook), so the honest value
                of `paidCAD` is $0 - and "Paid · Monthly plan" printed directly
                above "received $0" reads as a contradiction that sends the
                reader to Stripe to find out which half is lying. Both halves
                are true; putting them side by side is what misleads. */}
            {payment.paidByPledge ? (
              <>
                {' · '}
                <span style={{ color: 'var(--muted)' }}>collected by monthly pre-authorized debit</span>
              </>
            ) : (
              payment.paidCAD !== null && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--muted)' }}>
                    received {money(payment.paidCAD)} in portal donations (all time)
                  </span>
                </>
              )
            )}
          </p>
        )}

        {/* ⚠️ #117: the received figure is LIFETIME, not this year's. Labelled
            rather than quietly presented as a year total - a family in their
            fifth year would otherwise look far more paid-up than they are for
            the current term. */}

        {payment.unknownReason && (
          <p style={{ fontSize: 13, margin: '4px 0 0', color: 'var(--body-text)', lineHeight: 1.55 }}>
            {UNKNOWN_COPY[payment.unknownReason]}
          </p>
        )}

        {payment.paidByPledge && (
          <p style={{ fontSize: 12, margin: '4px 0 0', color: 'var(--muted)', lineHeight: 1.5 }}>
            This family gives by monthly pre-authorized debit, which does not record individual
            portal donations.
          </p>
        )}

        {payment.pledges === 'unavailable' && (
          <p style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--err)', lineHeight: 1.5 }}>
            Monthly-plan information could not be loaded, so this verdict is based on one-off
            donations only.
          </p>
        )}
      </div>

      {active.length === 0 && inactive.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
          No programs on record for this family.
        </p>
      )}

      {active.map((e) => (
        <EnrollmentRow key={e.eid} e={e} canSeeMoney={canSeeMoney} />
      ))}

      {inactive.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', margin: '10px 0 6px' }}>
            Past / cancelled
          </div>
          {inactive.map((e) => (
            <EnrollmentRow key={e.eid} e={e} canSeeMoney={canSeeMoney} muted />
          ))}
        </>
      )}
    </div>
  );
}

function EnrollmentRow({
  e,
  canSeeMoney,
  muted = false,
}: {
  e: FamilyPaymentData['enrollments'][number];
  canSeeMoney: boolean;
  muted?: boolean;
}) {
  const isActive = e.status === 'active';
  // `chargeAmount` - the SAME function the verdict uses - rather than
  // `effectiveSuggestedAmount`, which collapses a missing offering onto the
  // enroll-time snapshot and so reports a confident `0` for an enrollment nobody
  // ever priced. Showing 0 there would contradict the "no fee recorded"
  // explanation printed above it.
  const amount = chargeAmount({
    override: e.suggestedAmountOverride ?? null,
    snapshot: e.suggestedAmountSnapshot,
    offering: e.offering,
    enrolledAt: e.enrolledAt,
    settledOffPortal: e.settledOffPortal === true,
  });
  const source = paymentSourceOf(
    e.offering?.paymentSource !== undefined ? { paymentSource: e.offering.paymentSource } : {},
  );

  return (
    <div
      style={{
        padding: 12,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        marginBottom: 8,
        opacity: muted ? 0.65 : 1,
      }}
    >
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{e.programLabel}</span>
        {!isActive && <Chip tone="neutral">Cancelled</Chip>}
        {e.settledOffPortal === true && <Chip tone="good">Settled off-portal</Chip>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
        {e.termLabel}
        {canSeeMoney && (
          <>
            {' · '}
            {amount === null ? 'no fee recorded' : money(amount)}
          </>
        )}
      </div>
      {/* Named for EVERY viewer, not just admins: "the teacher collects this
          one" is the answer to the payment question, and a volunteer needs it
          as much as an admin does. It carries no dollar figure. */}
      {source !== 'portal' && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
          {source === 'teacher-managed'
            ? 'Fees for this program are collected by the teacher, not through the portal.'
            : 'Fees for this program are recorded outside the portal.'}
        </div>
      )}
      {/* Settlement provenance - ADMIN ONLY (`canSeeMoney`).
          The chip above says THAT it was settled and stays visible to everyone,
          because that is a status like any other. This line is different: it
          carries `settledBy` (a staff member's email) and `settledNote`, which
          is REQUIRED free text whose stated purpose is "why this family's ask
          was changed" - i.e. the field an admin fills with "$500 e-transfer
          confirmed Aug 3". Shipping it ungated leaked a dollar figure to every
          volunteer on a page that gates the amount line ten lines above.
          Caught in review, before anyone had settled a family with a note. */}
      {canSeeMoney && e.settledOffPortal === true && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
          {/* Three cases, not two. Every enrollment settled before 2026-08-06
              carries none of these fields, and a session without an email
              carries a date but no actor - so "Recorded by  on Sep 3" was a
              reachable render. Each case gets its own sentence. */}
          {e.settledAt && e.settledBy
            ? `Recorded by ${e.settledBy} on ${shortDate(e.settledAt)}`
            : e.settledAt
              ? `Recorded on ${shortDate(e.settledAt)}`
              : 'Recorded before we started keeping details of who settled it'}
          {e.settledNote ? ` - ${e.settledNote}` : ''}
        </div>
      )}
    </div>
  );
}

const DONATION_STATUS_COPY: Record<string, string> = {
  // The portal learns a donation completed from the FAMILY'S BROWSER at the
  // Stripe return URL - there is no webhook. The copy says so, because a
  // "Completed" that turns out to be the browser's word is exactly the kind of
  // claim that sends someone to the Stripe dashboard to double-check.
  completed: 'Completed (confirmed at the Stripe return page)',
  redirected: 'Started - never confirmed back to the portal',
  abandoned: 'Abandoned',
};

const PLEDGE_STATUS_COPY: Record<string, string> = {
  // "Active as of the last check", NOT "Active - debited monthly". The portal
  // re-checks a pledge only while it is `started`; once active nothing ever
  // looks again (#54/#64). A subscription cancelled at Stripe, or one whose
  // debits are failing, reads `active` here forever - so a flat "debited
  // monthly" is a claim about the present that nothing has verified, on the one
  // screen built to stop people trusting the wrong thing. `lastCheckedAt`
  // renders beside this.
  active: 'Active as of the last check',
  started: 'Started - mandate not yet confirmed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export interface PaymentActivityProps {
  payment: FamilyPaymentData;
}

/**
 * "Payment activity" - ADMIN ONLY.
 *
 * Every payment the PORTAL initiated, plus the payment service's own words about
 * the ones that failed. This is the closest thing to "Stripe feedback" that
 * exists in our data, and until now it was recorded and displayed nowhere.
 *
 * What it deliberately is NOT: Stripe's ledger. Charges, invoices, refunds and
 * per-month PAD outcomes live at Stripe and reach us through no channel - the
 * CMT payment service exposes five calls and none of them lists transactions.
 * The footnote says so, so that an admin who needs a refund history knows to go
 * to Stripe rather than concluding the family never paid.
 */
export function PaymentActivity({ payment }: PaymentActivityProps) {
  const donations = payment.donations === 'unavailable' ? [] : payment.donations;
  const pledges = payment.pledges === 'unavailable' ? [] : payment.pledges;

  return (
    <div style={{ marginBottom: 16 }}>
      <SectionHeading>Payment activity</SectionHeading>

      {payment.donations === 'unavailable' && (
        <p style={{ fontSize: 12, color: 'var(--err)', margin: '0 0 8px' }}>
          Donation history could not be loaded.
        </p>
      )}

      {donations.length === 0 && payment.donations !== 'unavailable' && (
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 10px' }}>
          No donations have been started through the portal.
        </p>
      )}

      {donations.map((d) => (
        <DonationRow key={d.did} d={d} />
      ))}

      {payment.pledges === 'unavailable' && (
        <p style={{ fontSize: 12, color: 'var(--err)', margin: '10px 0 0' }}>
          Monthly-plan history could not be loaded.
        </p>
      )}

      {pledges.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', margin: '12px 0 6px' }}>
            Monthly plan attempts
          </div>
          {pledges.map((p) => (
            <PledgeRow key={p.pid} p={p} />
          ))}
        </>
      )}

      <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, margin: '12px 0 0' }}>
        This is what the portal recorded. Stripe&apos;s own ledger - individual monthly debits,
        refunds and chargebacks - is not sent to the portal, so check Stripe directly for those.
      </p>
    </div>
  );
}

function DonationRow({ d }: { d: DonationDoc }) {
  return (
    <div
      style={{
        padding: 12,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        marginBottom: 8,
      }}
    >
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{money(d.amountCAD)}</span>
        <Chip tone={d.status === 'completed' ? 'good' : d.status === 'redirected' ? 'warn' : 'neutral'}>
          {DONATION_STATUS_COPY[d.status] ?? d.status}
        </Chip>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
        {/* `label` is server-derived and always present; `programLabel` is null
            on legacy `type: 'general'` rows written before that type was
            withdrawn, so it can never be the only thing rendered. */}
        {d.label} · {shortDate(d.createdAt)}
        {d.coverFee && d.feeCAD > 0 ? ` · incl. ${money(d.feeCAD)} fee` : ''}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontFamily: 'var(--mono)' }}>
        {d.clientReferenceId}
      </div>
    </div>
  );
}

function PledgeRow({ p }: { p: StaffPledgeView }) {
  return (
    <div
      style={{
        padding: 12,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        marginBottom: 8,
      }}
    >
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{money(p.monthlyAmountCAD)}/month</span>
        <Chip tone={p.status === 'active' ? 'good' : p.status === 'failed' ? 'warn' : 'neutral'}>
          {PLEDGE_STATUS_COPY[p.status] ?? p.status}
        </Chip>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
        Started {shortDate(p.startedAt)}
        {p.activatedAt ? ` · active from ${shortDate(p.activatedAt)}` : ''}
        {p.cancelledAt ? ` · cancelled ${shortDate(p.cancelledAt)}` : ''}
        {p.lastCheckedAt ? ` · last checked ${shortDate(p.lastCheckedAt)}` : ''}
      </div>

      {/* The payment service's OWN words, verbatim. This string is the single
          most useful thing on the page for a failed payment enquiry, and it has
          been captured in Firestore and shown to nobody since pledges shipped. */}
      {p.lastError && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--err)',
            marginTop: 6,
            fontFamily: 'var(--mono)',
            lineHeight: 1.45,
            wordBreak: 'break-word',
          }}
        >
          {p.lastError}
        </div>
      )}

      {p.needsStripeVerification && (
        <div style={{ fontSize: 12, color: 'var(--err)', marginTop: 6, lineHeight: 1.5 }}>
          ⚠ A subscription was created after this pledge stopped being active. Check Stripe - the
          portal cannot stop a debit.
        </div>
      )}

      {/* Opaque provider handles, for looking the family up in Stripe directly.
          Never credentials, and never bank details - the PAD is authorised on a
          Stripe-hosted page and no account, transit or institution number ever
          reaches this codebase. The FAMILY-facing view omits these by
          construction (`FamilyPledgeView`); this is the staff view. */}
      {(p.subscriptionId ?? p.customerId) && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontFamily: 'var(--mono)' }}>
          {p.subscriptionId ?? ''}
          {p.verifiedSubscriptionId && p.verifiedSubscriptionId !== p.subscriptionId
            ? ` (verified ${p.verifiedSubscriptionId})`
            : ''}
          {p.customerId ? ` · ${p.customerId}` : ''}
        </div>
      )}
    </div>
  );
}
