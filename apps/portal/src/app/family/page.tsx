import { connection } from 'next/server';
import Link from 'next/link';
import type { ReactNode, SVGProps, CSSProperties } from 'react';
import { SetuLogo, SetuAvatar, SetuIcon } from '@cmt/ui';
import { displayFid } from '@cmt/shared-domain';
import { CspRoot } from '@/features/family/components/atoms';
import { flags } from '@/lib/flags';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { PendingJoinRequestsPanel } from '@/features/family/components/pending-join-requests-panel';
import { CompleteDonationButton } from '@/features/family/components/complete-donation-button';
import { loadFamilyDashboard, type BvChildView } from './_helpers/load-dashboard';
import { buildFamilyDashboardModel, type FamilyDashboardModel } from './_helpers/dashboard-model';

// The legacy check-in ID is retired at the end of the calendar year. Kept as
// named constants so the copy is trivial to re-date (long form on desktop, short
// on the narrower mobile card).
const RETIRE_DATE_LONG = 'December 31, 2026';
const RETIRE_DATE_SHORT = 'Dec 31, 2026';

// ── Icons not in the shared SetuIcon set (server-safe inline SVG) ──────────────
const iconBase = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function IconBook(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...iconBase} {...p}>
      <path d="M2 4h5.5A2.5 2.5 0 0 1 10 6.5V21a2 2 0 0 0-2-2H2z" />
      <path d="M22 4h-5.5A2.5 2.5 0 0 0 14 6.5V21a2 2 0 0 1 2-2h6z" />
    </svg>
  );
}

function IconGear(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...iconBase} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconUserCheck(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...iconBase} {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <polyline points="16 11 18 13 22 9" />
    </svg>
  );
}

/** A faint decorative temple line-drawing for the greeting header. Purely
 *  ornamental — hidden from assistive tech and non-interactive. */
function TempleMotif({ style }: { style?: CSSProperties }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 240 200"
      width="240"
      height="200"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="1.4"
      strokeLinejoin="round"
      strokeLinecap="round"
      style={{ pointerEvents: 'none', ...style }}
    >
      <line x1="150" y1="10" x2="150" y2="40" />
      <path d="M150 13 L169 18.5 L150 24 Z" />
      <path d="M146 40 h8 l-2 -6 h-4 z" />
      <path d="M150 40 C 140 70, 128 100, 118 132 L 182 132 C 172 100, 160 70, 150 40 Z" />
      <path d="M150 62 C 144 84, 138 106, 133 124" />
      <path d="M150 62 C 156 84, 162 106, 167 124" />
      <line x1="126" y1="112" x2="174" y2="112" />
      <line x1="122" y1="123" x2="178" y2="123" />
      <rect x="112" y="132" width="76" height="40" />
      <path d="M140 172 v-20 a10 10 0 0 1 20 0 v20" />
      <path d="M108 132 v-15 l-8 15 z" />
      <path d="M192 132 v-15 l8 15 z" />
      <rect x="100" y="172" width="100" height="9" />
      <rect x="94" y="181" width="112" height="8" />
      <path d="M40 42 q6 -5 12 0 q6 -5 12 0" />
      <path d="M62 60 q5 -4 10 0 q5 -4 10 0" />
    </svg>
  );
}

// ── Presentational atoms for the ID card ───────────────────────────────────────

/** Circular tinted icon badge (accent-soft fill, coral glyph). */
function IconBadge({ children, size = 44 }: { children: ReactNode; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        background: 'var(--accentSoft)',
        color: 'var(--accent)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {children}
    </span>
  );
}

/** Small status pill — 'ok' (green, "New ID") or 'info' (teal, "Retiring Soon"). */
function StatusBadge({ tone, children }: { tone: 'ok' | 'info'; children: ReactNode }) {
  const c =
    tone === 'ok'
      ? { bg: 'var(--ok-soft)', fg: 'var(--ok)' }
      : { bg: 'var(--info-soft)', fg: 'var(--info-deep)' };
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 9px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}

/** "YOUR FAMILY ID" label + the big mono number. */
function FamilyIdValue({ fid, mobile = false }: { fid: string; mobile?: boolean }) {
  return (
    <div data-testid="family-id-callout" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accentDeep)' }}>
        Your Family ID
      </span>
      <strong
        data-testid="family-id-value"
        style={{
          fontSize: mobile ? 36 : 42,
          lineHeight: 1,
          color: 'var(--ink)',
          fontFamily: 'var(--mono)',
          fontWeight: 800,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '.01em',
          whiteSpace: 'nowrap',
        }}
      >
        {fid}
      </strong>
    </div>
  );
}

/** The new-vs-old ID transition copy. Rendered ONLY when the family has a legacy
 *  check-in ID (migrated families); net-new families never see this section. */
function IdTransition({ legacyFid, mobile = false }: { legacyFid: string; mobile?: boolean }) {
  return (
    <div data-testid="family-legacy-id" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <StatusBadge tone="ok">New ID</StatusBadge>
        <span style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.45 }}>
          Use this ID for all future registrations, payments, and communications.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          Old ID:{' '}
          <strong style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontWeight: 700 }}>{legacyFid}</strong>
        </span>
        <StatusBadge tone="info">Retiring Soon</StatusBadge>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        {mobile ? `Retires on ${RETIRE_DATE_SHORT}.` : `The old ID will be retired on ${RETIRE_DATE_LONG}.`}
      </div>
    </div>
  );
}

/** "FAMILY MEMBERS" adult/child counts + the Manage-family button. */
function FamilyMembers({ adults, children, mobile = false }: { adults: number; children: number; mobile?: boolean }) {
  const row = (n: number, label: string) => (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <IconBadge size={30}>
        <SetuIcon.user width={15} height={15} />
      </IconBadge>
      <span style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>
        {n} {label}
      </span>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        Family members
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {row(adults, adults === 1 ? 'Adult' : 'Adults')}
        {row(children, children === 1 ? 'Child' : 'Children')}
      </div>
      <Link
        href="/family/members"
        className={`btn btn--s${mobile ? ' btn--block' : ''}`}
        style={{ textDecoration: 'none', display: mobile ? 'flex' : 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 2 }}
      >
        <IconGear />
        Manage family
      </Link>
    </div>
  );
}

/** One Bala Vihar stat: tinted icon badge + uppercase label + colored value. */
function BvStat({ icon, label, value, valueColor }: { icon: ReactNode; label: string; value: string; valueColor: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1, minWidth: 0 }}>
      <IconBadge size={40}>{icon}</IconBadge>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 600, marginTop: 3, color: valueColor, letterSpacing: '-0.01em' }}>{value}</div>
      </div>
    </div>
  );
}

/** The reassurance footer banner ("Keep your Family ID handy…"). */
function KeepIdBanner() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        padding: '14px 18px',
        background: 'var(--info-soft)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
        <span style={{ color: 'var(--info-deep)', display: 'grid', placeItems: 'center' }}>
          <SetuIcon.shield width={16} height={16} />
        </span>
        <span style={{ fontSize: 13, color: 'var(--info-deep)', lineHeight: 1.45 }}>
          Keep your Family ID handy. You&apos;ll need it for all future interactions with Bala Vihar.
        </span>
      </div>
      <Link
        href="/docs"
        className="focus-ring"
        style={{ fontSize: 13, fontWeight: 600, color: 'var(--info-deep)', textDecoration: 'none', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        Learn more
        <SetuIcon.chevron width={13} height={13} />
      </Link>
    </div>
  );
}

export default async function FamilyDashboardPage() {
  await connection();

  let managerName = 'Family member';
  let isManager = false;
  let model: FamilyDashboardModel = buildFamilyDashboardModel({
    enrollments: [], donations: [], programsById: new Map(), legacyPaymentStatus: null, bvAttendedCount: 0,
  });
  let bvChildren: BvChildView[] = [];
  let familyCounts = { children: 0, adults: 0 };
  let familyFid: string | null = null;
  let familyLegacyId: string | null = null;

  if (flags.setuAuth) {
    const data = await getCurrentFamily();
    if (data) {
      const currentMember = data.members.find((m) => m.mid === data.currentMid);
      if (currentMember) managerName = `${currentMember.firstName} ${currentMember.lastName}`;
      isManager = data.isManager;
      familyFid = displayFid(data.family);
      familyLegacyId = data.family.legacyFid;
      const dash = await loadFamilyDashboard(data.family, data.members);
      model = dash.model;
      bvChildren = dash.bvChildren;
      familyCounts = dash.familyCounts;
    }
  }

  const { isEnrolled, enrollPeriodLabel, enrolledPill } = model;
  const { complete: donationComplete } = model.donation;

  const trimmedFirst = (managerName.split(' ')[0] ?? '').trim();
  const firstName = trimmedFirst || null;
  const todayLabel = new Date().toLocaleDateString('en-CA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Toronto',
  });

  const donationPaid = model.legacyPaid || donationComplete;
  const donationStatus = model.teacherManaged ? 'Off-portal' : donationPaid ? 'Paid' : isEnrolled ? 'Pending' : 'Not enrolled';
  const donationColor =
    donationStatus === 'Paid' ? 'var(--ok)' : donationStatus === 'Pending' ? 'var(--accent)' : 'var(--muted)';
  const enrollmentValue = model.bvState === 'none' ? 'Not enrolled' : 'Enrolled';
  const enrollmentColor = model.bvState === 'none' ? 'var(--muted)' : 'var(--ok)';
  const showLegacy = !!familyLegacyId && familyLegacyId !== familyFid;

  // The in-portal "Complete donation" prompt: an enrolled family with an unpaid,
  // portal-managed donation. Everything else (paid / teacher-managed / legacy)
  // suppresses it.
  const showDonatePrompt = model.donation.showGive && !donationComplete && !!model.eid;

  // Shared Bala Vihar tail: donation banner OR enroll CTA, then the per-child
  // attendance list (kept — it's real, and a prior regression hid attendance).
  const enrollCta = !isEnrolled && (
    familyCounts.children === 0 ? (
      <Link href="/family/members/new" className="btn btn--p" style={{ textDecoration: 'none', display: 'inline-block' }}>
        Add a child to enroll
      </Link>
    ) : (
      <Link href="/family/enroll" className="btn btn--p" style={{ textDecoration: 'none', display: 'inline-block' }}>
        Enroll now
      </Link>
    )
  );

  const childrenList = bvChildren.length > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
      <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Children</div>
      {bvChildren.map((c) => (
        <div key={c.mid} className="between" style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{c.firstName || 'Child'}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {c.levelName ?? 'Level pending'}
              {c.teacherNames.length > 0 ? ` · ${c.teacherNames.join(', ')}` : ''}
            </div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--accentDeep)' }}>
            {c.attendance.total > 0 ? `${c.attendance.present}/${c.attendance.total}` : '—'}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* ── Mobile ─────────────────────────────────────────────────────────── */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '14px 18px 90px', overflowY: 'auto', minHeight: '100dvh' }}>
            <div className="between" style={{ marginBottom: 18 }}>
              <SetuLogo size={18} />
              <SetuAvatar name={managerName} size={32} />
            </div>

            <div style={{ position: 'relative', overflow: 'hidden', marginBottom: 18 }}>
              <TempleMotif style={{ position: 'absolute', top: -18, right: -56, width: 168, height: 140, opacity: 0.1 }} />
              <div style={{ position: 'relative' }}>
                <p style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.02em' }}>{todayLabel}</p>
                <h1 style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>
                  {firstName ? `Hari OM, ${firstName}.` : 'Hari OM!'}
                </h1>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>Welcome back! Here&apos;s your family overview.</p>
              </div>
            </div>

            {/* Family ID card */}
            <div className="card" style={{ padding: 18, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <IconBadge size={52}>
                  <SetuIcon.people width={24} height={24} />
                </IconBadge>
                {familyFid ? <FamilyIdValue fid={familyFid} mobile /> : null}
              </div>
              {showLegacy && familyLegacyId ? <IdTransition legacyFid={familyLegacyId} mobile /> : null}
              <div style={{ height: 1, background: 'var(--line)' }} />
              <FamilyMembers adults={familyCounts.adults} children={familyCounts.children} mobile />
            </div>

            {/* Join requests (managers only; renders null when none) */}
            {isManager && <PendingJoinRequestsPanel compact />}

            {/* Bala Vihar card */}
            <div className="card" style={{ padding: 18, marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <IconBadge size={40}>
                    <IconBook />
                  </IconBadge>
                  <h2 style={{ fontSize: 16, fontWeight: 600 }}><em className="sa">Bala Vihar</em></h2>
                </div>
                <span className="pill" style={{ background: enrolledPill.bg, color: enrolledPill.fg, gap: 5 }}>
                  {model.bvState !== 'none' && <SetuIcon.check width={13} height={13} />}
                  {enrolledPill.text}
                </span>
              </div>
              <div style={{ height: 1, background: 'var(--line)', marginBottom: 16 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <BvStat icon={<SetuIcon.calendar width={20} height={20} />} label="Academic year" value={enrollPeriodLabel ?? '—'} valueColor="var(--ink)" />
                <BvStat icon={<IconUserCheck />} label="Enrollment status" value={enrollmentValue} valueColor={enrollmentColor} />
                <BvStat icon={<SetuIcon.heart width={20} height={20} />} label="Donation status" value={donationStatus} valueColor={donationColor} />
              </div>

              {showDonatePrompt && model.eid && (
                <div style={{ marginTop: 16, padding: 14, background: '#fdefe7', border: '1px solid var(--accentSoft)', borderRadius: 'var(--radiusSm)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--warn)', marginTop: 1 }}><SetuIcon.info width={16} height={16} /></span>
                    <span style={{ fontSize: 13, color: 'var(--body-text)', lineHeight: 1.45 }}>
                      Complete your donation to confirm your enrollment and support Bala Vihar.
                    </span>
                  </div>
                  <CompleteDonationButton eid={model.eid} amountCAD={model.suggestedAmount ?? 0} label="Complete donation" block />
                </div>
              )}
              {enrollCta && <div style={{ marginTop: 16 }}>{enrollCta}</div>}
              {childrenList && <div style={{ marginTop: 16 }}>{childrenList}</div>}
            </div>

            <KeepIdBanner />
          </div>
        </CspRoot>
      </div>

      {/* ── Desktop — layout.tsx owns the sidebar + main wrapper ────────────── */}
      <div className="hidden md:block">
        <header style={{ position: 'relative', overflow: 'hidden', marginBottom: 24 }}>
          <TempleMotif style={{ position: 'absolute', top: -22, right: 0, opacity: 0.11 }} />
          <div style={{ position: 'relative' }}>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>{todayLabel}</p>
            <h1 style={{ fontSize: 32, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>{firstName ? `Hari OM, ${firstName}.` : 'Hari OM!'}</h1>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6 }}>Welcome back! Here&apos;s your family overview.</p>
          </div>
        </header>

        {/* Family ID card — three zones: ID · transition · members */}
        <div className="card" style={{ padding: 24, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 28, alignItems: 'stretch' }}>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexShrink: 0 }}>
              <IconBadge size={56}>
                <SetuIcon.people width={26} height={26} />
              </IconBadge>
              {familyFid ? <FamilyIdValue fid={familyFid} /> : null}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
              {showLegacy && familyLegacyId ? <IdTransition legacyFid={familyLegacyId} /> : null}
            </div>
            <div style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch' }} />
            <div style={{ flexShrink: 0, minWidth: 176 }}>
              <FamilyMembers adults={familyCounts.adults} children={familyCounts.children} />
            </div>
          </div>
        </div>

        {/* Join requests (managers only; renders null when none) */}
        {isManager && <PendingJoinRequestsPanel />}

        {/* Bala Vihar card */}
        <div className="card" style={{ padding: 24, marginBottom: 18 }}>
          <div className="between" style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <IconBadge size={44}>
                <IconBook />
              </IconBadge>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 600 }}><em className="sa">Bala Vihar</em></h2>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Your enrollment and donation status</p>
              </div>
            </div>
            <span className="pill" style={{ background: enrolledPill.bg, color: enrolledPill.fg, gap: 6 }}>
              {model.bvState !== 'none' && <SetuIcon.check width={14} height={14} />}
              {enrolledPill.text}
            </span>
          </div>
          <div style={{ height: 1, background: 'var(--line)', marginBottom: 20 }} />
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <BvStat icon={<SetuIcon.calendar width={20} height={20} />} label="Academic year" value={enrollPeriodLabel ?? '—'} valueColor="var(--ink)" />
            <div style={{ width: 1, height: 44, background: 'var(--line)', margin: '0 8px' }} />
            <BvStat icon={<IconUserCheck />} label="Enrollment status" value={enrollmentValue} valueColor={enrollmentColor} />
            <div style={{ width: 1, height: 44, background: 'var(--line)', margin: '0 8px' }} />
            <BvStat icon={<SetuIcon.heart width={20} height={20} />} label="Donation status" value={donationStatus} valueColor={donationColor} />
          </div>

          {showDonatePrompt && model.eid && (
            <div style={{ marginTop: 20, padding: '14px 18px', background: '#fdefe7', border: '1px solid var(--accentSoft)', borderRadius: 'var(--radiusSm)', display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--warn)', display: 'grid', placeItems: 'center' }}><SetuIcon.info width={16} height={16} /></span>
                <span style={{ fontSize: 13, color: 'var(--body-text)' }}>Complete your donation to confirm your enrollment and support Bala Vihar.</span>
              </div>
              <CompleteDonationButton eid={model.eid} amountCAD={model.suggestedAmount ?? 0} label="Complete donation" />
            </div>
          )}
          {enrollCta && <div style={{ marginTop: 20 }}>{enrollCta}</div>}
          {childrenList && <div style={{ marginTop: 20 }}>{childrenList}</div>}
        </div>

        <KeepIdBanner />
      </div>
    </>
  );
}
