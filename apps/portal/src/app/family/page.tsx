import { Suspense } from 'react';
import { connection } from 'next/server';
import Link from 'next/link';
import { SetuLogo, SetuAvatar } from '@cmt/ui';
import { CspRoot, Stat, MetricCard, SkeletonCard } from '@/features/family/components/atoms';
import { flags } from '@/lib/flags';
import { mockFamily } from '@/features/family/data/mock';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { ContactsNudge } from '@/features/family/components/contacts-nudge';
import { PendingJoinRequestsPanel } from '@/features/family/components/pending-join-requests-panel';
import { shouldShowContactsNudge } from './_helpers/should-show-contacts-nudge';
import { VolunteeringSkillsNudge } from '@/features/family/components/volunteering-skills-nudge';
import { shouldShowVolunteeringSkillsNudge } from './_helpers/should-show-volunteering-nudge';
import { type CalendarEntry } from '@/features/setu/calendar/calendar';
import { deriveSevaCardView, type FamilySevaProgress } from '@/features/setu/seva/get-family-seva-progress';
import { SevaProgressCard } from '@/features/family/components/seva-progress-card';
import { type FamilyPrasadView } from '@/features/setu/prasad/family-assignment';
import { FamilyPrasadCard } from '@/features/setu/prasad/family-prasad-card';
import { loadFamilyDashboard } from './_helpers/load-dashboard';
import {
  buildFamilyDashboardModel,
  type FamilyDashboardModel,
} from './_helpers/dashboard-model';

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
  let displayMembers: { name: string; mid?: string }[] = mockFamily.members.map((m) => ({ name: m.name }));
  let currentMid: string | null = null;
  // Only managers can review/approve gated co-manager join requests.
  let isManager = false;
  // Upcoming class dates from the managed calendar (Slice 4b), by family location.
  let upcomingEntries: CalendarEntry[] = [];
  // One-time "add your other contacts" nudge — shown until the current member dismisses it (B3).
  let showContactsNudge = false;
  // One-time "set your volunteering skills" nudge — adults with no skills yet.
  let showVolunteeringNudge = false;

  // All BV-bespoke derivation (which enrollment drives the card, donation
  // status) lives in buildFamilyDashboardModel so it can be unit-tested with
  // multi-enrollment fixtures (see __tests__/dashboard-model.test.ts).
  // The default empty model renders the not-enrolled state for the mock /
  // non-setuAuth path; the real model is built below once data is loaded.
  let model: FamilyDashboardModel = buildFamilyDashboardModel({
    enrollments: [],
    donations: [],
    programsById: new Map(),
    legacyPaymentStatus: null,
    bvAttendedCount: 0,
  });
  // Seva-hours progress (Slice D). Default renders nothing (no seva year set);
  // the real value is read below once the family is loaded.
  let sevaProgress: FamilySevaProgress = { currentSevaYear: null, hoursPerYear: 20, hoursEarned: 0 };
  // Prasad seva assignment (Task 11). null = no rotation published for this
  // family yet (or no setu session) — the card renders nothing in that case.
  let prasad: FamilyPrasadView | null = null;

  if (flags.setuAuth) {
    const data = await getCurrentFamily();
    if (data) {
      const currentMember = data.members.find((m) => m.mid === data.currentMid);
      if (currentMember) {
        managerName = `${currentMember.firstName} ${currentMember.lastName}`;
        showContactsNudge = shouldShowContactsNudge(currentMember);
        showVolunteeringNudge = shouldShowVolunteeringSkillsNudge(currentMember);
      }
      currentMid = data.currentMid;
      isManager = data.isManager;
      familyName = data.family.name;
      memberCount = data.members.length;
      displayMembers = data.members.map((m) => ({ name: `${m.firstName} ${m.lastName}`, mid: m.mid }));

      // The BV-bespoke model, upcoming class dates, seva progress, and prasad
      // assignment are all composed by loadFamilyDashboard — shared verbatim
      // with GET /api/setu/dashboard (mobile) so the two never drift.
      const dash = await loadFamilyDashboard(data.family, data.members);
      model = dash.model;
      upcomingEntries = dash.upcoming;
      sevaProgress = dash.seva;
      prasad = dash.prasad;
    }
  }

  const {
    isEnrolled,
    kidsEnrolled,
    enrollPeriodLabel,
    donateUrl,
    otherProgramCards,
    enrolledPill,
  } = model;
  const { complete: donationComplete, showGive } = model.donation;

  // Greeting first name. The profile-completion gate (app/family/layout.tsx)
  // now hard-blocks any family with missing required member info — including a
  // missing firstName — and redirects to /complete-profile, so by the
  // time the dashboard renders the name is present. A null here only happens on
  // the mock/non-setuAuth path; the greeting falls back to "Hari OM!".
  const trimmedFirst = (managerName.split(' ')[0] ?? '').trim();
  const firstName = trimmedFirst || null;
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

  const sevaView = deriveSevaCardView(sevaProgress);
  const donationPaid = model.legacyPaid || donationComplete;
  // Teacher-managed BV offerings collect payment off-portal — there's nothing to
  // pay or track here, so show a neutral status, NOT a red "Pending".
  const donationStatus = model.teacherManaged
    ? 'Off-portal'
    : donationPaid
      ? 'Paid'
      : isEnrolled
        ? 'Pending'
        : 'Not enrolled';
  const donationStatusTone: 'ok' | 'warn' | 'err' = model.teacherManaged
    ? 'warn'
    : donationPaid
      ? 'ok'
      : 'err';
  const donationStatusSub = model.teacherManaged
    ? 'Managed by your teacher'
    : isEnrolled
      ? enrollPeriodLabel ?? 'Bala Vihar'
      : 'Enroll to set donation';

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
            {!showContactsNudge && showVolunteeringNudge && currentMid && (
              <VolunteeringSkillsNudge mid={currentMid} />
            )}
            {isManager && <PendingJoinRequestsPanel compact />}

            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}><em className="sa">Bala Vihar</em>{enrollPeriodLabel ? ` · ${enrollPeriodLabel}` : ''}</span>
                <span className="pill" style={{ background: enrolledPill.bg, color: enrolledPill.fg }}>{enrolledPill.text}</span>
              </div>
              <div className="row" style={{ gap: 14, marginBottom: 14 }}>
                <Stat label="Kids enrolled" value={String(kidsEnrolled)}/>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {model.bvState === 'enrolled'
                  ? 'Open a child’s profile to see their Sunday attendance.'
                  : model.bvState === 'registered'
                    ? 'Attend your first class or complete your donation to confirm enrollment.'
                    : 'Enroll your children to join Sunday Bala Vihar classes.'}
              </div>
              {model.confirmNudge && (
                <Link href={donateUrl} className="btn btn--p btn--block" style={{ marginTop: 12, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                  Give donation
                </Link>
              )}
              {!isEnrolled && (
                <Link href="/family/enroll" className="btn btn--s btn--block" style={{ marginTop: 12, display: 'block', textAlign: 'center', textDecoration: 'none' }}>Enroll now</Link>
              )}
            </div>

            {sevaView.show && (
              <div style={{ marginBottom: 12 }}>
                <SevaProgressCard
                  view={sevaView}
                  hoursEarned={sevaProgress.hoursEarned}
                  hoursPerYear={sevaProgress.hoursPerYear}
                  currentSevaYear={sevaProgress.currentSevaYear}
                />
              </div>
            )}

            {prasad && (
              <div style={{ marginBottom: 12 }}>
                <FamilyPrasadCard assignment={prasad} />
              </div>
            )}

            {/* Generic cards for non-BV active enrollments (Phase F) */}
            {otherProgramCards.map((card) => (
              <div key={card.eid} className="card" style={{ padding: 16, marginBottom: 12 }}>
                <div className="between" style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{card.label}{card.termLabel ? ` · ${card.termLabel}` : ''}</span>
                  <span className="pill" style={{ background: 'var(--accentSoft)', color: 'var(--accentDeep)' }}>Enrolled</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                  {card.showDonation
                    ? 'Open enrollment for donation details.'
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
                {displayMembers.map((m, i) => {
                  const avatar = (
                    <div style={{ border: '2px solid var(--surface)', borderRadius: '50%' }}>
                      <SetuAvatar name={m.name} size={36}/>
                    </div>
                  );
                  return (
                    <div key={i} style={{ marginLeft: i > 0 ? -8 : 0 }}>
                      {m.mid ? (
                        <Link href={`/family/members/${m.mid}/profile`} className="focus-ring" title={m.name} style={{ display: 'inline-flex', borderRadius: '50%' }}>{avatar}</Link>
                      ) : avatar}
                    </div>
                  );
                })}
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
          <div className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
            <div className="row" style={{ gap: 10 }}>
              <Link href="/family/programs" className="btn btn--s" style={{ textDecoration: 'none' }}>Programs</Link>
              {showGive && <Link href={donateUrl} className="btn btn--p">Give donation</Link>}
            </div>
            {model.confirmNudge && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, textAlign: 'right', maxWidth: 260 }}>
                Attend your first class or complete your donation to confirm enrollment.
              </div>
            )}
          </div>
        </header>

        {showContactsNudge && <ContactsNudge />}
        {!showContactsNudge && showVolunteeringNudge && currentMid && (
          <VolunteeringSkillsNudge mid={currentMid} />
        )}
        {isManager && <PendingJoinRequestsPanel />}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14, marginBottom: 18 }}>
          <MetricCard
            label="Donation status"
            value={donationStatus}
            sub={donationStatusSub}
            tone={donationStatusTone}
          />
          <MetricCard label="Bala Vihar" value={model.bvState === 'enrolled' ? 'Enrolled' : model.bvState === 'registered' ? 'Registered' : 'Not yet'} sub={enrollPeriodLabel ?? 'no active period'}/>
          <MetricCard label="Family"     value={String(memberCount)} sub={`${memberCount} member${memberCount !== 1 ? 's' : ''}`}/>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18 }}>
          <Suspense fallback={<SkeletonCard />}>
            <div className="card" style={{ padding: 24 }}>
              <div className="between" style={{ marginBottom: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600 }}><em className="sa">Bala Vihar</em>{enrollPeriodLabel ? ` · ${enrollPeriodLabel}` : ''}</h3>
                {/* Issue #23 (I2): the three-state model pill (Enrolled / Registered /
                    Not enrolled), rendered unconditionally to match the mobile BV card
                    (page.tsx:180). Previously desktop hardcoded a green "Enrolled" pill
                    whenever a BV enrollment existed, contradicting the confirm nudge. */}
                <span className="pill" style={{ background: enrolledPill.bg, color: enrolledPill.fg }}>{enrolledPill.text}</span>
              </div>
              {isEnrolled ? (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em' }}>{kidsEnrolled}</span>
                    <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 14 }}>
                      {kidsEnrolled === 1 ? 'child enrolled' : 'children enrolled'}
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.5, marginBottom: 18 }}>
                    Sunday attendance is tracked per child — open a child&apos;s profile to see their classes.
                  </p>
                  <Link href="/family/members" className="btn btn--s" style={{ textDecoration: 'none', display: 'inline-block' }}>
                    View members →
                  </Link>
                </>
              ) : (
                <>
                  <div style={{ padding: '8px 0 18px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>
                    Enroll your children to join Sunday Bala Vihar classes.
                  </div>
                  <Link href="/family/enroll" className="btn btn--p" style={{ textDecoration: 'none', display: 'inline-block' }}>
                    Enroll now
                  </Link>
                </>
              )}
            </div>
          </Suspense>
        </div>

        {sevaView.show && (
          <div style={{ marginTop: 18 }}>
            <SevaProgressCard
              view={sevaView}
              hoursEarned={sevaProgress.hoursEarned}
              hoursPerYear={sevaProgress.hoursPerYear}
              currentSevaYear={sevaProgress.currentSevaYear}
            />
          </div>
        )}

        {prasad && (
          <div style={{ marginTop: 18, maxWidth: 420 }}>
            <FamilyPrasadCard assignment={prasad} />
          </div>
        )}

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
                    ? 'Open enrollment for donation details.'
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
