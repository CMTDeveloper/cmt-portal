import Link from 'next/link';
import { SetuAvatar, SetuIcon } from '@cmt/ui';
import { AllergyCallout, SectionLabel } from '@/features/family/components/atoms';
import type { ChildProfile, ChildProfileProgram, ChildProgramAttendance } from './get-child-profile';

interface ChildProfileViewProps {
  profile: ChildProfile;
  editHref?: string;
}

// ─── shared bits ────────────────────────────────────────────────────────────────

/** A thin middot separator between inline metadata items. */
function Dot() {
  return (
    <span aria-hidden style={{ color: 'var(--line2)' }}>
      ·
    </span>
  );
}

/** A small icon + label cell for a program's term/location meta row. */
function MetaItem({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--body-text)' }}>
      <span aria-hidden style={{ display: 'inline-flex', color: 'var(--muted)' }}>
        {icon}
      </span>
      {children}
    </span>
  );
}

// ─── attendance ─────────────────────────────────────────────────────────────────

// A calm, secondary note for the not-linked / no-record / no-attendance states —
// muted text on a recessed surface so it reads as informational, never alarming.
function renderAttendanceNote(text: string) {
  return (
    <div
      style={{
        marginTop: 14,
        padding: '11px 13px',
        borderRadius: 'var(--radiusSm)',
        background: 'var(--surface2)',
        fontSize: 13,
        color: 'var(--muted)',
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
}

// The rewarding state: a labelled "{attended} of {total}" line, a confident
// percentage, and a marks heatmap (present = accent, absent = err). Cells stay
// ~14px and wrap cleanly so a long term reads at a glance on a phone.
function renderAttendanceData(att: ChildProgramAttendance) {
  return (
    <div
      style={{
        marginTop: 14,
        paddingTop: 14,
        borderTop: '1px solid var(--line)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--body-text)' }}>
          <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>
            {att.attended} of {att.total}
          </strong>{' '}
          classes attended
        </span>
        <span
          style={{
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: 'var(--accentDeep)',
          }}
        >
          {att.attendedPct}%
        </span>
      </div>
      <div
        role="img"
        aria-label={`${att.attended} of ${att.total} classes attended, ${att.attendedPct} percent`}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}
      >
        {att.marks.map((m, i) => (
          <span
            key={i}
            data-testid="att-cell"
            title={`${m.date} · ${m.present ? 'present' : 'absent'}`}
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              background: m.present ? 'var(--accent)' : 'var(--err)',
              opacity: m.present ? 0.85 : 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function renderAttendance(att: ChildProgramAttendance) {
  if (att.available && att.total > 0) {
    return renderAttendanceData(att);
  }
  if (att.available && att.total === 0) {
    return renderAttendanceNote('No classes recorded yet.');
  }
  if (!att.available && att.note) {
    return renderAttendanceNote(att.note);
  }
  return renderAttendanceNote('No attendance for this program.');
}

// ─── program card ─────────────────────────────────────────────────────────────

// One card per enrolled program. Active programs carry a slim accent rail at the
// top — the same "rewarding signal" used on the seva roster — so the page reads
// like a confident class roster rather than a flat list.
function renderProgramCard(p: ChildProfileProgram) {
  const isActive = p.status === 'active';
  return (
    <div
      key={p.eid}
      className="card"
      style={{
        padding: 0,
        overflow: 'hidden',
        borderColor: isActive ? 'var(--accent)' : 'var(--line)',
      }}
    >
      {isActive && <div aria-hidden style={{ height: 3, background: 'var(--accent)' }} />}
      <div style={{ padding: 'clamp(16px, 4vw, 20px)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--ink)',
                lineHeight: 1.25,
                letterSpacing: '-0.01em',
              }}
            >
              {p.label}
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                marginTop: 8,
                fontSize: 13,
              }}
            >
              <MetaItem icon={<SetuIcon.calendar width={14} height={14} />}>{p.term}</MetaItem>
              {p.location && (
                <>
                  <Dot />
                  <MetaItem icon={<SetuIcon.home width={14} height={14} />}>{p.location}</MetaItem>
                </>
              )}
            </div>
          </div>
          <span
            className="pill"
            style={{
              flex: '0 0 auto',
              textTransform: 'capitalize',
              fontWeight: 600,
              background: isActive ? 'var(--accentSoft)' : 'var(--surface2)',
              color: isActive ? 'var(--accentDeep)' : 'var(--muted)',
            }}
          >
            {p.status}
          </span>
        </div>
        {renderAttendance(p.attendance)}
      </div>
    </div>
  );
}

// ─── quick-stats strip ──────────────────────────────────────────────────────────

// A small at-a-glance band. The program count and (when any attendance exists)
// the overall attended % each render as one contiguous text node — "3 programs",
// "90% attendance" — so the phrase reads naturally and the % clause is dropped
// wholesale when there's nothing to show. A leading icon chip keeps it warm.
function renderQuickStats(stats: ChildProfile['stats']) {
  const programWord = stats.programCount === 1 ? 'program' : 'programs';
  return (
    <div
      className="card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        marginBottom: 6,
        background: 'var(--surface)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          flex: '0 0 auto',
          borderRadius: 999,
          background: 'var(--accentSoft)',
          color: 'var(--accent)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SetuIcon.people width={15} height={15} />
      </span>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          fontSize: 14,
          color: 'var(--body-text)',
          fontWeight: 600,
        }}
      >
        <span style={{ color: 'var(--ink)' }}>
          {stats.programCount} {programWord}
        </span>
        {stats.hasAnyAttendance && (
          <>
            <Dot />
            <span style={{ color: 'var(--accentDeep)' }}>{stats.overallAttendedPct}% attendance</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── empty state ──────────────────────────────────────────────────────────────

// Warm, branded empty state — the heart-in-rosette motif lifted from the seva
// browser, with the Enroll CTA front and centre.
function renderEmptyPrograms() {
  return (
    <div
      className="card"
      style={{
        padding: 'clamp(28px, 7vw, 40px) 24px',
        textAlign: 'center',
        background: 'var(--surface)',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 72,
          height: 72,
          borderRadius: 999,
          background: 'var(--accentSoft)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 999,
            background: 'var(--surface)',
            color: 'var(--accent)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SetuIcon.heart width={22} height={22} />
        </div>
      </div>
      <p style={{ fontSize: 17, color: 'var(--ink)', fontWeight: 600, letterSpacing: '-0.01em' }}>
        Not enrolled in any programs yet
      </p>
      <p
        style={{
          fontSize: 14,
          color: 'var(--muted)',
          marginTop: 8,
          maxWidth: 320,
          marginInline: 'auto',
          lineHeight: 1.55,
        }}
      >
        Bala Vihar, music, and language classes appear here once you enrol — pick one to get started.
      </p>
      <Link
        href="/family/enroll"
        className="btn btn--p"
        style={{ marginTop: 20, display: 'inline-flex', minHeight: 44 }}
      >
        Enroll in a program
      </Link>
    </div>
  );
}

// ─── main component ─────────────────────────────────────────────────────────────

export function ChildProfileView({ profile, editHref }: ChildProfileViewProps) {
  const { stats } = profile;
  const name = `${profile.firstName} ${profile.lastName}`;
  const subLine =
    profile.type === 'Child'
      ? `Child${profile.schoolGrade ? ` · ${profile.schoolGrade}` : ''}`
      : 'Adult';

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
        <SetuAvatar name={name} size={72} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 'clamp(26px, 7vw, 30px)', fontWeight: 400, lineHeight: 1.1 }}>{name}</h1>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
              marginTop: 6,
              fontSize: 13,
              color: 'var(--muted)',
            }}
          >
            <span>{subLine}</span>
            {profile.birthMonthYear && (
              <>
                <Dot />
                <span>Born {profile.birthMonthYear}</span>
              </>
            )}
            <Dot />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>MID {profile.mid}</span>
          </div>
        </div>
      </header>

      {profile.foodAllergies && (
        <AllergyCallout severity="severe" summary={profile.foodAllergies} detail="Please inform class teacher." />
      )}

      {renderQuickStats(stats)}

      <SectionLabel>Programs</SectionLabel>
      {profile.programs.length === 0 ? (
        renderEmptyPrograms()
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {profile.programs.map((p) => renderProgramCard(p))}
        </div>
      )}

      {profile.pastPrograms.length > 0 && (
        <details style={{ marginTop: 18 }}>
          <summary
            className="focus-ring"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: 'var(--muted)',
              cursor: 'pointer',
              minHeight: 44,
              fontWeight: 600,
            }}
          >
            <SetuIcon.chevron width={14} height={14} />
            Past programs ({profile.pastPrograms.length})
          </summary>
          <div className="col" style={{ gap: 6, marginTop: 10 }}>
            {profile.pastPrograms.map((p) => (
              <div
                key={p.eid}
                style={{
                  padding: '10px 13px',
                  borderRadius: 'var(--radiusSm)',
                  background: 'var(--surface2)',
                  fontSize: 13,
                  color: 'var(--muted)',
                }}
              >
                <span style={{ color: 'var(--body-text)', fontWeight: 600 }}>{p.label}</span> · {p.term} · Ended
              </div>
            ))}
          </div>
        </details>
      )}

      {editHref && (
        <div style={{ marginTop: 22 }}>
          <Link href={editHref} className="btn btn--s" style={{ display: 'inline-flex', minHeight: 44 }}>
            <SetuIcon.edit width={14} height={14} /> Edit details
          </Link>
        </div>
      )}
    </div>
  );
}
