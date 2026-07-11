import { connection } from 'next/server';
import Link from 'next/link';
import { SetuLogo, SetuAvatar } from '@cmt/ui';
import { displayFid } from '@cmt/shared-domain';
import { CspRoot, Stat } from '@/features/family/components/atoms';
import { flags } from '@/lib/flags';
import { mockFamily } from '@/features/family/data/mock';
import { getCurrentFamily } from '@/features/setu/members/get-current-family';
import { PendingJoinRequestsPanel } from '@/features/family/components/pending-join-requests-panel';
import { CompleteDonationButton } from '@/features/family/components/complete-donation-button';
import { loadFamilyDashboard, type BvChildView } from './_helpers/load-dashboard';
import {
  buildFamilyDashboardModel,
  type FamilyDashboardModel,
  type ActionItem,
} from './_helpers/dashboard-model';

/** The web href for an action item. Kept out of the model so the mobile API
 *  stays UI-path-free; the web maps each kind to its route here. Written as an
 *  if-chain (not a bare single-case switch) so it always returns a string under
 *  noImplicitReturns as new ActionItem kinds are added in Slice 2. */
function actionHref(item: ActionItem, model: FamilyDashboardModel): string {
  if (item.kind === 'donation') return model.donateUrl;
  return model.donateUrl; // fallback — unreachable today (donation is the only kind)
}

function FamilyIdCallout({ fid, legacyFid, mobile = false }: { fid: string; legacyFid?: string | null; mobile?: boolean }) {
  // Migrated families still recognise their legacy check-in ID; show it quietly
  // under the new ID with a note that it is going away, so families learn the
  // new number organically (no mass announcement). Net-new families have no
  // legacyFid and see only the new ID.
  const showLegacy = !!legacyFid && legacyFid !== fid;
  return (
    <div
      data-testid="family-id-callout"
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 4,
        padding: mobile ? '10px 12px' : '12px 16px',
        background: 'var(--accentSoft)',
        border: '1px solid var(--line2)',
        borderRadius: 'var(--radiusSm)',
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--accentDeep)', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>
        Family ID
      </span>
      <strong
        data-testid="family-id-value"
        style={{
          fontSize: mobile ? 32 : 36,
          lineHeight: 1.05,
          color: 'var(--ink)',
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '.04em',
          whiteSpace: 'nowrap',
        }}
      >
        {fid}
      </strong>
      {showLegacy && (
        <div
          data-testid="family-legacy-id"
          style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--line2)', display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            Old check-in ID {legacyFid}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.3, maxWidth: 220 }}>
            Being phased out - please use your new Family ID above.
          </span>
        </div>
      )}
    </div>
  );
}

export default async function FamilyDashboardPage() {
  await connection();

  let managerName = 'Family member';
  let memberCount = mockFamily.members.length;
  let displayMembers: { name: string; mid?: string }[] = mockFamily.members.map((m) => ({ name: m.name }));
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
      memberCount = data.members.length;
      familyFid = displayFid(data.family);
      familyLegacyId = data.family.legacyFid;
      displayMembers = data.members.map((m) => ({ name: `${m.firstName} ${m.lastName}`, mid: m.mid }));
      const dash = await loadFamilyDashboard(data.family, data.members);
      model = dash.model;
      bvChildren = dash.bvChildren;
      familyCounts = dash.familyCounts;
    }
  }

  const { isEnrolled, enrollPeriodLabel, enrolledPill, actionItems } = model;
  const { complete: donationComplete } = model.donation;

  const trimmedFirst = (managerName.split(' ')[0] ?? '').trim();
  const firstName = trimmedFirst || null;
  const todayLabel = new Date().toLocaleDateString('en-CA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Toronto',
  });

  const donationPaid = model.legacyPaid || donationComplete;
  const donationStatus = model.teacherManaged ? 'Off-portal' : donationPaid ? 'Paid' : isEnrolled ? 'Pending' : 'Not enrolled';

  const hasActions = actionItems.length > 0 || isManager;

  // Shared BV section body (identical logic on both layouts).
  const bvSection = (
    <>
      <div className="row" style={{ gap: 18, flexWrap: 'wrap', marginBottom: 16 }}>
        <Stat label="Academic year" value={enrollPeriodLabel ?? '—'} />
        <Stat label="Enrollment" value={model.bvState === 'none' ? 'Not enrolled' : 'Enrolled'} />
        <Stat label="Donation" value={donationStatus} />
      </div>
      {model.donation.showGive && !donationComplete && model.eid && (
        <div style={{ marginBottom: 18 }}>
          <CompleteDonationButton eid={model.eid} amountCAD={model.suggestedAmount ?? 0} label="Complete donation" />
        </div>
      )}
      {bvChildren.length > 0 && (
        <div className="col" style={{ gap: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>Children</div>
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
      )}
      {!isEnrolled && (
        familyCounts.children === 0 ? (
          <Link href="/family/members/new" className="btn btn--p" style={{ textDecoration: 'none', display: 'inline-block', marginTop: 8 }}>
            Add a child to enroll
          </Link>
        ) : (
          <Link href="/family/enroll" className="btn btn--p" style={{ textDecoration: 'none', display: 'inline-block', marginTop: 8 }}>
            Enroll now
          </Link>
        )
      )}
    </>
  );

  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden">
        <CspRoot style={{ minHeight: '100dvh' }}>
          <div style={{ padding: '14px 18px 90px', overflowY: 'auto', minHeight: '100dvh' }}>
            <div className="between" style={{ marginBottom: 22 }}>
              <SetuLogo size={18} />
              <SetuAvatar name={managerName} size={32} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.02em' }}>{todayLabel}</p>
              <h1 style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 600, marginTop: 4, letterSpacing: '-0.02em' }}>
                {firstName ? `Hari OM, ${firstName}.` : 'Hari OM!'}
              </h1>
            </div>

            {/* Block 1 — Family */}
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div className="between" style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Family · {familyCounts.children} {familyCounts.children === 1 ? 'child' : 'children'} · {familyCounts.adults} {familyCounts.adults === 1 ? 'adult' : 'adults'}</span>
                <Link href="/family/members" className="focus-ring" style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Manage family</Link>
              </div>
              {familyFid && (
                <div style={{ marginBottom: 14 }}>
                  <FamilyIdCallout fid={familyFid} legacyFid={familyLegacyId} mobile />
                </div>
              )}
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {displayMembers.map((m, i) => {
                  const avatar = (<div style={{ border: '2px solid var(--surface)', borderRadius: '50%' }}><SetuAvatar name={m.name} size={36} /></div>);
                  return (
                    <div key={i} style={{ marginLeft: i > 0 ? -8 : 0 }}>
                      {m.mid ? <Link href={`/family/members/${m.mid}/profile`} className="focus-ring" title={m.name} style={{ display: 'inline-flex', borderRadius: '50%' }}>{avatar}</Link> : avatar}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Block 2 — Action Items */}
            {hasActions && (
              <div style={{ marginBottom: 12 }}>
                {isManager && <PendingJoinRequestsPanel compact />}
                {actionItems.map((item) => (
                  <div key={item.kind} className="card" style={{ padding: 16, marginTop: isManager ? 12 : 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{item.title}</div>
                    <Link href={actionHref(item, model)} className="btn btn--p btn--block" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>{item.ctaLabel}</Link>
                  </div>
                ))}
              </div>
            )}

            {/* Block 3 — Bala Vihar */}
            <div className="card" style={{ padding: 16 }}>
              <div className="between" style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}><em className="sa">Bala Vihar</em></span>
                <span className="pill" style={{ background: enrolledPill.bg, color: enrolledPill.fg }}>{enrolledPill.text}</span>
              </div>
              {bvSection}
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
        </header>

        {/* Block 1 — Family (the three metric boxes were removed per Vaibhav's
            2026-07-04 feedback; the child/adult counts moved under this card). */}
        <div className="card" style={{ padding: 24, marginBottom: 18 }}>
          <div className="between">
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>Family · {memberCount} member{memberCount !== 1 ? 's' : ''}</h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {familyCounts.children} {familyCounts.children === 1 ? 'child' : 'children'} · {familyCounts.adults} {familyCounts.adults === 1 ? 'adult' : 'adults'}
              </p>
              {familyFid && (
                <div style={{ marginTop: 14 }}>
                  <FamilyIdCallout fid={familyFid} legacyFid={familyLegacyId} />
                </div>
              )}
            </div>
            <Link href="/family/members" className="btn btn--s" style={{ textDecoration: 'none' }}>Manage family</Link>
          </div>
        </div>

        {/* Block 2 — Action Items */}
        {hasActions && (
          <div style={{ marginBottom: 18 }}>
            {isManager && <PendingJoinRequestsPanel />}
            {actionItems.length > 0 && (
              <div className="card" style={{ padding: 24, marginTop: isManager ? 18 : 0 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Action items</h3>
                <div className="col" style={{ gap: 12 }}>
                  {actionItems.map((item) => (
                    <div key={item.kind} className="between">
                      <span style={{ fontSize: 13 }}>{item.title}</span>
                      <Link href={actionHref(item, model)} className="btn btn--p" style={{ textDecoration: 'none' }}>{item.ctaLabel}</Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Block 3 — Bala Vihar */}
        <div className="card" style={{ padding: 24 }}>
          <div className="between" style={{ marginBottom: 18 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}><em className="sa">Bala Vihar</em>{enrollPeriodLabel ? ` · ${enrollPeriodLabel}` : ''}</h3>
            <span className="pill" style={{ background: enrolledPill.bg, color: enrolledPill.fg }}>{enrolledPill.text}</span>
          </div>
          {bvSection}
        </div>
      </div>
    </>
  );
}
