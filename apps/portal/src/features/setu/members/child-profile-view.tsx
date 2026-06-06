import Link from 'next/link';
import { SetuAvatar } from '@cmt/ui';
import { AllergyCallout, SectionLabel } from '@/features/family/components/atoms';
import type { ChildProfile, ChildProfileProgram, ChildProgramAttendance } from './get-child-profile';

interface ChildProfileViewProps {
  profile: ChildProfile;
  editHref?: string;
}

function renderAttendance(att: ChildProgramAttendance) {
  if (att.available && att.total > 0) {
    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 8 }}>
          {att.attended} of {att.total} · {att.attendedPct}%
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {att.marks.map((m, i) => (
            <span
              key={i}
              data-testid="att-cell"
              title={m.date}
              style={{
                width: 14,
                height: 14,
                borderRadius: 4,
                background: m.present ? 'var(--accent)' : 'var(--err)',
                opacity: m.present ? 0.8 : 1,
              }}
            />
          ))}
        </div>
      </div>
    );
  }
  if (att.available && att.total === 0) {
    return <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>No classes recorded yet.</div>;
  }
  if (!att.available && att.note) {
    return <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>{att.note}</div>;
  }
  return <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>No attendance for this program.</div>;
}

function renderProgramCard(p: ChildProfileProgram) {
  return (
    <div key={p.eid} className="card" style={{ padding: 18, marginBottom: 12 }}>
      <div className="between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{p.label}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {p.term}{p.location ? ` · ${p.location}` : ''}
          </div>
        </div>
        <span
          className="pill"
          style={{
            flex: '0 0 auto',
            textTransform: 'capitalize',
            fontWeight: 600,
            background: p.status === 'active' ? 'var(--accentSoft)' : 'var(--surface2)',
            color: p.status === 'active' ? 'var(--accentDeep)' : 'var(--muted)',
          }}
        >
          {p.status}
        </span>
      </div>
      {renderAttendance(p.attendance)}
    </div>
  );
}

export function ChildProfileView({ profile, editHref }: ChildProfileViewProps) {
  const { stats } = profile;
  const name = `${profile.firstName} ${profile.lastName}`;
  const subLine =
    profile.type === 'Child'
      ? `Child${profile.schoolGrade ? ` · ${profile.schoolGrade}` : ''}`
      : 'Adult';
  const programWord = stats.programCount === 1 ? 'program' : 'programs';
  const quickStats = stats.hasAnyAttendance
    ? `${stats.programCount} ${programWord} · ${stats.overallAttendedPct}% attendance`
    : `${stats.programCount} ${programWord}`;

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <SetuAvatar name={name} size={64} />
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 400, lineHeight: 1.1 }}>{name}</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{subLine}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>MID {profile.mid}</div>
        </div>
      </header>

      {profile.foodAllergies && (
        <AllergyCallout severity="severe" summary={profile.foodAllergies} detail="Please inform class teacher." />
      )}

      <div style={{ fontSize: 13, color: 'var(--body-text)', marginBottom: 4 }}>{quickStats}</div>

      <SectionLabel>Programs</SectionLabel>
      {profile.programs.length === 0 ? (
        <div className="card" style={{ padding: 20, background: 'var(--accentSoft)', border: '1px solid var(--line)' }}>
          <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 12 }}>Not enrolled in any programs yet</div>
          <Link href="/family/enroll" className="btn btn--s" style={{ display: 'inline-flex' }}>Enroll in a program</Link>
        </div>
      ) : (
        profile.programs.map((p) => renderProgramCard(p))
      )}

      {profile.pastPrograms.length > 0 && (
        <details style={{ marginTop: 18 }}>
          <summary style={{ fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
            Past programs ({profile.pastPrograms.length})
          </summary>
          <div className="col" style={{ gap: 6, marginTop: 10 }}>
            {profile.pastPrograms.map((p) => (
              <div key={p.eid} style={{ fontSize: 13, color: 'var(--muted)' }}>
                {p.label} · {p.term} · Ended
              </div>
            ))}
          </div>
        </details>
      )}

      {editHref && (
        <div style={{ marginTop: 22 }}>
          <Link href={editHref} className="btn btn--s" style={{ display: 'inline-flex' }}>Edit details</Link>
        </div>
      )}
    </div>
  );
}
