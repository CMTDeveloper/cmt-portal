import { Suspense } from 'react';
import { connection } from 'next/server';
import { cookies } from 'next/headers';
import Link from 'next/link';
import type { Metadata } from 'next';
import { verifyPortalSessionCookie } from '@cmt/firebase-shared/admin/session';
import { gradeLabel, isWelcomeTeam, type WithRole } from '@cmt/shared-domain';
import { getAllVisitorsView, type VisitorLevelGroup } from '@/features/setu/teacher/all-visitors';
import { AddVisitorForm } from '@/features/setu/visitors/add-visitor-form';
import { EditVisitorForm } from '@/features/setu/visitors/edit-visitor-form';
import { mostRecentSunday } from '@/features/setu/calendar/calendar';
import type { DoorGuestChild } from '@/features/setu/attendance/check-in-attendance';

export const metadata: Metadata = { title: 'Visitors · Chinmaya Setu' };

export default function WelcomeVisitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: 'var(--muted)' }}>Loading visitors…</div>}>
      <WelcomeVisitorsBody searchParams={searchParams} />
    </Suspense>
  );
}

// `await connection()` before any Firebase Admin read, or the build's
// "Collecting page data" pass tries to run it during prerender.
// The welcome layout already provides CspRoot, so brand tokens resolve here.
async function WelcomeVisitorsBody({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await connection();

  // Gate 2 of three, and it was MISSING until 2026-08-05 - this page had no
  // role check of its own, and the welcome layout only gates its DESKTOP
  // branch (the phone branch renders {children} straight through). So on a
  // phone, middleware was the only thing standing here.
  //
  // Not exploitable as it stood - canAccessRoute does deny the path - but "one
  // gate" is not the rule this codebase runs on, and this screen is about to
  // grow writes. A page that trusts middleware alone is one config edit away
  // from being open. Renders "Access denied" rather than redirecting: an
  // authorization redirect from inside a gated layout is what produces the
  // ERR_TOO_MANY_REDIRECTS bounce recorded elsewhere in this repo.
  const cookieStore = await cookies();
  const raw = await verifyPortalSessionCookie(cookieStore.get('__session')?.value ?? '').catch(() => null);
  if (!raw || !isWelcomeTeam(raw as unknown as WithRole)) {
    return (
      <div style={{ padding: 32, fontFamily: 'var(--body)' }}>
        <p style={{ color: 'var(--err)', fontSize: 14 }}>Access denied. Welcome-team role required.</p>
      </div>
    );
  }

  const { date: dateParam } = await searchParams;
  // Same rule the teacher visitors page uses, so the two screens agree on which
  // day they are showing when a date is absent or malformed.
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : mostRecentSunday();

  const view = await getAllVisitorsView(date);
  const grouped = view.groups.reduce((n, g) => n + g.children.length, 0);
  // A door guest's centre is recorded by neither guest source, so a child whose
  // grade matches a class at both centres appears under both. Say so, but only
  // when it is actually happening - an always-on caveat is noise.
  const appearsTwice = grouped > view.childCount;

  return (
    <div className="col" style={{ gap: 16, padding: '24px 20px', maxWidth: 960, margin: '0 auto', width: '100%' }}>
      <div className="between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Visitors</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
            Guests checked in at the door, grouped by the class their grade matches.
          </p>
        </div>
        {/* A plain GET form: no client JS, and the date stays in the URL so the
            view is shareable and survives a refresh. */}
        <form method="get" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor="visitors-date" style={{ fontSize: 13, color: 'var(--muted)' }}>Date</label>
          <input
            id="visitors-date"
            type="date"
            name="date"
            defaultValue={date}
            style={{
              minHeight: 38, padding: '0 10px', fontSize: 14,
              border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)',
              background: 'var(--surface)', color: 'var(--ink)',
            }}
          />
          <button
            type="submit"
            style={{
              minHeight: 38, padding: '0 14px', fontSize: 13, fontWeight: 600,
              border: '1px solid var(--line)', borderRadius: 'var(--radiusSm)',
              background: 'var(--surface)', color: 'var(--body-text)', cursor: 'pointer',
            }}
          >
            Show
          </button>
        </form>
      </div>

      {/* Recording a walk-in the kiosk did not catch. Takes the VIEWED date,
          not today, so a desk reviewing another Sunday files the guest where
          they are looking. */}
      <AddVisitorForm date={date} />

      <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, fontFeatureSettings: '"tnum"' }}>
        {view.childCount === 0
          ? 'No guests checked in on this date.'
          : `${view.childCount} ${view.childCount === 1 ? 'child' : 'children'} checked in.`}
        {appearsTwice
          ? ' A guest whose grade matches a class at both centres is listed under each, because the door does not record which centre they visited.'
          : ''}
      </p>

      {view.groups.map((g) => (
        <VisitorGroup key={`${g.location}:${g.levelId}`} group={g} date={date} />
      ))}

      {view.unmatched.length > 0 && (
        <section>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0 8px' }}>
            Not matched to a class ({view.unmatched.length})
          </h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 8px' }}>
            Their grade is missing or outside every enabled class, so no teacher sees them. A teacher
            can still add them from their own Visitors screen.
          </p>
          <div className="card" style={{ padding: 6 }}>
            {view.unmatched.map((c, i) => (
              <ChildRow key={`${c.parentEmail}:${c.name}:${i}`} child={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function VisitorGroup({ group, date }: { group: VisitorLevelGroup; date: string }) {
  return (
    <section>
      <div className="between" style={{ gap: 8, marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
          {group.location ? `${group.location} · ` : ''}{group.levelName}
          <span style={{ fontWeight: 500, color: 'var(--muted)' }}> · {group.ageLabel}</span>
        </h2>
        {/* Confirmation lives on the teacher's own screen, which is where the
            per-child contactKeys read is worth paying for. */}
        <Link
          href={`/teacher/levels/${group.levelId}/visitors?date=${date}`}
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--accentDeep)' }}
        >
          Open class ({group.children.length})
        </Link>
      </div>
      <div className="card" style={{ padding: 6 }}>
        {group.children.map((c, i) => (
          <ChildRow key={`${c.parentEmail}:${c.name}:${i}`} child={c} />
        ))}
      </div>
    </section>
  );
}

function ChildRow({ child }: { child: DoorGuestChild }) {
  const contact = [child.parentName, child.phone, child.parentEmail].filter(Boolean).join(' · ');
  const ref = child.editRef;
  return (
    <div
      data-testid="visitor-row"
      style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center',
        gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--line)',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{child.name || 'Unnamed guest'}</div>
        {contact && (
          <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {contact}
          </div>
        )}
      </div>
      <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
        {child.grade ? gradeLabel(child.grade) : 'No grade'}
      </span>
      {/* A DIRECT child of the wrapping flex row, not nested beside the grade:
          closed it is a small button that sits on this line, open it takes a
          full-width line of its own (`flex: 1 0 100%` on the form itself).

          Correctable only if it is one of OUR guest documents. Legacy door rows
          come from the standalone check-in app's own Firebase project, whose
          kiosk shut down 2026-08-03 - history, and history is read-only. */}
      {ref ? (
        <EditVisitorForm
          visitor={{
            docId: ref.docId,
            childIndex: ref.childIndex,
            name: child.name,
            grade: child.grade,
            ...ref.contact,
          }}
          siblingCount={ref.siblingCount}
        />
      ) : (
        <span
          style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}
          title="Recorded by the standalone door app, which is no longer running"
        >
          Door record
        </span>
      )}
    </div>
  );
}
