import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SetuAvatar, SetuIcon, Rosette } from '@cmt/ui';
import { CspRoot, SectionLabel } from '@/features/family/components/atoms';
import { EnrollCta } from '@/features/family/components/enroll-cta';
import { EnrollPanel } from '@/features/family/components/enroll-panel';
import { EligibleMembersList } from '@/features/family/components/eligible-members-list';
import { CompleteDonationButton } from '@/features/family/components/complete-donation-button';
import { resolveSuggestedAmount, paymentSourceOf, memberEligibleForProgram, BALA_VIHAR } from '@cmt/shared-domain';
import type { OfferingDoc, PaymentSource } from '@cmt/shared-domain';
import { getProgram } from '@/features/setu/programs/get-programs';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { getOpenOfferingsForFamily } from '@/features/setu/enrollment/get-open-offerings';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { getDonations } from '@/features/setu/donations/get-donations';

export const metadata = { title: 'Enroll' };

interface Props {
  params: Promise<{ programKey: string }>;
}

function fmtDate(d: Date | null) {
  if (!d) return '—';
  return d.toLocaleDateString('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto',
  });
}

function offeringPaymentSource(offering: Pick<OfferingDoc, 'paymentSource'> | null | undefined): PaymentSource {
  return paymentSourceOf(offering?.paymentSource !== undefined ? { paymentSource: offering.paymentSource } : {});
}

function canCollectOnline(usesDonation: boolean, donationsEnabled: boolean, paymentSource: PaymentSource) {
  return usesDonation && donationsEnabled && paymentSource !== 'teacher-managed';
}

function enrolledStateText(usesDonation: boolean, paymentSource: PaymentSource) {
  if (usesDonation && paymentSource === 'teacher-managed') {
    return 'Your family is enrolled — payment is managed by the teacher.';
  }
  return usesDonation ? 'Your family is enrolled — donation coming soon.' : 'Your family is enrolled.';
}

function renderAlreadyEnrolledBanner(
  termLabel: string,
  paid = false,
  usesDonation = false,
  paymentSource: PaymentSource = 'portal',
) {
  // "Proceed to donate below." only makes sense when the program actually takes
  // a donation; a free program (usesDonation=false) just confirms enrollment.
  const message = paid
    ? `Your family is enrolled in ${termLabel} and your contribution is paid. Thank you.`
    : usesDonation && paymentSource === 'teacher-managed'
      ? `Your family is already enrolled in ${termLabel}. Payment is managed by the teacher.`
    : usesDonation
      ? `Your family is already enrolled in ${termLabel}. Proceed to donate below.`
      : `Your family is already enrolled in ${termLabel}.`;
  return (
    <div style={{ padding: '14px 18px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', marginBottom: 20, fontSize: 14, fontWeight: 600 }}>
      {message}
    </div>
  );
}

function renderNoPeriodBanner(programLabel: string, location: string | null) {
  return (
    <div style={{ padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 20, fontSize: 14, color: 'var(--body-text)' }}>
      No open enrollment for <strong>{programLabel}</strong>{location ? ` at ${location}` : ''} right now — check back soon.
    </div>
  );
}

function renderPaidPanel(termLabel: string) {
  return (
    <div className="card" style={{ padding: 24, position: 'sticky', top: 0 }}>
      <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.16em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--muted)', marginBottom: 14 }}>
        Donation
      </h3>
      <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', padding: '6px 12px', fontSize: 12 }}>
        Paid · {termLabel}
      </span>
      <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, margin: '14px 0 0' }}>
        Your {termLabel} contribution is recorded as paid — thank you. No further action needed.
      </p>
    </div>
  );
}

function renderPaidBlockMobile(termLabel: string) {
  return (
    <div style={{ padding: 18, background: 'var(--accentSoft)', border: '1px solid var(--line2)', borderRadius: 'var(--radius)' }}>
      <span className="pill" style={{ background: 'var(--surface)', color: 'var(--accentDeep)', padding: '6px 12px', fontSize: 12 }}>
        Paid · {termLabel}
      </span>
      <p style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 12, lineHeight: 1.5 }}>
        Your {termLabel} contribution is recorded as paid — thank you. No further action needed.
      </p>
    </div>
  );
}

function renderDonationBlock(suggestedAmount: number, location: string | null, termLabel: string) {
  return (
    <div style={{ padding: 18, background: 'var(--accentSoft)', border: '1px solid var(--line2)', borderRadius: 'var(--radius)' }}>
      <div style={{ fontSize: 11, color: 'var(--accentDeep)', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>
        {location ? `${location} ` : ''}{termLabel} rate
      </div>
      <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: 'var(--display)', fontSize: 40 }}>${suggestedAmount}</span>
        <span style={{ fontSize: 13, color: 'var(--body-text)' }}>per family · suggested</span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 10, lineHeight: 1.5 }}>
        Suggested, not required. The program runs entirely on family donations. <strong>Any amount welcome</strong> — and giving more keeps it running.
      </p>
    </div>
  );
}

export default async function ProgramEnrollPage({ params }: Props) {
  await connection();

  const { programKey } = await params;

  // Load program + family in parallel.
  const [program, familyData] = await Promise.all([
    getProgram(programKey),
    getCurrentFamily(),
  ]);

  if (!program || program.status !== 'active') notFound();

  if (!familyData) {
    return (
      <CspRoot style={{ padding: 32 }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Session expired. Please sign in again.</p>
      </CspRoot>
    );
  }

  const { family, members, isManager } = familyData;
  const isBv = programKey === BALA_VIHAR;

  // Filter eligible members per program eligibility.
  const now = new Date();
  const eligibleMembers = members.filter((m) =>
    memberEligibleForProgram(m, program.eligibility, now),
  );

  // For BV (child-only): show the children list. For generic: show eligible members.
  const displayMembers = isBv
    ? members.filter((m) => m.type === 'Child')
    : eligibleMembers;

  const [enrollments, openOfferings, donations] = await Promise.all([
    getEnrollments(family.fid),
    getOpenOfferingsForFamily(programKey, family.location),
    getDonations(family.fid),
  ]);

  // Auto-select the first (or only) open offering. For BV this is always one.
  const defaultOffering = openOfferings[0] ?? null;

  // Find the active enrollment for THIS program that matches an open offering.
  // A stale enrollment from a prior term (oid not in openOfferings) must not
  // block the enroll/no-period states — identical to the old BV page guard.
  const openOidSet = new Set(openOfferings.map((o) => o.oid));
  const activeEnrollment =
    enrollments.find(
      (e) => e.status === 'active' && e.programKey === programKey && openOidSet.has(e.oid),
    ) ?? null;

  // For already-enrolled: find the matching open offering (so the CTA is correct).
  const enrolledOffering = activeEnrollment
    ? openOfferings.find((o) => o.oid === activeEnrollment.oid) ?? defaultOffering
    : defaultOffering;

  const alreadyEnrolled = activeEnrollment !== null;
  const donationsEnabled = process.env.NEXT_PUBLIC_FEATURE_SETU_DONATIONS === 'true';
  const usesDonation = program.capabilities.usesDonation;
  const selectedPaymentSource = offeringPaymentSource(enrolledOffering);
  const onlineDonationsEnabled = canCollectOnline(usesDonation, donationsEnabled, selectedPaymentSource);

  // Legacy payment gate — BALA VIHAR ONLY. getLegacyPaymentStatus reads the BV
  // roster's `payment` column (the 2025-26 cutover), which has no program
  // dimension. Applying it to another program (even one whose offering is mis-set
  // to paymentSource:'legacy') would show BV's payment status for a non-BV
  // donation, so gate the whole bridge on programKey.
  const isLegacyPeriod =
    programKey === 'bala-vihar' &&
    enrolledOffering != null &&
    selectedPaymentSource === 'legacy';
  const legacyPaid =
    isLegacyPeriod && (await getLegacyPaymentStatus(family.legacyFid)) === 'paid';

  const activeTerm = activeEnrollment?.termLabel ?? enrolledOffering?.termLabel ?? '';
  const displaySuggestedAmount =
    activeEnrollment?.effectiveSuggestedAmount ??
    (enrolledOffering ? resolveSuggestedAmount(enrolledOffering, now) : undefined);

  // "Paid" = legacy-roster paid OR completed Setu donation(s) for THIS enrollment
  // covering the suggested amount. Once paid, the page shows a thank-you panel and
  // no donate CTA — giving more lives in the Giving tab.
  const givenForPeriod = activeEnrollment
    ? donations
        .filter((d) => d.status === 'completed' && d.eid === activeEnrollment.eid)
        .reduce((sum, d) => sum + d.amountCAD, 0)
    : 0;
  const donationComplete =
    displaySuggestedAmount != null && displaySuggestedAmount > 0 && givenForPeriod >= displaySuggestedAmount;
  const paid = legacyPaid || donationComplete;

  // The OID to use for the EnrollCta — prefer the enrolled offering when already enrolled.
  const ctaOid = enrolledOffering?.oid ?? defaultOffering?.oid ?? '';

  // When MULTIPLE offerings are open and the manager can still enroll, the term
  // picker and submit must share client state — render them together via
  // EnrollPanel. Single-offering (BV) keeps the bare CTA path unchanged.
  const showInlinePanel =
    !alreadyEnrolled && isManager && Boolean(ctaOid) && openOfferings.length > 1;

  return (
    <>
      {/* ── Mobile ───────────────────────────────────────────────── */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: 'calc(100dvh - 64px)', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/family" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back />
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Enroll</span>
              <span style={{ width: 32 }} />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 100px' }}>
              {alreadyEnrolled && renderAlreadyEnrolledBanner(activeTerm, paid, usesDonation, selectedPaymentSource)}
              {!enrolledOffering && !alreadyEnrolled && renderNoPeriodBanner(program.label, family.location)}

              {enrolledOffering && (
                <>
                  {/* Program hero banner */}
                  <div style={{ padding: '18px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius)', marginBottom: 16, position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', right: -20, top: -20, opacity: .2 }}>
                      <Rosette size={120} color="#fff" stroke={.8} />
                    </div>
                    <div style={{ position: 'relative' }}>
                      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', opacity: .85, marginBottom: 6 }}>Enroll in</div>
                      <h1 style={{ fontSize: 26, fontWeight: 500, color: '#fff', fontFamily: 'var(--display)' }}>
                        {isBv ? <em className="sa">Bala Vihar</em> : program.label} · {enrolledOffering.termLabel}
                      </h1>
                      <p style={{ fontSize: 13, opacity: .9, marginTop: 8 }}>
                        {fmtDate(enrolledOffering.startDate)} – {fmtDate(enrolledOffering.endDate)}{family.location ? ` · ${family.location}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Eligible members */}
                  {displayMembers.length > 0 && (
                    <>
                      <SectionLabel>Who&apos;s enrolling</SectionLabel>
                      <EligibleMembersList
                        members={displayMembers}
                        eligibility={program.eligibility}
                        now={now}
                      />
                    </>
                  )}

                  {/* Donation — only when program uses donation */}
                  {usesDonation && (
                    <>
                      <SectionLabel>Donation{paid ? '' : ' · suggested donation'}</SectionLabel>
                      {paid
                        ? renderPaidBlockMobile(activeTerm)
                        : renderDonationBlock(displaySuggestedAmount ?? 0, family.location, activeTerm)}
                    </>
                  )}

                  {/* Multi-offering: term picker + submit live together (selection drives the oid).
                      Single-offering keeps the bare CTA in the sticky footer below (BV unchanged). */}
                  {showInlinePanel && (
                    <>
                      <SectionLabel>Select term</SectionLabel>
                      <EnrollPanel
                        offerings={openOfferings}
                        defaultOid={ctaOid}
                        donationsEnabled={usesDonation && donationsEnabled}
                        usesDonation={usesDonation}
                      />
                    </>
                  )}
                </>
              )}
            </div>

            {/* Sticky CTA footer */}
            <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: '14px 18px', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
              {alreadyEnrolled ? (
                paid ? (
                  <Link href="/family" className="btn btn--p btn--block" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                    Back to dashboard
                  </Link>
                ) : onlineDonationsEnabled ? (
                  <CompleteDonationButton eid={activeEnrollment.eid} amountCAD={activeEnrollment.effectiveSuggestedAmount} label="Continue to donation →" block />
                ) : (
                  <div style={{ padding: '12px 16px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radiusSm)', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>
                    {enrolledStateText(usesDonation, selectedPaymentSource)}
                  </div>
                )
              ) : showInlinePanel ? (
                <Link href="/family" className="btn btn--s btn--block" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                  Cancel
                </Link>
              ) : ctaOid && isManager ? (
                <EnrollCta oid={ctaOid} donationsEnabled={onlineDonationsEnabled} usesDonation={usesDonation} paymentSource={selectedPaymentSource} />
              ) : ctaOid ? (
                <button className="btn btn--p btn--block" disabled style={{ cursor: 'not-allowed', opacity: 0.5 }}>
                  Only the family manager can enroll
                </button>
              ) : (
                <button className="btn btn--p btn--block" disabled style={{ cursor: 'not-allowed', opacity: 0.5 }}>
                  No active enrollment period
                </button>
              )}
            </div>
          </div>
        </CspRoot>
      </div>

      {/* ── Desktop ──────────────────────────────────────────────── */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 26 }}>
          <Link href="/family" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <SetuIcon.back /> Back to dashboard
          </Link>
          <div className="between">
            <div>
              <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Program enrollment</p>
              <h1 style={{ fontSize: 40, fontWeight: 400, marginTop: 6 }}>
                {isBv ? <em style={{ fontStyle: 'italic' }}>Bala Vihar</em> : program.label}
                {enrolledOffering ? ` · ${enrolledOffering.termLabel}` : ''}
              </h1>
            </div>
            {family.location && (
              <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', padding: '6px 12px', fontSize: 12 }}>
                {family.location}
              </span>
            )}
          </div>
        </header>

        {alreadyEnrolled && renderAlreadyEnrolledBanner(activeTerm, paid, usesDonation, selectedPaymentSource)}
        {!enrolledOffering && !alreadyEnrolled && renderNoPeriodBanner(program.label, family.location)}

        {enrolledOffering && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 22 }}>
            {/* Left: members + what's included */}
            <div>
              {displayMembers.length > 0 && (
                <div className="card" style={{ padding: 24, marginBottom: 14 }}>
                  <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--body-text)', marginBottom: 16 }}>
                    {isBv ? 'Children enrolling' : 'Members enrolling'}
                  </h3>
                  <div className="col" style={{ gap: 10 }}>
                    {displayMembers.map((m) => (
                      <div key={m.mid} style={{ padding: 14, background: 'var(--bg)', borderRadius: 'var(--radiusSm)', display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
                          <SetuIcon.check color="#fff" />
                        </div>
                        <SetuAvatar name={`${m.firstName} ${m.lastName}`} size={44} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 600 }}>{m.firstName} {m.lastName}</div>
                          {m.schoolGrade && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.schoolGrade}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="card" style={{ padding: 24 }}>
                <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--body-text)', marginBottom: 16 }}>What&apos;s included</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                  {([
                    [isBv ? 'Sunday classes' : 'Program sessions',
                      `${fmtDate(enrolledOffering.startDate)}${enrolledOffering.endDate ? ` – ${fmtDate(enrolledOffering.endDate)}` : ' · ongoing'}`],
                  ] as [string, string][]).map(([t, sub], i) => (
                    <div key={i} className="row" style={{ gap: 12, padding: '10px 12px', background: 'var(--bg)', borderRadius: 'var(--radiusSm)' }}>
                      <div style={{ flex: '0 0 auto', width: 28, height: 28, borderRadius: '50%', background: 'var(--accentSoft)', color: 'var(--accentDeep)', display: 'grid', placeItems: 'center' }}>
                        <SetuIcon.check />
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{t}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: offering picker + donation/confirm panel */}
            <aside>
              {paid ? renderPaidPanel(activeTerm) : (
                <div className="card" style={{ padding: 24, position: 'sticky', top: 0 }}>
                  {/* Donation block — only for programs with usesDonation */}
                  {usesDonation ? (
                    <>
                      <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.16em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--muted)', marginBottom: 14 }}>
                        Donation · suggested donation
                      </h3>
                      <div style={{ padding: 18, background: 'var(--accentSoft)', borderRadius: 'var(--radiusSm)', marginBottom: 18 }}>
                        <div className="row" style={{ alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
                          <span style={{ fontFamily: 'var(--display)', fontSize: 46, lineHeight: 1 }}>${displaySuggestedAmount ?? 0}</span>
                          <span style={{ fontSize: 13, color: 'var(--body-text)' }}>· per family</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {family.location ? `${family.location} ` : ''}{activeTerm} rate · locked when you first attend
                        </div>
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, marginBottom: 18 }}>
                        This is a suggested donation, not a fee. The program runs entirely on family donations. <em className="sa">Sevaks</em> teach without pay. Any amount is welcome.
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.16em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--muted)', marginBottom: 14 }}>
                        Enrollment
                      </h3>
                      <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, marginBottom: 18 }}>
                        This program has no donation requirement. Confirm enrollment below.
                      </p>
                    </>
                  )}

                  {alreadyEnrolled ? (
                    onlineDonationsEnabled ? (
                      <CompleteDonationButton eid={activeEnrollment.eid} amountCAD={activeEnrollment.effectiveSuggestedAmount} label="Continue to donation →" block />
                    ) : (
                      <div style={{ padding: '12px 16px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radiusSm)', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>
                        {enrolledStateText(usesDonation, selectedPaymentSource)}
                      </div>
                    )
                  ) : showInlinePanel ? (
                    <EnrollPanel
                      offerings={openOfferings}
                      defaultOid={ctaOid}
                      donationsEnabled={usesDonation && donationsEnabled}
                      usesDonation={usesDonation}
                      pickerLabel={
                        <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.16em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--muted)', marginBottom: 10 }}>
                          Select term
                        </h3>
                      }
                    />
                  ) : isManager ? (
                    <EnrollCta oid={ctaOid} donationsEnabled={onlineDonationsEnabled} usesDonation={usesDonation} paymentSource={selectedPaymentSource} />
                  ) : (
                    <button className="btn btn--p btn--block" disabled style={{ cursor: 'not-allowed', opacity: 0.5 }}>
                      Only the family manager can enroll
                    </button>
                  )}

                  {usesDonation && (
                    <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, textAlign: 'center' }}>
                      Donations are tax-deductible · Chinmaya Mission Toronto
                    </p>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </>
  );
}
