import { Suspense } from 'react';
import { connection } from 'next/server';
import Link from 'next/link';
import { SetuLogo, SetuAvatar, SetuIcon } from '@cmt/ui';
import { CspRoot, Stat, MetricCard, SkeletonCard } from '@/features/family/components/atoms';
import { flags } from '@/lib/flags';
import { mockFamily } from '@/features/family/data/mock';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { ContactsNudge } from '@/features/family/components/contacts-nudge';
import { shouldShowContactsNudge } from './_helpers/should-show-contacts-nudge';
import { getEnrollments } from '@/features/setu/enrollment/get-enrollments';
import { getDonations } from '@/features/setu/donations/get-donations';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { getUpcoming, getClassDatesHeld, type CalendarEntry } from '@/features/setu/calendar/calendar';
import { getCheckInAttendance } from '@/features/setu/attendance/check-in-attendance';
import { listPrograms } from '@/features/setu/programs/get-programs';
import {
  buildFamilyDashboardModel,
  isLegacyBvPeriod,
  type FamilyDashboardModel,
} from './_helpers/dashboard-model';
import type { ProgramDoc } from '@cmt/shared-domain';

function fmtSunday(ymd: string): string {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Toronto',
  });
}

function fmtUpcoming(e: CalendarEntry): { d: string; m: string; t: string; sub: string | null } {
  const date = new Date(`${e.date}T12:00:00`);
  const d = date.toLocaleDateString('en-CA', { day: 'numeric', timeZone: 'America/Toronto' });
  const m = date.toLocaleDateString('en-CA', { month: 'short', timeZone: 'America/Toronto' });
  const t =
    e.kind === 'no-class'
      ? `No class${e.noClassReason ? ` · ${e.noClassReason}` : ''}`
      : e.classType === 'first'
        ? 'First class'
        : e.classType === 'short'
          ? 'Short class'
          : 'Class';
  return { d, m, t, sub: e.specialEvents };
}

export default async function FamilyDashboardPage() {
  // Mark this page as dynamic — flags.setuAuth may be false in which case no
  // awaited request-data access happens before the request-time new Date()
  // below. connection() makes the rest of this component request-time only.
  await connection();
  let managerName = 'Family member';
  let familyName = mockFamily.name;
  let memberCount = mockFamily.members.length;
  let displayMembers: { name: string }[] = mockFamily.members.map((m) => ({ name: m.name }));
  let currentMid: string | null = null;
  // Upcoming class dates from the managed calendar (Slice 4b), by family location.
  let upcomingEntries: CalendarEntry[] = [];
  // One-time "add your other contacts" nudge — shown until the current member dismisses it (B3).
  let showContactsNudge = false;

  // All BV-bespoke derivation (which enrollment drives the card, donation status,
  // attendance scoping) lives in buildFamilyDashboardModel so it can be unit-
  // tested with multi-enrollment fixtures (see __tests__/dashboard-model.test.ts).
  // The default empty model renders the not-enrolled state for the mock /
  // non-setuAuth path; the real model is built below once data is loaded.
  let model: FamilyDashboardModel = buildFamilyDashboardModel({
    enrollments: [],
    donations: [],
    programsById: new Map(),
    rawCheckIns: [],
    classSundaysHeld: 0,
    legacyPaymentStatus: null,
  });

  if (flags.setuAuth) {
    const data = await getCurrentFamily();
    if (data) {
      const currentMember = data.members.find((m) => m.mid === data.currentMid);
      if (currentMember) {
        managerName = `${currentMember.firstName} ${currentMember.lastName}`;
        showContactsNudge = shouldShowContactsNudge(currentMember);
      }
      currentMid = data.currentMid;
      familyName = data.family.name;
      memberCount = data.members.length;
      displayMembers = data.members.map((m) => ({ name: `${m.firstName} ${m.lastName}` }));

      const [enrollments, donations, allPrograms] = await Promise.all([
        getEnrollments(data.family.fid),
        getDonations(data.family.fid),
        listPrograms(),
      ]);
      const programsById = new Map<string, ProgramDoc>(allPrograms.map((p) => [p.programKey, p]));

      // Legacy roster status is only relevant when the active BV offering is the
      // 2025-26 cutover year; fetch it conditionally so other families skip the
      // extra RTDB read. isLegacyBvPeriod uses the same predicate the model does.
      const legacyPaymentStatus = isLegacyBvPeriod(enrollments)
        ? await getLegacyPaymentStatus(data.family.legacyFid)
        : null;

      // The dashboard's calendar + attendance are the Bala Vihar program's, so
      // scope the readers to 'bala-vihar' (a second usesCalendar program must not
      // leak dates in or inflate the attendance denominator).
      const [{ upcoming }, rawCheckIns, classSundays] = await Promise.all([
        getUpcoming(data.family.location, 'bala-vihar', undefined, 3),
        getCheckInAttendance(data.family.legacyFid),
        getClassDatesHeld(data.family.location, 'bala-vihar'),
      ]);
      upcomingEntries = upcoming;

      model = buildFamilyDashboardModel({
        enrollments,
        donations,
        programsById,
        rawCheckIns,
        classSundaysHeld: classSundays.length,
        legacyPaymentStatus,
      });
    }
  }

  const {
    isEnrolled,
    kidsEnrolled,
    enrollPeriodLabel,
    suggestedAmount,
    givenForPeriod,
    donateUrl,
    isLegacyPeriod,
    legacyPaid,
    otherProgramCards,
    enrolledPill,
  } = model;
  const { summary: ci, hasAttendance, total: attendanceTotal, pct: attendancePct } = model.attendance;
  const {
    complete: donationComplete,
    pct: donationPct,
    tone: donationTone,
    showGive,
    showProgress,
    heading: donationHeading,
  } = model.donation;

  // Handle the lazy-migrated placeholder manager whose firstName is still
  // empty: show a neutral greeting and surface a Complete-your-profile CTA
  // (rendered below) so the user knows what to do next.
  const trimmedFirst = (managerName.split(' ')[0] ?? '').trim();
  const firstName = trimmedFirst || null;
  const needsProfile = !trimmedFirst;
  // Date rendered in America/Toronto so the dashboard greeting matches what
  // a sevak in the lobby sees on their clock (per CLAUDE.md B2 note 4).
  const todayLabel = new Date().toLocaleDateString('en-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Toronto',
  });
  void familyName;

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '14px 18px 90px', overflowY: 'auto', minHeight: '100dvh' }}>
            <div className="between" style={{ marginBottom: 22 }}>
              <SetuLogo size={18}/>
              <SetuAvatar name={managerName} size={32}/>
            </div>

            <div style={{ marginBottom: 22 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.02em' }}>{todayLabel}</p>
              <h1 style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>
                {firstName ? `Hari OM, ${firstName}.` : 'Hari OM!'}
              </h1>
            </div>
            {showContactsNudge && <ContactsNudge />}
            {needsProfile && currentMid && (
              <Link href={`/family/members/${currentMid}/edit`} style={{ display: 'block', padding: '14px 16px', background: 'var(--accentSoft)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', textDecoration: 'none', color: 'var(--accentDeep)', marginBottom: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Complete your profile →</div>
                <div style={{ fontSize: 12, marginTop: 2 }}>We don&apos;t have your name on file yet. Add it so sevaks know who to greet on Sunday.</div>
              </Link>
            )}

            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}><em className="sa">Bala Vihar</em>{enrollPeriodLabel ? ` · ${enrollPeriodLabel}` : ''}</span>
                <span className="pill" style={{ background: enrolledPill.bg, color: enrolledPill.fg }}>{enrolledPill.text}</span>
              </div>
              <div className="row" style={{ gap: 14, marginBottom: 14 }}>
                <Stat label="Kids enrolled" value={String(kidsEnrolled)}/>
                <div style={{ width: 1, height: 36, background: 'var(--line)' }}/>
                <Stat label="Attendance" value={hasAttendance ? String(ci.attended) : '—'}/>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {hasAttendance
                  ? `Attended ${ci.attended} of ${attendanceTotal} Sunday classes.`
                  : 'Attendance appears here once Sunday classes begin.'}
              </div>
              {!isEnrolled && (
                <Link href="/family/enroll" className="btn btn--s btn--block" style={{ marginTop: 12, display: 'block', textAlign: 'center', textDecoration: 'none' }}>Enroll now</Link>
              )}
            </div>

            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{donationHeading}</div>
                  <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2, letterSpacing: '-0.01em' }}>
                    {legacyPaid ? 'Completed' : isEnrolled ? `$${givenForPeriod}.00` : 'Give'}
                  </div>
                </div>
                {showGive && <Link href={donateUrl} className="btn btn--p">{donationComplete ? 'Give more' : 'Give'}</Link>}
              </div>
              {legacyPaid && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  Completed for {enrollPeriodLabel} — thank you. Recorded from our records.
                </div>
              )}
              {showProgress && (
                <>
                  <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ width: `${donationPct}%`, height: '100%', background: 'var(--accent)' }}/>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                    {isLegacyPeriod
                      ? `Payment pending for ${enrollPeriodLabel} · $${suggestedAmount} suggested`
                      : `$${givenForPeriod} of $${suggestedAmount}${enrollPeriodLabel ? ` · ${enrollPeriodLabel}` : ''} · suggested`}
                  </div>
                </>
              )}
              {!isEnrolled && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>A charitable gift to Chinmaya Mission Toronto — any amount welcome.</div>
              )}
            </div>

            {/* Generic cards for non-BV active enrollments (Phase F) */}
            {otherProgramCards.map((card) => (
              <div key={card.eid} className="card" style={{ padding: 16, marginBottom: 12 }}>
                <div className="between" style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{card.label}{card.termLabel ? ` · ${card.termLabel}` : ''}</span>
                  <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>Enrolled</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                  {card.showDonation
                    ? 'See dashboard for donation details.'
                    : 'No donation required for this program.'}
                </div>
                <Link href={`/family/enroll/${card.programKey}`} className="btn btn--s" style={{ fontSize: 12, textDecoration: 'none', display: 'inline-block' }}>
                  View enrollment →
                </Link>
              </div>
            ))}

            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Upcoming</span>
                <Link href="/family/calendar" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>View all</Link>
              </div>
              {upcomingEntries.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>No upcoming class dates published yet.</div>
              ) : (
                <div className="col" style={{ gap: 10 }}>
                  {upcomingEntries.map((entry) => {
                    const e = fmtUpcoming(entry);
                    const noClass = entry.kind === 'no-class';
                    return (
                      <div key={entry.entryId} className="row" style={{ gap: 12 }}>
                        <div style={{ width: 42, padding: '6px 0', textAlign: 'center', background: noClass ? 'var(--surface2)' : 'var(--accentSoft)', borderRadius: 'var(--radiusSm)' }}>
                          <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{e.m}</div>
                          <div style={{ fontSize: 16, fontWeight: 600, marginTop: -2, color: noClass ? 'var(--muted)' : 'var(--accentDeep)' }}>{e.d}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{e.t}</div>
                          {e.sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.sub}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 16 }}>
              <div className="between" style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>My family · {memberCount}</span>
                <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Manage</Link>
              </div>
              <div className="row" style={{ gap: -6, flexWrap: 'wrap' }}>
                {displayMembers.map((m, i) => (
                  <div key={i} style={{ marginLeft: i > 0 ? -8 : 0 }}>
                    <div style={{ border: '2px solid var(--surface)', borderRadius: '50%' }}>
                      <SetuAvatar name={m.name} size={36}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CspRoot>
      </div>

      {/* Desktop — layout.tsx owns sidebar + main wrapper */}
      <div className="hidden md:block">
        <header className="between" style={{ marginBottom: 28 }}>
          <div>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>{todayLabel}</p>
            <h1 style={{ fontSize: 32, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>{firstName ? `Hari OM, ${firstName}.` : 'Hari OM!'}</h1>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <Link href="/family/programs" className="btn btn--s" style={{ textDecoration: 'none' }}>Programs</Link>
            {showGive && <Link href={donateUrl} className="btn btn--p">Give donation</Link>}
          </div>
        </header>

        {showContactsNudge && <ContactsNudge />}
        {needsProfile && currentMid && (
          <Link href={`/family/members/${currentMid}/edit`} style={{ display: 'block', padding: '16px 20px', background: 'var(--accentSoft)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', textDecoration: 'none', color: 'var(--accentDeep)', marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Complete your profile →</div>
            <div style={{ fontSize: 13, marginTop: 2 }}>We don&apos;t have your name on file yet. Add it so sevaks know who to greet on Sunday.</div>
          </Link>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
          <MetricCard
            label="Donation"
            value={legacyPaid ? 'Completed' : isEnrolled ? `$${givenForPeriod}` : '—'}
            sub={
              !isEnrolled
                ? 'not enrolled'
                : legacyPaid
                  ? `${enrollPeriodLabel ?? ''} · completed`
                  : isLegacyPeriod
                    ? `${enrollPeriodLabel ?? ''} · payment pending`
                    : donationComplete
                      ? `received · ${enrollPeriodLabel ?? ''}`
                      : `of $${suggestedAmount} · ${enrollPeriodLabel ?? 'suggested'}`
            }
            {...(donationTone ? { tone: donationTone } : {})}
          />
          <MetricCard label="Bala Vihar" value={isEnrolled ? 'Enrolled' : 'Not yet'} sub={enrollPeriodLabel ?? 'no active period'}/>
          <MetricCard
            label="Attendance"
            value={hasAttendance ? String(ci.attended) : '—'}
            sub={hasAttendance ? `of ${attendanceTotal} Sundays` : 'no classes yet'}
            {...(hasAttendance ? { tone: attendancePct >= 75 ? ('ok' as const) : ('warn' as const) } : {})}
          />
          <MetricCard label="Family"     value={String(memberCount)} sub={`${memberCount} member${memberCount !== 1 ? 's' : ''}`}/>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18 }}>
          <Suspense fallback={<SkeletonCard />}>
            <div className="card" style={{ padding: 24 }}>
              <div className="between" style={{ marginBottom: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600 }}><em className="sa">Bala Vihar</em>{enrollPeriodLabel ? ` · ${enrollPeriodLabel}` : ''}</h3>
                {isEnrolled && <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>Enrolled</span>}
              </div>
              {hasAttendance ? (
                <>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Sundays attended</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {ci.marks.map((m) => (
                      <span
                        key={m.date}
                        title={m.present ? 'Present' : 'Absent'}
                        style={{
                          fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8,
                          background: m.present ? 'var(--accentSoft)' : 'var(--err-soft, #f6dcdc)',
                          color: m.present ? 'var(--accentDeep)' : 'var(--err)',
                          textDecoration: m.present ? 'none' : 'line-through',
                        }}
                      >
                        {fmtSunday(m.date)}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Attended <strong style={{ color: 'var(--ink)' }}>{ci.attended}</strong> of {attendanceTotal} class Sundays this year.
                  </div>
                </>
              ) : (
                <div style={{ padding: '24px 0', color: 'var(--muted)', fontSize: 13 }}>
                  Attendance will appear here once Sunday classes begin.
                </div>
              )}
            </div>
          </Suspense>

          <Suspense fallback={<SkeletonCard />}>
            <div className="card" style={{ padding: 24 }}>
              <div className="between" style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Donation</span>
                <SetuIcon.info color="var(--muted)"/>
              </div>
              {legacyPaid ? (
                <div style={{ marginBottom: 18 }}>
                  <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)', fontSize: 12 }}>Completed · {enrollPeriodLabel}</span>
                  <div style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5, marginTop: 12 }}>
                    Your {enrollPeriodLabel} Bala Vihar contribution is recorded as completed. Thank you — no further action needed for this year.
                  </div>
                </div>
              ) : isEnrolled && suggestedAmount !== null ? (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em' }}>${givenForPeriod}</span>
                    <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 14 }}>of ${suggestedAmount} suggested</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ width: `${donationPct}%`, height: '100%', background: 'var(--accent)' }}/>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>
                    {isLegacyPeriod
                      ? `Payment pending · ${enrollPeriodLabel}`
                      : `${donationComplete ? 'Thank you — received in full' : `$${givenForPeriod} of $${suggestedAmount}`}${enrollPeriodLabel ? ` · ${enrollPeriodLabel}` : ''}`}
                  </div>
                </>
              ) : (
                <div style={{ marginBottom: 18 }}>
                  <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>Any amount welcome</span>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>A charitable gift to Chinmaya Mission Toronto.</div>
                </div>
              )}
              {showGive && (
                <>
                  <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5, marginBottom: 18 }}>
                    Suggested, not required. Any amount welcome. Donations are tax-deductible.
                  </p>
                  <Link href={donateUrl} className="btn btn--p btn--block" style={{ display: 'flex' }}>
                    {donationComplete ? 'Give more' : 'Give donation'}
                  </Link>
                </>
              )}
            </div>
          </Suspense>
        </div>

        {/* Generic cards for non-BV active enrollments (Phase F) */}
        {otherProgramCards.length > 0 && (
          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {otherProgramCards.map((card) => (
              <div key={card.eid} className="card" style={{ padding: 20 }}>
                <div className="between" style={{ marginBottom: 10 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600 }}>{card.label}{card.termLabel ? ` · ${card.termLabel}` : ''}</h3>
                  <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>Enrolled</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
                  {card.showDonation
                    ? 'See dashboard for donation details.'
                    : 'No donation required for this program.'}
                </div>
                <Link href={`/family/enroll/${card.programKey}`} className="btn btn--s" style={{ textDecoration: 'none', display: 'inline-block' }}>
                  View enrollment →
                </Link>
              </div>
            ))}
          </div>
        )}

        <div className="card" style={{ padding: 24, marginTop: 18 }}>
          <div className="between" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Upcoming</h3>
            <Link href="/family/calendar" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>View calendar →</Link>
          </div>
          {upcomingEntries.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>No upcoming class dates published yet.</div>
          ) : (
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              {upcomingEntries.map((entry) => {
                const e = fmtUpcoming(entry);
                const noClass = entry.kind === 'no-class';
                return (
                  <div key={entry.entryId} className="row" style={{ gap: 12, minWidth: 200 }}>
                    <div style={{ width: 46, padding: '6px 0', textAlign: 'center', background: noClass ? 'var(--surface2)' : 'var(--accentSoft)', borderRadius: 'var(--radiusSm)' }}>
                      <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{e.m}</div>
                      <div style={{ fontSize: 16, fontWeight: 600, marginTop: -2, color: noClass ? 'var(--muted)' : 'var(--accentDeep)' }}>{e.d}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{e.t}</div>
                      {e.sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.sub}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
