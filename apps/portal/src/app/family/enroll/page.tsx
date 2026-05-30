import { connection } from 'next/server';
import Link from 'next/link';
import { SetuAvatar, SetuIcon, Rosette } from '@cmt/ui';
import { CspRoot, SectionLabel } from '@/features/family/components/atoms';
import { EnrollCta } from '@/features/family/components/enroll-cta';
import { resolveSuggestedAmount, paymentSourceOf } from '@cmt/shared-domain';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { resolveActivePeriod } from '@/features/setu/enrollment/resolve-active-period';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';

export const metadata = { title: 'Enroll — CMT Portal' };

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto',
  });
}

export default async function EnrollPage() {
  await connection();

  const familyData = await getCurrentFamily();
  if (!familyData) {
    return (
      <CspRoot style={{ padding: 32 }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Session expired. Please sign in again.</p>
      </CspRoot>
    );
  }

  const { family, members, isManager } = familyData;
  const children = members.filter((m) => m.type === 'Child');

  const [enrollments, activePeriod] = await Promise.all([
    getEnrollments(family.fid),
    resolveActivePeriod({ programKey: 'bala-vihar', location: family.location }),
  ]);

  // Only consider an enrollment "current" if it matches the active period.
  // A stale enrollment from a prior semester must not block the enroll/no-period states.
  const activeEnrollment =
    enrollments.find((e) => e.status === 'active' && e.pid === activePeriod?.pid) ?? null;

  const alreadyEnrolled = activeEnrollment !== null;
  const donationsEnabled = process.env.NEXT_PUBLIC_FEATURE_SETU_DONATIONS === 'true';
  // Legacy cutover year: if this period's payment is tracked off-portal
  // (paymentSource='legacy') and the roster shows the family has paid, we don't
  // ask for a donation here — show "Paid". Giving more is always possible from
  // the Giving tab.
  const isLegacyPeriod = activePeriod ? paymentSourceOf(activePeriod) === 'legacy' : false;
  const legacyPaid = isLegacyPeriod && (await getLegacyPaymentStatus(family.legacyFid)) === 'paid';
  // Pin amount to enrollment snapshot/override; before enrolling, show the tier
  // a family enrolling today would get (prorated by date).
  const displaySuggestedAmount =
    activeEnrollment?.effectiveSuggestedAmount ??
    (activePeriod ? resolveSuggestedAmount(activePeriod, new Date()) : undefined);

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="between" style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
              <Link href="/family" className="focus-ring" style={{ background: 'transparent', border: 0, padding: 6, marginLeft: -6, color: 'var(--body-text)', display: 'inline-flex' }}>
                <SetuIcon.back/>
              </Link>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Enroll</span>
              <span style={{ width: 32 }}/>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 100px' }}>
              {alreadyEnrolled && renderAlreadyEnrolledBanner(activeEnrollment.periodLabel, legacyPaid)}
              {!activePeriod && !alreadyEnrolled && renderNoPeriodBanner(family.location)}

              {activePeriod && (
                <>
                  <div style={{ padding: '18px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius)', marginBottom: 16, position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', right: -20, top: -20, opacity: .2 }}>
                      <Rosette size={120} color="#fff" stroke={.8}/>
                    </div>
                    <div style={{ position: 'relative' }}>
                      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', opacity: .85, marginBottom: 6 }}>Enroll in</div>
                      <h1 style={{ fontSize: 26, fontWeight: 500, color: '#fff', fontFamily: 'var(--display)' }}>
                        <em className="sa">Bala Vihar</em> · {activePeriod.periodLabel}
                      </h1>
                      <p style={{ fontSize: 13, opacity: .9, marginTop: 8 }}>
                        {fmtDate(activePeriod.startDate)} – {fmtDate(activePeriod.endDate)} · {family.location}
                      </p>
                    </div>
                  </div>

                  {children.length > 0 && (
                    <>
                      <SectionLabel>Who&apos;s enrolling</SectionLabel>
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                        {children.map((m, i) => (
                          <div key={m.mid} style={{ padding: 14, borderTop: i > 0 ? '1px solid var(--line)' : undefined, display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 24, height: 24, borderRadius: 6, border: '2px solid var(--accent)', background: 'var(--accent)', display: 'grid', placeItems: 'center', color: '#fff' }}>
                              <SetuIcon.check color="#fff"/>
                            </div>
                            <SetuAvatar name={`${m.firstName} ${m.lastName}`} size={36}/>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: 14 }}>{m.firstName} {m.lastName}</div>
                              {m.schoolGrade && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.schoolGrade}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <SectionLabel><em className="sa">Dakshina</em>{legacyPaid ? '' : ' · suggested donation'}</SectionLabel>
                  {legacyPaid
                    ? renderPaidBlockMobile(activePeriod.periodLabel)
                    : renderDakshinaBlock(displaySuggestedAmount ?? 0, family.location, activePeriod.periodLabel)}
                </>
              )}
            </div>
            <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: '14px 18px', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
              {alreadyEnrolled ? (
                legacyPaid ? (
                  <Link href="/family" className="btn btn--p btn--block" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                    Back to dashboard
                  </Link>
                ) : donationsEnabled ? (
                  <Link href={`/family/donate?eid=${activeEnrollment.eid}`} className="btn btn--p btn--block" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                    Continue to donation →
                  </Link>
                ) : (
                  <div style={{ padding: '12px 16px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radiusSm)', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>
                    Your family is enrolled — donation coming soon.
                  </div>
                )
              ) : activePeriod && isManager ? (
                <EnrollCta pid={activePeriod.pid} donationsEnabled={donationsEnabled}/>
              ) : activePeriod ? (
                <button className="btn btn--p btn--block" disabled style={{ cursor: 'not-allowed', opacity: 0.5 }}>
                  Only the family manager can enroll
                </button>
              ) : (
                <button className="btn btn--p btn--block" disabled style={{ cursor: 'not-allowed', opacity: 0.5 }}>
                  No active period
                </button>
              )}
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header style={{ marginBottom: 26 }}>
          <Link href="/family" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--body-text)', fontSize: 13, padding: 0, marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <SetuIcon.back/> Back to dashboard
          </Link>
          <div className="between">
            <div>
              <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Program enrollment</p>
              <h1 style={{ fontSize: 40, fontWeight: 400, marginTop: 6 }}>
                <em style={{ fontStyle: 'italic' }}>Bala Vihar</em>{activePeriod ? ` · ${activePeriod.periodLabel}` : ''}
              </h1>
            </div>
            <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', padding: '6px 12px', fontSize: 12 }}>
              {family.location}
            </span>
          </div>
        </header>

        {alreadyEnrolled && renderAlreadyEnrolledBanner(activeEnrollment.periodLabel, legacyPaid)}
        {!activePeriod && !alreadyEnrolled && renderNoPeriodBanner(family.location)}

        {activePeriod && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 22 }}>
            <div>
              {children.length > 0 && (
                <div className="card" style={{ padding: 24, marginBottom: 14 }}>
                  <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--body-text)', marginBottom: 16 }}>Children enrolling</h3>
                  <div className="col" style={{ gap: 10 }}>
                    {children.map((m) => (
                      <div key={m.mid} style={{ padding: 14, background: 'var(--bg)', borderRadius: 'var(--radiusSm)', display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
                          <SetuIcon.check color="#fff"/>
                        </div>
                        <SetuAvatar name={`${m.firstName} ${m.lastName}`} size={44}/>
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
                    ['Sunday classes', `${fmtDate(activePeriod.startDate)} – ${fmtDate(activePeriod.endDate)}`],
                    ['Year-end performance', 'Last week of the program'],
                  ] as [string, string][]).map(([t, sub], i) => (
                    <div key={i} className="row" style={{ gap: 12, padding: '10px 12px', background: 'var(--bg)', borderRadius: 'var(--radiusSm)' }}>
                      <div style={{ flex: '0 0 auto', width: 28, height: 28, borderRadius: '50%', background: 'var(--accentSoft)', color: 'var(--accentDeep)', display: 'grid', placeItems: 'center' }}>
                        <SetuIcon.check/>
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

            <aside>
              {legacyPaid ? renderPaidPanel(activePeriod.periodLabel) : (
              <div className="card" style={{ padding: 24, position: 'sticky', top: 0 }}>
                <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.16em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--muted)', marginBottom: 14 }}>
                  <em className="sa">Dakshina</em> · suggested donation
                </h3>
                <div style={{ padding: 18, background: 'var(--accentSoft)', borderRadius: 'var(--radiusSm)', marginBottom: 18 }}>
                  <div className="row" style={{ alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--display)', fontSize: 46, lineHeight: 1 }}>${displaySuggestedAmount ?? 0}</span>
                    <span style={{ fontSize: 13, color: 'var(--body-text)' }}>· per family</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {family.location} {activePeriod.periodLabel} rate · locked when you first attend
                  </div>
                </div>
                <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, marginBottom: 18 }}>
                  This is a suggested donation, not a fee. The program runs entirely on family donations. <em className="sa">Sevaks</em> teach without pay. Any amount is welcome; giving more keeps the lights on.
                </p>
                {alreadyEnrolled ? (
                  donationsEnabled ? (
                    <Link href={`/family/donate?eid=${activeEnrollment.eid}`} className="btn btn--p btn--block" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                      Continue to donation →
                    </Link>
                  ) : (
                    <div style={{ padding: '12px 16px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', borderRadius: 'var(--radiusSm)', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>
                      Your family is enrolled — donation coming soon.
                    </div>
                  )
                ) : isManager ? (
                  <EnrollCta pid={activePeriod.pid} donationsEnabled={donationsEnabled}/>
                ) : (
                  <button className="btn btn--p btn--block" disabled style={{ cursor: 'not-allowed', opacity: 0.5 }}>
                    Only the family manager can enroll
                  </button>
                )}
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, textAlign: 'center' }}>
                  Donations are tax-deductible · Chinmaya Mission Toronto
                </p>
              </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </>
  );
}

function renderAlreadyEnrolledBanner(periodLabel: string, paid = false) {
  return (
    <div style={{ padding: '14px 18px', background: 'var(--accentSoft)', color: 'var(--accentDeep)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', marginBottom: 20, fontSize: 14, fontWeight: 600 }}>
      {paid
        ? `Your family is enrolled in ${periodLabel} and your contribution is paid. Thank you.`
        : `Your family is already enrolled in ${periodLabel}. Proceed to donate below.`}
    </div>
  );
}

function renderPaidPanel(periodLabel: string) {
  return (
    <div className="card" style={{ padding: 24, position: 'sticky', top: 0 }}>
      <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.16em', fontWeight: 700, fontFamily: 'var(--body)', color: 'var(--muted)', marginBottom: 14 }}>
        <em className="sa">Dakshina</em>
      </h3>
      <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', padding: '6px 12px', fontSize: 12 }}>
        Paid · {periodLabel}
      </span>
      <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.55, margin: '14px 0 0' }}>
        Your {periodLabel} Bala Vihar contribution is recorded as paid — thank you. No further action needed.
      </p>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
        Want to give more? You can donate any amount any time from{' '}
        <Link href="/family/donate" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>Giving</Link>.
      </p>
    </div>
  );
}

function renderPaidBlockMobile(periodLabel: string) {
  return (
    <div style={{ padding: 18, background: 'var(--accentSoft)', border: '1px solid var(--line2)', borderRadius: 'var(--radius)' }}>
      <span className="pill" style={{ background: 'var(--surface)', color: 'var(--accentDeep)', padding: '6px 12px', fontSize: 12 }}>
        Paid · {periodLabel}
      </span>
      <p style={{ fontSize: 13, color: 'var(--body-text)', marginTop: 12, lineHeight: 1.5 }}>
        Your {periodLabel} contribution is recorded as paid — thank you. Want to give more? Use the <strong>Giving</strong> tab any time.
      </p>
    </div>
  );
}

function renderNoPeriodBanner(location: string) {
  return (
    <div style={{ padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 20, fontSize: 14, color: 'var(--body-text)' }}>
      No active Bala Vihar enrollment period for <strong>{location}</strong> right now — check back next semester.
    </div>
  );
}

function renderDakshinaBlock(suggestedAmount: number, location: string, periodLabel: string) {
  return (
    <div style={{ padding: 18, background: 'var(--accentSoft)', border: '1px solid var(--line2)', borderRadius: 'var(--radius)' }}>
      <div style={{ fontSize: 11, color: 'var(--accentDeep)', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>
        {location} {periodLabel} rate
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
