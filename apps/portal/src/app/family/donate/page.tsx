import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { SetuIcon, Rosette } from '@cmt/ui';
import { CspRoot } from '@/features/family/components/atoms';
import { DonateForm } from '@/features/family/components/donate-form';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { paymentSourceOf, BALA_VIHAR } from '@cmt/shared-domain';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { isPledgeGiving } from '@cmt/shared-domain/setu';
import { flags } from '@/lib/flags';
import { getFamilyPledge } from '@/features/setu/pledges/get-family-pledge';
import { clearAbandonedPledge } from '@/features/setu/pledges/clear-abandoned-pledge';
import { configuredMonthlyAmountCAD } from '@/features/setu/pledges/pledge-amount';
import { MonthlyDonationOption } from '@/features/setu/pledges/components/monthly-donation-option';

export const metadata = { title: 'Donate' };

export default async function DonatePage({
  searchParams,
}: {
  searchParams: Promise<{ eid?: string }>;
}) {
  if (process.env.NEXT_PUBLIC_FEATURE_SETU_DONATIONS !== 'true') {
    redirect('/family/enroll');
  }

  await connection();

  const familyData = await getCurrentFamily();
  if (!familyData) {
    return (
      <CspRoot style={{ padding: 32 }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Session expired. Please sign in again.</p>
      </CspRoot>
    );
  }

  const { family, isManager } = familyData;
  const { eid } = await searchParams;

  // Resolve mode. `?eid` → bala-vihar (amount pinned to enrollment snapshot/
  // override); no eid → general year-round giving.
  let mode: 'enrollment' | 'general' = 'general';
  let suggestedAmount: number | null = null;
  let periodLabel: string | null = null;
  let programLabel: string | null = null;
  let programKey: string | null = null;
  let tiers: number[] = [];
  let resolvedEid: string | null = null;
  // Legacy cutover year already settled offline → block the online checkout.
  let alreadyPaidLegacy = false;
  let teacherManagedPayment = false;

  if (eid) {
    const enrollments = await getEnrollments(family.fid);
    const enrollment = enrollments.find((e) => e.eid === eid && e.status === 'active');
    if (enrollment) {
      mode = 'enrollment';
      resolvedEid = enrollment.eid;
      suggestedAmount = enrollment.effectiveSuggestedAmount;
      periodLabel = enrollment.termLabel;
      programLabel = enrollment.offering?.programLabel ?? enrollment.programLabel;
      programKey = enrollment.programKey;
      tiers = enrollment.offering?.amountTiers ?? [];

      if (enrollment.offering) {
        const paymentSource = paymentSourceOf(enrollment.offering.paymentSource !== undefined ? { paymentSource: enrollment.offering.paymentSource } : {});
        if (paymentSource === 'legacy') {
          alreadyPaidLegacy = (await getLegacyPaymentStatus(family.legacyFid)) === 'paid';
        }
        teacherManagedPayment = paymentSource === 'teacher-managed';
      }
    }
    // If the eid is stale/unknown, fall through to general giving rather than erroring.
  }

  // General year-round giving is handled off-portal (CMT decision 2026-06-04):
  // only the enrollment donation (?eid=) collects through the portal now. A bare
  // /family/donate (or a stale eid that fell through to 'general') redirects home.
  if (mode === 'general') {
    redirect('/family');
  }

  const heading = mode === 'enrollment' ? 'Your donation' : 'Make a donation';
  const backHref = mode === 'enrollment' && programKey ? `/family/enroll/${programKey}` : '/family';
  const sub =
    mode === 'enrollment'
      ? `${programLabel ?? 'Program'}${periodLabel ? ` · ${periodLabel}` : ''} · ${family.location}`
      : 'A charitable gift to Chinmaya Mission Toronto';

  // ── The monthly alternative (2026-07-27, Vaibhav) ─────────────────────────
  // "This should not be separate. It's part of Bala Vihar. Instead of straight
  // $500 donation, family can do Monthly Pledge." So the choice lives HERE, at
  // the moment the family is deciding how to pay, rather than as an unrelated
  // card on the dashboard.
  //
  // Gated to a BALA VIHAR ENROLLMENT donation on purpose: a general gift has no
  // yearly contribution to spread, and another programme's donation is not what
  // the monthly plan funds. This is also what stops the ask reaching a family
  // with no Bala Vihar enrollment at all - the state in the screenshot that
  // prompted the change.
  const pledgeEligible =
    flags.setuPledge && mode === 'enrollment' && programKey === BALA_VIHAR && !teacherManagedPayment;
  // Same repair as the enroll page and the dashboard: an attempt the family
  // never submitted must not block the ONE-TIME payment either. Reachable
  // without touching the enroll page - during a multi-offering window
  // `EnrollPanel` -> `EnrollCta` redirects straight here after enrolling, so a
  // family with an earlier abandoned attempt would land on "your bank is
  // confirming it" with no way to pay. Found by a Codex review, 2026-07-29.
  let existingPledge = pledgeEligible ? await getFamilyPledge(family.fid) : null;
  if (existingPledge?.status === 'started') {
    if ((await clearAbandonedPledge(family.fid)) === 'cleared') {
      existingPledge = await getFamilyPledge(family.fid);
    }
  }
  const monthlyOption = pledgeEligible ? (
    <MonthlyDonationOption
      monthlyAmountCAD={configuredMonthlyAmountCAD()}
      oneTimeAmountCAD={suggestedAmount}
      canStart={isManager}
      alreadyPledging={isPledgeGiving(existingPledge)}
    />
  ) : null;

  // ── 🔴 A pledge already covers this contribution ───────────────────────────
  //
  // This page renders the FULL one-time payment form, and until 2026-07-28 it
  // had no pledge awareness at all: `existingPledge` was read, but only to set
  // `alreadyPledging`, which is `isPledgeGiving()` - true for `active` ALONE.
  // A family whose mandate was still confirming (`started`) therefore saw the
  // complete form and could pay $500 on top of $51/month, with nothing on any
  // layer to stop it. The page is reachable from four code paths plus any stale
  // tab, so this was not a theoretical bookmark case.
  //
  // `started` counts as well as `active` - the days-long confirmation gap IS the
  // exposure window. The server enforces the same rule in the checkout route;
  // this exists so the family reads an explanation instead of meeting a 409.
  const pledgeCoversThis =
    existingPledge?.status === 'started' || existingPledge?.status === 'active';

  const form = pledgeCoversThis && mode === 'enrollment' ? (
    <div style={{ padding: '16px 18px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radius)', fontSize: 14, lineHeight: 1.55 }}>
      <strong>
        {existingPledge?.status === 'active'
          ? `You are giving $${configuredMonthlyAmountCAD()} a month.`
          : 'Your monthly gift is being set up.'}
      </strong>
      <div style={{ marginTop: 6, color: 'var(--body-text)' }}>
        {existingPledge?.status === 'active'
          ? `Your monthly plan covers this year's Bala Vihar contribution, so there is nothing more to pay here. It continues until you ask the temple office to stop it.`
          : `Your bank is confirming it, which can take a few days. Nothing has been taken yet, and there is nothing more for you to do. Changed your mind? Contact the temple office.`}
        {' '}<Link href="/family" style={{ color: 'var(--accentDeep)', fontWeight: 600 }}>Back to dashboard</Link>
      </div>
    </div>
  ) : teacherManagedPayment ? (
    <div style={{ padding: '16px 18px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radius)', fontSize: 14, lineHeight: 1.55 }}>
      <strong>Payment is managed by the teacher for {periodLabel}.</strong>
      <div style={{ marginTop: 6, color: 'var(--body-text)' }}>
        There&apos;s nothing to pay in the portal for this enrollment.
        {' '}<Link href="/family" style={{ color: 'var(--accentDeep)', fontWeight: 600 }}>Back to dashboard</Link>
      </div>
    </div>
  ) : alreadyPaidLegacy ? (
    <div style={{ padding: '16px 18px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radius)', fontSize: 14, lineHeight: 1.55 }}>
      <strong>Already paid for {periodLabel}.</strong>
      <div style={{ marginTop: 6, color: 'var(--body-text)' }}>
        Our records show your Bala Vihar contribution for {periodLabel} is paid — thank you. There&apos;s nothing to pay here.
        {' '}<Link href="/family" style={{ color: 'var(--accentDeep)', fontWeight: 600 }}>Back to dashboard</Link>
      </div>
    </div>
  ) : isManager ? (
    <>
    <DonateForm
      mode={mode}
      eid={resolvedEid}
      suggestedAmount={suggestedAmount}
      periodLabel={periodLabel}
      tiers={tiers}
      // DORMANT: the Bala Vihar donation acknowledgements ship with placeholder
      // copy and are gated OFF until CMT provides the final disclaimer text. To
      // re-enable, set this to {programKey === BALA_VIHAR} (BALA_VIHAR is now
      // imported above for the monthly-option gate).
      requiresAcknowledgements={false}
    />
    {/* The SECOND way to pay the same Bala Vihar contribution (2026-07-27).
        Bala Vihar only, and only for an enrollment donation - a general gift has
        no yearly contribution to spread. */}
    {monthlyOption}
    </>
  ) : (
    <div style={{ padding: '14px 16px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radiusSm)', fontSize: 14, fontWeight: 600 }}>
      Only the family manager can make a donation through the portal.
    </div>
  );


  const why = (
    <div style={{ padding: 16, background: 'var(--accentSoft)', borderRadius: 'var(--radius)', marginBottom: 14 }}>
      <div className="row" style={{ gap: 10, marginBottom: 8 }}>
        <Rosette size={20} color="var(--accentDeep)" stroke={1.4} />
        <strong style={{ fontSize: 13, color: 'var(--accentDeep)' }}>Why we ask, plainly</strong>
      </div>
      <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55 }}>
        Chinmaya Mission Toronto is a registered Canadian charity (11885 3456 RR0001). Your donation pays for the hall, materials, snacks and insurance. <strong>It is not a fee.</strong> <em className="sa">Sevaks</em> teach without pay. Giving more keeps the programs healthy for next year&apos;s families.
      </p>
    </div>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href={backHref} className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back />
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{mode === 'enrollment' ? 'Donation' : 'Giving'}</span>
              <span style={{ width: 32 }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 84px' }}>
              <h1 style={{ fontSize: 26, fontWeight: 400, marginBottom: 6 }}>
                {heading}
              </h1>
              <p style={{ fontSize: 13, color: 'var(--body-text)', marginBottom: 18, lineHeight: 1.5 }}>{sub}</p>
              {form}
              <div style={{ marginTop: 16 }}>{why}</div>
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 28 }}>
          <Link href={backHref} className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <SetuIcon.back /> {mode === 'enrollment' ? 'Back to enrollment' : 'Back to dashboard'}
          </Link>
          <div>
            <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>{sub}</p>
            <h1 style={{ fontSize: 38, fontWeight: 400, marginTop: 6 }}>
              {heading}
            </h1>
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 22 }}>
          <div>{why}</div>
          <aside>
            <div className="card" style={{ padding: 24, position: 'sticky', top: 0 }}>{form}</div>
          </aside>
        </div>
      </div>
    </>
  );
}
